class CustomError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends CustomError {
  constructor(message = "Validation Error", errors = []) {
    super(message, 400);
    this.errors = errors;
  }
}

class NotFoundError extends CustomError {
  constructor(message = "Resource not found") {
    super(message, 404);
  }
}

class UnauthorizedError extends CustomError {
  constructor(message = "Unauthorized access") {
    super(message, 401);
  }
}

class ForbiddenError extends CustomError {
  constructor(message = "Access forbidden") {
    super(message, 403);
  }
}

class BadRequestError extends CustomError {
  constructor(message = "Bad request") {
    super(message, 400);
  }
}

class ConflictError extends CustomError {
  constructor(message = "Resource conflict") {
    super(message, 409);
  }
}

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
