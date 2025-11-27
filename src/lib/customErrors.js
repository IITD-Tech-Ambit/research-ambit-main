/**
 * Custom error classes for better error handling
 */

/**
 * Base custom error class
 */
class CustomError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error class
 */
class ValidationError extends CustomError {
  constructor(message = "Validation Error", errors = []) {
    super(message, 400);
    this.errors = errors;
  }
}

/**
 * Not found error class
 */
class NotFoundError extends CustomError {
  constructor(message = "Resource not found") {
    super(message, 404);
  }
}

/**
 * Unauthorized error class
 */
class UnauthorizedError extends CustomError {
  constructor(message = "Unauthorized access") {
    super(message, 401);
  }
}

/**
 * Forbidden error class
 */
class ForbiddenError extends CustomError {
  constructor(message = "Access forbidden") {
    super(message, 403);
  }
}

/**
 * Bad request error class
 */
class BadRequestError extends CustomError {
  constructor(message = "Bad request") {
    super(message, 400);
  }
}

/**
 * Conflict error class
 */
class ConflictError extends CustomError {
  constructor(message = "Resource conflict") {
    super(message, 409);
  }
}

/**
 * Internal server error class
 */
class InternalServerError extends CustomError {
  constructor(message = "Internal server error") {
    super(message, 500);
  }
}

export {
  CustomError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
  InternalServerError,
};
