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
import { connectToRedis } from "./src/lib/redis.js";
import router from "./src/routes/index.js";
import { metricsMiddleware, startMetricsServer } from "./src/lib/metrics.js";
import { startGrpcServer, stopGrpcServer, GRPC_BIND_ADDRESS } from "./src/grpc/server.js";

dotenv.config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 3002;

app.set("trust proxy", true);

// Use combined format in production, dev in development
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev", {
  skip: (req) => req.url === "/" || req.url === "/health"
}));

app.use(cors());
app.use(metricsMiddleware);
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

// Connect to database and Redis
db();
connectToRedis();

// gRPC (directory.v1 east-west mesh listener) toggle. Default on; set
// GRPC_ENABLED=false to run the legacy REST-only process.
const GRPC_ENABLED = process.env.GRPC_ENABLED !== "false";

// PM2 runs this in cluster mode (instances: 'max' — one worker per core), but
// the directory.v1 gRPC port (50055) is frozen by the Envoy contract to a
// single fixed value, so every worker cannot bind it. Decision: bind gRPC once,
// on the lead worker only (NODE_APP_INSTANCE '0'); grpc-js has no portable
// SO_REUSEPORT and Envoy load-balances at the connection level anyway. In dev
// (nodemon / fork mode) NODE_APP_INSTANCE is undefined, so that single process
// also binds. The REST/HTTP server stays on every worker (unchanged).
const isLeadWorker = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === "0";

let grpcServer = null;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    startMetricsServer();
  });

  if (GRPC_ENABLED && isLeadWorker) {
    startGrpcServer()
      .then((server) => {
        grpcServer = server;
      })
      .catch((err) => {
        console.error(`Failed to start gRPC server on ${GRPC_BIND_ADDRESS}:`, err);
      });
  }
}

export default app;

const shutdown = async (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  try {
    await stopGrpcServer(grpcServer);
  } catch (err) {
    console.error("Error during gRPC shutdown:", err);
  }
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
