/**
 * Shared plumbing for the thin gRPC handlers: turn an async
 * `handler(call) => responseObject` into a grpc-js unary `(call, callback)`,
 * translating the existing CustomError hierarchy into gRPC status codes (which
 * the api-gateway maps back to the same HTTP statuses the REST API returns).
 */
import grpc from "@grpc/grpc-js";
import { CustomError } from "../lib/customErrors.js";

function toGrpcError(err) {
    let code = grpc.status.INTERNAL;
    if (err instanceof CustomError) {
        switch (err.statusCode) {
            case 400: code = grpc.status.INVALID_ARGUMENT; break;
            case 401: code = grpc.status.UNAUTHENTICATED; break;
            case 403: code = grpc.status.PERMISSION_DENIED; break;
            case 404: code = grpc.status.NOT_FOUND; break;
            case 409: code = grpc.status.ALREADY_EXISTS; break;
            default: code = grpc.status.INTERNAL;
        }
    }
    const metadata = new grpc.Metadata();
    // Carry validation detail so the gateway can reconstruct the REST error body.
    if (err && err.errors) {
        try { metadata.set("errors-json", JSON.stringify(err.errors)); } catch { /* ignore */ }
    }
    return { code, message: err?.message || "Internal error", metadata };
}

/** Wrap an async unary handler with uniform error mapping. */
export function unary(handler) {
    return (call, callback) => {
        Promise.resolve(handler(call))
            .then((response) => callback(null, response))
            .catch((err) => callback(toGrpcError(err)));
    };
}
