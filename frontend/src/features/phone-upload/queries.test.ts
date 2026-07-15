import { describe, expect, it } from 'vitest';

import { phoneUploadRefetchInterval } from './queries';

describe('phone upload polling cadence', () => {
  it('polls active and retryable-failure states at bounded frequencies', () => {
    expect(phoneUploadRefetchInterval('pending')).toBe(2_000);
    expect(phoneUploadRefetchInterval('opened')).toBe(2_000);
    expect(phoneUploadRefetchInterval('uploading')).toBe(1_250);
    expect(phoneUploadRefetchInterval('processing')).toBe(1_250);
    expect(phoneUploadRefetchInterval('failed')).toBe(5_000);
  });

  it('stops only after permanently unusable states', () => {
    expect(phoneUploadRefetchInterval('completed')).toBe(false);
    expect(phoneUploadRefetchInterval('cancelled')).toBe(false);
    expect(phoneUploadRefetchInterval('expired')).toBe(false);
  });
});
