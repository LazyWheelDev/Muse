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
          ├─ /assets/*  -> compiled frontend assets
          └─ /*         -> frontend index.html SPA fallback

Local data root
  ├─ muse.sqlite3
  ├─ media/
  ├─ tmp/uploads/
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
- local storage path and atomic-file operations; and
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
unexpected failures follow that contract. Metadata requests are capped at a
configurable 64 KiB; the separate 25 MiB upload limit is reserved for the next
streaming image-import endpoint.
Unknown `/api/*` routes always remain API 404 responses; the SPA fallback never
hides them. Interactive OpenAPI documentation is available locally at
`/api/docs`, with the schema at `/api/openapi.json`.

## Persistence model

SQLite stores metadata and relative file references. Image bytes and generated
previews live under the configured local media root.

The initial schema contains:

- clothing items, including a garment category and a separate default body
  zone;
- clothing image metadata for original, processed, and thumbnail files;
- saved outfits;
- ordered outfit items with placement and layer data; and
- typed application settings for later preference work.

Garment category describes what an item is. Body zone describes where it is
placed in the Outfit Builder. They are deliberately separate concepts. More
than one garment may occupy the same body zone.

Outfit item coordinates are normalized for display-size independence. `x` and
`y` describe the garment center, use the canvas top-left as origin, and each
remain in the inclusive range `[0, 1]`. Each placement stores one proportional
scale value, rotation, and an explicit layer. Rendering sorts by layer
deterministically.

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
timeout, WAL journaling, and `synchronous=NORMAL`. This keeps the stack small
while allowing responsive kiosk reads during normal writes.

Alembic is the only production schema migration mechanism. Direct
`metadata.create_all()` startup behavior is intentionally avoided. Migrations
use transactional SQLite DDL, are forward- and reverse-testable, and CI checks
that model metadata matches the committed migration head. The reserved backup
directory is not yet an automated pre-migration backup system; that recovery
workflow belongs in the kiosk deployment milestone.

## Local storage policy

All writable paths resolve beneath one configurable data root. The storage
layer rejects traversal and absolute-path input, uses generated collision-safe
filenames, restricts public media to approved image directories and types, and
exposes locked, fsynced atomic move operations for future import processing.
Database rows store portable POSIX-style relative paths, never deployment-specific
absolute paths.

Database, temporary, backup, public-media, and frontend-build paths are checked
for unsafe overlap. Runtime directories use owner-only permissions, and
promoted media files use owner read/write permissions. Persistent filenames are
backend-generated UUIDs; callers do not select final paths.
Readiness write probes are deduplicated and cached for five minutes to avoid
unnecessary SD-card metadata churn.

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
only the locked Python environment, the compiled frontend, SQLite data, and
Chromium in kiosk mode. It does not need Node.js, Redis, PostgreSQL, a task queue,
or a network connection for core wardrobe use.

The service binds to loopback by default and is intended to run as one systemd
service. A single worker avoids duplicate in-process work and SQLite write
contention. Images are kept out of SQLite to limit database growth and memory
pressure. Outfit collection queries aggregate placement counts in SQLite and
reserve full garment/image hydration for detail reads.

## Deferred capabilities

The current foundation does not implement image upload or processing, QR phone
import, automatic metadata detection, duplicate-outfit detection, search,
filters, favorites, cloud synchronization, recommendations, or multi-user
accounts. Later features must preserve the local API, migration, storage, and
offline guarantees described here.
