import { describe, expect, it } from 'vitest';

import { decodePhoneUploadSession, decodePhoneUploadSessionCreated } from './decoders';

const now = '2026-07-15T12:00:00Z';
const later = '2026-07-15T12:10:00Z';
const sessionId = 'a'.repeat(32);
const uploadUrl = `http://muse.local:8765/u/#token=${'A'.repeat(43)}`;
const fallbackUrl = `http://192.168.1.20:8765/u/#token=${'A'.repeat(43)}`;

describe('phone upload decoders', () => {
  it('decodes one-time creation credentials and an optional direct-IP fallback', () => {
    expect(
      decodePhoneUploadSessionCreated({
        id: sessionId,
        status: 'pending',
        created_at: now,
        expires_at: later,
        upload_url: uploadUrl,
        fallback_upload_url: fallbackUrl,
        qr_payload: uploadUrl,
        listener_status: 'ready',
      }),
    ).toEqual({
      id: sessionId,
      status: 'pending',
      createdAt: now,
      expiresAt: later,
      uploadUrl,
      fallbackUploadUrl: fallbackUrl,
      qrPayload: uploadUrl,
      listenerStatus: 'ready',
    });
  });

  it('decodes a completed device status without any raw token', () => {
    expect(
      decodePhoneUploadSession({
        id: sessionId,
        status: 'completed',
        created_at: now,
        updated_at: later,
        expires_at: later,
        started_at: now,
        completed_at: later,
        cancelled_at: null,
        failed_at: null,
        clothing_item_id: 42,
        error_code: null,
        listener_status: 'unavailable',
      }),
    ).toMatchObject({
      id: sessionId,
      status: 'completed',
      clothingItemId: 42,
      listenerStatus: 'unavailable',
    });
  });

  it.each([
    { id: 'A'.repeat(32), label: 'uppercase id' },
    { id: 'short', label: 'short id' },
    { id: sessionId, upload_url: 'https://muse.local/u/#token=x', label: 'HTTPS contract' },
    { id: sessionId, qr_payload: fallbackUrl, label: 'QR mismatch' },
    { id: sessionId, upload_url: 'http://muse.local/api/v1/#token=x', label: 'core path' },
    { id: sessionId, upload_url: 'http://muse.local/u/#token=', label: 'empty token' },
    {
      id: sessionId,
      upload_url: `http://muse.local/u/#token=${'A'.repeat(43)}suffix`,
      label: 'token suffix',
    },
    {
      id: sessionId,
      upload_url: `http://muse.local/u/#token=${'A'.repeat(43)}&extra=value`,
      label: 'fragment parameters',
    },
    { id: sessionId, listener_status: 'checking', label: 'listener status' },
  ])('rejects an unsafe $label', (overrides) => {
    const payload: Record<string, unknown> = {
      id: sessionId,
      status: 'pending',
      created_at: now,
      expires_at: later,
      upload_url: uploadUrl,
      fallback_upload_url: null,
      qr_payload: uploadUrl,
      listener_status: 'ready',
    };
    Object.assign(payload, overrides);
    delete payload.label;
    expect(() => decodePhoneUploadSessionCreated(payload)).toThrow();
  });
});
