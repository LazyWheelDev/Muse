# Contributing to Muse

Muse is an offline-first smart wardrobe for a dedicated Raspberry Pi
touchscreen. Keep changes within the approved MVP and follow `AGENTS.md`, the
design-system documentation, and the approved mockups.

## Toolchain and setup

Use the checked-in toolchain versions:

- Python `3.13.x`
- uv `0.11.28`
- Node.js `24.18.0`
- npm `11.16.0`

From the repository root:

```bash
cd backend
uv sync --locked --all-groups

cd ../frontend
nvm install
nvm use
npm ci
npx playwright install chromium
```

Use `npx playwright install --with-deps chromium` on a Linux environment that
also needs Playwright's operating-system packages. Do not install project Python
packages globally or replace `npm ci` with an unlocked CI install.

If macOS Python reports skipped hidden `.pth` files from `.venv`, export
`UV_PROJECT_ENVIRONMENT=venv` before sync and backend commands; that alternate
environment path is gitignored.

If dependency declarations change, regenerate and commit the appropriate lockfile
with the tool's pinned version. Do not hand-edit generated lock data.

## Development startup

Start and migrate FastAPI first:

```bash
cd backend
uv run muse-backend migrate
uv run muse-backend serve --reload
```

Then start Vite in a second terminal:

```bash
cd frontend
npm run dev
```

Use `npm run dev:mobile` or `npm run preview:mobile` only for isolated responsive
styling. They do not emulate session authorization or the restricted LAN
surface; functional phone work must use the listener below.

Phone-upload changes must also exercise the real restricted listener rather
than binding the main application to the LAN. Build both frontends and put the
following common settings in the untracked `backend/.env` so the loopback main
process and restricted process use the same disposable database:

```dotenv
MUSE_DATA_ROOT=/tmp/muse-phone-upload-dev
MUSE_PHONE_UPLOAD_ENABLED=true
MUSE_PHONE_UPLOAD_BIND_HOST=127.0.0.1
MUSE_PHONE_UPLOAD_TRUSTED_HOSTS=["127.0.0.1","localhost"]
MUSE_PHONE_UPLOAD_FRONTEND_BUILD_PATH=../frontend/dist-phone
```

Then migrate once and start the two processes separately:

```bash
cd frontend
npm run build

cd ../backend
uv run muse-backend migrate
uv run muse-backend serve --reload

# Run from backend/ in another terminal with the same backend/.env.
uv run muse-backend serve-phone-upload
```

The main server must remain on `127.0.0.1`. Use a configured private interface
only for an intentional physical-phone test.

The browser calls relative `/api/v1` paths. Vite proxies `/api` to FastAPI; do
not add a hard-coded production host. Local API documentation is available at
`http://127.0.0.1:8000/api/docs`.

Copy `backend/.env.example` or `frontend/.env.example` only when overrides are
needed. Never commit `.env`, secrets, machine paths, local databases, uploaded
media, test output, or coverage data.

## Required checks

Before handing off backend changes, run:

```bash
cd backend
uv run ruff format --check .
uv run ruff check .
uv run mypy src tests
uv run pytest
uv run muse-backend migration-check
```

Useful focused commands are:

```bash
uv run ruff format .
uv run pytest -m unit --no-cov
uv run pytest -m integration --no-cov
uv run pytest tests/test_outfit_preview_renderer.py --no-cov
uv run pytest tests/test_outfit_previews_api.py --no-cov
```

Before handing off frontend changes, run:

```bash
cd frontend
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run test:e2e
```

Apply frontend formatting with `npm run format`; use `npm run test:watch` while
iterating. Playwright exercises Chromium at `1280 × 800`.

For the ordinary and P4 destructive browser checks, first build the frontend
and prepare the documented disposable FastAPI processes. P6 owns both listeners
itself; leave ports `8000` and `8787` free before running its command.

