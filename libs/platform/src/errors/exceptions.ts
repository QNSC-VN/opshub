import type { ErrorCategory, ErrorCode } from './error-codes';
import { CATEGORY_HTTP_STATUS } from './error-codes';

/**
 * Base exception for all domain/application errors.
 * The global exception filter maps this to the wire envelope.
 */
export class DomainException extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown[];

  constructor(code: ErrorCode, message: string, category: ErrorCategory, details?: unknown[]) {
    super(message);
    this.name = 'DomainException';
    this.code = code;
    this.httpStatus = CATEGORY_HTTP_STATUS[category];
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundException extends DomainException {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 'NOT_FOUND');
  }
}

export class ConflictException extends DomainException {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 'CONFLICT');
  }
}

export class ValidationException extends DomainException {
  constructor(code: ErrorCode, message: string, details?: unknown[]) {
    super(code, message, 'VALIDATION_FAILED', details);
  }
}

export class PermissionDeniedException extends DomainException {
  constructor(message = 'Permission denied') {
    super('FORBIDDEN', message, 'PERMISSION_DENIED');
  }
}

export class UnauthorizedException extends DomainException {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 'UNAUTHORIZED');
  }
}

export class PreconditionFailedException extends DomainException {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 'PRECONDITION_FAILED');
  }
}
