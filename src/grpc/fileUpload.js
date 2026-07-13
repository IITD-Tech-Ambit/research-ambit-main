/**
 * Bridge a proto FileUpload (filename/content_type/bytes) to the local-temp-
 * file contract the existing services expect (multer hands them req.file.path;
 * lib/cloudinary uploads that path and unlinks it). We materialize the gRPC
 * bytes to a temp file and hand back its path, so the shared service code path
 * is byte-for-byte the same as the REST upload path.
 */
import { writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/**
 * @param {{ filename?: string, content_type?: string, data?: Buffer|Uint8Array }} [file]
 * @returns {string|null} temp file path, or null when no bytes were provided
 */
export function writeUploadToTemp(file) {
    if (!file || !file.data || file.data.length === 0) return null;
    const dir = mkdtempSync(path.join(os.tmpdir(), "ra-grpc-"));
    const safeName = (file.filename || "upload").replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
    const filePath = path.join(dir, `${crypto.randomBytes(6).toString("hex")}-${safeName}`);
    writeFileSync(filePath, Buffer.from(file.data));
    return filePath;
}