```bash
cd frontend
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8000 npm run test:e2e:production
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8000 \
PLAYWRIGHT_PHONE_UPLOAD_BASE_URL=http://127.0.0.1:8787 \
MUSE_BACKEND_EXECUTABLE=/absolute/path/to/backend/.venv/bin/muse-backend \
MUSE_MAIN_PID_FILE=/tmp/muse-phone-main.pid \
MUSE_PHONE_PID_FILE=/tmp/muse-phone-upload.pid \
MUSE_PHONE_E2E_DATA_ROOT=/tmp/muse-phone-e2e \
npm run test:e2e:production:p4

MUSE_P6_RUNTIME_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/muse-p6-runtime.XXXXXX")"
MUSE_P6_DATA_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/muse-p6-data.XXXXXX")"
chmod 700 "$MUSE_P6_RUNTIME_ROOT" "$MUSE_P6_DATA_ROOT"
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8000 \
PLAYWRIGHT_PHONE_UPLOAD_BASE_URL=http://127.0.0.1:8787 \
MUSE_BACKEND_EXECUTABLE=/absolute/path/to/backend/.venv/bin/muse-backend \
MUSE_P6_E2E_RUNTIME_ROOT="$MUSE_P6_RUNTIME_ROOT" \
MUSE_P6_E2E_DATA_ROOT="$MUSE_P6_DATA_ROOT" \
npm run test:e2e:production:p6
```

The suite imports, edits, reloads, and soft-deletes its own garments, then
builds, previews, updates, copies, and deletes its own outfits. Run only the P5
cross-stack check with `npm run test:e2e:production:p5` under the same disposable
host configuration. The P4 command additionally requires the restricted
listener configured against `dist-phone`; it decodes the QR in a phone-sized
browser, tests the single-use network upload, and restarts both disposable
processes before checking persistence and replay. P6 requires a fresh private
runtime root and a dedicated empty data root. It controls only the exact child
process handles it launches, uses no shared predictable PID path, and must never
be replaced by a privileged Muse API. Never target an existing personal or
production wardrobe.

For a local run, create owner-only PID files containing the actual disposable
listener PIDs before invoking P4; the harness rewrites them after restart. The
GitHub Actions workflow is the reference setup for all required variables,
isolated migration, listener startup, cleanup, and failure diagnostics.

The P6 harness owns private data/runtime attempt directories and retains the
exact child-process handles it launches. Its PID files are generated only for
bounded CI crash cleanup, not supplied as process authority. It starts both
disposable listeners, stages restore and delete-all, proves online activation is
rejected, invokes `apply-staged-maintenance` only after both have stopped,
restarts them, and verifies readiness, persistence, reset behavior, and LAN
isolation. It refuses non-loopback targets. Never run it against personal data.
Service activation remains an operator/test action; Muse exposes no restart
shell API.

Run both suites for cross-stack changes. GitHub Actions performs locked installs,
all static checks and tests, a clean-database migration check, both frontend
production builds, shell Playwright tests, a same-origin main-app smoke test,
and the restricted-listener phone workflow.

## Backend conventions

- Keep API routes, Pydantic schemas, services, repositories, SQLAlchemy models,
  storage, and configuration in their existing focused packages.
- Use the application factory and injected settings in tests. Never point tests
  at development or production data.
- Validate at HTTP and storage boundaries, then keep domain rules in services.
- Use explicit transactions for multi-row operations. Translate expected
  conflicts into structured application errors rather than exposing traces or
  database implementation details.
- Keep API changes versioned below `/api/v1` and update OpenAPI-facing schemas,
  tests, and documentation together.
- Use relative POSIX paths in persisted media references. Resolve paths only
  through the local-storage abstraction; reject traversal, absolute paths, and
  caller-selected destination names.
- Stream garment multipart bodies directly into the configured temporary root.
  Do not replace this with `request.form()`, `UploadFile`, or an in-memory body
  buffer without re-establishing the same size, cleanup, and crash guarantees.
