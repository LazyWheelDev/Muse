import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearPhoneSessionStorage,
  consumePhoneEntryState,
  isValidPhoneUploadToken,
  markPhoneUploadAttempted,
  rememberTerminalState,
} from './token';

const token = 'A'.repeat(43);

afterEach(() => {
  clearPhoneSessionStorage();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('phone upload token handoff', () => {
  it('moves a valid fragment token into tab storage and immediately sanitizes the URL', () => {
    window.history.replaceState(null, '', `/u/#token=${token}`);
    const state = consumePhoneEntryState();

    expect(state).toEqual({
      token,
      terminal: null,
      invalidFragment: false,
      uploadAttempted: false,
    });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/u/');
    expect(consumePhoneEntryState().token).toBe(token);
  });

  it('rejects malformed fragment and stored values', () => {
    window.history.replaceState(null, '', '/u/#token=too-short');
    expect(consumePhoneEntryState()).toEqual({
      token: null,
      terminal: null,
      invalidFragment: true,
      uploadAttempted: false,
    });
    expect(isValidPhoneUploadToken('a'.repeat(42))).toBe(false);
  });

  it('recovers a non-secret terminal state after removing the raw token', () => {
    window.history.replaceState(null, '', `/u/#token=${token}`);
    consumePhoneEntryState();
    rememberTerminalState('completed');

    expect(consumePhoneEntryState()).toEqual({
      token: null,
      terminal: 'completed',
      invalidFragment: false,
      uploadAttempted: false,
    });
    expect(sessionStorage.getItem('muse.phone-upload.token.v1')).toBeNull();
  });

  it('retains only a non-secret upload-attempt marker across a tab refresh', () => {
    window.history.replaceState(null, '', `/u/#token=${token}`);
    consumePhoneEntryState();
    markPhoneUploadAttempted();

    expect(consumePhoneEntryState()).toEqual({
      token,
      terminal: null,
      invalidFragment: false,
      uploadAttempted: true,
    });

    window.history.replaceState(null, '', `/u/#token=${'B'.repeat(43)}`);
    expect(consumePhoneEntryState().uploadAttempted).toBe(false);
  });
});
