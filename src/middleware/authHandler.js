import jwt from "jsonwebtoken";
import { UnauthorizedError, ForbiddenError } from "../lib/customErrors.js";
import { asyncErrorHandler } from "./errorHandler.js";


const authMiddleware = (...args) => {
    const checkAuth = async (req, res, next, roles = []) => {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new UnauthorizedError("No token provided");
        }

        const token = authHeader.split(" ")[1];

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
        } catch (error) {
            throw new UnauthorizedError("Invalid token");
        }

        if (roles.length > 0 && !roles.includes(req.user.role)) {
            throw new ForbiddenError(
                "You do not have permission to perform this action"
            );
        }

        next();
    };

    // Check if called as standard middleware: (req, res, next)
    if (args.length === 3 && typeof args[2] === "function" && args[0].headers) {
        return asyncErrorHandler((req, res, next) =>
            checkAuth(req, res, next, [])
        )(...args);
    }

    // Called as factory: (role1, role2, ...)
    const roles = args;
    return asyncErrorHandler(async (req, res, next) =>
        checkAuth(req, res, next, roles)
    );
};

export default authMiddleware;
