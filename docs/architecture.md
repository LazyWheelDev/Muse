# Architecture

## Runtime topology

Muse is an offline-first, single-device application for a Raspberry Pi 5 with an
attached `1280 × 800` touchscreen. The MVP has no cloud service or paid runtime
API dependency.

```text
Chromium kiosk
  └─ same-origin HTTP
      └─ FastAPI (one Uvicorn worker)
          ├─ /api/v1/*  -> application services -> SQLAlchemy -> SQLite
          ├─ bounded image worker -> local Pillow processing
          ├─ /assets/*  -> compiled frontend assets
          └─ /*         -> frontend index.html SPA fallback

Local data root
  ├─ muse.sqlite3
  ├─ media/garments/{original,processed,thumbnails,cutouts}/
  ├─ media/outfits/previews/
  ├─ tmp/uploads/<import-attempt>/
  ├─ tmp/previews/<preview-attempt>/
  └─ backups/
```

In development, Vite serves the React application on `127.0.0.1:5173` and
proxies `/api` to FastAPI on `127.0.0.1:8000`. Browser code still uses relative
`/api/v1` URLs. In production, FastAPI serves the compiled frontend and API from
one origin, so Chromium does not need Node.js or cross-origin configuration.

## Frontend

The frontend is React, TypeScript, and Vite. Its responsibilities are:

- render the touch-first wardrobe experience;
- keep UI state and interactions accessible at kiosk dimensions;
- call the versioned local API through the typed API client; and
- show an explicit diagnostic state if the backend is unavailable.

TanStack Query owns server-state caching, cancellation, and mutation
invalidation. Wardrobe selection and view context remain in validated URL
parameters so Details and browser navigation can restore the exact context.
Multipart upload progress uses the browser's local `XMLHttpRequest` progress
events; normal JSON requests continue through the centralized fetch client.

The Outfit Builder uses one reducer-backed editor session above the route tree.
The draft contains the outfit mode and identifier, name, placements, active
garment, origin return path, and last saved baseline. It is distinct from
TanStack Query's server cache and is encoded into a versioned, validated,
512 KiB-bounded `sessionStorage` record for reload recovery. Corrupt or
unsupported records are discarded safely. Temporary Wardrobe selection may
reuse the draft without saving it to the API. A validated local
`preserveDraft=1` Wardrobe round-trip marker distinguishes that explicit editor
handoff from an ordinary Home-to-Wardrobe-to-Builder flow, which starts a new
outfit when the retained editor state is clean.

The browser workspace renders through a local Canvas 2D surface with a logical
`640 × 800` coordinate system. Pointer movement is accumulated with
`requestAnimationFrame`; it does not issue API requests. Semantic command
controls and an ordered garment list remain available as keyboard and assistive
technology alternatives. Saved Outfits uses the approved three-column card
grid at `1280 × 800`, with two- and one-column fallbacks only on narrower
development viewports.

Required fonts and interface assets are part of the Vite bundle. Approved PNG
mockups are design references, not runtime assets. The frontend cannot assume
Internet access or a hard-coded production host.

## Backend

The backend uses Python 3.13, FastAPI, Pydantic, SQLAlchemy 2, Alembic, and the
standard-library SQLite driver. Its packages separate:

- application creation and process lifecycle;
- versioned API routes and dependency injection;
- request and response schemas;
- application services and domain rules;
- repositories and SQLAlchemy models;
- migrations and database connection policy;
- validated environment configuration;
- local storage path and atomic-file operations;
- streaming multipart ingestion, bounded image processing, and crash
  reconciliation; and
- structured error handling and request identifiers.

The application is created through a factory so tests can supply isolated
settings and temporary paths. Normal startup creates required directories but
does not silently create or migrate database tables. Operators run Alembic
before starting the production service.

### HTTP contract

Application endpoints live below `/api/v1`. Health and readiness are distinct:

- `GET /api/v1/health` reports that the FastAPI process is alive.
- `GET /api/v1/readiness` checks dependencies such as the database schema,
  writable local storage, and the configured frontend build when static serving
  is enabled.

Failures use a stable structured JSON envelope and include a request identifier.
Validation, trusted-host, CORS-preflight, body-limit, database, storage, and
unexpected failures follow that contract. JSON metadata requests are capped at
a configurable 64 KiB. The garment import route has an independent streaming
limit of approximately 25 MiB plus bounded multipart overhead; it is never
buffered by the general request-body middleware.
Unknown `/api/*` routes always remain API 404 responses; the SPA fallback never
hides them. Interactive OpenAPI documentation is available locally at
`/api/docs`, with the schema at `/api/openapi.json`.

