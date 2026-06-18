import http from "node:http";
import client from "prom-client";

/**
 * Prometheus metrics for the Express backend.
 *
 * Exposes RED metrics (Rate / Errors / Duration) on a DEDICATED internal port
 * (never on the public app port).
 *
 * PM2 cluster note: this backend runs under PM2 cluster mode. prom-client's
 * AggregatorRegistry must run in the cluster primary, which PM2 owns — so each
 * worker instead exposes its own metrics endpoint on
 *   METRICS_PORT_BASE + NODE_APP_INSTANCE
 * and Prometheus scrapes every worker. Aggregate with `sum by (job)`.
 */

const SERVICE_NAME = process.env.SERVICE_NAME || "backend";
const METRICS_PORT_BASE = parseInt(process.env.METRICS_PORT_BASE || "9111", 10);
const METRICS_HOST = process.env.METRICS_HOST || "0.0.0.0";

export const register = new client.Registry();
register.setDefaultLabels({ service: SERVICE_NAME });
client.collectDefaultMetrics({ register });

const httpHistogram = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * Resolve a low-cardinality route label. After Express routing, `req.route`
 * holds the matched pattern; unmatched requests collapse to "unmatched".
 */
function routeLabel(req) {
  if (req.route && req.route.path) {
    return (req.baseUrl || "") + req.route.path;
  }
  if (req.baseUrl) return req.baseUrl;
  return "unmatched";
}

export function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    httpHistogram
      .labels(req.method, routeLabel(req), String(res.statusCode))
      .observe(seconds);
  });
  next();
}

function resolveMetricsPort() {
  const instance = parseInt(process.env.NODE_APP_INSTANCE || "0", 10);
  return METRICS_PORT_BASE + (Number.isNaN(instance) ? 0 : instance);
}

export function startMetricsServer(logger = console) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      try {
        const body = await register.metrics();
        res.writeHead(200, { "Content-Type": register.contentType });
        res.end(body);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
      return;
    }
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const port = resolveMetricsPort();
  server.listen(port, METRICS_HOST, () => {
    logger.log?.(`Metrics exposed on http://${METRICS_HOST}:${port}/metrics`);
  });
  server.on("error", (err) => {
    logger.error?.("Metrics server error:", err);
  });
  return server;
}
