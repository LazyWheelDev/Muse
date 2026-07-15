export interface HealthResponse {
  status: 'ok';
  service: 'muse-backend';
  version: string;
}

export interface ReadinessCheck {
  status: 'ok' | 'error';
  message?: string | null;
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  checks: Record<string, ReadinessCheck>;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  request_id?: string;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}
