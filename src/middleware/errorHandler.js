import { errorResponse } from "../lib/responseUtils.js";
import { CustomError } from "../lib/customErrors.js";

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const globalErrorHandler = (err, req, res, next) => {
  // Log error details (in production, use proper logging service)
  console.error("Error occurred:", {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });

  // Handle custom errors
  if (err instanceof CustomError) {
    return errorResponse(res, err.message, err.statusCode, err.errors || null);
  }

  // Handle validation errors (e.g., from express-validator)
  if (err.name === "ValidationError" && err.errors) {
    return errorResponse(res, "Validation Error", 400, err.errors);
  }

  // Handle MongoDB duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return errorResponse(res, `${field} already exists`, 409);
  }

  // Handle MongoDB cast error
  if (err.name === "CastError") {
    return errorResponse(res, "Invalid ID format", 400);
  }

  // Handle JWT errors
  if (err.name === "JsonWebTokenError") {
    return errorResponse(res, "Invalid token", 401);
  }

  if (err.name === "TokenExpiredError") {
    return errorResponse(res, "Token expired", 401);
  }

  // Handle multer errors (file upload)
  if (err.code === "LIMIT_FILE_SIZE") {
    return errorResponse(res, "File size too large", 400);
  }

  // Handle SyntaxError (malformed JSON)
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return errorResponse(res, "Invalid JSON format", 400);
  }

  // Default error response
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

/**
 * 404 Not Found handler middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const notFoundHandler = (req, res, next) => {
  return errorResponse(res, `Route ${req.originalUrl} not found`, 404);
};

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors and pass them to error handler
 * @param {Function} fn - Async function to wrap
 */
const asyncErrorHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export { globalErrorHandler, notFoundHandler, asyncErrorHandler };
