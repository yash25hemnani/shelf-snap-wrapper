import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import booksRoutes from "./routes/books.routes";
import { logger } from "./utils/logger";
import path from "path";
import adminRoutes from "./routes/admin.routes";
import catalogRoutes from "./routes/catalog.routes";

const app = express();
app.use(cors());
// Requests carry a base64 photo; Vercel caps bodies at 4.5 MB anyway.
app.use(express.json({ limit: "4mb" }));
app.use(pinoHttp({ logger }));

app.use("/admin", express.static(path.join(process.cwd(), "public", "admin")));

// Banner photos for the web catalog. On Vercel the CDN serves public/ itself.
app.use(
  "/catalog",
  express.static(path.join(process.cwd(), "public", "catalog"), { maxAge: "7d" }),
);

app.use("/api/admin", adminRoutes);
// Before booksRoutes: its token check runs for every path it sees
app.use(catalogRoutes);
app.use(booksRoutes);

export default app;
