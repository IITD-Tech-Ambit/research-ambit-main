import { errorResponse } from "../lib/responseUtils.js";
import { CustomError } from "../lib/customErrors.js";

const globalErrorHandler = (err, req, res, next) => {
  console.error("Error occurred:", {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });

  if (err instanceof CustomError) {
    return errorResponse(res, err.message, err.statusCode, err.errors || null);
  }

  if (err.name === "ValidationError" && err.errors) {
    return errorResponse(res, "Validation Error", 400, err.errors);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return errorResponse(res, `${field} already exists`, 409);
  }

  if (err.name === "CastError") {
    return errorResponse(res, "Invalid ID format", 400);
  }

  if (err.name === "JsonWebTokenError") {
    return errorResponse(res, "Invalid token", 401);
  }

  if (err.name === "TokenExpiredError") {
    return errorResponse(res, "Token expired", 401);
  }

  if (err.code === "LIMIT_FILE_SIZE") {
    return errorResponse(res, "File size too large", 400);
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return errorResponse(res, "Invalid JSON format", 400);
  }

  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === "production"
      ? "Something went wrong!"
      : err.message;

  return errorResponse(
    res,
    message,
    statusCode,
    process.env.NODE_ENV === "development" ? err.stack : null,
  );
};

const notFoundHandler = (req, res, next) => {
  return errorResponse(res, `Route ${req.originalUrl} not found`, 404);
};

const asyncErrorHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export { globalErrorHandler, notFoundHandler, asyncErrorHandler };
