import { useRef } from 'react';
import type { TouchEventHandler } from 'react';

export function useHorizontalSwipe(
  onPrevious: () => void,
  onNext: () => void,
  disabled = false,
): {
  onTouchStart: TouchEventHandler<HTMLElement>;
  onTouchEnd: TouchEventHandler<HTMLElement>;
} {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (event) => {
      const touch = event.changedTouches[0];
      start.current = touch === undefined ? null : { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd: (event) => {
      const touch = event.changedTouches[0];
      const origin = start.current;
      start.current = null;
      if (disabled || touch === undefined || origin === null) {
        return;
      }
      const deltaX = touch.clientX - origin.x;
      const deltaY = touch.clientY - origin.y;
      if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) {
        return;
      }
      if (deltaX > 0) {
        onPrevious();
      } else {
        onNext();
      }
    },
  };
}
