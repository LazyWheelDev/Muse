import type { HealthResponse, ReadinessCheck, ReadinessResponse } from './contracts';
import { requestJson } from './request';
import type { ApiRequestOptions } from './request';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeHealthResponse(value: unknown): HealthResponse {
  if (
    !isRecord(value) ||
    value.status !== 'ok' ||
    value.service !== 'muse-backend' ||
    typeof value.version !== 'string' ||
    value.version.trim().length === 0
  ) {
    throw new Error('Invalid health response.');
  }

  return {
    status: value.status,
    service: value.service,
    version: value.version,
  };
}

function decodeReadinessCheck(value: unknown): ReadinessCheck {
  if (!isRecord(value) || (value.status !== 'ok' && value.status !== 'error')) {
    throw new Error('Invalid readiness check.');
  }

  if (value.message !== undefined && value.message !== null && typeof value.message !== 'string') {
    throw new Error('Invalid readiness message.');
  }

  return {
    status: value.status,
    ...(value.message === undefined ? {} : { message: value.message }),
  };
}

function decodeReadinessResponse(value: unknown): ReadinessResponse {
  if (
    !isRecord(value) ||
    (value.status !== 'ready' && value.status !== 'not_ready') ||
    !isRecord(value.checks)
  ) {
    throw new Error('Invalid readiness response.');
  }

  const rawChecks = value.checks;
  const requiredChecks = ['database', 'migrations', 'storage'] as const;

  if (requiredChecks.some((checkName) => !(checkName in rawChecks))) {
    throw new Error('Readiness response is missing a required check.');
  }

  const checks = Object.fromEntries(
    Object.entries(rawChecks).map(([checkName, check]) => [checkName, decodeReadinessCheck(check)]),
  );

  return { status: value.status, checks };
}

export function getHealth(options: ApiRequestOptions = {}): Promise<HealthResponse> {
  return requestJson('/health', decodeHealthResponse, options);
}

export function getReadiness(options: ApiRequestOptions = {}): Promise<ReadinessResponse> {
  return requestJson('/readiness', decodeReadinessResponse, {
    ...options,
    acceptedStatuses: [503],
  });
}
