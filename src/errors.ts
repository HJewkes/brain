export interface GenericError {
  error: true;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T, E extends string = string> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { error: true; code: E; message: string; details?: Record<string, unknown> };
    };

export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

export function fail<E extends string>(
  code: E,
  message: string,
  details?: Record<string, unknown>,
): Result<never, E> {
  const error: { error: true; code: E; message: string; details?: Record<string, unknown> } = {
    error: true,
    code,
    message,
  };
  if (details !== undefined) {
    error.details = details;
  }
  return { ok: false, error };
}
