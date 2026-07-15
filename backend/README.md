# Muse backend

The Muse backend is a local FastAPI service for clothing metadata, saved outfits,
SQLite persistence, safe filesystem access, and short-lived phone-upload
sessions. Production uses one loopback-only main process plus one deliberately
restricted local-network process; neither has a mandatory cloud dependency.

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
  phone_upload/  Restricted LAN application, security, and static assets
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

| Variable                                      | Development default         | Purpose                                                  |
| --------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `MUSE_ENVIRONMENT`                            | `development`               | `development`, `testing`, or `production` safety policy  |
| `MUSE_DATA_ROOT`                              | `../local-data`             | Parent of every writable runtime path                    |
| `MUSE_DATABASE_PATH`                          | `muse.sqlite3`              | SQLite file, relative to data root                       |
| `MUSE_MEDIA_ROOT`                             | `media`                     | Parent for persistent local media                        |
| `MUSE_TEMP_UPLOAD_ROOT`                       | `tmp/uploads`               | Private streaming/import-attempt staging                 |
| `MUSE_TEMP_PREVIEW_ROOT`                      | `tmp/previews`              | Private crash-recovery staging for outfit previews       |
| `MUSE_ORIGINAL_IMAGE_ROOT`                    | `media/garments/original`   | Exact, immutable upload bytes                            |
| `MUSE_PROCESSED_IMAGE_ROOT`                   | `media/garments/processed`  | Browser-safe normalized WebP files                       |
| `MUSE_THUMBNAIL_ROOT`                         | `media/garments/thumbnails` | Wardrobe grid thumbnails                                 |
| `MUSE_CUTOUT_IMAGE_ROOT`                      | `media/garments/cutouts`    | Optional best-effort cutouts                             |
| `MUSE_OUTFIT_PREVIEW_ROOT`                    | `media/outfits/previews`    | Immutable generated outfit preview WebP files            |
| `MUSE_BACKUP_ROOT`                            | `backups`                   | Reserved local backup location                           |
| `MUSE_LOCK_ROOT`                              | `.locks`                    | Cross-process import-admission locks                     |
| `MUSE_MAX_UPLOAD_SIZE_BYTES`                  | `26214400`                  | Maximum source image bytes (25 MiB)                      |
| `MUSE_MAX_IMPORT_OVERHEAD_BYTES`              | `65536`                     | Multipart metadata and framing allowance                 |
| `MUSE_UPLOAD_CHUNK_SIZE_BYTES`                | `262144`                    | Maximum parser work chunk                                |
| `MUSE_MAX_IMAGE_PIXELS`                       | `24000000`                  | Maximum decoded source pixel count                       |
| `MUSE_MAX_IMAGE_DIMENSION`                    | `12000`                     | Maximum source width or height                           |
| `MUSE_NORMALIZED_IMAGE_MAX_DIMENSION`         | `1600`                      | Maximum normalized WebP side                             |
| `MUSE_THUMBNAIL_MAX_DIMENSION`                | `384`                       | Maximum thumbnail side                                   |
| `MUSE_NORMALIZED_WEBP_QUALITY`                | `85`                        | Normalized lossy WebP quality                            |
| `MUSE_THUMBNAIL_WEBP_QUALITY`                 | `80`                        | Thumbnail lossy WebP quality                             |
| `MUSE_BACKGROUND_PROCESSING_ENABLED`          | `true`                      | Run the bounded optional cutout worker                   |
| `MUSE_BACKGROUND_PROCESSING_MAX_ATTEMPTS`     | `2`                         | Retry ceiling for transient processor failures           |
| `MUSE_BACKGROUND_WORKER_POLL_SECONDS`         | `0.5`                       | Durable queue poll interval                              |
| `MUSE_BACKGROUND_SHUTDOWN_TIMEOUT_SECONDS`    | `10.0`                      | Graceful worker join deadline                            |
| `MUSE_MAX_API_BODY_SIZE_BYTES`                | `65536`                     | Non-import metadata body limit                           |
| `MUSE_LOG_LEVEL`                              | `INFO`                      | Python log level                                         |
| `MUSE_FRONTEND_BUILD_PATH`                    | `../frontend/dist`          | Existing Vite production build                           |
| `MUSE_SERVE_FRONTEND`                         | `false`                     | Enable same-origin SPA serving                           |
| `MUSE_TRUSTED_HOSTS`                          | local hosts                 | JSON list accepted by trusted-host middleware            |
| `MUSE_ALLOWED_ORIGINS`                        | Vite local origins          | JSON list for deliberate development CORS access         |
| `MUSE_PHONE_UPLOAD_ENABLED`                   | `false`                     | Permit session creation and the restricted listener      |
| `MUSE_PHONE_UPLOAD_BIND_HOST`                 | `127.0.0.1`                 | Exact IPv4 interface for the restricted listener         |
| `MUSE_PHONE_UPLOAD_PORT`                      | `8787`                      | Restricted listener port                                 |
| `MUSE_PHONE_UPLOAD_ADVERTISED_HOST`           | unset                       | Optional phone-resolvable hostname such as `muse.local`  |
| `MUSE_PHONE_UPLOAD_ADVERTISED_IPV4`           | unset                       | Optional direct fallback equal to the exact bind address |
| `MUSE_PHONE_UPLOAD_TRUSTED_HOSTS`             | local hosts                 | Exact accepted phone-listener Host values                |
| `MUSE_PHONE_UPLOAD_FRONTEND_BUILD_PATH`       | `../frontend/dist-phone`    | Dedicated mobile Vite production build                   |
| `MUSE_PHONE_UPLOAD_SESSION_TTL_SECONDS`       | `600`                       | One-time token lifetime                                  |
| `MUSE_PHONE_UPLOAD_MAX_ATTEMPTS`              | `3`                         | Failed claim ceiling before a session is unusable        |
| `MUSE_PHONE_UPLOAD_RECEIVE_TIMEOUT_SECONDS`   | `120`                       | Maximum request-body receive time                        |
| `MUSE_PHONE_UPLOAD_CLEANUP_INTERVAL_SECONDS`  | `300`                       | Minimum bounded periodic cleanup interval                |
| `MUSE_PHONE_UPLOAD_RETENTION_SECONDS`         | `86400`                     | Terminal session retention before deletion               |
| `MUSE_PHONE_UPLOAD_CLEANUP_BATCH_SIZE`        | `100`                       | Maximum rows or stale attempts per aggregate pass        |
| `MUSE_PHONE_UPLOAD_RATE_LIMIT_REQUESTS`       | `60`                        | Per-window in-memory request allowance                   |
| `MUSE_PHONE_UPLOAD_RATE_LIMIT_WINDOW_SECONDS` | `60`                        | Abuse-control window                                     |
| `MUSE_PHONE_UPLOAD_RATE_LIMIT_CLIENTS`        | `256`                       | Bounded in-memory client bucket count                    |

