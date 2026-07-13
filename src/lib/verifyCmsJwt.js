/**
 * Shared CMS JWT verification used by Express authMiddleware and gRPC
 * grpcAuth so both transports accept/reject identically.
 */
import jwt from "jsonwebtoken";
import { UnauthorizedError, ForbiddenError } from "./customErrors.js";

/**
 * Verify a raw CMS JWT (no `Bearer ` prefix) and optionally require a role.
 * @returns {{ id: string, email?: string, role: string }}
 */
export function verifyCmsJwt(token, roles = []) {
    if (!token) {
        throw new UnauthorizedError("No token provided");
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        throw new UnauthorizedError("Invalid token");
    }

    if (roles.length > 0 && !roles.includes(decoded.role)) {
        throw new ForbiddenError(
            "You do not have permission to perform this action"
        );
    }

    return decoded;
}
