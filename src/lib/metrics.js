/**
 * Prometheus metrics for the backend (Express).
 *
 * Each PM2 worker opens a dedicated metrics server on:
 *   METRICS_PORT_BASE + NODE_APP_INSTANCE  (default: 9111, 9112, …)
 *
 * Prometheus scrapes each worker individually; `sum by (job)` aggregates
 * across workers at query time. This mirrors the search-api pattern.
 */

import http from 'node:http';
import client from 'prom-client';

const SERVICE_NAME = process.env.SERVICE_NAME || 'backend';
const METRICS_PORT_BASE = parseInt(process.env.METRICS_PORT_BASE || '9111', 10);
const METRICS_HOST = process.env.METRICS_HOST || '0.0.0.0';

function resolveMetricsPort() {
    const instance = parseInt(process.env.NODE_APP_INSTANCE || '0', 10);
    return METRICS_PORT_BASE + (Number.isNaN(instance) ? 0 : instance);
}

const register = new client.Registry();
register.setDefaultLabels({ service: SERVICE_NAME });
client.collectDefaultMetrics({ register });

export const httpHistogram = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
});

/**
 * Express middleware — records duration after response is sent.
 * Attach before routes: app.use(metricsMiddleware)
 */
export function metricsMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        // Use matched route pattern to keep cardinality bounded.
        const route = req.route?.path
            ? (req.baseUrl || '') + req.route.path
            : req.path || 'unknown';
        httpHistogram
            .labels(req.method, route, String(res.statusCode))
            .observe(seconds);
    });
    next();
}

/**
 * Start the dedicated internal metrics HTTP server.
 * Call once after the main app starts.
 */
export function startMetricsServer() {
    const port = resolveMetricsPort();

    const server = http.createServer(async (req, res) => {
        if (req.url === '/metrics') {
            try {
                const body = await register.metrics();
                res.writeHead(200, { 'Content-Type': register.contentType });
                res.end(body);
            } catch (err) {
                res.writeHead(500);
                res.end(String(err));
            }
            return;
        }
        if (req.url === '/healthz') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
            return;
        }
        res.writeHead(404);
        res.end();
    });

    server.listen(port, METRICS_HOST, () => {
        console.log(`Metrics server listening on http://${METRICS_HOST}:${port}/metrics`);
    });

    server.on('error', (err) => {
        console.error('Metrics server error:', err);
    });

    return server;
}