- Preserve source bytes exactly. Generate normalized, thumbnail, and optional
  cutout variants as separate records in one logical image group; never treat
  derivatives as separate carousel photographs.
- Keep optional processing outside long SQLite transactions. Any change to the
  import manifest or reconciliation protocol requires injected-failure and
  restart tests.
- Keep the full FastAPI application loopback-only. The LAN listener must use its
  separate application factory and expose only its mobile page/assets, minimal
  listener status, token-authorized status, and one token-authorized import.
  Never include the main API router, media router, SPA fallback, readiness
  details, OpenAPI, or interactive docs in that factory.
- Generate phone-upload secrets with at least 256 bits of entropy, persist only
  their digest, keep the raw value in the mobile URL fragment, and never log it
  or a full QR URL. Ordinary status responses must not return it.
- Treat browser traces, screenshots of live QR codes, videos, request headers,
  and E2E state files as secret-bearing. The P4 harness must disable or redact
  them, invalidate its session in teardown, and never place them in CI
  diagnostics or the repository.
- Reuse the existing streaming parser and `GarmentImportService` for phone
  uploads. A session claim and stable internal idempotency key must guarantee at
  most one committed garment across concurrency, retry, and restart.
- Acquire the shared cross-process import gate for local import, phone import,
  and upload-attempt reconciliation. Never delete its lock file. Cleanup must
  be bounded, repeatable, and unable to remove committed garments or media.
- Render outfit previews only through the preview coordinator. Generated files
  must use a new immutable name, private staging plus a durable manifest, atomic
  promotion, short database ownership transaction, and compensating cleanup.
  Never overwrite a registered preview in place.
- Treat every outfit row, including a soft-deleted row, as the owner of its
  registered preview. Do not remove that file until an explicit permanent
  retention policy replaces the current soft-delete behavior.
- Preserve preview failure isolation: a failed create must leave no outfit, and
  a failed update must preserve the previous row and preview. Changes to preview
  staging, cleanup, or reconciliation require injected-failure and restart
  coverage.
- Do not call SQLAlchemy `metadata.create_all()` as a runtime migration shortcut.
- Keep application settings behind the explicit typed allowlist. Never accept
  an arbitrary settings key, command string, environment variable, Wi-Fi
  credential, or filesystem path from the browser.
- Keep every Settings mutation JSON-only and protected by the same-origin
  middleware. UI confirmation is not a substitute for backend validation.
- Create backups from the SQLite online-backup API and copy only snapshot-owned
  regular media. Stream checksums and validation; do not buffer an archive entry
  or complete backup in memory.
- Treat every backup as hostile during restore. Never call `extractall()`.
  Require a closed manifest, reject traversal, symlinks, special files,
  duplicate or case-colliding paths and zip bombs, and verify checksums, SQLite,
  foreign keys, and migration head before staging.
- A staged restore or delete-all response means restart is required. It must not
  be described as applied. Run `apply-staged-maintenance` only after both Muse
  listeners are stopped; the runtime lease refuses online activation.
- Platform adapters are read-only and bounded during P6. Restart, reboot,
  shutdown, Wi-Fi management, hardware brightness, systemd, and kiosk activation
  remain unavailable until P7. Do not add `shell=True`, caller-selected argv,
  broad sudo rules, or a root web process.

### Schema changes

Create an Alembic revision for every persistent model change, inspect the
generated operations, and test it from an empty database. Apply and verify with:

```bash
cd backend
uv run muse-backend migrate
uv run muse-backend migration-status
uv run muse-backend migration-check
```

Where practical, test downgrade and re-upgrade locally as well. Normal server
startup must remain migration-free so schema changes are deliberate and
observable.

To reset only a development database:

```bash
uv run muse-backend reset-dev --confirm
```

This is destructive to the configured SQLite database. The command rejects test
and production environments and deliberately leaves media in place.

### Data-model invariants

