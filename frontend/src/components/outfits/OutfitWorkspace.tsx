import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import museValetUrl from '../../assets/muse-valet.svg';
import type { ClothingImage } from '../../features/clothing/model';
import {
  OUTFIT_BASE_WIDTH_BY_BODY_ZONE,
  OUTFIT_WORKSPACE_HEIGHT,
  OUTFIT_WORKSPACE_WIDTH,
} from '../../features/outfit-builder/model';
import styles from './OutfitWorkspace.module.css';
import type { WorkspacePlacement } from './OutfitWorkspace.types';

interface AlphaMask {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
}

interface LoadedImage {
  element: HTMLImageElement;
  mask: AlphaMask | null;
}

interface PlacementGeometry {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  radians: number;
}

interface DragState {
  pointerId: number;
  clientId: string;
  startPointerX: number;
  startPointerY: number;
  startPositionX: number;
  startPositionY: number;
}

interface OutfitWorkspaceProps {
  placements: readonly WorkspacePlacement[];
  activePlacementId: string | null;
  onActivate: (clientId: string) => void;
  onMove: (clientId: string, positionX: number, positionY: number) => void;
}

const imageCache = new Map<string, Promise<LoadedImage>>();
const MAX_CACHED_IMAGES = 48;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function naturalDimensions(image: LoadedImage | undefined): { width: number; height: number } {
  if (image === undefined) {
    return { width: 4, height: 3 };
  }
  return {
    width: Math.max(1, image.element.naturalWidth),
    height: Math.max(1, image.element.naturalHeight),
  };
}

function placementGeometry(placement: WorkspacePlacement, image?: LoadedImage): PlacementGeometry {
  const dimensions = naturalDimensions(image);
  const width =
    OUTFIT_WORKSPACE_WIDTH *
    OUTFIT_BASE_WIDTH_BY_BODY_ZONE[placement.bodyZone] *
    clamp(placement.scale, 0.1, 4);
  return {
    centerX: clamp(placement.positionX) * OUTFIT_WORKSPACE_WIDTH,
    centerY: clamp(placement.positionY) * OUTFIT_WORKSPACE_HEIGHT,
    width,
    height: width * (dimensions.height / dimensions.width),
    radians: (placement.rotation * Math.PI) / 180,
  };
}

function createAlphaMask(image: HTMLImageElement): AlphaMask | null {
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, 192 / Math.max(1, longestSide));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {
    return null;
  }
  try {
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const alpha = new Uint8ClampedArray(width * height);
    for (let source = 3, destination = 0; source < pixels.length; source += 4, destination += 1) {
      alpha[destination] = pixels[source] ?? 0;
    }
    return { width, height, alpha };
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<LoadedImage> {
  const cached = imageCache.get(url);
  if (cached !== undefined) {
    return cached;
  }
  const request = new Promise<LoadedImage>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener(
      'load',
      () => resolve({ element: image, mask: createAlphaMask(image) }),
      { once: true },
    );
    image.addEventListener('error', () => reject(new Error('Garment image failed to load.')), {
      once: true,
    });
    image.src = url;
  });
  imageCache.set(url, request);
  if (imageCache.size > MAX_CACHED_IMAGES) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined && oldest !== url) {
      imageCache.delete(oldest);
    }
  }
  request.catch(() => imageCache.delete(url));
  return request;
}

async function loadFirstCandidate(
  candidates: readonly ClothingImage[],
): Promise<LoadedImage | null> {
  for (const candidate of candidates) {
    try {
      return await loadImage(candidate.contentUrl);
    } catch {
      // A later locally stored derivative may still be usable.
    }
  }
  return null;
}

function roundedRectangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawPlacement(
  context: CanvasRenderingContext2D,
  placement: WorkspacePlacement,
  loaded: LoadedImage | undefined,
) {
  const geometry = placementGeometry(placement, loaded);
  context.save();
  context.translate(geometry.centerX, geometry.centerY);
  context.rotate(geometry.radians);
  if (loaded === undefined) {
    const placeholderHeight = Math.max(72, geometry.width * 0.68);
    roundedRectangle(
      context,
      -geometry.width / 2,
      -placeholderHeight / 2,
      geometry.width,
      placeholderHeight,
      22,
    );
    context.fillStyle = 'rgba(255, 249, 241, 0.9)';
    context.fill();
    context.strokeStyle = 'rgba(169, 130, 73, 0.72)';
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = '#756f66';
    context.font = '500 22px Inter, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(
      placement.deleted ? 'Unavailable garment' : 'Image unavailable',
      0,
      0,
      geometry.width - 24,
    );
  } else {
    context.drawImage(
      loaded.element,
      -geometry.width / 2,
      -geometry.height / 2,
      geometry.width,
      geometry.height,
    );
  }
  context.restore();
}

function drawActiveOutline(
  context: CanvasRenderingContext2D,
  placement: WorkspacePlacement,
  loaded: LoadedImage | undefined,
) {
  const geometry = placementGeometry(placement, loaded);
  context.save();
  context.translate(geometry.centerX, geometry.centerY);
  context.rotate(geometry.radians);
  context.strokeStyle = '#a98249';
  context.lineWidth = 4;
  context.setLineDash([10, 7]);
  context.strokeRect(
    -geometry.width / 2 - 7,
    -geometry.height / 2 - 7,
    geometry.width + 14,
    geometry.height + 14,
  );
  context.setLineDash([]);
  context.beginPath();
  context.arc(geometry.width / 2 + 5, -geometry.height / 2 - 5, 12, 0, Math.PI * 2);
  context.fillStyle = '#fff9f1';
  context.fill();
  context.strokeStyle = '#a98249';
  context.lineWidth = 4;
  context.stroke();
  context.restore();
}

function pointHitsPlacement(
  pointX: number,
  pointY: number,
  placement: WorkspacePlacement,
  loaded: LoadedImage | undefined,
): boolean {
  const geometry = placementGeometry(placement, loaded);
  const deltaX = pointX - geometry.centerX;
  const deltaY = pointY - geometry.centerY;
  const cosine = Math.cos(geometry.radians);
  const sine = Math.sin(geometry.radians);
  const localX = cosine * deltaX + sine * deltaY;
  const localY = -sine * deltaX + cosine * deltaY;
  if (
    localX < -geometry.width / 2 ||
    localX > geometry.width / 2 ||
    localY < -geometry.height / 2 ||
    localY > geometry.height / 2
  ) {
    return false;
  }
  if (loaded?.mask === null || loaded === undefined) {
    return true;
  }
  const horizontal = clamp(localX / geometry.width + 0.5);
  const vertical = clamp(localY / geometry.height + 0.5);
  const maskX = Math.min(loaded.mask.width - 1, Math.floor(horizontal * loaded.mask.width));
  const maskY = Math.min(loaded.mask.height - 1, Math.floor(vertical * loaded.mask.height));
  const alpha = loaded.mask.alpha[maskY * loaded.mask.width + maskX] ?? 0;
  return alpha >= 24;
}

function pointerPosition(
  event: ReactPointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * OUTFIT_WORKSPACE_WIDTH,
    y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * OUTFIT_WORKSPACE_HEIGHT,
  };
}

