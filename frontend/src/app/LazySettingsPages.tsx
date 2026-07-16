import { lazy, Suspense, type ReactNode } from 'react';

import { LoadingState } from '../components/ui/AsyncState';

const NetworkSettingsPage = lazy(() =>
  import('../pages/NetworkSettingsPage').then((module) => ({
    default: module.NetworkSettingsPage,
  })),
);
const DisplaySettingsPage = lazy(() =>
  import('../pages/DisplaySettingsPage').then((module) => ({
    default: module.DisplaySettingsPage,
  })),
);
const DataSettingsPage = lazy(() =>
  import('../pages/DataSettingsPage').then((module) => ({ default: module.DataSettingsPage })),
);
const DeviceSettingsPage = lazy(() =>
  import('../pages/DeviceSettingsPage').then((module) => ({ default: module.DeviceSettingsPage })),
);
const AboutMusePage = lazy(() =>
  import('../pages/AboutMusePage').then((module) => ({ default: module.AboutMusePage })),
);

function LazySettingsBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingState label="Opening Settings…" />}>{children}</Suspense>;
}

export function LazyNetworkSettingsPage() {
  return (
    <LazySettingsBoundary>
      <NetworkSettingsPage />
    </LazySettingsBoundary>
  );
}

export function LazyDisplaySettingsPage() {
  return (
    <LazySettingsBoundary>
      <DisplaySettingsPage />
    </LazySettingsBoundary>
  );
}

export function LazyDataSettingsPage() {
  return (
    <LazySettingsBoundary>
      <DataSettingsPage />
    </LazySettingsBoundary>
  );
}

export function LazyDeviceSettingsPage() {
  return (
    <LazySettingsBoundary>
      <DeviceSettingsPage />
    </LazySettingsBoundary>
  );
}

export function LazyAboutMusePage() {
  return (
    <LazySettingsBoundary>
      <AboutMusePage />
    </LazySettingsBoundary>
  );
}
