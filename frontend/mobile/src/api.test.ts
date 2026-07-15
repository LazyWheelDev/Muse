import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLanSession, MobileUploadError, safeUploadFilename } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('safeUploadFilename', () => {
  it.each([
    ['closet.png', '', 'garment-upload.png'],
    ['closet.WEBP', '', 'garment-upload.webp'],
    ['closet.jpeg', '', 'garment-upload.jpg'],
    ['original.bin', 'image/png', 'garment-upload.png'],
    ['original.bin', 'image/webp', 'garment-upload.webp'],
    ['original.bin', 'image/jpeg', 'garment-upload.jpg'],
  ])('uses content type and safe suffix for %s', (name, type, expected) => {
    expect(safeUploadFilename(new File(['image'], name, { type }))).toBe(expected);
  });
});

describe('getLanSession', () => {
  it.each([
    [409, 'phone_upload_session_busy'],
    [429, 'rate_limit_exceeded'],
    [429, 'phone_upload_rate_limited'],
    [429, 'upload_concurrency_exceeded'],
  ])('keeps transient %s %s responses retryable', async (status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code, message: 'redacted' } }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const request = getLanSession('A'.repeat(43));

    await expect(request).rejects.toMatchObject({ code, status, retryable: true });
    await expect(request).rejects.toBeInstanceOf(MobileUploadError);
  });

  it('honors an explicit non-retryable server decision for a transient code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'phone_upload_session_busy',
              message: 'redacted',
              details: { retryable: false },
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(getLanSession('A'.repeat(43))).rejects.toMatchObject({ retryable: false });
  });
});
