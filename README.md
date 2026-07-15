# Muse

Muse is an offline-first smart wardrobe for a dedicated Raspberry Pi 5
touchscreen. It lets users organize clothing, compose garments on a silhouette,
control layers, and save outfits without requiring a cloud account, subscription,
or Internet connection.

The current implementation includes the local garment and outfit vertical
slices: streaming image import, exact-original preservation, safe local
derivatives, SQLite persistence, Wardrobe and Clothing Details, the manual
Outfit Builder, deterministic local preview generation, and the approved Saved
Outfits grid. Phone QR import and kiosk deployment remain later milestones.

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

Open `http://127.0.0.1:5173`. Vite proxies relative `/api` requests to
`http://127.0.0.1:8000`, so frontend code follows the same-origin production
contract and never embeds a production hostname. Override only the development
proxy target with `MUSE_DEV_API_ORIGIN` in `frontend/.env`.

Useful local endpoints:

- Backend health: `http://127.0.0.1:8000/api/v1/health`
- Backend readiness: `http://127.0.0.1:8000/api/v1/readiness`
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
`/wardrobe/add`. Muse accepts one JPEG, PNG, or WebP source photograph together
with validated garment metadata. The server verifies the file signature,
declared MIME type, filename suffix, dimensions, pixel count, frame count, color
mode, complete decode, EXIF orientation, and bounded color-profile data.

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

The production browser integration suite targets a running same-origin FastAPI
host. After building the frontend, migrating a disposable empty data root, and
starting FastAPI as described below, run it in a second terminal with:

```bash
cd frontend
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8000 npm run test:e2e:production
```

This runs the garment import/edit/delete flow and the P5 outfit flow. The latter
imports local garments, creates overlapping placements, transforms and layers
them, verifies the generated `600 × 750` preview and approved three-column
grid, reloads, updates, saves as new, deletes, and checks local-only requests and
`1280 × 800` horizontal overflow. To run only that check, use
`npm run test:e2e:production:p5` with the same `PLAYWRIGHT_BASE_URL`. Do not
point either command at a personal wardrobe database.

## Production build and startup

Build the frontend on a development machine or in CI:

```bash
cd frontend
npm ci
npm run build
```

Configure the Pi using `backend/.env.example` as a reference. A minimal local
production configuration includes:

```dotenv
MUSE_ENVIRONMENT=production
MUSE_DATA_ROOT=/var/lib/muse
MUSE_SERVE_FRONTEND=true
MUSE_FRONTEND_BUILD_PATH=/opt/muse/frontend/dist
MUSE_TRUSTED_HOSTS=["127.0.0.1","localhost"]
MUSE_ALLOWED_ORIGINS=[]
```

Then install the locked Python environment, migrate, and start one local worker:

```bash
cd /opt/muse/backend
uv sync --locked --no-dev
.venv/bin/muse-backend migrate
.venv/bin/muse-backend serve --host 127.0.0.1 --port 8000
```

Production invokes the locked environment directly so `uv run` cannot sync the
default development dependency group during device startup.

FastAPI serves the compiled SPA and API from the same origin. Direct navigation
to React routes receives `index.html`; unknown `/api/*` paths remain API 404s.
The backend keeps health diagnostics available if the frontend build is missing,
while readiness reports the missing build. Normal Raspberry Pi runtime needs
Python, the locked environment, the compiled frontend, SQLite data, and Chromium;
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
