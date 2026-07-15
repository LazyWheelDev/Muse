import { requestJson, requestVoid } from '../../api/request';
import { decodeOutfitDetail, decodeOutfitPage } from './decoders';
import type {
  OutfitCreatePayload,
  OutfitDetail,
  OutfitListOptions,
  OutfitPage,
  OutfitUpdatePayload,
} from './model';

export const DEFAULT_OUTFIT_PAGE_LIMIT = 24;

function outfitPath(outfitId: number): `/outfits/${number}` {
  if (!Number.isSafeInteger(outfitId) || outfitId <= 0) {
    throw new Error('Outfit id must be a positive integer.');
  }
  return `/outfits/${outfitId}`;
}

function normalizedListOptions(options: OutfitListOptions = {}) {
  const limit = options.limit ?? DEFAULT_OUTFIT_PAGE_LIMIT;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Outfit list limit must be an integer between 1 and 100.');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Outfit list offset must be a nonnegative integer.');
  }
  return { limit, offset };
}

export function listOutfits(
  options: OutfitListOptions = {},
  signal?: AbortSignal,
): Promise<OutfitPage> {
  const { limit, offset } = normalizedListOptions(options);
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestJson(`/outfits?${search.toString()}`, decodeOutfitPage, {
    ...(signal === undefined ? {} : { signal }),
  });
}

export function getOutfit(outfitId: number, signal?: AbortSignal): Promise<OutfitDetail> {
  return requestJson(outfitPath(outfitId), decodeOutfitDetail, {
    ...(signal === undefined ? {} : { signal }),
  });
}

export function createOutfit(
  payload: OutfitCreatePayload,
  signal?: AbortSignal,
): Promise<OutfitDetail> {
  return requestJson('/outfits', decodeOutfitDetail, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
}

export function updateOutfit(
  outfitId: number,
  payload: OutfitUpdatePayload,
  signal?: AbortSignal,
): Promise<OutfitDetail> {
  return requestJson(outfitPath(outfitId), decodeOutfitDetail, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
}

export function deleteOutfit(outfitId: number, signal?: AbortSignal): Promise<void> {
  return requestVoid(outfitPath(outfitId), {
    method: 'DELETE',
    ...(signal === undefined ? {} : { signal }),
  });
}
