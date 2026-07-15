import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../api/ApiClientError';
import type { ImportClothingOptions } from '../features/clothing/clothingClient';
import { decodeClothingDetail } from '../features/clothing/decoders';
import { jsonResponse, rawClothingDetail, rawClothingPage } from '../test/clothingFixtures';
import { renderApp } from '../test/renderApp';

const importMock = vi.hoisted(() =>
  vi.fn<(options: ImportClothingOptions) => Promise<ReturnType<typeof decodeClothingDetail>>>(),
);
const revokeObjectUrlMock = vi.fn();

vi.mock('../features/clothing/clothingClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/clothing/clothingClient')>();
  return { ...actual, importClothingItem: importMock };
});

beforeEach(() => {
  importMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(rawClothingPage)));
  vi.stubGlobal('URL', URL);
  URL.createObjectURL = vi.fn(() => 'blob:muse-preview');
  revokeObjectUrlMock.mockReset();
  URL.revokeObjectURL = revokeObjectUrlMock;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AddGarmentPage', () => {
  it('validates required fields and focuses the visible image chooser', async () => {
    const user = userEvent.setup();
    renderApp('/wardrobe/add');
    await user.click(screen.getByRole('button', { name: 'Import garment' }));
    expect(screen.getByText('Choose a garment image.')).toBeVisible();
    expect(screen.getByText('Enter a garment name.')).toBeVisible();
    expect(screen.getByLabelText(/Choose a garment photograph/u)).toHaveFocus();
    expect(importMock).not.toHaveBeenCalled();
  });

  it('previews, replaces, and removes a local selection without exposing a path', async () => {
    const user = userEvent.setup();
    renderApp('/wardrobe/add');
    const input = screen.getByLabelText(/Choose a garment photograph/u);
    const image = new File(['image bytes'], 'linen-shirt.webp', { type: 'image/webp' });
    await user.upload(input, image);
    expect(screen.getByRole('img', { name: 'Selected garment preview' })).toHaveAttribute(
      'src',
      'blob:muse-preview',
    );
    expect(screen.queryByText(/fakepath|Users\//u)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replace image' }));
    await user.upload(input, image);
    expect(screen.getByRole('img', { name: 'Selected garment preview' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('img', { name: 'Selected garment preview' })).not.toBeInTheDocument();
    expect(revokeObjectUrlMock).toHaveBeenCalled();
  });

  it('accepts a suffix-backed browser file with an empty advisory MIME type', async () => {
    const user = userEvent.setup();
    renderApp('/wardrobe/add');
    await user.upload(
      screen.getByLabelText(/Choose a garment photograph/u),
      new File(['bytes'], 'garment.png', { type: '' }),
    );
    expect(screen.getByRole('img', { name: 'Selected garment preview' })).toBeVisible();
    expect(screen.queryByText('Choose a JPG, PNG, or WebP image.')).not.toBeInTheDocument();
  });

  it('reports final preparation, imports, and navigates to the selected garment', async () => {
    let finishImport: ((value: ReturnType<typeof decodeClothingDetail>) => void) | undefined;
    importMock.mockImplementation(
      (options) =>
        new Promise((resolve) => {
          finishImport = resolve;
          options.onProgress?.({ loaded: 10, total: 10, percent: 100 });
        }),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/wardrobe/add');
    await user.upload(
      screen.getByLabelText(/Choose a garment photograph/u),
      new File(['bytes'], 'garment.jpg', { type: 'image/jpeg' }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Linen Shirt');
    await user.click(screen.getByRole('button', { name: 'Import garment' }));
    expect(await screen.findByText('Preparing garment image…')).toBeVisible();
    finishImport?.(decodeClothingDetail(rawClothingDetail));
    await waitFor(() => expect(router.state.location.pathname).toBe('/wardrobe'));
    expect(router.state.location.search).toContain('category=top');
    expect(router.state.location.search).toContain('item=1');
  });

  it('reuses the idempotency key on an unchanged retry and changes it with the draft', async () => {
    importMock.mockRejectedValue(
      new ApiClientError({ code: 'backend_unavailable', message: 'Try the local service again.' }),
    );
    const user = userEvent.setup();
    renderApp('/wardrobe/add');
    await user.upload(
      screen.getByLabelText(/Choose a garment photograph/u),
      new File(['bytes'], 'garment.jpg', { type: 'image/jpeg' }),
    );
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.type(name, 'Linen Shirt');
    await user.click(screen.getByRole('button', { name: 'Import garment' }));
    expect(await screen.findByText('Try the local service again.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Import garment' }));
    await waitFor(() => expect(importMock).toHaveBeenCalledTimes(2));
    const firstKey = importMock.mock.calls[0]?.[0].idempotencyKey;
    const secondKey = importMock.mock.calls[1]?.[0].idempotencyKey;
    expect(secondKey).toBe(firstKey);

    await user.type(name, ' Updated');
    await user.click(screen.getByRole('button', { name: 'Import garment' }));
    await waitFor(() => expect(importMock).toHaveBeenCalledTimes(3));
    expect(importMock.mock.calls[2]?.[0].idempotencyKey).not.toBe(firstKey);
  });

  it('places structured backend image errors next to the chooser and restores focus', async () => {
    importMock.mockRejectedValue(
      new ApiClientError({
        code: 'corrupt_image',
        message: 'The selected image could not be decoded safely.',
      }),
    );
    const user = userEvent.setup();
    renderApp('/wardrobe/add');
    const imageInput = screen.getByLabelText(/Choose a garment photograph/u);
    await user.upload(
      imageInput,
      new File(['not really an image'], 'garment.jpg', { type: 'image/jpeg' }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Linen Shirt');
    await user.click(screen.getByRole('button', { name: 'Import garment' }));

    expect(
      await screen.findByText('The selected image could not be decoded safely.'),
    ).toHaveAttribute('id', 'garment-image-error');
    await waitFor(() => expect(imageInput).toHaveFocus());
    expect(
      screen.queryByText('Muse could not import this garment. Please try again.'),
    ).not.toBeInTheDocument();
  });
});
