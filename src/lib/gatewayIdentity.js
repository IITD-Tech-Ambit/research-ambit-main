import crypto from "crypto";

// Proves x-user-* came from the gateway; an unset secret trusts headers (local dev).
export const isFromGateway = (req) => {
    const secret = process.env.GATEWAY_SHARED_SECRET || "";
    if (!secret) return true;
    const given = Buffer.from(String(req.headers["x-gateway-secret"] || ""));
    const expected = Buffer.from(secret);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};