Production and test environments reject a data root inside the repository.
Configure an external production location such as `/var/lib/muse`. Startup
creates configured directories with owner-only permissions; it does not migrate
the database. Private runtime paths, public media, and the frontend build may not
overlap. When phone upload is enabled, the bind address and every advertised
host or address must appear exactly in `MUSE_PHONE_UPLOAD_TRUSTED_HOSTS`; wildcard
phone hosts are rejected. An IPv4 literal in either advertised field must equal
the exact bind address.
A loopback listener is valid for CI and same-machine development but cannot
advertise any LAN hostname or address.

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
.venv/bin/muse-backend serve-phone-upload
```

Probe the main process at `/api/v1/health` and `/api/v1/readiness`. Probe the
configured LAN origin at `/listener-status`; it returns only `{"status":"ok"}`
and no database, storage, migration, or core API details. Readiness rechecks the
bounded Vite manifest and all of its allow-listed assets, not only process
liveness.

Use the environment executable directly in production (including in systemd)
so service startup never attempts to resolve or install development packages.

Each CLI server command intentionally starts one Uvicorn worker. Keep the main
`serve` command on `127.0.0.1`; never bind its complete API to the LAN. Only
`serve-phone-upload` may bind the configured private interface, and it starts a
different application factory that has no core API router, media browser,
OpenAPI, interactive docs, or SPA fallback.

Run one aggregate bounded phone-session and interrupted-attempt cleanup pass
when diagnosing retention or from a future scheduled service:

```bash
.venv/bin/muse-backend cleanup-phone-upload-sessions
```

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

| Method and path                                      | Purpose                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/v1/health`                                 | Process liveness and backend version                         |
| `GET /api/v1/readiness`                              | Database, migrations, storage, and optional frontend checks  |
| `POST /api/v1/clothing-items`                        | Create clothing metadata without uploading an image          |
| `POST /api/v1/clothing-items/import`                 | Stream, validate, persist, and enqueue one local photograph  |
| `GET /api/v1/clothing-items`                         | Page active items; optionally select `garment_category`      |
| `GET /api/v1/clothing-items/{id}`                    | Read one active item and its image metadata                  |
| `PATCH /api/v1/clothing-items/{id}`                  | Update validated clothing metadata                           |
| `DELETE /api/v1/clothing-items/{id}`                 | Soft-delete clothing metadata                                |
| `POST /api/v1/phone-upload-sessions`                 | Create a short-lived phone-upload handoff                    |
| `GET /api/v1/phone-upload-sessions/{id}`             | Read safe device-facing session state                        |
| `DELETE /api/v1/phone-upload-sessions/{id}`          | Cancel and invalidate an uncommitted session                 |
| `POST /api/v1/phone-upload-sessions/{id}/regenerate` | Invalidate and replace a session                             |
| `POST /api/v1/outfits`                               | Create placements and a local preview transactionally        |
| `GET /api/v1/outfits`                                | Page through active outfits                                  |
| `GET /api/v1/outfits/{id}`                           | Read a complete outfit and garment reference states          |
| `PATCH /api/v1/outfits/{id}`                         | Replace/update an outfit and changed preview transactionally |
| `DELETE /api/v1/outfits/{id}`                        | Soft-delete an outfit                                        |
| `GET /api/v1/media/{relative_path}`                  | Read a validated local media path                            |

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

