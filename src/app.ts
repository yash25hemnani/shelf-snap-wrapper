import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import booksRoutes from "./routes/books.routes";
import { logger } from "./utils/logger";
import path from "path";
import adminRoutes from "./routes/admin.routes";

const app = express();
app.use(cors());
// Requests carry a base64 photo; Vercel caps bodies at 4.5 MB anyway.
app.use(express.json({ limit: "4mb" }));
app.use(pinoHttp({ logger }));

app.use("/admin", express.static(path.join(process.cwd(), "public", "admin")));

app.use("/api/admin", adminRoutes);
app.use(booksRoutes);

export default app;
