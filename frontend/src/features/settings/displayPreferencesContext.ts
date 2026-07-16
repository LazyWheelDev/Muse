import { createContext, useContext } from 'react';

import type { ApplicationPreferences, ApplicationPreferencesUpdate } from './model';

export interface DisplayPreferencesContextValue {
  preferences: ApplicationPreferences;
  settingsUnavailable: boolean;
  isSaving: boolean;
  previewPreferences: (update: ApplicationPreferencesUpdate) => void;
  savePreferences: (update: ApplicationPreferencesUpdate) => Promise<void>;
  sleeping: boolean;
  sleepDisplay: () => void;
  wakeDisplay: () => void;
}

export const DisplayPreferencesContext = createContext<DisplayPreferencesContextValue | null>(null);

export function useDisplayPreferences(): DisplayPreferencesContextValue {
  const context = useContext(DisplayPreferencesContext);
  if (context === null) throw new Error('Display preferences must be used within their provider.');
  return context;
}
