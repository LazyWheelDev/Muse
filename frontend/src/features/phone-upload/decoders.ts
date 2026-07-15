import {
  phoneUploadListenerStatuses,
  phoneUploadSessionStatuses,
  type PhoneUploadListenerStatus,
  type PhoneUploadSession,
  type PhoneUploadSessionCreated,
  type PhoneUploadSessionStatus,
} from './model';

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function identifier(value: unknown): string {
  if (typeof value === 'string' && /^[0-9a-f]{32}$/u.test(value)) {
    return value;
  }
  throw new Error('phone upload session id must be 32 lowercase hexadecimal characters.');
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : string(value, label);
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label);
  if (Number.isNaN(Date.parse(result))) {
    throw new Error(`${label} must be a timestamp.`);
  }
  return result;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : timestamp(value, label);
}

function status(value: unknown): PhoneUploadSessionStatus {
  if (
    typeof value !== 'string' ||
    !phoneUploadSessionStatuses.includes(value as PhoneUploadSessionStatus)
  ) {
    throw new Error('phone upload session status is unsupported.');
  }
  return value as PhoneUploadSessionStatus;
}

function listenerStatus(value: unknown): PhoneUploadListenerStatus {
  if (
    typeof value !== 'string' ||
    !phoneUploadListenerStatuses.includes(value as PhoneUploadListenerStatus)
  ) {
    throw new Error('phone upload listener status is unsupported.');
  }
  return value as PhoneUploadListenerStatus;
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function localUploadUrl(value: unknown, label: string): string {
  const raw = string(value, label);
  if (raw.length > 2048 || [...raw].some((character) => (character.codePointAt(0) ?? 0) < 32)) {
    throw new Error(`${label} is not a safe local URL.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/u/' ||
    parsed.search !== '' ||
    !/^#token=[A-Za-z0-9_-]{43}$/u.test(parsed.hash)
  ) {
    throw new Error(`${label} must use the restricted local upload URL contract.`);
  }
  return parsed.href;
}

export function decodePhoneUploadSessionCreated(value: unknown): PhoneUploadSessionCreated {
  const session = record(value, 'phone upload session');
  const uploadUrl = localUploadUrl(session.upload_url, 'upload_url');
  const qrPayload = localUploadUrl(session.qr_payload, 'qr_payload');
  const fallbackUploadUrl =
    session.fallback_upload_url === null || session.fallback_upload_url === undefined
      ? null
      : localUploadUrl(session.fallback_upload_url, 'fallback_upload_url');
  if (uploadUrl !== qrPayload) {
    throw new Error('QR payload must exactly match the upload URL.');
  }
  return {
    id: identifier(session.id),
    status: status(session.status),
    createdAt: timestamp(session.created_at, 'created_at'),
    expiresAt: timestamp(session.expires_at, 'expires_at'),
    uploadUrl,
    fallbackUploadUrl,
    qrPayload,
    listenerStatus: listenerStatus(session.listener_status),
  };
}

export function decodePhoneUploadSession(value: unknown): PhoneUploadSession {
  const session = record(value, 'phone upload session');
  return {
    id: identifier(session.id),
    status: status(session.status),
    createdAt: timestamp(session.created_at, 'created_at'),
    updatedAt: timestamp(session.updated_at, 'updated_at'),
    expiresAt: timestamp(session.expires_at, 'expires_at'),
    startedAt: nullableTimestamp(session.started_at, 'started_at'),
    completedAt: nullableTimestamp(session.completed_at, 'completed_at'),
    cancelledAt: nullableTimestamp(session.cancelled_at, 'cancelled_at'),
    failedAt: nullableTimestamp(session.failed_at, 'failed_at'),
    clothingItemId: nullablePositiveInteger(session.clothing_item_id, 'clothing_item_id'),
    errorCode: nullableString(session.error_code, 'error_code'),
    listenerStatus: listenerStatus(session.listener_status),
  };
}
