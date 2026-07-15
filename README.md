# Muse

Muse is an offline-first smart wardrobe for a dedicated Raspberry Pi 5
touchscreen. It lets users organize clothing, compose garments on a silhouette,
control layers, and save outfits without requiring a cloud account, subscription,
or Internet connection.

The current implementation milestone provides the React application shell, a
versioned FastAPI API, SQLite persistence, safe local-storage foundations, and
development/production integration. It does not yet implement the complete
product screens or image import workflow.

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
    outfits/previews/
  tmp/uploads/
  backups/
```

SQLite rows store relative media references; bytes remain on the filesystem.
Production and test settings reject writable data inside the source tree. Set
`MUSE_DATA_ROOT` to a durable external directory, for example `/var/lib/muse`,
in production. Configuration also prevents database, temporary, backup, public
media, and frontend-build paths from overlapping. Runtime directories and newly
promoted media are owner-only.

Metadata API bodies default to a 64 KiB limit. The separately configured 25 MiB
upload limit is a validated placeholder for the next streaming image-import
slice; no upload endpoint exists in this milestone.

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

## Offline runtime assets

Inter and Playfair Display are bundled through Fontsource and emitted into the
Vite build. Muse does not request required fonts, CSS, icons, or graphical assets
from a CDN. Approved PNG mockups under `assets/ui/mockups/` remain references and
are not shipped as application UI.