export function OutfitWorkspace({
  placements,
  activePlacementId,
  onActivate,
  onMove,
}: OutfitWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const queuedMoveRef = useRef<{ clientId: string; x: number; y: number } | null>(null);
  const [loadedImages, setLoadedImages] = useState<ReadonlyMap<string, LoadedImage | null>>(
    new Map(),
  );
  const orderedPlacements = useMemo(
    () => [...placements].sort((left, right) => left.layerIndex - right.layerIndex),
    [placements],
  );
  const imageSignature = placements
    .map(
      (placement) =>
        `${placement.clientId}:${placement.imageCandidates.map((image) => image.contentUrl).join(',')}`,
    )
    .join('|');

  useEffect(() => {
    let cancelled = false;
    const activeIds = new Set(placements.map((placement) => placement.clientId));
    for (const placement of placements) {
      if (placement.imageCandidates.length === 0) {
        continue;
      }
      void loadFirstCandidate(placement.imageCandidates).then((loaded) => {
        if (cancelled) {
          return;
        }
        setLoadedImages((current) => {
          const next = new Map([...current].filter(([clientId]) => activeIds.has(clientId)));
          next.set(placement.clientId, loaded);
          return next;
        });
      });
    }
    return () => {
      cancelled = true;
    };
    // imageSignature intentionally captures candidate changes without depending on array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSignature]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas === null || canvas === undefined || context === null || context === undefined) {
      return;
    }
    canvas.width = OUTFIT_WORKSPACE_WIDTH;
    canvas.height = OUTFIT_WORKSPACE_HEIGHT;
    context.clearRect(0, 0, OUTFIT_WORKSPACE_WIDTH, OUTFIT_WORKSPACE_HEIGHT);
    for (const placement of orderedPlacements) {
      drawPlacement(context, placement, loadedImages.get(placement.clientId) ?? undefined);
    }
    const active = orderedPlacements.find((placement) => placement.clientId === activePlacementId);
    if (active !== undefined) {
      drawActiveOutline(context, active, loadedImages.get(active.clientId) ?? undefined);
    }
  }, [activePlacementId, loadedImages, orderedPlacements]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [],
  );

  function queueMove(clientId: string, x: number, y: number) {
    queuedMoveRef.current = { clientId, x: clamp(x), y: clamp(y) };
    if (animationFrameRef.current !== null) {
      return;
    }
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const queued = queuedMoveRef.current;
      queuedMoveRef.current = null;
      if (queued !== null) {
        onMove(queued.clientId, queued.x, queued.y);
      }
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const point = pointerPosition(event, canvas);
    const hit = [...orderedPlacements]
      .reverse()
      .find((placement) =>
        pointHitsPlacement(
          point.x,
          point.y,
          placement,
          loadedImages.get(placement.clientId) ?? undefined,
        ),
      );
    if (hit === undefined) {
      return;
    }
    event.preventDefault();
    onActivate(hit.clientId);
    dragRef.current = {
      pointerId: event.pointerId,
      clientId: hit.clientId,
      startPointerX: point.x,
      startPointerY: point.y,
      startPositionX: hit.positionX,
      startPositionY: hit.positionY,
    };
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    if (canvas === null || drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const point = pointerPosition(event, canvas);
    queueMove(
      drag.clientId,
      drag.startPositionX + (point.x - drag.startPointerX) / OUTFIT_WORKSPACE_WIDTH,
      drag.startPositionY + (point.y - drag.startPointerY) / OUTFIT_WORKSPACE_HEIGHT,
    );
  }

  function finishPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    if (queuedMoveRef.current !== null) {
      const queued = queuedMoveRef.current;
      queuedMoveRef.current = null;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      onMove(queued.clientId, queued.x, queued.y);
    }
    dragRef.current = null;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  const unresolvedCount = placements.filter(
    (placement) => placement.imageCandidates.length > 0 && !loadedImages.has(placement.clientId),
  ).length;

  return (
    <div className={styles.workspace} data-testid="outfit-workspace">
      <img className={styles.silhouette} src={museValetUrl} alt="" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={`Outfit workspace with ${placements.length} garment${placements.length === 1 ? '' : 's'}. Touch a visible garment to select and drag it.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      />
      {placements.length === 0 ? (
        <p className={styles.emptyHint}>Choose a category to add your first garment.</p>
      ) : unresolvedCount > 0 ? (
        <p className={styles.loadingStatus} role="status">
          Preparing {unresolvedCount} garment {unresolvedCount === 1 ? 'image' : 'images'}…
        </p>
      ) : null}
    </div>
  );
}
