export interface ApiClientErrorOptions {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
  requestId?: string;
  cause?: unknown;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(options: ApiClientErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiClientError';
    this.code = options.code;
    this.status = options.status ?? null;
    this.details = options.details;
    this.requestId = options.requestId ?? null;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}
