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
- python-multipart for bounded streaming ingestion
- Pillow for local validation, normalization, thumbnails, and conservative cutouts
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

| Variable                                   | Development default         | Purpose                                                 |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------- |
| `MUSE_ENVIRONMENT`                         | `development`               | `development`, `testing`, or `production` safety policy |
| `MUSE_DATA_ROOT`                           | `../local-data`             | Parent of every writable runtime path                   |
| `MUSE_DATABASE_PATH`                       | `muse.sqlite3`              | SQLite file, relative to data root                      |
| `MUSE_MEDIA_ROOT`                          | `media`                     | Parent for persistent local media                       |
| `MUSE_TEMP_UPLOAD_ROOT`                    | `tmp/uploads`               | Private streaming/import-attempt staging                |
| `MUSE_TEMP_PREVIEW_ROOT`                   | `tmp/previews`              | Private crash-recovery staging for outfit previews      |
| `MUSE_ORIGINAL_IMAGE_ROOT`                 | `media/garments/original`   | Exact, immutable upload bytes                           |
| `MUSE_PROCESSED_IMAGE_ROOT`                | `media/garments/processed`  | Browser-safe normalized WebP files                      |
| `MUSE_THUMBNAIL_ROOT`                      | `media/garments/thumbnails` | Wardrobe grid thumbnails                                |
| `MUSE_CUTOUT_IMAGE_ROOT`                   | `media/garments/cutouts`    | Optional best-effort cutouts                            |
| `MUSE_OUTFIT_PREVIEW_ROOT`                 | `media/outfits/previews`    | Immutable generated outfit preview WebP files           |
| `MUSE_BACKUP_ROOT`                         | `backups`                   | Reserved local backup location                          |
| `MUSE_MAX_UPLOAD_SIZE_BYTES`               | `26214400`                  | Maximum source image bytes (25 MiB)                     |
| `MUSE_MAX_IMPORT_OVERHEAD_BYTES`           | `65536`                     | Multipart metadata and framing allowance                |
| `MUSE_UPLOAD_CHUNK_SIZE_BYTES`             | `262144`                    | Maximum parser work chunk                               |
| `MUSE_MAX_IMAGE_PIXELS`                    | `24000000`                  | Maximum decoded source pixel count                      |
| `MUSE_MAX_IMAGE_DIMENSION`                 | `12000`                     | Maximum source width or height                          |
| `MUSE_NORMALIZED_IMAGE_MAX_DIMENSION`      | `1600`                      | Maximum normalized WebP side                            |
| `MUSE_THUMBNAIL_MAX_DIMENSION`             | `384`                       | Maximum thumbnail side                                  |
| `MUSE_NORMALIZED_WEBP_QUALITY`             | `85`                        | Normalized lossy WebP quality                           |
| `MUSE_THUMBNAIL_WEBP_QUALITY`              | `80`                        | Thumbnail lossy WebP quality                            |
| `MUSE_BACKGROUND_PROCESSING_ENABLED`       | `true`                      | Run the bounded optional cutout worker                  |
| `MUSE_BACKGROUND_PROCESSING_MAX_ATTEMPTS`  | `2`                         | Retry ceiling for transient processor failures          |
| `MUSE_BACKGROUND_WORKER_POLL_SECONDS`      | `0.5`                       | Durable queue poll interval                             |
| `MUSE_BACKGROUND_SHUTDOWN_TIMEOUT_SECONDS` | `10.0`                      | Graceful worker join deadline                           |
| `MUSE_MAX_API_BODY_SIZE_BYTES`             | `65536`                     | Non-import metadata body limit                          |
| `MUSE_LOG_LEVEL`                           | `INFO`                      | Python log level                                        |
| `MUSE_FRONTEND_BUILD_PATH`                 | `../frontend/dist`          | Existing Vite production build                          |
| `MUSE_SERVE_FRONTEND`                      | `false`                     | Enable same-origin SPA serving                          |
| `MUSE_TRUSTED_HOSTS`                       | local hosts                 | JSON list accepted by trusted-host middleware           |
| `MUSE_ALLOWED_ORIGINS`                     | Vite local origins          | JSON list for deliberate development CORS access        |

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

| Method and path                      | Purpose                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `GET /api/v1/health`                 | Process liveness and backend version                         |
| `GET /api/v1/readiness`              | Database, migrations, storage, and optional frontend checks  |
| `POST /api/v1/clothing-items`        | Create clothing metadata without uploading an image          |
| `POST /api/v1/clothing-items/import` | Stream, validate, persist, and enqueue one local photograph  |
| `GET /api/v1/clothing-items`         | Page active items; optionally select `garment_category`      |
| `GET /api/v1/clothing-items/{id}`    | Read one active item and its image metadata                  |
| `PATCH /api/v1/clothing-items/{id}`  | Update validated clothing metadata                           |
| `DELETE /api/v1/clothing-items/{id}` | Soft-delete clothing metadata                                |
| `POST /api/v1/outfits`               | Create placements and a local preview transactionally        |
| `GET /api/v1/outfits`                | Page through active outfits                                  |
| `GET /api/v1/outfits/{id}`           | Read a complete outfit and garment reference states          |
| `PATCH /api/v1/outfits/{id}`         | Replace/update an outfit and changed preview transactionally |
| `DELETE /api/v1/outfits/{id}`        | Soft-delete an outfit                                        |
| `GET /api/v1/media/{relative_path}`  | Read a validated local media path                            |

Collection responses use deterministic ordering plus bounded `limit` and
non-negative `offset` query parameters. Expected failures use a stable JSON
error envelope and an `X-Request-ID` response header. Validation errors never
expose local absolute paths or stack traces.

