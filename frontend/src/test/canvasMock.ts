import { vi } from 'vitest';

export const canvasSpies = {
  arc: vi.fn<CanvasRenderingContext2D['arc']>(),
  beginPath: vi.fn<CanvasRenderingContext2D['beginPath']>(),
  clearRect: vi.fn<CanvasRenderingContext2D['clearRect']>(),
  drawImage: vi.fn<CanvasRenderingContext2D['drawImage']>(),
  fill: vi.fn<CanvasRenderingContext2D['fill']>(),
  fillText: vi.fn<CanvasRenderingContext2D['fillText']>(),
  restore: vi.fn<CanvasRenderingContext2D['restore']>(),
  rotate: vi.fn<CanvasRenderingContext2D['rotate']>(),
  roundRect: vi.fn<CanvasRenderingContext2D['roundRect']>(),
  save: vi.fn<CanvasRenderingContext2D['save']>(),
  setLineDash: vi.fn<CanvasRenderingContext2D['setLineDash']>(),
  stroke: vi.fn<CanvasRenderingContext2D['stroke']>(),
  strokeRect: vi.fn<CanvasRenderingContext2D['strokeRect']>(),
  translate: vi.fn<CanvasRenderingContext2D['translate']>(),
};

function opaqueImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  return { colorSpace: 'srgb', data, height, width };
}

export const canvasContextMock = {
  ...canvasSpies,
  fillStyle: '#000000',
  font: '10px sans-serif',
  getImageData: (_x: number, _y: number, width: number, height: number) =>
    opaqueImageData(width, height),
  lineWidth: 1,
  strokeStyle: '#000000',
  textAlign: 'start',
  textBaseline: 'alphabetic',
} as unknown as CanvasRenderingContext2D;

const capturedPointers = new WeakMap<HTMLCanvasElement, Set<number>>();
let nextAnimationFrameId = 1;
const animationFrames = new Map<number, number>();

export function installCanvasMock(): void {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(contextId: string) {
      return contextId === '2d' ? canvasContextMock : null;
    },
  });

  Object.defineProperties(HTMLCanvasElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value(this: HTMLCanvasElement, pointerId: number) {
        return capturedPointers.get(this)?.has(pointerId) ?? false;
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(this: HTMLCanvasElement, pointerId: number) {
        capturedPointers.get(this)?.delete(pointerId);
      },
    },
    setPointerCapture: {
      configurable: true,
      value(this: HTMLCanvasElement, pointerId: number) {
        const pointers = capturedPointers.get(this) ?? new Set<number>();
        pointers.add(pointerId);
        capturedPointers.set(this, pointers);
      },
    },
  });

  Object.defineProperties(window, {
    cancelAnimationFrame: {
      configurable: true,
      writable: true,
      value(animationFrameId: number) {
        const timeoutId = animationFrames.get(animationFrameId);
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
          animationFrames.delete(animationFrameId);
        }
      },
    },
    requestAnimationFrame: {
      configurable: true,
      writable: true,
      value(callback: FrameRequestCallback) {
        const animationFrameId = nextAnimationFrameId;
        nextAnimationFrameId += 1;
        const timeoutId = window.setTimeout(() => {
          animationFrames.delete(animationFrameId);
          callback(performance.now());
        }, 0);
        animationFrames.set(animationFrameId, timeoutId);
        return animationFrameId;
      },
    },
  });
}
