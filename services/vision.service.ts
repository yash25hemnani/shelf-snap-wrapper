import Groq from "groq-sdk";
import {
  MODEL_NAME,
  GEMINI_MODEL_NAME,
  SYSTEM_PROMPT,
} from "../constants/books.constants";
import { logger } from "../utils/logger";

export interface VisionInput {
  prompt: string;
  image: string; // base64, no data: prefix
  imageMimeType: string;
  // Defaults to SYSTEM_PROMPT (the /identify-books schema)
  systemPrompt?: string;
}

export interface VisionResult {
  provider: "groq" | "gemini";
  responseText: string;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

/** Thrown when Groq is rate limited and Gemini can't take over. */
export class ModelsUnavailableError extends Error {
  constructor() {
    super("Models not available");
    this.name = "ModelsUnavailableError";
  }
}

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent`;

// Gemini can hang under load; give up before the app's 60 s timeout.
const GEMINI_TIMEOUT_MS = 30_000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GROQ_API_KEY) {
  logger.error("Missing GROQ_API_KEY in .env — refusing to start.");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  logger.warn("GEMINI_API_KEY not set — no fallback when Groq is rate limited.");
}

// No SDK retries: on a 429 or outage we switch to Gemini instead of waiting.
const groq = new Groq({ apiKey: GROQ_API_KEY, maxRetries: 0 });

// Groq errors that Gemini can cover: rate limits, Groq server errors and
// network failures. Anything else (bad request, bad key) is rethrown.
function shouldFallBack(err: unknown) {
  return (
    err instanceof Groq.RateLimitError ||
    err instanceof Groq.InternalServerError ||
    err instanceof Groq.APIConnectionError
  );
}

async function callGroq({
  prompt,
  image,
  imageMimeType,
  systemPrompt = SYSTEM_PROMPT,
}: VisionInput) {
  const completion = await groq.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:${imageMimeType};base64,${image}` },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  // Groq's limit is per-minute tokens, so log what each scan costs
  const usage = completion.usage;
  logger.info(
    {
      provider: "groq",
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
    },
    "Model token usage",
  );

  return completion.choices[0]?.message?.content ?? "";
}

async function callGemini({
  prompt,
  image,
  imageMimeType,
  systemPrompt = SYSTEM_PROMPT,
}: VisionInput) {
  const response = await fetch(GEMINI_URL, {
    method: "POST",
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY ?? "",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: imageMimeType, data: image } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        // Less reasoning before answering, for a faster reply
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const usage = data.usageMetadata;
  logger.info(
    {
      provider: "gemini",
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount,
      thoughtsTokens: usage?.thoughtsTokenCount,
      totalTokens: usage?.totalTokenCount,
    },
    "Model token usage",
  );

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

/**
 * Asks a vision model to read the spines in the photo. Tries Groq first; if
 * Groq is rate limited or down, falls back to Gemini. Throws
 * ModelsUnavailableError if both are out. Other Groq errors are rethrown.
 */
export async function identifySpines(input: VisionInput): Promise<VisionResult> {
  try {
    return { provider: "groq", responseText: await callGroq(input) };
  } catch (err) {
    if (!shouldFallBack(err)) throw err;
    logger.warn({ err }, "Groq unavailable, falling back to Gemini");
  }

  if (!GEMINI_API_KEY) throw new ModelsUnavailableError();

  try {
    return { provider: "gemini", responseText: await callGemini(input) };
  } catch (err) {
    logger.error({ err }, "Gemini fallback failed");
    throw new ModelsUnavailableError();
  }
}
