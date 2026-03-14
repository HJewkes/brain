import {
  type Result as GenericResult,
  ok as genericOk,
  fail as genericFail,
} from '../../errors.js';

export type SessionErrorCode =
  | 'NOT_FOUND'
  | 'DUPLICATE_SESSION'
  | 'INVALID_INPUT'
  | 'INVALID_TRANSITION';

export type Result<T> = GenericResult<T, SessionErrorCode>;

export function ok<T>(data: T): Result<T> {
  return genericOk(data);
}

export function fail(
  code: SessionErrorCode,
  message: string,
  details?: Record<string, unknown>
): Result<never> {
  return genericFail(code, message, details);
}
