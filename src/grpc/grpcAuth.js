/**
 * gRPC-side auth: same CMS JWT/role checks as REST middleware, against gRPC
 * metadata instead of Express headers. The gateway forwards
 * `Authorization: Bearer <jwt>` as the `authorization` metadata key.
 */
import jwt from "jsonwebtoken";
import { UnauthorizedError } from "../lib/customErrors.js";
import { verifyCmsJwt } from "../lib/verifyCmsJwt.js";

export function getAuthorization(metadata) {
    const values = metadata?.get?.("authorization") || [];
    const raw = values.length ? values[0] : null;
    return raw ? String(raw) : null;
}

/**
 * Require a valid CMS JWT and (optionally) one of `roles`. Returns the decoded
 * { id, email, role }. Same throw semantics as authMiddleware.
 */
export function requireAuth(metadata, roles = []) {
    const authHeader = getAuthorization(metadata);
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new UnauthorizedError("No token provided");
    }
    return verifyCmsJwt(authHeader.split(" ")[1], roles);
}

/**
 * Optional-auth resolution mirroring lib/userIdExtractor.getUserId + the
 * controllers' "header present but invalid => 401" behavior. Returns
 * { userId, authProvided }.
 */
export function optionalAuth(metadata) {
    const authHeader = getAuthorization(metadata);
    if (!authHeader) {
        return { userId: null, authProvided: false };
    }
    if (!authHeader.startsWith("Bearer ")) {
        return { userId: null, authProvided: true };
    }
    try {
        const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
        return { userId: decoded.id, authProvided: true };
    } catch {
        return { userId: null, authProvided: true };
    }
}

/**
 * Best-effort client IP for the anonymous like/comment dedup path. The gateway
 * has no proto field for it, so we accept an `x-forwarded-for` metadata hint
 * if present; otherwise "" (anonymous IP dedup simply won't match over gRPC).
 */
export function clientIp(metadata) {
    const values = metadata?.get?.("x-forwarded-for") || [];
    if (!values.length) return "";
    return String(values[0]).split(",")[0].trim();
}
