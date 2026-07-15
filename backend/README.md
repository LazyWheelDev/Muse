# Muse backend

The Muse backend is a local FastAPI service for clothing metadata, saved outfits,
SQLite persistence, and safe filesystem access. It is designed to run as one
lightweight process on a Raspberry Pi 5 and has no mandatory cloud dependency.

## Stack and layout

- Python `>=3.13,<3.14`
- uv `0.11.28` with committed `uv.lock`
- FastAPI and Pydantic
- SQLAlchemy 2 with the standard-library SQLite driver
- Alembic migrations
- Ruff, mypy, pytest, HTTPX, and pytest-cov for development

```text
src/muse_backend/
  api/           Routes, dependencies, and HTTP error translation
  database/      Engine policy, models, and migration helpers
  domain/        Enumerations, validation, and application exceptions
  middleware/    Request-level cross-cutting behavior
  repositories/  SQL persistence queries
  schemas/       Pydantic API contracts
  services/      Transactional application rules and presenters
  storage/       Local path validation and atomic-file foundations
migrations/      Alembic environment and versioned revisions
tests/           Unit and integration tests with isolated temporary data
```

## Install

From `backend/`:

```bash
uv sync --locked --all-groups
```

uv reads `.python-version`, obtains a compatible Python 3.13 interpreter when
needed, and installs the exact locked environment in `.venv`. Project commands
always run through `uv run`; globally installed packages are not used.

On macOS, if Python reports that hidden `.pth` files inside `.venv` were skipped,
export `UV_PROJECT_ENVIRONMENT=venv` before syncing and keep it set for backend
commands in that shell. This selects the gitignored `backend/venv/` path. Linux
and Raspberry Pi environments can use the normal `.venv` path.

## Configuration

Settings use the `MUSE_` prefix and are loaded from process environment variables
or an optional `backend/.env`. Copy `.env.example` for local overrides. Paths may
be absolute or relative; writable child paths resolve beneath `MUSE_DATA_ROOT`.

| Variable                       | Development default         | Purpose                                                 |
| ------------------------------ | --------------------------- | ------------------------------------------------------- |
| `MUSE_ENVIRONMENT`             | `development`               | `development`, `testing`, or `production` safety policy |
| `MUSE_DATA_ROOT`               | `../local-data`             | Parent of every writable runtime path                   |
| `MUSE_DATABASE_PATH`           | `muse.sqlite3`              | SQLite file, relative to data root                      |
| `MUSE_MEDIA_ROOT`              | `media`                     | Parent for persistent local media                       |
| `MUSE_TEMP_UPLOAD_ROOT`        | `tmp/uploads`               | Staging area for future imports                         |
| `MUSE_ORIGINAL_IMAGE_ROOT`     | `media/garments/original`   | Original garment files                                  |
| `MUSE_PROCESSED_IMAGE_ROOT`    | `media/garments/processed`  | Best-effort processed garment files                     |
| `MUSE_THUMBNAIL_ROOT`          | `media/garments/thumbnails` | Local thumbnails                                        |
| `MUSE_OUTFIT_PREVIEW_ROOT`     | `media/outfits/previews`    | Future rendered outfit previews                         |
| `MUSE_BACKUP_ROOT`             | `backups`                   | Reserved local backup location                          |
| `MUSE_MAX_UPLOAD_SIZE_BYTES`   | `26214400`                  | Validated future upload limit (25 MiB)                  |
| `MUSE_MAX_API_BODY_SIZE_BYTES` | `65536`                     | Metadata API request limit (64 KiB)                     |
| `MUSE_LOG_LEVEL`               | `INFO`                      | Python log level                                        |
| `MUSE_FRONTEND_BUILD_PATH`     | `../frontend/dist`          | Existing Vite production build                          |
| `MUSE_SERVE_FRONTEND`          | `false`                     | Enable same-origin SPA serving                          |
| `MUSE_TRUSTED_HOSTS`           | local hosts                 | JSON list accepted by trusted-host middleware           |
| `MUSE_ALLOWED_ORIGINS`         | Vite local origins          | JSON list for deliberate development CORS access        |

Production and test environments reject a data root inside the repository.
Configure an external production location such as `/var/lib/muse`. Startup
creates configured directories with owner-only permissions; it does not migrate
the database. Private runtime paths, public media, and the frontend build may not
overlap.

## Commands

Install dependencies:

```bash
uv sync --locked --all-groups
```

Apply migrations, then start the development server:

```bash
uv run muse-backend migrate
uv run muse-backend serve --reload
```

Start the production server after setting production environment variables and
building the frontend:

```bash
uv sync --locked --no-dev
.venv/bin/muse-backend migrate
.venv/bin/muse-backend serve --host 127.0.0.1 --port 8000
```

Use the environment executable directly in production (including in systemd)
so service startup never attempts to resolve or install development packages.