`POST /api/v1/clothing-items/import` accepts one bounded JSON metadata part and
one JPEG, PNG, or WebP image part. The service acknowledges the import only
after the exact original, a normalized display derivative, a thumbnail, and the
corresponding database rows are durable. Optional background cleanup continues
through the bounded local worker and is observable through clothing responses.

The saved-outfit contract is:

- `POST /api/v1/outfits` creates an outfit, its ordered placements, and its
  generated preview;
- `GET /api/v1/outfits` returns active summaries newest-updated first;
- `GET /api/v1/outfits/{id}` hydrates the complete editor state, including
  active or deleted garment-reference status;
- `PATCH /api/v1/outfits/{id}` updates the name and, when supplied, replaces the
  placements transactionally; and
- `DELETE /api/v1/outfits/{id}` soft-deletes the outfit without deleting any
  garment or registered preview bytes.

## Persistence model

SQLite stores metadata and relative file references. Image bytes and generated
previews live under the configured local media root.

The schema contains:

- clothing items, including a garment category and a separate default body
  zone;
- logical clothing-image groups and metadata for original, normalized,
  thumbnail, and optional cutout variants;
- saved outfits;
- ordered outfit items with placement and layer data; and
- typed application settings for later preference work.

Garment category describes what an item is. Body zone describes where it is
placed in the Outfit Builder. They are deliberately separate concepts. More
than one garment may occupy the same body zone.

Every imported garment stores a persistent processing state: `pending`,
`processing`, `completed`, `completed_with_fallback`, or `failed`. Image groups
prevent derivatives of one source photograph from appearing as separate
carousel slides. A list response exposes one thumbnail and one preferred display
image; detail responses retain the grouped variants. Display preference is
cutout, then normalized, then exact original. Legacy or metadata-only garments
that never requested image processing use the explicit `not_requested` state.

Outfit item coordinates are normalized for display-size independence. `x` and
`y` describe the garment center, use the canvas top-left as origin, and each
remain in the inclusive range `[0, 1]`. Each placement stores one proportional
scale value, rotation, and an explicit layer. Rendering sorts by layer
deterministically from lowest/back to highest/front, with clothing identifier as
the stable tie-breaker. Positive stored rotation is clockwise around the garment
center.

Both the browser editor and local Pillow renderer interpret placements against
the same logical `640 × 800` workspace. A garment's unrotated width is
`640 × body-zone base width × scale`; height preserves the chosen image's
aspect ratio. The base-width fractions are `0.28` head, `0.34` neck, `0.50`
upper body, `0.56` full body, `0.42` lower body, `0.40` feet, and `0.30`
accessory. Coordinates, proportional scale, rotation, and unique layer are
validated at the API and recovered-session boundaries. Several different
garments may overlap in the same body zone; adding the same garment again
activates its existing placement instead of duplicating it.

### Deletion policy

Clothing and outfits use soft deletion. Normal collection and detail queries do
not return deleted records. A clothing item already referenced by a saved outfit
may be soft-deleted without invalidating that outfit; outfit reads retain a
deleted-reference state and its primary-image metadata. New outfits cannot
introduce deleted clothing. Files are never permanently removed as an implicit
side effect of soft deletion.

Permanent deletion and orphan cleanup require a later, explicit retention policy
and must first account for all outfit references.

## SQLite policy

Muse runs one Uvicorn worker and uses short SQLAlchemy sessions and explicit
transactions. Every connection enables foreign-key enforcement, a bounded busy
timeout, WAL journaling, and `synchronous=FULL`. The stronger default prioritizes
acknowledged-write durability on appliance storage; its latency must still be
measured on the target SD card or NVMe device. WAL keeps normal reads responsive
during writes.

Alembic is the only production schema migration mechanism. Direct
`metadata.create_all()` startup behavior is intentionally avoided. Migrations
are written explicitly for SQLite, are forward- and reverse-testable, and CI
checks that model metadata matches the committed migration head. SQLite DDL is
not treated as a cross-file transaction with media, so operators must stop the
service and use the future backup procedure before production upgrades. The
reserved backup directory is not yet an automated pre-migration backup system;
that recovery workflow belongs in the kiosk deployment milestone.

## Local storage policy

All writable paths resolve beneath one configurable data root. The storage
layer rejects traversal and absolute-path input, uses generated collision-safe
filenames, restricts public media to approved image directories and types, and
exposes locked, fsynced atomic move operations for import processing.
Database rows store portable POSIX-style relative paths, never deployment-specific
absolute paths.

