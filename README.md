# Muse

Muse is an offline-first smart wardrobe for a dedicated Raspberry Pi 5
touchscreen. It lets users organize clothing, compose garments on a silhouette,
control layers, and save outfits without requiring a cloud account, subscription,
or Internet connection.

The current implementation includes the complete garment, phone-import, outfit,
and product-experience slices: secure local streaming import, short-lived QR
handoff, exact-original preservation, safe local derivatives, SQLite
persistence, Wardrobe and Clothing Details, the manual Outfit Builder,
deterministic local preview generation, the approved Saved Outfits grid,
readiness-aware Splash, typed Settings, local backups, and capability-aware
device information. Kiosk deployment and physical Raspberry Pi validation
remain later milestones.

## MVP principles

- Local and offline by default
- Touch-first at `1280 × 800`
- User-controlled outfit selection
- No mandatory paid API or hosted service
- Reliable Raspberry Pi kiosk operation
- Approved mockups and design-system documentation as the visual source of truth

See [docs/mvp-scope.md](docs/mvp-scope.md) for product scope and
[docs/architecture.md](docs/architecture.md) for the runtime and persistence
design.

## Repository structure

```text
assets/      Approved design references, brand assets, icons, and media
backend/     FastAPI API, SQLite migrations, persistence, and local storage
docs/        Product, interface, architecture, and roadmap documentation
frontend/    React, TypeScript, and Vite touchscreen application
kiosk/       Raspberry Pi startup, deployment, and kiosk configuration
```

## Supported toolchains

- Python `3.13.x` (constrained to `>=3.13,<3.14`)
- uv `0.11.28`
- Node.js `24.18.0`
- npm `11.16.0`

Python 3.13 is available for current 64-bit Raspberry Pi OS and gives Muse a
single reproducible development and ARM64 production target. The exact Python
minor and uv version are recorded in `backend/.python-version` and
`backend/pyproject.toml`; Python dependencies are frozen in `backend/uv.lock`.
Node and npm requirements are recorded in `.nvmrc`, `frontend/package.json`, and
`frontend/package-lock.json`.

