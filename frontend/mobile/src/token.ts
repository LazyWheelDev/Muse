const tokenStorageKey = 'muse.phone-upload.token.v1';
const terminalStorageKey = 'muse.phone-upload.terminal.v1';
const uploadAttemptedStorageKey = 'muse.phone-upload.attempted.v1';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const terminalLifetimeMilliseconds = 60 * 60 * 1_000;

export type PhoneTerminalState =
  'completed' | 'expired' | 'cancelled' | 'failed' | 'invalid' | 'used';

interface StoredTerminalState {
  status: PhoneTerminalState;
  savedAt: number;
}

export interface PhoneEntryState {
  token: string | null;
  terminal: PhoneTerminalState | null;
  invalidFragment: boolean;
  uploadAttempted: boolean;
}

export function isValidPhoneUploadToken(value: string): boolean {
  return tokenPattern.test(value);
}

function readStoredTerminal(): PhoneTerminalState | null {
  const raw = sessionStorage.getItem(terminalStorageKey);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTerminalState>;
    if (
      typeof parsed.savedAt !== 'number' ||
      Date.now() - parsed.savedAt > terminalLifetimeMilliseconds ||
      !['completed', 'expired', 'cancelled', 'failed', 'invalid', 'used'].includes(
        parsed.status ?? '',
      )
    ) {
      sessionStorage.removeItem(terminalStorageKey);
      return null;
    }
    return parsed.status as PhoneTerminalState;
  } catch {
    sessionStorage.removeItem(terminalStorageKey);
    return null;
  }
}

export function consumePhoneEntryState(): PhoneEntryState {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/u, ''));
  const fragmentToken = fragment.get('token');
  let invalidFragment = false;

  if (fragmentToken !== null) {
    if (isValidPhoneUploadToken(fragmentToken)) {
      sessionStorage.setItem(tokenStorageKey, fragmentToken);
      sessionStorage.removeItem(terminalStorageKey);
      sessionStorage.removeItem(uploadAttemptedStorageKey);
    } else {
      sessionStorage.removeItem(tokenStorageKey);
      sessionStorage.removeItem(uploadAttemptedStorageKey);
      invalidFragment = true;
    }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }

  const storedToken = sessionStorage.getItem(tokenStorageKey);
  if (storedToken !== null && !isValidPhoneUploadToken(storedToken)) {
    sessionStorage.removeItem(tokenStorageKey);
    sessionStorage.removeItem(uploadAttemptedStorageKey);
  }

  return {
    token: storedToken !== null && isValidPhoneUploadToken(storedToken) ? storedToken : null,
    terminal: fragmentToken === null ? readStoredTerminal() : null,
    invalidFragment,
    uploadAttempted:
      storedToken !== null &&
      isValidPhoneUploadToken(storedToken) &&
      sessionStorage.getItem(uploadAttemptedStorageKey) === '1',
  };
}

export function markPhoneUploadAttempted() {
  sessionStorage.setItem(uploadAttemptedStorageKey, '1');
}

export function rememberTerminalState(status: PhoneTerminalState) {
  sessionStorage.removeItem(tokenStorageKey);
  sessionStorage.removeItem(uploadAttemptedStorageKey);
  const record: StoredTerminalState = { status, savedAt: Date.now() };
  sessionStorage.setItem(terminalStorageKey, JSON.stringify(record));
}

export function clearPhoneSessionStorage() {
  sessionStorage.removeItem(tokenStorageKey);
  sessionStorage.removeItem(terminalStorageKey);
  sessionStorage.removeItem(uploadAttemptedStorageKey);
}
