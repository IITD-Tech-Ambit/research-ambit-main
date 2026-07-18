import { asyncErrorHandler } from "./errorHandler.js";
import { UnauthorizedError } from "../lib/customErrors.js";
import { verifyCmsJwt } from "../lib/verifyCmsJwt.js";

const authMiddleware = (...args) => {
    const checkAuth = async (req, res, next, roles = []) => {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new UnauthorizedError("No token provided");
        }

        req.user = verifyCmsJwt(authHeader.split(" ")[1], roles);
        next();
    };

    if (args.length === 3 && typeof args[2] === "function" && args[0].headers) {
        return asyncErrorHandler((req, res, next) =>
            checkAuth(req, res, next, [])
        )(...args);
    }

    const roles = args;
    return asyncErrorHandler(async (req, res, next) =>
        checkAuth(req, res, next, roles)
    );
};

export default authMiddleware;
