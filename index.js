import express from "express";
import morgan from "morgan";
import cors from "cors";
import dotenv from "dotenv";
import {
  globalErrorHandler,
  notFoundHandler,
} from "./src/middleware/errorHandler.js";
import { successResponse } from "./src/lib/responseUtils.js";
import db from "./src/lib/db.js";
import router from "./src/routes/index.js";

dotenv.config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 3002;

app.set("trust proxy", true);

// Use combined format in production, dev in development
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev", {
  skip: (req) => req.url === "/" || req.url === "/health"
}));

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("public"));


app.get("/", (req, res) => {
  successResponse(res, { status: "ok" }, "Service healthy");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api", router);

app.use(notFoundHandler);
app.use(globalErrorHandler);

// Connect to database
db();

// Listen on port (Vercel handles binding differently via serverless)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

export default app;

process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  process.exit(0);
});