- Garment category and Outfit Builder body zone are separate concepts.
- Outfit placement `x` and `y` are normalized garment-center coordinates, use a
  top-left origin, and remain in `[0, 1]`.
- Placement uses one proportional scale value and an explicit layer.
- Several garments may occupy the same body zone.
- The logical outfit workspace is `640 × 800`; generated previews are
  `600 × 750` lossless WebP files. Positive rotation is clockwise and layers
  render from lowest/back to highest/front.
- Soft-deleted garments are excluded from Wardrobe queries, but existing outfit
  references remain readable. Never delete their files implicitly.

## Frontend conventions

- Use strict TypeScript and keep components small and focused.
- Prefer semantic HTML and accessible names before adding ARIA.
- Preserve visible keyboard focus and the `56 × 56 px` minimum touch target.
- Do not require hover or motion for essential behavior. Honor
  `prefers-reduced-motion`.
- Use `frontend/src/styles/tokens.css` and CSS Modules rather than one-off visual
  values or a heavyweight styling runtime.
- Keep required fonts, icons, and graphics local. Do not add CDN or runtime
  network dependencies for core behavior.
- Treat `assets/ui/mockups/` as approved references, not runtime UI assets.
- Keep backend access behind the typed API client, pass `AbortSignal` where
  lifecycle cancellation matters, and present unavailable states accessibly.
- Keep server state in TanStack Query and Wardrobe navigation context in
  validated URL parameters. Invalidate clothing collections after import,
  update, and soft deletion rather than maintaining a competing global store.
- Keep the Outfit Builder draft in its single reducer-backed provider. Do not
  copy editor state into TanStack Query or introduce a second store. Update the
  versioned, validated, bounded session codec whenever the persisted draft
  shape changes.
- Keep placement math in `features/outfit-builder/model.ts` aligned with the
  backend renderer: logical canvas dimensions, body-zone base widths, center
  coordinates, proportional scale, clockwise rotation, and deterministic
  layers are one cross-stack contract.
- Pointer movement must remain local and frame-batched; do not send an API
  mutation for each drag event. Preserve semantic command controls and the
  ordered garment list as alternatives to direct Canvas interaction.
- Preserve the approved three-column Saved Outfits grid at `1280 × 800`.
  Search, filters, favorites, exact duplicate-outfit detection, and fullscreen
  or long-press preview are not reasons to expand the current screen.
- Revoke every local image-preview object URL and keep multipart upload progress,
  cancellation, and structured errors in the centralized clothing client.
- Keep the device-facing session in the existing typed client and TanStack Query
  cache, with bounded polling stopped for completed, cancelled, or expired
  sessions and slowed for a retryable failure. Keep mobile form and progress
  state inside the separate phone entry; do not add a second global state
  framework.
- The phone page must be usable at `390 × 844`, use local assets only, and
  accept only JPEG, PNG, and WebP. Reject HEIC/HEIF with an actionable message;
  do not rename it or claim unsupported browser conversion.
- Do not introduce a dark theme during the MVP.
- Keep the Splash readiness-aware and single-play. Internal navigation must not
  replay it, persistent readiness failure must retain a safe Retry path, and
  Reduced Motion must preserve every essential state transition.
- Interface brightness is an application dimming overlay with a safe minimum;
  never label it as hardware backlight control. Screen sleep must preserve the
  active route and consume the wake interaction without click-through.

## Scope discipline

Do not add cloud synchronization, AI outfit recommendations, social features,
marketplace behavior, complex scraping, native mobile applications,
photorealistic try-on, or multi-user accounts during the MVP. Search, filters,
favorites, automatic metadata detection, and exact duplicate-outfit detection
are also outside the current milestone. New ideas belong in
`docs/version-2.md` rather than implementation code.

Update tests and documentation whenever behavior, commands, configuration, API
contracts, or architecture change.

Hardware acceptance follows
[docs/raspberry-pi-validation.md](docs/raspberry-pi-validation.md). Development
machine measurements must be reported separately from real Raspberry Pi results.
