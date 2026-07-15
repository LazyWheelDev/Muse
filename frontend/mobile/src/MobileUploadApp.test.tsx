import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClothingWritePayload } from '../../src/features/clothing/model';
import { MobileUploadApp } from './MobileUploadApp';
import { MobileUploadError, type LanSession, type MobileUploadProgress } from './api';
import {
  clearPhoneSessionStorage,
  consumePhoneEntryState,
  markPhoneUploadAttempted,
} from './token';

const token = 'A'.repeat(43);
const getSessionMock = vi.hoisted(() => vi.fn());
const createObjectUrlMock = vi.hoisted(() => vi.fn<(value: Blob | MediaSource) => string>());
const revokeObjectUrlMock = vi.hoisted(() => vi.fn<(value: string) => void>());
const uploadMock = vi.hoisted(() =>
  vi.fn<
    (options: {
      token: string;
      image: File;
      metadata: ClothingWritePayload;
      signal?: AbortSignal;
      onProgress?: (progress: MobileUploadProgress) => void;
    }) => Promise<{ status: 'completed' }>
  >(),
);

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function openedSession(): LanSession {
  return {
    status: 'opened',
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    canUpload: true,
    canRetry: true,
  };
}

async function completeRequiredForm(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText('Choose from photos'),
    new File(['jpeg bytes'], 'shirt.jpg', { type: 'image/jpeg' }),
  );
  await user.type(screen.getByRole('textbox', { name: 'Garment name' }), 'Phone Shirt');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'top');
}

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, getLanSession: getSessionMock, uploadPhoneGarment: uploadMock };
});

beforeEach(() => {
  clearPhoneSessionStorage();
  window.history.replaceState(null, '', `/u/#token=${token}`);
  getSessionMock.mockReset();
  uploadMock.mockReset();
  getSessionMock.mockResolvedValue(openedSession());
  vi.stubGlobal('URL', URL);
  createObjectUrlMock.mockReset();
  createObjectUrlMock.mockReturnValue('blob:muse-phone-preview');
  revokeObjectUrlMock.mockReset();
  URL.createObjectURL = (value) => createObjectUrlMock(value);
  URL.revokeObjectURL = (value) => revokeObjectUrlMock(value);
});