Database, temporary, backup, public-media, and frontend-build paths are checked
for unsafe overlap. Runtime directories use owner-only permissions, and
promoted media files use owner read/write permissions. Persistent filenames are
backend-generated UUIDs; callers do not select final paths.
Readiness write probes are deduplicated and cached for five minutes to avoid
unnecessary SD-card metadata churn.

An import writes only inside a backend-owned attempt directory and records a
small durable manifest before promoting files. Core files are promoted with
`fsync` before a short database transaction registers the garment. A failed
transaction compensates only the generated paths named by that manifest.
Startup reconciliation removes stale temporary attempts, preserves media for
committed rows, compensates interrupted uncommitted promotions, and resets stale
processing claims. It never broadly purges originals or soft-deleted media.

Outfit preview generation follows the same filesystem/database ownership model.
Creating an outfit or changing its placements renders a `600 × 750` lossless
WebP in a private preview-attempt directory, records a recovery manifest, and
atomically promotes a unique immutable filename before the short database
transaction records it. Rendering is local and bounded. It tries cutout,
normalized, then original garment media; an unavailable or invalid garment
becomes a neutral placeholder rather than failing the whole preview. A failed
render, promotion, or database update preserves the previous outfit row and
preview. Name-only and unchanged-placement updates reuse the current preview.

After a successful placement replacement, the coordinator removes the
superseded unregistered file. If cleanup fails, startup reconciliation retries
it from the manifest. Reconciliation treats active and soft-deleted outfit rows
as preview owners, preserves every registered preview, removes only known
unregistered generated files, and reports missing registered files. Soft-deleting
an outfit deliberately retains its preview until an explicit permanent-retention
policy exists.

SQLite is the durable queue for optional processing. One application-owned
worker claims pending rows, performs CPU work outside database transactions,
and commits a cutout or a truthful fallback state. Concurrency and queued wake
signals are bounded; Redis and external task services are unnecessary.

Production and test configuration reject data roots inside the source tree.
Tests create isolated temporary roots. A development default under
`local-data/` is gitignored for convenience, but production should use a durable
location such as `/var/lib/muse` on the Raspberry Pi.

## Production frontend serving

With static serving enabled, FastAPI serves the existing Vite `dist` directory.
Versioned asset filenames may be cached immutably, while `index.html` is served
without a long-lived cache. Safe `GET` and `HEAD` requests for non-API,
extensionless routes fall back to `index.html`, which supports direct navigation
to React Router routes.

If the build is absent, backend health remains available and readiness explains
the missing dependency. Readiness checks the build live, so a removed or restored
deployment is reflected without stale process state. The server does not
fabricate an empty frontend build or swallow API errors.

## Raspberry Pi operating model

The target is Raspberry Pi OS 64-bit on ARM64 with Python 3.13. Production needs
only the locked Python environment, the compiled frontend, SQLite data, Pillow,
the pure-Python multipart parser, and Chromium in kiosk mode. Pillow publishes
CPython 3.13 Linux ARM64 wheels with the required common image codecs. The Pi
does not need Node.js, Redis, PostgreSQL, a task queue, a downloaded ML model, or
a network connection for core wardrobe use.

The service binds to loopback by default and is intended to run as one systemd
service. A single worker avoids duplicate in-process work and SQLite write
contention. Images are kept out of SQLite to limit database growth and memory
pressure. Outfit collection queries aggregate placement counts in SQLite and
reserve full garment/image hydration for detail reads.

On an Apple M4 development machine, a warmed 20-placement synthetic preview
render measured a `0.2334 s` median and `0.2383 s` maximum across five runs and
produced a 40,034-byte WebP. This is regression evidence only, not Raspberry Pi
validation. Target-device render latency, Chromium interaction smoothness,
memory, temperature, throttling, storage behavior, and power-loss recovery
remain acceptance work in `docs/raspberry-pi-validation.md`.

## Deferred capabilities

The current vertical slice does not implement QR phone import, ML-backed
background removal, automatic metadata detection, exact duplicate-outfit
detection, search, arbitrary filters, favorites, cloud synchronization,
recommendations, or multi-user accounts. Phone QR import remains an intended
later MVP milestone; a fullscreen or long-press Saved Outfit preview is an
optional convenience. The other discovery and automation features remain
optional or post-MVP. Later features must preserve the local API, migration,
storage, and offline guarantees described here.
