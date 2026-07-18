import path from "node:path";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// protos/ is a committed copy seeded by the workspace protos/sync.sh into this
// service's build context. The Docker image copies it to /app/protos and sets
// PROTO_DIR (see Dockerfile), mirroring api-gateway/search-api. Locally it
// resolves next to src/ at research-ambit-main/protos.
const PROTO_DIR = process.env.PROTO_DIR || path.resolve(__dirname, "../../protos");

// Same options as api-gateway's loader so both sides agree on field naming
// (keepCase => snake_case proto field names as written in the .proto).
const LOADER_OPTIONS = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR],
};

/**
 * Load a proto file (path relative to the protos/ root) and return the
 * grpc-js package object, e.g. loadPackage('directory/v1/directory.proto').
 */
export function loadPackage(relativeProtoPath) {
    const definition = protoLoader.loadSync(
        path.join(PROTO_DIR, relativeProtoPath),
        LOADER_OPTIONS,
    );
    return grpc.loadPackageDefinition(definition);
}

export { PROTO_DIR };
