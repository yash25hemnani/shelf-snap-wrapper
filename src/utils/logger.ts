import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Keep bearer tokens out of request logs.
  redact: [
    "req.headers.authorization",
    'req.headers["x-vercel-oidc-token"]',
    'req.headers["x-vercel-proxy-signature"]',
  ],
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
});
