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
const PORT = process.env.PORT || 3000;

app.set("trust proxy", true);

app.use(morgan("dev"));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.get("/", (req, res) => {
  const ipAddress = req.ip;
  successResponse(
    res,
    { ipAddress: ipAddress },
    "The service is healthy and running!"
  );
});

app.use("/api", router);

app.use(notFoundHandler);
app.use(globalErrorHandler);

// Connect to database
db();

// Only listen if not running in Vercel (Vercel handles the port binding)
if (process.env.NODE_ENV !== "production") {
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
