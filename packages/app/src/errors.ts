import { PaymentError, PricingError, StockError } from '@omborchi/core';
import { PG_ERRORS, pgConstraint, pgErrorCode } from '@omborchi/db';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'WAREHOUSE_FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_STATE'
  | 'PRICE_OVERRIDE_FORBIDDEN'
  | 'NO_OPEN_SHIFT'
  | 'PAYMENT'
  | 'PRICING'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  WAREHOUSE_FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  INVALID_STATE: 409,
  PRICE_OVERRIDE_FORBIDDEN: 403,
  NO_OPEN_SHIFT: 409,
  PAYMENT: 422,
  PRICING: 422,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`, { what });

/** Translate anything thrown below the route layer into an AppError with a stable code. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ZodError) {
    return new AppError('VALIDATION', 'Invalid input', {
      issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    });
  }
  if (e instanceof StockError) {
    return new AppError(e.code === 'INSUFFICIENT_STOCK' ? 'INSUFFICIENT_STOCK' : 'VALIDATION', e.message, e.details);
  }
  if (e instanceof PaymentError) return new AppError('PAYMENT', e.message, { reason: e.code });
  if (e instanceof PricingError) return new AppError('PRICING', e.message, { reason: e.code });
  const code = pgErrorCode(e);
  if (code === PG_ERRORS.checkViolation) {
    const c = pgConstraint(e);
    if (c === 'stock_never_negative' || c === 'batch_never_negative') {
      return new AppError('INSUFFICIENT_STOCK', 'Not enough stock', { constraint: c });
    }
    return new AppError('VALIDATION', 'Constraint violated', { constraint: c });
  }
  if (code === PG_ERRORS.uniqueViolation) return new AppError('CONFLICT', 'Already exists', { constraint: pgConstraint(e) });
  if (code === PG_ERRORS.foreignKeyViolation) return new AppError('CONFLICT', 'Referenced record is missing or in use', { constraint: pgConstraint(e) });
  if (e instanceof Error && /stock_never_negative/.test(e.message)) return new AppError('INSUFFICIENT_STOCK', 'Not enough stock');
  return new AppError('INTERNAL', e instanceof Error ? e.message : 'Unexpected error');
}
