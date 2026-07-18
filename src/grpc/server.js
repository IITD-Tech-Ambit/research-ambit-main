/**
 * gRPC composition root + bootstrap for the directory.v1 mesh listener.
 *
 * This is the ONLY place that wires transport (gRPC handlers) to the shared
 * application services — handlers receive their service as an injected
 * dependency (a port), keeping them free of any Express/req-res coupling. The
 * same services back the REST controllers, so there is a single implementation
 * per behavior.
 *
 * All five directory.v1 services share this one listener (:50055), matching the
 * Envoy contract (one cluster, one `/directory.v1.` prefix route).
 */
import grpc from "@grpc/grpc-js";
import { loadPackage } from "./loadProto.js";

import * as directoryService from "../services/directoryService.js";
import * as kgService from "../services/kgService.js";
import * as contentService from "../services/contentService.js";
import * as userService from "../services/userService.js";
import * as suggestionService from "../services/suggestionService.js";

import { createDirectoryHandlers } from "./handlers/directoryHandlers.js";
import { createKgHandlers } from "./handlers/kgHandlers.js";
import { createContentHandlers } from "./handlers/contentHandlers.js";
import { createUserHandlers } from "./handlers/userHandlers.js";
import { createSuggestionHandlers } from "./handlers/suggestionHandlers.js";

const GRPC_BIND_ADDRESS = process.env.GRPC_BIND_ADDRESS || "0.0.0.0:50055";

/** Build the fully-wired grpc.Server without binding (useful for tests). */
export function buildGrpcServer() {
    const pkg = loadPackage("directory/v1/directory.proto").directory.v1;
    const server = new grpc.Server();

    server.addService(pkg.DirectoryService.service, createDirectoryHandlers(directoryService));
    server.addService(pkg.KnowledgeGraphService.service, createKgHandlers(kgService));
    server.addService(pkg.ContentService.service, createContentHandlers(contentService));
    server.addService(pkg.UserService.service, createUserHandlers(userService));
    server.addService(pkg.SuggestionService.service, createSuggestionHandlers(suggestionService));

    return server;
}

/** Bind the server on GRPC_BIND_ADDRESS. Resolves with the server handle. */
export function startGrpcServer() {
    // Warm the active Mongo KG version cache (idempotent; REST also calls init).
    kgService.initKg();

    const server = buildGrpcServer();
    return new Promise((resolve, reject) => {
        server.bindAsync(
            GRPC_BIND_ADDRESS,
            grpc.ServerCredentials.createInsecure(),
            (err, port) => {
                if (err) return reject(err);
                console.log(`gRPC (directory.v1) listening on ${GRPC_BIND_ADDRESS} (bound port ${port})`);
                resolve(server);
            },
        );
    });
}

/** Graceful drain: stop accepting new calls, let in-flight ones finish. */
export function stopGrpcServer(server) {
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
        server.tryShutdown((err) => {
            if (err) server.forceShutdown();
            resolve();
        });
    });
}

export { GRPC_BIND_ADDRESS };