The CLI intentionally starts one Uvicorn worker. Put Chromium on the same host
and origin; do not expose the service to a LAN without adding an appropriate
deployment security boundary.

Format and verify source:

```bash
uv run ruff format .
uv run ruff format --check .
uv run ruff check .
uv run mypy src tests
uv run pytest
```

Run separated test groups:

```bash
uv run pytest -m unit --no-cov
uv run pytest -m integration --no-cov
```

Coverage is collected and enforced at the repository threshold by the complete
`uv run pytest` suite. Focused marker runs disable coverage so they remain useful
during iteration.

## Migrations and development reset

The database schema is managed only by Alembic. The commands below use the same
validated settings as the application:

```bash
uv run muse-backend migrate
uv run muse-backend migrate <revision>
uv run muse-backend migration-status
uv run muse-backend migration-check
```

`migration-status` compares the database revision with the repository head.
`migration-check` asks Alembic whether SQLAlchemy metadata would require another
migration. A server with an unavailable or stale schema remains live at the
health endpoint but reports not-ready. Migration commands initialize the
configured storage tree with `0700` directories and keep SQLite at `0600`, so a
fresh production bootstrap is private before server startup.

Reset only an expendable development database with:

```bash
uv run muse-backend reset-dev --confirm
```

The command refuses to run outside `development`, refuses without `--confirm`,
removes the configured SQLite file and its `-wal`/`-shm` journals, and migrates a
new empty database to head. It preserves media intentionally. Always inspect
`MUSE_DATA_ROOT` first.

## API

The API is versioned below `/api/v1`.

| Method and path                      | Purpose                                                     |
| ------------------------------------ | ----------------------------------------------------------- |
| `GET /api/v1/health`                 | Process liveness and backend version                        |
| `GET /api/v1/readiness`              | Database, migrations, storage, and optional frontend checks |
| `POST /api/v1/clothing-items`        | Create clothing metadata without uploading an image         |
| `GET /api/v1/clothing-items`         | Page through active clothing items                          |
| `GET /api/v1/clothing-items/{id}`    | Read one active item and its image metadata                 |
| `PATCH /api/v1/clothing-items/{id}`  | Update validated clothing metadata                          |
| `DELETE /api/v1/clothing-items/{id}` | Soft-delete clothing metadata                               |
| `POST /api/v1/outfits`               | Create an outfit and placements transactionally             |
| `GET /api/v1/outfits`                | Page through active outfits                                 |
| `GET /api/v1/outfits/{id}`           | Read a complete outfit and garment reference states         |
| `PATCH /api/v1/outfits/{id}`         | Replace/update an outfit transactionally                    |
| `DELETE /api/v1/outfits/{id}`        | Soft-delete an outfit                                       |
| `GET /api/v1/media/{relative_path}`  | Read a validated local media path                           |

Collection responses use deterministic ordering plus bounded `limit` and
non-negative `offset` query parameters. Expected failures use a stable JSON
error envelope and an `X-Request-ID` response header. Validation errors never
expose local absolute paths or stack traces.

Metadata request bodies are limited by `MUSE_MAX_API_BODY_SIZE_BYTES`. The
larger `MUSE_MAX_UPLOAD_SIZE_BYTES` value is reserved for the next streaming
image-import endpoint and does not enable uploads by itself. Public media is
limited to approved image extensions beneath configured image/preview roots.

Inspect and exercise the local contract at:

- `http://127.0.0.1:8000/api/docs`
- `http://127.0.0.1:8000/api/openapi.json`

These interactive development aids are disabled when
`MUSE_ENVIRONMENT=production`.

## Data semantics

Garment category and default Outfit Builder body zone are independent fields.
Outfits can include multiple garments in the same zone. Placement `x` and `y`
represent the garment center relative to the canvas, use a top-left origin, and
remain within `[0, 1]`. Placement has one proportional scale, rotation, and an
explicit unique layer.

Clothing and outfits use nullable deletion timestamps. Deleted records are
absent from ordinary collection/detail requests. Saved outfits preserve
references to garments that were deleted after the outfit was created, and
responses identify those references as deleted while retaining primary-image
metadata. New outfit content cannot add a deleted garment. Soft deletion never
removes media bytes.

## Production SPA hosting

Build `frontend/dist`, set `MUSE_SERVE_FRONTEND=true`, and point
`MUSE_FRONTEND_BUILD_PATH` at that directory. FastAPI serves hashed assets with
long-lived immutable caching and the SPA entry point without a long-lived cache.
Safe extensionless client routes fall back to `index.html`; `/api/*` never does.

If the build is missing, API health remains accessible, readiness reports the
failure, and root UI requests receive an unavailable response. This makes a bad
deployment diagnosable without masking it. Node.js is not required on the
Raspberry Pi after the frontend has been built.
