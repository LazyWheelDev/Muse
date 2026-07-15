import { useCallback } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';

export function useUnsavedChanges(isDirty: boolean) {
  useBeforeUnload(
    useCallback(
      (event) => {
        if (isDirty) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [isDirty],
    ),
  );

  return useBlocker(useCallback(() => isDirty, [isDirty]));
}