Install [uv](https://docs.astral.sh/uv/) `0.11.28` and `nvm`, or provide the same
toolchain versions another way. No globally installed Python packages are used.

On macOS, if Python reports that hidden `.pth` files inside `.venv` were skipped,
set `export UV_PROJECT_ENVIRONMENT=venv` before `uv sync` and in each new shell
that runs backend commands. The alternate `backend/venv/` directory is already
gitignored; Linux and Raspberry Pi environments can use uv's normal `.venv`.

## First-time setup

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

On Debian, Ubuntu, or Raspberry Pi OS development images, Playwright's browser
and operating-system dependencies can be installed with:

```bash
cd frontend
npx playwright install --with-deps chromium
```

Playwright is a development/CI dependency only. The deployed kiosk uses the
system Chromium package.

## Local development

Copy the documented backend settings only when you need local overrides; the
checked-in defaults already work for development:

```bash
cp backend/.env.example backend/.env
```

Start the backend before the frontend. In terminal 1:

```bash
cd backend
uv run muse-backend migrate
uv run muse-backend serve --reload
```

In terminal 2:

```bash
cd frontend
npm run dev
```

`npm run dev:mobile` and `npm run preview:mobile` are available for isolated
responsive styling work, but they do not replace the token-authorized LAN
listener. Use the two-process procedure below for a real phone upload.

The ordinary Vite workflow exercises the loopback device application. To test
the real restricted phone surface, build both frontends and give the main and
restricted processes the same disposable configuration. Set these values in
the untracked `backend/.env` before starting either process:

```dotenv
MUSE_DATA_ROOT=/tmp/muse-phone-upload-dev
MUSE_PHONE_UPLOAD_ENABLED=true
MUSE_PHONE_UPLOAD_BIND_HOST=127.0.0.1
MUSE_PHONE_UPLOAD_TRUSTED_HOSTS=["127.0.0.1","localhost"]
MUSE_PHONE_UPLOAD_FRONTEND_BUILD_PATH=../frontend/dist-phone
```

Then build, migrate the disposable database, restart the main process in
terminal 1, and start the restricted process in terminal 3:

```bash
cd frontend
npm run build

cd ../backend
uv run muse-backend migrate
uv run muse-backend serve --reload

# Run from backend/ in another terminal with the same backend/.env.
uv run muse-backend serve-phone-upload
```

When testing from a separate phone, set both bind and advertised IPv4 to the Pi
or development machine's same exact private LAN address, add it to the phone
trusted-host list, and keep the main server on `127.0.0.1`. A loopback listener
deliberately cannot advertise a LAN hostname or address.

Open `http://127.0.0.1:5173`. Vite proxies relative `/api` requests to
`http://127.0.0.1:8000`, so frontend code follows the same-origin production
contract and never embeds a production hostname. Override only the development
proxy target with `MUSE_DEV_API_ORIGIN` in `frontend/.env`.

Useful local endpoints:

- Backend health: `http://127.0.0.1:8000/api/v1/health`
- Backend readiness: `http://127.0.0.1:8000/api/v1/readiness`
- Restricted-listener status when enabled: `http://127.0.0.1:8787/listener-status`
- OpenAPI UI: `http://127.0.0.1:8000/api/docs`
- OpenAPI JSON: `http://127.0.0.1:8000/api/openapi.json`

The frontend shows its backend diagnostic automatically in development, or when
`?diagnostics=1` is supplied explicitly. A failed health request produces a
visible unavailable state rather than a blank application.

## Database and local data

Development defaults to the gitignored `local-data/` directory at the repository
root:

```text
local-data/
  muse.sqlite3
  media/
    garments/original/
    garments/processed/
    garments/thumbnails/
    garments/cutouts/
    outfits/previews/
  tmp/uploads/
  tmp/previews/
  .locks/
  backups/
```

SQLite rows store relative media references; bytes remain on the filesystem.
Production and test settings reject writable data inside the source tree. Set
`MUSE_DATA_ROOT` to a durable external directory, for example `/var/lib/muse`,
in production. Configuration also prevents database, temporary, backup, public
media, and frontend-build paths from overlapping. Runtime directories and newly
promoted media are owner-only.

Metadata API bodies default to a 64 KiB limit. Garment import has a separate
25 MiB image limit plus bounded multipart overhead and writes upload chunks only
inside the configured temporary root.

## Garment import and local images

Open Wardrobe and choose **Add Garment**, or navigate directly to
`/wardrobe/add`, to choose the import method. `/wardrobe/add/device` opens the
local form; `/wardrobe/add/phone` opens the QR session view. Both methods accept
one JPEG, PNG, or WebP source photograph with validated garment metadata through
the same importer. The server verifies the file signature, declared MIME type,
filename suffix, dimensions, pixel count, frame count, color mode, complete
decode, EXIF orientation, and bounded color-profile data.

An acknowledged import has already stored:

- the exact, never-overwritten original bytes;
- a browser-safe normalized WebP with a maximum `1600 px` side; and
- a WebP thumbnail with a maximum `384 px` side.

The defaults reject images above 24 megapixels, a `12000 px` side, or 25 MiB.
All limits and derivative dimensions are configurable through documented
`MUSE_` settings. Derivatives contain no source EXIF or other unnecessary public
metadata.

Optional background cleanup runs through one bounded local worker after the
core import succeeds. The shipped Pillow processor preserves meaningful source
transparency and can remove a highly uniform, border-connected background when
its conservative confidence checks pass. Otherwise the garment records a
truthful `completed_with_fallback` state and continues using its normalized
image. Muse does not download an ML model or require the Internet. Display
selection is cutout, normalized, then original; grids prefer thumbnails.

Import attempts use backend-owned temporary directories and durable manifests
to coordinate atomic file promotion with the SQLite transaction. Startup
reconciliation preserves committed media, compensates interrupted uncommitted
promotions, clears stale temporary attempts, and resumes interrupted optional
processing. Soft deletion does not remove any image bytes.

### Import from a phone

Add Garment offers **Upload on this device** and **Upload from phone**. The
second option creates a persistent, short-lived session and displays a locally
generated QR code, readable fallback URL, expiry countdown, cancel, and
regenerate controls. A phone on the same trusted network opens the dedicated
responsive Muse page, previews or replaces a JPEG, PNG, or WebP photograph,
enters garment metadata, and uploads through the same secure streaming importer
as local-device import. Muse then refreshes Wardrobe and opens the committed
garment automatically.

Phone import uses two server processes. The complete SPA and `/api/v1` API stay
on `127.0.0.1`; a restricted listener binds one configured LAN interface and
serves only the mobile build, safe session status, and one authorized upload.
It exposes no clothing/outfit/Settings CRUD, media browser, readiness details,
OpenAPI, filesystem paths, or privileged actions. CORS is not used as
authentication, and no wildcard origin is enabled.

Before creating or regenerating a session, the loopback API probes the
restricted listener's exact configured bind address at `/listener-status` with
a 500 ms timeout. The probe follows no redirect, performs no DNS lookup, sends
no token, and requires the exact minimal JSON response. If the listener or its
compiled mobile build is unavailable, creation fails safely before a token row
is issued. Each active device status response repeats this bounded probe so the
screen's network state describes listener reachability, not merely successful
SQLite session creation. The listener revalidates its bounded Vite manifest and
every allow-listed mobile asset for each readiness response, so deleting or
corrupting a deployed build fails closed even after process startup.

The kiosk uses versioned loopback routes under
`/api/v1/phone-upload-sessions`. The LAN surface is limited to the safe
`/listener-status` readiness response, `/u/`, locally compiled
`/phone-assets/*`, `GET /phone-api/v1/session`, and
`POST /phone-api/v1/upload`. Requests for the main `/api/v1` tree through the
LAN listener remain unavailable.

Each token has at least 256 bits of entropy. SQLite stores only its SHA-256
digest. The QR URL places the raw token in the URL fragment, which is not sent
in the HTTP request target or Referrer. Mobile code removes the fragment from
visible history, retains the validated value only in origin-scoped
`sessionStorage` for refresh recovery, and sends it as the
`X-Muse-Upload-Token` authorization header. Terminal states clear it. The
listener disables access logging, and ordinary device status never returns the
secret. Completion, cancellation, expiry, or regeneration makes the token
unusable. A safe failed attempt may be retried with the same token only while
the server explicitly reports it retryable and the attempt and expiry limits
remain. Transactional session
claiming plus the existing import idempotency contract guarantees at most one
committed garment per successful session. On restart, Muse checks that stable
key before trusting a stale session state: if a garment already committed, even
a concurrent visible failure, cancellation, or expiry is reconciled to
`completed` instead of deleting or duplicating the garment.

Session creation defaults to a ten-minute lifetime. Startup drains session
recovery in repeated transactions of at most 100 mutations so every stale row
is handled without an unbounded transaction. Each periodic or operator cleanup
pass shares one 100-record budget across committed-import recovery, expiry,
interrupted-claim recovery, terminal-row deletion, and abandoned temporary
attempts. The main process checks at most every 300 seconds by default, and the
restricted listener also removes one bounded stale-attempt batch when it
starts. A `completed`, `cancelled`, or `expired` row is deleted only after it
has remained unchanged for 24 hours. An uncommitted `failed` row first expires;
no cleanup path removes a committed garment or registered image. Import,
best-effort cutout processing, startup reconciliation, and cleanup all use the
same cross-process gate, preventing cleanup from racing active temporary files
while also bounding concurrent Pillow work.

`MUSE_PHONE_UPLOAD_CLEANUP_BATCH_SIZE` bounds one cleanup pass. The listener's
in-memory abuse guard is configured by
`MUSE_PHONE_UPLOAD_RATE_LIMIT_REQUESTS`,
`MUSE_PHONE_UPLOAD_RATE_LIMIT_WINDOW_SECONDS`, and
`MUSE_PHONE_UPLOAD_RATE_LIMIT_CLIENTS`; it is not authentication and stores no
persistent client profile. Session authorization remains the token.

Muse supports JPEG, PNG, and WebP from phones. HEIC and HEIF are rejected with
an actionable message rather than renamed or decoded partially. Although a
third-party HEIF plugin publishes Python 3.13 Linux AArch64 artifacts, its
complete Raspberry Pi resource, codec, and licensing profile has not passed
target-hardware acceptance. The mobile camera picker requests a compatible
representation where the browser supports it, but Muse does not claim that an
iPhone will always convert an existing HEIC library photograph.

The advertised URL may use a configured `muse.local` hostname when Raspberry Pi
OS and the phone already have working mDNS, but this milestone does not install
or reconfigure the device's mDNS service. The direct private IPv4 address is the
deterministic fallback. Muse requires neither public DNS, an Internet tunnel, a
cloud relay, nor an external QR service. The HTTP token is protected against
guessing and replay but is not confidential from a malicious observer on the
LAN; phone upload therefore assumes a trusted local network.

Apply committed migrations and inspect their state with:

```bash
cd backend
uv run muse-backend migrate
uv run muse-backend migration-status
uv run muse-backend migration-check
```

Normal startup never calls `create_all()` and never silently applies schema
changes. Run migrations before starting the service. Migration bootstrap creates
the configured storage tree with owner-only directory permissions and keeps the
SQLite file owner-readable/writable only.

For development only, reset the configured SQLite database and recreate it at
the migration head with:

```bash
cd backend
uv run muse-backend reset-dev --confirm
```

The command refuses non-development environments and requires the explicit
confirmation flag. It removes the database plus its WAL/SHM journals, but does
not delete media. Review `MUSE_DATA_ROOT` before running it.

Clothing and outfits are soft-deleted. Normal queries exclude deleted records,
while an existing saved outfit remains valid when one of its garments is
deleted, including its primary-image reference. Soft deletion never silently
removes garment files.

The Clothing collection accepts an optional `garment_category` query parameter
for the approved Wardrobe category navigation. Search, arbitrary filters, and
favorites are intentionally absent.

## Outfit Builder and Saved Outfits

Open `/outfit-builder` to create an outfit, or pass an existing identifier as
`/outfit-builder?outfitId={id}`. The editor can add and remove garments, place
them directly on the workspace, move/resize/rotate them with touch-friendly
commands, reorder layers, reset transforms, and keep several distinct garments
in one body zone. Adding the same garment again activates its existing
placement rather than creating an accidental duplicate.

The browser and backend share one placement contract:

- a logical `640 × 800` workspace;
- normalized garment-center `x` and `y` coordinates with a top-left origin;
- one proportional scale value;
- clockwise rotation around the garment center; and
- deterministic back-to-front layer ordering.

The editor draft lives in one reducer-backed session separate from TanStack
Query server state. A versioned, validated, size-bounded `sessionStorage` record
recovers the draft after a browser reload. API save failures preserve the local
draft. Existing outfits support update, save as new, restore saved state, and
confirmed soft deletion.

Create and placement-changing update requests render a deterministic local
`600 × 750` lossless WebP. Pillow tries cutout, normalized, then original
garment media and substitutes a neutral placeholder only when every candidate
is unusable. A private staging directory and durable manifest coordinate atomic
promotion with the SQLite transaction. Name-only or unchanged-placement updates
reuse the existing preview; failed work preserves the previous row and preview.
Successful replacement removes the superseded unregistered preview, with
startup reconciliation retrying deferred cleanup. Soft-deleted outfit previews
are retained until Muse has an explicit permanent-retention policy.

`/saved-outfits` displays the approved three-column grid at `1280 × 800`,
newest-updated first. Cards use the generated preview, fall back safely when it
is missing, and reopen the exact outfit in the Builder. Grid scroll position is
preserved within the browser session. Long-press/fullscreen preview and exact
duplicate-outfit detection are optional extensions, not current MVP behavior.

Local saved-outfit endpoints are:

- `POST /api/v1/outfits`
- `GET /api/v1/outfits`
- `GET /api/v1/outfits/{id}`
- `PATCH /api/v1/outfits/{id}`
- `DELETE /api/v1/outfits/{id}`

An Apple M4 development benchmark rendered 20 placements of one synthetic
`800 × 1200` WebP with a `0.2334 s` median and `0.2383 s` maximum across five
warmed runs; the output was 40,034 bytes. This is non-Pi regression evidence.
Raspberry Pi 5 latency, memory, thermal, touch, storage, and interruption checks
remain required by
[docs/raspberry-pi-validation.md](docs/raspberry-pi-validation.md).

## Splash, Settings, and local data maintenance

Muse starts through a local CSS/SVG Splash sequence coordinated with
`GET /api/v1/readiness`. Readiness may complete before the designed sequence; if
it takes longer, Muse holds the final wordmark and retries at a bounded rate.
Persistent failure retains a branded Retry state instead of exposing a backend
trace. The full sequence plays once per cold browser session, does not replay
during internal navigation, and has a restrained Reduced Motion path.

`/settings` follows the approved five-card layout:

- **W & N** reports safe local-network and restricted-listener status. It does
  not manage Wi-Fi credentials in P6.
- **Display** persists interface dimming, screen timeout, Reduced Motion, and
  Splash mode. Dimming is an application overlay, not hardware backlight
  control; the sleep overlay preserves the active route.
- **Data** reports local storage, creates and lists local backups, downloads or
  deletes a selected backup, cleans bounded temporary data, and stages restore
  or delete-all maintenance.
- **Device** shows sanitized local information and explicit capability states.
  Privileged restart, reboot, shutdown, systemd, kiosk, Wi-Fi management, and
  hardware brightness remain unavailable until P7.
- **About Muse** describes the local-first privacy model, license, repository,
  and Build Week context using only bundled content.

Settings use the main loopback API only. The restricted phone listener mounts no
Settings, backup, device, maintenance, media, health, documentation, or main SPA
route. Settings mutation requests must be JSON and pass the extra origin check.

Backups are private `*.muse-backup.zip` archives below the configured data root.
Each contains a SQLite online snapshot, only media referenced by that snapshot,
and a closed versioned manifest with sizes and SHA-256 checksums. Operational
phone-upload sessions, nested backups, temporary files, logs, caches,
environment files, and secrets are excluded. Restore validates the archive and
stages replacement data but returns `staged_restart_required`; it never swaps a
database used by a running listener.

Apply staged maintenance only after both Muse listeners are stopped:

```bash
cd backend
uv run muse-backend apply-staged-maintenance \
  --confirm "APPLY STAGED MUSE MAINTENANCE"
```

The command obtains an exclusive runtime lease and refuses to run while either
listener holds its shared lease. Restore keeps the pre-operation safety backup.
Delete-all requires the UI's two confirmations, the exact typed phrase, and
explicit backup-loss acknowledgement; activation recreates the migrated empty
database and required local directories without touching application code.
P7 systemd units will coordinate the stop/apply/migrate/start sequence on the
physical device.

## Verification

Run the backend checks:

```bash
cd backend
uv run ruff format --check .
uv run ruff check .
uv run mypy src tests
uv run pytest
uv run muse-backend migration-check
```

Run a focused backend group without applying the whole-suite coverage threshold
with `uv run pytest -m unit --no-cov` or
`uv run pytest -m integration --no-cov`. Apply formatting with
`uv run ruff format .`.

Run the frontend checks:

```bash
cd frontend
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run test:e2e
```

Apply frontend formatting with `npm run format`. The Playwright shell suite uses
Chromium at the target `1280 × 800` viewport.

The ordinary and P4 production browser suites target disposable FastAPI
processes prepared as described below. P6 is different: its harness migrates,
starts, stops, and restarts both listeners itself, so ports `8000` and `8787`
must be free before running the P6 command.

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

The first command runs the local garment import/edit/delete flow and the P5
outfit flow. The P4 command additionally requires the restricted listener and
uses separate device and phone browser contexts to decode the QR, upload a real
image, observe automatic completion, restart both disposable test processes,
verify persistence, and reject replay after restart. CI supplies the backend
executable and isolated runtime paths to the Playwright harness. P6 creates a
private mode-`0700` per-attempt runtime directory, retains the exact child
process handles it launches, refuses symlinked runtime files, and never signals
a PID read from a file. It relaunches the two documented CLI commands against
the same dedicated, initially empty temporary data root. It never reuses the
P1/P5 smoke database. Muse exposes no restart or privileged test endpoint. The
P5 scenario imports local garments, creates overlapping placements, transforms
and layers them, verifies the generated `600 × 750` preview and approved
three-column grid, reloads, updates, saves as new, deletes, and checks local-only
requests and `1280 × 800` horizontal overflow. To run only that check, use
`npm run test:e2e:production:p5` with the same `PLAYWRIGHT_BASE_URL`. Do not
point any production E2E command at a personal wardrobe database.

The P6 scenario observes the real Splash/readiness transition, exercises all
Settings sections, persists Reduced Motion, creates and restores a backup,
applies staged restore and delete-all only after stopping both test listeners,
then verifies readiness, data integrity, reset behavior, LAN isolation, local
assets, touch targets, and `1280 × 800` overflow. It is intentionally
destructive and must use fresh private data and runtime roots.

The P4 PID files must already contain the actual disposable listener process IDs
and be writable by the test user; that harness rewrites them after restart. The
P6 harness owns its isolated attempt directories and exact child-process
handles, starts and stops both disposable listeners itself, and refuses
non-loopback targets. Its private PID files exist only for bounded CI crash
cleanup and are never trusted by Playwright as process authority. Use the
production executable path selected for the test environment (`venv` instead
of `.venv` on the documented macOS workaround). The CI workflow is the
canonical complete setup and creates owner-only PID and log files.

## Production build and startup

Build the frontend on a development machine or in CI:

```bash
cd frontend
npm ci
npm run build
```

The build command emits the kiosk application to `frontend/dist` and the
restricted phone page to `frontend/dist-phone`. Copy both immutable build
outputs to the Pi; do not run Vite or install Node on the production device.

Configure the Pi using `backend/.env.example` as a reference. A minimal local
production configuration includes:

```dotenv
MUSE_ENVIRONMENT=production
MUSE_DATA_ROOT=/var/lib/muse
MUSE_SERVE_FRONTEND=true
MUSE_FRONTEND_BUILD_PATH=/opt/muse/frontend/dist
MUSE_TRUSTED_HOSTS=["127.0.0.1","localhost"]
MUSE_ALLOWED_ORIGINS=[]
MUSE_MAINTENANCE_ROOT=maintenance
MUSE_MAX_BACKUP_ARCHIVE_BYTES=2147483648
MUSE_MAX_BACKUP_ENTRY_COUNT=20000
MUSE_MAX_BACKUP_COMPRESSION_RATIO=200
MUSE_MAINTENANCE_CLEANUP_BATCH_SIZE=100
MUSE_PHONE_UPLOAD_ENABLED=true
MUSE_PHONE_UPLOAD_BIND_HOST=192.168.1.50
MUSE_PHONE_UPLOAD_PORT=8001
MUSE_PHONE_UPLOAD_ADVERTISED_HOST=muse.local
MUSE_PHONE_UPLOAD_ADVERTISED_IPV4=192.168.1.50
MUSE_PHONE_UPLOAD_TRUSTED_HOSTS=["muse.local","192.168.1.50"]
MUSE_PHONE_UPLOAD_SESSION_TTL_SECONDS=600
MUSE_PHONE_UPLOAD_MAX_ATTEMPTS=3
MUSE_PHONE_UPLOAD_RECEIVE_TIMEOUT_SECONDS=120
MUSE_PHONE_UPLOAD_CLEANUP_INTERVAL_SECONDS=300
MUSE_PHONE_UPLOAD_RETENTION_SECONDS=86400
MUSE_PHONE_UPLOAD_CLEANUP_BATCH_SIZE=100
MUSE_PHONE_UPLOAD_RATE_LIMIT_REQUESTS=60
MUSE_PHONE_UPLOAD_RATE_LIMIT_WINDOW_SECONDS=60
MUSE_PHONE_UPLOAD_RATE_LIMIT_CLIENTS=256
MUSE_PHONE_UPLOAD_FRONTEND_BUILD_PATH=/opt/muse/frontend/dist-phone
```

Replace the example private address with the Pi's actual stable address. If
`muse.local` is not resolvable from the target phone, leave the advertised host
unset and use the direct-IP fallback. Never configure the main server with this
LAN address.

Then install the locked Python environment, migrate, and start the two
single-worker listeners in separate terminals or supervised processes:

```bash
cd /opt/muse/backend
uv sync --locked --no-dev
.venv/bin/muse-backend migrate
.venv/bin/muse-backend serve --host 127.0.0.1 --port 8000
.venv/bin/muse-backend serve-phone-upload
```

Readiness probes remain process-specific and intentionally disclose little on
the LAN listener:

```bash
curl --fail --show-error http://127.0.0.1:8000/api/v1/health
curl --fail --show-error http://127.0.0.1:8000/api/v1/readiness
curl --fail --show-error http://192.168.1.50:8001/listener-status
```

Run one aggregate bounded cleanup pass for an operator check or later scheduled
task. Its count includes reconciled, expired, and deleted session rows plus
removed stale import attempts:

```bash
.venv/bin/muse-backend cleanup-phone-upload-sessions
```

Production invokes the locked environment directly so `uv run` cannot sync the
default development dependency group during device startup.

The main FastAPI process serves the compiled SPA and API from the same loopback
origin. Direct navigation to React routes receives `index.html`; unknown
`/api/*` paths remain API 404s. The restricted listener serves only
`dist-phone` and its narrow upload contract. The backend keeps health
diagnostics available if the main frontend is missing, while readiness reports
the missing build. Normal Raspberry Pi runtime needs Python, the locked
environment, both precompiled frontend directories, SQLite data, and Chromium;
it does not need Node.js or Internet access.

Run the target-hardware acceptance procedure in
[docs/raspberry-pi-validation.md](docs/raspberry-pi-validation.md) before calling
a release Raspberry Pi validated. Development-machine timings and CI do not
replace that hardware run.

## Offline runtime assets

Inter and Playfair Display are bundled through Fontsource and emitted into the
Vite build. Muse does not request required fonts, CSS, icons, or graphical assets
from a CDN. Approved PNG mockups under `assets/ui/mockups/` remain references and
are not shipped as application UI.
