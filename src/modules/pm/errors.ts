export type PmErrorCode =
  | 'PROJECT_EXISTS'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'INVALID_CLAIM_TOKEN'
  | 'ALREADY_CLAIMED'
  | 'CYCLE_DETECTED'
  | 'NO_PROMPT'
  | 'HAS_DEPENDENTS'
  | 'WIP_LIMIT'
  | 'DUPLICATE_ID'
  | 'INVALID_INPUT';

export interface PmError {
  error: true;
  code: PmErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: PmError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(
  code: PmErrorCode,
  message: string,
  details?: Record<string, unknown>
): Result<never> {
  return { ok: false, error: pmError(code, message, details) };
}

export function pmError(
  code: PmErrorCode,
  message: string,
  details?: Record<string, unknown>
): PmError {
  const err: PmError = { error: true, code, message };
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

export function formatError(error: PmError, json: boolean): string {
  if (json) {
    return JSON.stringify(error);
  }
  return `Error [${error.code}]: ${error.message}`;
}