The import request contains exactly one `metadata` JSON part and one `image`
part. Optional `Idempotency-Key` values make a safe retry return the originally
committed garment. Metadata request bodies are limited by
`MUSE_MAX_API_BODY_SIZE_BYTES`; import bodies instead use the image limit plus
bounded multipart overhead. Public media is limited to approved image
extensions beneath configured image/preview roots.

## Garment import and processing

JPEG, PNG, and WebP uploads are signature-checked, fully decoded under explicit
dimension and pixel limits, oriented from EXIF, converted to a browser-safe
color mode, and written as normalized and thumbnail WebP derivatives. The
source bytes are hashed, atomically promoted without modification, and recorded
as a separate `original` image. Derivative records share an image-group ID so
the API exposes one carousel photograph rather than three duplicate slides.

Core import acknowledgment does not wait for optional background removal. A
single local worker claims persistent jobs and records `pending`, `processing`,
`completed`, or `completed_with_fallback`. The default conservative Pillow
processor preserves useful existing alpha or removes only a sufficiently
uniform, border-connected background. It does not download an ML model. A
failed or low-confidence cutout remains explicit and the UI falls back to the
normalized derivative.

The core lock does **not** include rembg, ONNX Runtime, or a model file. Their
current Python and Linux ARM64 packaging is promising, but their model storage,
first-run download behavior, sustained Pi latency, and thermal impact have not
yet passed target-hardware acceptance. `MUSE_BACKGROUND_PROCESSING_ENABLED`
therefore controls only the shipped Pillow processor; it does not silently turn
on ML inference.

The worker accepts the `BackgroundRemovalProcessor` protocol for a future
higher-quality local adapter. Enabling one on a Pi requires all of the following
as an explicit later change: pin an ARM64/Python 3.13 inference stack in
`uv.lock`, provision the selected model inside the device image (never download
it on first use), implement and test an adapter that writes a validated static
WebP, inject that adapter when constructing the single worker, and pass the
latency, RSS, temperature, recovery, and offline checks in the Pi validation
procedure. Until then, fallback is the supported production behavior.

Temporary attempts carry durable manifests. Startup reconciliation resets
interrupted jobs, compensates uncommitted promoted files only after checking
database ownership, retains ambiguous/unknown media for inspection, and logs
registered files that are missing or generated files with no row. An exact
original is never removed because optional processing failed. SQLite uses
foreign keys, WAL journaling, a busy timeout, and `synchronous=FULL` for this
single-device durability profile.

## Outfit preview generation

Creating an outfit, or replacing its placements, generates a deterministic
`600 x 750` lossless WebP preview locally. Rendering uses a logical `640 x 800`
workspace, a bundled neutral mannequin drawn with Pillow, ascending layers from
back to front, normalized center coordinates, proportional scale, and clockwise
rotation around each garment center. Garment media is tried in the order
`cutout`, `normalized`, then `original`; a bounded placeholder is rendered when
every candidate is unavailable or invalid. No network request or external model
is involved.

Preview files use unique immutable names. Each is rendered in the private
preview staging root, accompanied by a crash-recovery manifest, and atomically
promoted before the short database transaction records ownership. A failed
render, promotion, or database write leaves the previous outfit and preview
unchanged. Successful placement changes delete the superseded file after commit;
name-only and unchanged-placement updates reuse the existing preview. Soft
deletion retains its preview. Startup reconciliation treats every outfit row,
including soft-deleted rows, as authoritative and retries deferred cleanup of
unregistered generated previews.

Outfit summaries and details expose `preview_width` and `preview_height` when a
preview path exists. Hydrated garment references retain the existing
`primary_image` field and additionally expose `default_body_zone`,
`display_image`, `thumbnail_image`, and ordered `image_candidates` so clients can
perform the same local fallback without deriving filesystem paths.

### Performance validation

Development-machine measurements on 2026-07-15 used an Apple M4 (`arm64`),
Python 3.13.14, and local temporary storage. One synthetic 4000 x 3000 JPEG
decoded, oriented, normalized to 1600 x 1200, and thumbnailed to 384 x 288 in
0.142 seconds. A 24-item first page selected from 60 metadata-only garments had
a 0.58 ms median and 2.55 ms maximum across 20 runs. A deterministic preview
containing 20 placements of one synthetic 800 x 1200 WebP had a 0.2334-second
median and 0.2383-second maximum across five warmed runs, producing a 40,034-byte
WebP. These are repeatable development observations, not Raspberry Pi claims;
real photographs compress and decode differently.

Before a device release, repeat the following on the target Raspberry Pi 5:

1. Import representative JPEG, PNG, and WebP photographs near 1, 12, and 24
   megapixels while recording wall time, peak resident memory, derivative sizes,
   and device temperature.
2. Confirm no source over 25 MiB or 24 megapixels is accepted and that a
   cancelled transfer leaves no temporary attempt.
3. Request health, Wardrobe pages, and Clothing Details while the single cutout
   worker is active; record p50/p95 latency and confirm imports remain bounded to
   one core processing operation at a time.
4. Restart during both `pending` and `processing`, verify startup reconciliation,
   and confirm the exact original remains retrievable.
5. Exercise at least 60 garments in carousel and grid views, checking that the
   UI requests thumbnails rather than every original and that Chromium remains
   responsive at 1280 x 800.
6. Save and update outfits with 1, 5, and 20 garments while recording preview
   generation wall time, peak resident memory, temperature, and API latency.
7. Verify owner-only data permissions, available disk space, systemd shutdown,
   and database/media consistency after a hard power-cycle test.

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
