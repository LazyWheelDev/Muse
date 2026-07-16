# Muse frontend

The Muse frontend is a strict React/TypeScript/Vite application for the
`1280 × 800` Raspberry Pi kiosk. A second small Vite entry builds the restricted
phone-upload page. Both builds contain their fonts, icons, scripts, and graphics
locally; production runtime needs Chromium and Python, not Node.js or Internet
access.

## Setup and commands

```bash
nvm install
nvm use
npm ci

npm run dev
npm run dev:mobile
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run test:e2e
```

`npm run build` emits `dist/` for the loopback kiosk application and
`dist-phone/` for the restricted LAN listener. Those directories are generated
and must not be committed.

## Application structure

- TanStack Query owns API/server state and bounded polling.
- React Router owns primary navigation and direct-route reloads.
- Wardrobe selection remains encoded in validated URL context.
- Outfit Builder owns its one reducer-backed, bounded session draft.
- Settings uses typed decoders and the loopback-only `/api/v1/settings` family.
- Display preferences apply interface dimming, inactivity sleep, Reduced Motion,
  and the Splash mode without a global state framework.
- The Splash/readiness layer plays once on cold startup, uses deterministic
  visual phases, waits for real readiness, and retains a safe Retry state.

The Settings landing route has exactly five destinations:

```text
/settings/network
/settings/display
/settings/data
/settings/device
/settings/about
```

The Power menu is capability-aware. Sleep Display is local browser behavior;
restart, reboot, and shutdown remain disabled until P7 installs and validates a
least-privilege Raspberry Pi adapter.

## Frontend safety and accessibility

- Keep API URLs relative and same-origin; never embed a production hostname.
- Do not load remote fonts, icons, animation assets, analytics, or scripts.
- Keep essential controls at least `56 × 56 px`, preserve visible focus, and do
  not rely on hover, swipe, color, or motion alone.
- Dialogs must trap and restore focus, support Escape where safe, and announce
  status or validation changes.
- The sleep overlay consumes the wake interaction so it cannot activate a
  control beneath it.
- Treat `staged_restart_required` literally. Never show restore or delete-all as
  completed until services restart and readiness succeeds.
- Do not persist filesystem paths, tokens, credentials, or raw backend errors in
  browser storage.

## Production E2E

The ordinary shell test uses Vite preview. Production integration tests require
compiled builds and isolated FastAPI processes. The complete workflow and
environment variables are documented in the root README and GitHub Actions.

P6 uses:

```bash
MUSE_P6_RUNTIME_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/muse-p6-runtime.XXXXXX")"
MUSE_P6_DATA_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/muse-p6-data.XXXXXX")"
chmod 700 "$MUSE_P6_RUNTIME_ROOT" "$MUSE_P6_DATA_ROOT"
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8000 \
PLAYWRIGHT_PHONE_UPLOAD_BASE_URL=http://127.0.0.1:8787 \
MUSE_BACKEND_EXECUTABLE=/absolute/path/to/muse-backend \
MUSE_P6_E2E_RUNTIME_ROOT="$MUSE_P6_RUNTIME_ROOT" \
MUSE_P6_E2E_DATA_ROOT="$MUSE_P6_DATA_ROOT" \
npm run test:e2e:production:p6
```

This scenario is destructive and must never target personal or production data.
It disables browser traces, screenshots, and video while process control and
backup activation are exercised. The harness creates a mode-`0700` per-attempt
runtime directory and controls only the child-process objects it launched; PID
files exist solely for bounded CI crash cleanup and are never trusted by the
Playwright process as process authority.