## Phone-upload security boundary

Phone upload is intentionally split across two application processes. The main
loopback API creates, monitors, cancels, and regenerates sessions. The LAN
application serves only the safe `/listener-status` response, `/u/`,
allow-listed files under `/phone-assets/`, `GET /phone-api/v1/session`, and
`POST /phone-api/v1/upload`. It has strict Host and same-origin checks, bounded
bodies and receive time, security headers, in-memory abuse control, and no
wildcard CORS. The session token remains the authorization secret; being on the
LAN or passing CORS is not authentication.

The loopback session API verifies real listener reachability before creating or
regenerating a token. It connects directly to the configured bind IPv4 and
port, requests only `/listener-status`, follows no redirect or DNS result, uses
a 500 ms timeout, and accepts only the exact minimal JSON success response. A
failed probe returns a safe retryable `503` without creating a session. Device
status reads include the result of the same bounded probe; it is a process/build
readiness signal, not a broad network diagnostic and never carries a token. The
minimal status route revalidates the compiled index, bounded manifest, and
every allow-listed asset so a build removed after startup fails closed.

A new session receives 256 bits of random token entropy. SQLite stores only the
SHA-256 digest. The initial device response is the only ordinary response that
contains the QR URL; subsequent status responses never return the raw token.
The URL places it after `#token=`, and mobile JavaScript removes that fragment
from visible history before sending the value in `X-Muse-Upload-Token`. Server
access logging is disabled for the LAN listener, and code must never log raw
tokens, full QR URLs, image bytes, personal notes, or filesystem paths.

The persistent lifecycle is `pending`, `opened`, `uploading`, `processing`, then
`completed`, `failed`, `cancelled`, or `expired`. A transactional claim prevents
two phones from uploading concurrently. A stable internal idempotency key wraps
the existing import workflow so a retry or restart can discover an already
committed garment instead of creating another. Completion, cancellation,
expiry, and regeneration revoke the token. A failed attempt is retryable only
when the safe response says so and the attempt and expiry ceilings remain.

Local import, phone import, optional cutout processing, and every temporary-file
reconciliation pass acquire the same cross-process gate. Session recovery first
looks for an idempotently committed garment across stale failed, cancelled,
expired, uploading, or processing states and publishes `completed` when one
exists; otherwise it resets an interrupted claim to its safe failure or expiry
state. Startup drains session work through repeated transactions, each capped
by the configured batch size, and each listener removes one bounded stale-file
batch. By default the main process checks cleanup every 300 seconds. One
periodic or CLI pass shares one 100-record budget across committed recovery,
expiry, interrupted-claim recovery, deletion of `completed`, `cancelled`, or
`expired` rows unchanged for 24 hours, and abandoned attempt directories. A
failed row must expire before retention deletion. Cleanup cannot race the
cutout worker and never removes a committed garment or registered image. The
CLI reports all processed rows and stale attempts, not only deletions.

The mobile build supports JPEG, PNG, and WebP. HEIC and HEIF remain explicitly
unsupported: Muse returns an actionable format error and never renames those
bytes as JPEG. Adding a decoder requires a separately reviewed Python 3.13/Linux
AArch64/offline dependency and physical Pi resource validation.

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

Phone upload additionally requires the separate `frontend/dist-phone` build.
The restricted listener serves only its manifest-allow-listed entry and hashed
assets, with no directory listing or arbitrary filesystem access. Once `dist`
and `dist-phone` are built in CI or on a development machine, both production
processes are Python-only and continue to work without Node or Internet access.