afterEach(() => {
  vi.useRealTimers();
  clearPhoneSessionStorage();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('MobileUploadApp', () => {
  it('validates the token, sanitizes the address, and renders the narrow upload form', async () => {
    render(<MobileUploadApp />);
    expect(await screen.findByRole('heading', { name: 'Add Garment' })).toBeVisible();
    expect(window.location.hash).toBe('');
    expect(getSessionMock).toHaveBeenCalledWith(token, expect.any(AbortSignal));
    expect(screen.getByText('Take a photo')).toBeVisible();
    expect(screen.getByText('Choose from photos')).toBeVisible();
  });

  it('previews a compatible image, validates metadata, and completes one real upload', async () => {
    uploadMock.mockImplementation((options) => {
      options.onProgress?.({ loaded: 10, total: 10, percent: 100 });
      return Promise.resolve({ status: 'completed' });
    });
    const user = userEvent.setup();
    render(<MobileUploadApp />);
    const gallery = await screen.findByLabelText('Choose from photos');
    await user.upload(gallery, new File(['png bytes'], 'linen.png', { type: 'image/png' }));
    expect(screen.getByRole('img', { name: 'Selected garment preview' })).toHaveAttribute(
      'src',
      'blob:muse-phone-preview',
    );
    await user.type(screen.getByRole('textbox', { name: 'Garment name' }), 'Phone Linen Shirt');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'top');
    expect(screen.getByText('Suggested placement: upper body')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add garment to Muse' }));

    expect(await screen.findByRole('heading', { name: 'Garment added' })).toBeVisible();
    expect(uploadMock).toHaveBeenCalledOnce();
    const submitted = uploadMock.mock.calls[0]?.[0];
    expect(submitted?.metadata).toMatchObject({
      name: 'Phone Linen Shirt',
      garment_category: 'top',
      default_body_zone: 'upper_body',
    });
    expect(sessionStorage.getItem('muse.phone-upload.token.v1')).toBeNull();
  });

  it('shows actionable HEIC guidance without attempting an upload', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<MobileUploadApp />);
    const gallery = await screen.findByLabelText('Choose from photos');
    await user.upload(gallery, new File(['heic bytes'], 'IMG_001.heic', { type: 'image/heic' }));

    expect(await screen.findByText(/HEIC and HEIF are not supported/u)).toBeVisible();
    expect(screen.queryByRole('img', { name: 'Selected garment preview' })).not.toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('places required-field validation beside the photograph, name, and category', async () => {
    const user = userEvent.setup();
    render(<MobileUploadApp />);
    await screen.findByRole('heading', { name: 'Add Garment' });

    await user.click(screen.getByRole('button', { name: 'Add garment to Muse' }));

    expect(await screen.findByText('Choose or take one garment photograph.')).toBeVisible();
    expect(screen.getByText('Enter a garment name.')).toBeVisible();
    expect(screen.getByText('Choose a garment category.')).toBeVisible();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('replaces and removes a selected preview without retaining object URLs', async () => {
    const user = userEvent.setup();
    const createObjectUrl = createObjectUrlMock
      .mockReturnValueOnce('blob:first-preview')
      .mockReturnValueOnce('blob:replacement-preview');
    render(<MobileUploadApp />);
    const gallery = await screen.findByLabelText('Choose from photos');

    await user.upload(gallery, new File(['first'], 'first.png', { type: 'image/png' }));
    expect(screen.getByRole('img', { name: 'Selected garment preview' })).toHaveAttribute(
      'src',
      'blob:first-preview',
    );
    await user.upload(gallery, new File(['second'], 'second.webp', { type: 'image/webp' }));
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:first-preview');
    expect(screen.getByRole('img', { name: 'Selected garment preview' })).toHaveAttribute(
      'src',
      'blob:replacement-preview',
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('img', { name: 'Selected garment preview' })).not.toBeInTheDocument();
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:replacement-preview');
    expect(screen.getByText('Choose from photos')).toBeVisible();
  });

  it('preserves the image and fields after an interrupted retryable upload', async () => {
    uploadMock.mockRejectedValue(
      new MobileUploadError({
        code: 'listener_unavailable',
        message: 'The local connection was interrupted. Check Wi-Fi and try again.',
        retryable: true,
      }),
    );
    const user = userEvent.setup();
    render(<MobileUploadApp />);
    await user.upload(
      await screen.findByLabelText('Choose from photos'),
      new File(['jpeg bytes'], 'shirt.jpg', { type: 'image/jpeg' }),
    );
    const name = screen.getByRole('textbox', { name: 'Garment name' });
    await user.type(name, 'Retry Shirt');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'top');
    await user.click(screen.getByRole('button', { name: 'Add garment to Muse' }));

    expect(await screen.findByText(/local connection was interrupted/u)).toBeVisible();
    expect(name).toHaveValue('Retry Shirt');
    expect(screen.getByRole('img', { name: 'Selected garment preview' })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add garment to Muse' })).toBeEnabled(),
    );
  });

  it('keeps invalid garment metadata retryable instead of treating it as an invalid token', async () => {
    uploadMock.mockRejectedValue(
      new MobileUploadError({
        code: 'invalid_import_metadata',
        message: 'Correct the garment details and try again.',
        status: 422,
        retryable: true,
      }),
    );
    const user = userEvent.setup();
    render(<MobileUploadApp />);
    await screen.findByRole('heading', { name: 'Add Garment' });
    await completeRequiredForm(user);
    await user.click(screen.getByRole('button', { name: 'Add garment to Muse' }));

    expect(await screen.findByText('Correct the garment details and try again.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Add Garment' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Invalid upload code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add garment to Muse' })).toBeEnabled();
  });

  it('confirms session status before resolving an ambiguous already-used upload response', async () => {
    getSessionMock.mockResolvedValueOnce(openedSession()).mockResolvedValueOnce({
      status: 'completed',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      canUpload: false,
      canRetry: false,
    });
    uploadMock.mockRejectedValue(
      new MobileUploadError({
        code: 'phone_upload_session_used',
        message: 'This code has already been used.',
        status: 409,
      }),
    );
    const user = userEvent.setup();
    render(<MobileUploadApp />);
    await screen.findByRole('heading', { name: 'Add Garment' });
    await completeRequiredForm(user);
    await user.click(screen.getByRole('button', { name: 'Add garment to Muse' }));

    expect(await screen.findByRole('heading', { name: 'Garment added' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Code already used' })).not.toBeInTheDocument();
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  it('announces bounded upload progress and supports explicit cancellation', async () => {
    uploadMock.mockImplementation(
      (options) =>
        new Promise((_, reject) => {
          options.onProgress?.({ loaded: 5, total: 10, percent: 50 });
          options.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The upload was cancelled.', 'AbortError')),
            { once: true },
          );
        }),
    );
    const user = userEvent.setup();
    render(<MobileUploadApp />);
    await user.upload(
      await screen.findByLabelText('Choose from photos'),
      new File(['jpeg bytes'], 'shirt.jpg', { type: 'image/jpeg' }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Garment name' }), 'Cancel Shirt');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'top');
    await user.click(screen.getByRole('button', { name: 'Add garment to Muse' }));

    expect(await screen.findByText('Uploading photograph… 50%')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel upload' }));
    expect(await screen.findByText(/Upload cancelled. Your photograph/u)).toBeVisible();
    expect(screen.getByRole('img', { name: 'Selected garment preview' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add garment to Muse' })).toBeEnabled();
  });

  it('polls unavailable recovery one request at a time and aborts it when unmounted', async () => {
    vi.useFakeTimers();
    const pendingPoll = deferred<LanSession>();
    let pollSignal: AbortSignal | undefined;
    getSessionMock
      .mockRejectedValueOnce(
        new MobileUploadError({
          code: 'listener_unavailable',
          message: 'Muse could not be reached.',
          retryable: true,
        }),
      )
      .mockImplementationOnce((_token: string, signal?: AbortSignal) => {
        pollSignal = signal;
        return pendingPoll.promise;
      });
    const rendered = render(<MobileUploadApp />);
    await act(async () => Promise.resolve());
    expect(screen.getByRole('heading', { name: 'Muse is unavailable' })).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(getSessionMock).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(getSessionMock).toHaveBeenCalledTimes(2);

    rendered.unmount();
    expect(pollSignal?.aborted).toBe(true);
    pendingPoll.resolve(openedSession());
    await act(async () => Promise.resolve());
  });

  it('leaves processing for an authoritative retryable failed status', async () => {
    vi.useFakeTimers();
    let uploadWasAborted = false;
    getSessionMock.mockResolvedValueOnce(openedSession()).mockResolvedValueOnce({
      status: 'failed',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      canUpload: true,
      canRetry: true,
    });
    uploadMock.mockImplementation(
      (options) =>
        new Promise((_, reject) => {
          options.onProgress?.({ loaded: 10, total: 10, percent: 100 });
          options.signal?.addEventListener(
            'abort',
            () => {
              uploadWasAborted = true;
              reject(new DOMException('The upload stopped.', 'AbortError'));
            },
            { once: true },
          );
        }),
    );
    render(<MobileUploadApp />);
    await act(async () => Promise.resolve());
    fireEvent.change(screen.getByLabelText('Choose from photos'), {
      target: { files: [new File(['jpeg bytes'], 'shirt.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Garment name' }), {
      target: { value: 'Retry Shirt' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: 'top' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add garment to Muse' }));
    expect(screen.getByText('Processing safely on Muse…')).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(uploadWasAborted).toBe(true);
    expect(screen.getByText(/could not complete that upload/u)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add garment to Muse' })).toBeEnabled();
  });

  it('ignores stale opened poll responses during processing and after completion', async () => {
    vi.useFakeTimers();
    const processingPoll = deferred<LanSession>();
    const terminalPoll = deferred<LanSession>();
    const upload = deferred<{ status: 'completed' }>();
    getSessionMock
      .mockResolvedValueOnce(openedSession())
      .mockImplementationOnce(() => processingPoll.promise)
      .mockImplementationOnce(() => terminalPoll.promise);
    uploadMock.mockImplementation((options) => {
      options.onProgress?.({ loaded: 10, total: 10, percent: 100 });
      return upload.promise;
    });
    render(<MobileUploadApp />);
    await act(async () => Promise.resolve());
    fireEvent.change(screen.getByLabelText('Choose from photos'), {
      target: { files: [new File(['jpeg bytes'], 'shirt.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Garment name' }), {
      target: { value: 'Phone Shirt' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: 'top' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add garment to Muse' }));
    expect(screen.getByText('Processing safely on Muse…')).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(getSessionMock).toHaveBeenCalledTimes(2);
    processingPoll.resolve(openedSession());
    await act(() => processingPoll.promise);
    expect(screen.getByText('Processing safely on Muse…')).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(getSessionMock).toHaveBeenCalledTimes(3);
    upload.resolve({ status: 'completed' });
    await act(() => upload.promise);
    expect(screen.getByRole('heading', { name: 'Garment added' })).toBeVisible();

    terminalPoll.resolve(openedSession());
    await act(() => terminalPoll.promise);
    expect(screen.getByRole('heading', { name: 'Garment added' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Add Garment' })).not.toBeInTheDocument();
  });

  it('shows an invalid-code state for an unknown but well-formed token', async () => {
    getSessionMock.mockRejectedValue(
      new MobileUploadError({
        code: 'phone_upload_session_invalid',
        message: 'This phone upload code is not valid.',
        status: 404,
      }),
    );
    render(<MobileUploadApp />);

    expect(await screen.findByRole('heading', { name: 'Invalid upload code' })).toBeVisible();
    expect(screen.queryByText('Muse is unavailable')).not.toBeInTheDocument();
  });

  it('distinguishes a failed import from a successfully used code', async () => {
    getSessionMock.mockResolvedValue({
      status: 'failed',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      canUpload: false,
      canRetry: false,
    });
    render(<MobileUploadApp />);

    expect(await screen.findByRole('heading', { name: 'Upload failed' })).toBeVisible();
    expect(screen.queryByText('Code already used')).not.toBeInTheDocument();
  });

  it('shows a fresh completed session as already used', async () => {
    getSessionMock.mockResolvedValue({
      status: 'completed',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      canUpload: false,
      canRetry: false,
    });
    render(<MobileUploadApp />);

    expect(await screen.findByRole('heading', { name: 'Code already used' })).toBeVisible();
  });

  it('recovers a committed upload after a lost response and tab refresh', async () => {
    consumePhoneEntryState();
    markPhoneUploadAttempted();
    getSessionMock.mockResolvedValue({
      status: 'completed',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      canUpload: false,
      canRetry: false,
    });
    render(<MobileUploadApp />);

    expect(await screen.findByRole('heading', { name: 'Garment added' })).toBeVisible();
    expect(screen.queryByText('Code already used')).not.toBeInTheDocument();
  });

  it.each([
    ['expired', 'This code expired'],
    ['cancelled', 'Upload cancelled'],
  ])('renders the %s terminal state clearly', async (sessionStatus, heading) => {
    getSessionMock.mockResolvedValue({
      status: sessionStatus,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      canUpload: false,
      canRetry: false,
    });
    render(<MobileUploadApp />);

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
  });

  it('distinguishes initial listener unavailability from an invalid code', async () => {
    getSessionMock.mockRejectedValue(
      new MobileUploadError({
        code: 'listener_unavailable',
        message: 'Muse could not be reached.',
        retryable: true,
      }),
    );
    render(<MobileUploadApp />);

    expect(await screen.findByRole('heading', { name: 'Muse is unavailable' })).toBeVisible();
    expect(screen.getByText(/retry automatically/u)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(sessionStorage.getItem('muse.phone-upload.token.v1')).toBe(token);
    expect(screen.queryByText('Invalid upload code')).not.toBeInTheDocument();
  });

  it('recovers automatically when Muse returns to the local network', async () => {
    vi.useFakeTimers();
    getSessionMock
      .mockRejectedValueOnce(
        new MobileUploadError({
          code: 'listener_unavailable',
          message: 'Muse could not be reached.',
          retryable: true,
        }),
      )
      .mockResolvedValueOnce(openedSession());
    render(<MobileUploadApp />);
    await act(async () => Promise.resolve());
    expect(screen.getByRole('heading', { name: 'Muse is unavailable' })).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(screen.getByRole('heading', { name: 'Add Garment' })).toBeVisible();
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  it('retries unavailable validation immediately from the touch control', async () => {
    getSessionMock
      .mockRejectedValueOnce(
        new MobileUploadError({
          code: 'listener_unavailable',
          message: 'Muse could not be reached.',
          retryable: true,
        }),
      )
      .mockResolvedValueOnce(openedSession());
    const user = userEvent.setup();
    render(<MobileUploadApp />);
    const retry = await screen.findByRole('button', { name: 'Try again' });

    await user.click(retry);

    expect(await screen.findByRole('heading', { name: 'Add Garment' })).toBeVisible();
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });
});
