import { requestJson, requestVoid } from '../../api/request';
import { decodePhoneUploadSession, decodePhoneUploadSessionCreated } from './decoders';
import type { PhoneUploadSession, PhoneUploadSessionCreated } from './model';

function sessionPath(sessionId: string): `/phone-upload-sessions/${string}` {
  const normalized = sessionId.trim();
  if (!/^[0-9a-f]{32}$/u.test(normalized)) {
    throw new Error('Phone upload session id must be 32 lowercase hexadecimal characters.');
  }
  return `/phone-upload-sessions/${encodeURIComponent(normalized)}`;
}

export function createPhoneUploadSession(signal?: AbortSignal): Promise<PhoneUploadSessionCreated> {
  return requestJson('/phone-upload-sessions', decodePhoneUploadSessionCreated, {
    method: 'POST',
    ...(signal === undefined ? {} : { signal }),
  });
}

export function getPhoneUploadSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<PhoneUploadSession> {
  return requestJson(sessionPath(sessionId), decodePhoneUploadSession, {
    ...(signal === undefined ? {} : { signal }),
  });
}

export function cancelPhoneUploadSession(sessionId: string, signal?: AbortSignal): Promise<void> {
  return requestVoid(sessionPath(sessionId), {
    method: 'DELETE',
    ...(signal === undefined ? {} : { signal }),
  });
}

export function regeneratePhoneUploadSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<PhoneUploadSessionCreated> {
  return requestJson(`${sessionPath(sessionId)}/regenerate`, decodePhoneUploadSessionCreated, {
    method: 'POST',
    ...(signal === undefined ? {} : { signal }),
  });
}
