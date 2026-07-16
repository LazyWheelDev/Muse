# Architecture

## Runtime topology

Muse is an offline-first, single-device application for a Raspberry Pi 5 with an
attached `1280 × 800` touchscreen. The MVP has no cloud service or paid runtime
API dependency.

```text
Chromium kiosk
  └─ same-origin HTTP
      └─ Main FastAPI listener (one Uvicorn worker, loopback only)
          ├─ /api/v1/*  -> application services -> SQLAlchemy -> SQLite
          ├─ bounded image worker -> local Pillow processing
          ├─ /assets/*  -> compiled frontend assets
          └─ /*         -> frontend index.html SPA fallback

Phone on the trusted local network
  └─ short-lived upload-session secret
      └─ Restricted FastAPI listener (one Uvicorn worker, one LAN interface)
          ├─ mobile upload page and its dedicated compiled assets
          ├─ token-authorized session status
          └─ one token-authorized streamed garment import

Local data root
  ├─ muse.sqlite3
  ├─ media/garments/{original,processed,thumbnails,cutouts}/
  ├─ media/outfits/previews/
  ├─ tmp/uploads/<import-attempt>/
  ├─ tmp/previews/<preview-attempt>/
  ├─ maintenance/
  ├─ .locks/
  └─ backups/
```

In development, Vite serves the React application on `127.0.0.1:5173` and
proxies `/api` to FastAPI on `127.0.0.1:8000`. Browser code still uses relative
`/api/v1` URLs. In production, FastAPI serves the compiled frontend and API from
one origin, so Chromium does not need Node.js or cross-origin configuration.

Phone import deliberately does not bind this complete application to the LAN.
Production keeps the main process on `127.0.0.1`; a second application factory
binds a separate process to one configured private IPv4 address and port. That
restricted application does not include clothing, outfit, Settings, media,
main readiness, OpenAPI, or privileged-device routes. It serves only the
dedicated mobile build, the minimal `/listener-status` response, safe
upload-session status, and one streamed import endpoint.

The main application creates, monitors, cancels, and regenerates phone-upload
sessions through its loopback API. The initial response contains the one-time
secret needed to construct the QR payload. Later device-status responses never
return that secret. The mobile URL carries the secret in its URL fragment, so
the browser does not send it in the HTTP request target, Host header, or
Referrer. Mobile JavaScript validates it, removes it from visible history state,
and retains it only in origin-scoped `sessionStorage` so a page refresh can
recover. Terminal states clear the token. The restricted server disables access
logging and never writes raw secrets or full QR URLs to application logs.

Listener bind, advertised address, and retention values remain operator
environment configuration for this milestone. P4.4 does not add privileged
network controls, listener diagnostics, or QR-session creation to Settings; the
consumer entry is Add Garment.

P6 adds Settings only to the main loopback application. The restricted LAN
factory still mounts no Settings, backup, data-maintenance, device-information,
or power route. W & N may inspect the restricted listener through the existing
bounded server-to-server probe; it never expands the listener surface.

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

The Add Garment route first offers **Upload on this device** and **Upload from
phone**. The original local form remains available behind the first choice. The
phone view owns only the current device-facing session, polls at a bounded
interval while it is non-terminal, and stops polling on completion,
cancellation, expiry, or failure. Completion invalidates Wardrobe queries and
navigates to the imported garment without a manual refresh.

The phone experience is a separate small Vite entry emitted to `dist-phone`.
It is responsive at a `390 × 844` reference viewport, uses only locally bundled
fonts, icons, and scripts, and talks only to its listener origin. Browser upload
progress is local UI state; durable session state remains in SQLite. Neither
frontend embeds a production hostname. Building both `dist` and `dist-phone`
requires Node during development or CI, but serving them on the Pi does not.

The device build renders QR codes with `qrcode.react@4.2.0` (ISC, no runtime
dependencies). `jsqr@1.4.0` (Apache-2.0) and `pngjs@7.0.0` (MIT) are development
dependencies used only to decode the generated QR in the production E2E test;
they do not ship in either browser bundle or on the Pi. No Python QR or HEIF
decoder was added.

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

### Startup and application preferences

The frontend owns a single startup/readiness layer above the normal route tree.
It plays the branded Splash once on a cold browser session, holds its final
composition while `GET /api/v1/readiness` is not ready, and presents a bounded
recovery state after persistent failure. Internal navigation never replays the
full sequence. Reduced Motion replaces the physical letter and droplet movement
with the final wordmark and restrained fades.

TanStack Query remains the server-state owner for Settings. The backend stores a
closed set of explicit application preferences in `application_settings`:
device name, safe interface-dimming percentage, screen timeout, Reduced Motion,
and Splash mode. The API never accepts an arbitrary key or filesystem path. The
browser may apply an immediate visual hint while loading, but SQLite remains the
authoritative persisted value.

Interface brightness is an application overlay, not physical backlight control.
Screen timeout displays an in-browser sleep layer and does not stop services.
Touch, pointer, or keyboard input wakes it without losing the current route or
editor state.

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

The loopback phone-session API creates and observes durable sessions without
exposing token hashes. Creation and regeneration are the only responses that
contain a newly generated raw secret as part of the device-facing upload URL;
regeneration invalidates the old session before returning a replacement.
Cancellation immediately prevents a new claim and never removes a garment that
has already committed.

The loopback routes are:

- `POST /api/v1/phone-upload-sessions`;
- `GET /api/v1/phone-upload-sessions/{session_id}`;
- `DELETE /api/v1/phone-upload-sessions/{session_id}`; and
- `POST /api/v1/phone-upload-sessions/{session_id}/regenerate`.

The LAN contract is intentionally separate: `/listener-status` returns only
safe listener readiness, `/u/` serves the mobile entry, `/phone-assets/*`
serves only its compiled files,
`GET /phone-api/v1/session` validates and reports the token-owned session, and
`POST /phone-api/v1/upload` accepts one garment import. The raw token is sent in
`X-Muse-Upload-Token`; no token is placed in an API path or query string.

Session creation and regeneration fail closed unless the main loopback process
can reach `/listener-status` on the exact configured bind IPv4 and port. This
server-to-server probe has a 500 ms timeout, follows neither DNS nor redirects,
sends no token, caps the response body, and accepts only the exact minimal JSON
contract. Status reads repeat the bounded probe and expose only `ready` or
`unavailable`; they do not reveal listener internals. The restricted process
also refuses to become ready unless its current database migration, bounded
Vite manifest, and every manifest-allow-listed mobile asset remain present.
This validation is repeated by `/listener-status`, so a build removed or
corrupted after startup fails closed before another session is issued.

The LAN listener uses the same multipart parser, image validator, import
coordinator, storage manifests, atomic promotion, database transaction, and
background-processing queue as local-device import. Authorization wraps this
pipeline; it does not create a second image-ingestion implementation. A
transactional compare-and-set claims an eligible session before the request body
is accepted. A stable internal idempotency key derived from the public session
identifier closes the crash window between committing the garment and marking
the session complete.

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

### Settings, platform information, and data maintenance

Settings endpoints live below `/api/v1/settings` on the main loopback listener.
They expose typed preferences, safe network status, storage summary, device
status, capability states, a safe staged-maintenance status, backup management,
bounded temporary cleanup, and staging of restore or delete-all operations.
Mutation routes accept JSON only
and apply an additional same-origin check. Responses expose neither raw paths,
environment variables, Wi-Fi credentials, command output, nor phone-upload
secrets.

The read-only platform adapter uses bounded standard-library reads for
operating-system, architecture, memory, uptime, disk, and optional thermal
information. Wi-Fi management and hardware brightness remain unavailable. P7
adds a separate device-control adapter for application restart, reboot, and
shutdown. It reports available only after a fixed root-owned helper and exact
sudo authorization pass validation; it never accepts caller-selected commands,
arguments, paths, or service names. Display sleep and interface dimming remain
application-level capabilities.

Muse backups use a versioned local ZIP contract. Creation starts from the
SQLite online-backup API, removes operational phone-upload sessions from the
snapshot, copies only media referenced by that snapshot, computes SHA-256
checksums, writes a closed manifest, validates the completed archive, and
atomically promotes it below `backup_root`. It excludes nested backups,
temporary uploads, caches, locks, logs, environment files, and runtime secrets.
Archive creation and validation are streamed and subject to configured entry,
expanded-size, archive-size, and compression-ratio limits.

Restore is deliberately two-phase. The loopback API validates an existing local
archive, creates a safety backup, extracts into a private maintenance staging
directory, and writes a durable pending marker. It returns
`staged_restart_required`; it never claims live data changed. The CLI command
`apply-staged-maintenance` acquires an exclusive runtime-services lease and
refuses activation while either server is running. With services stopped it
moves the staged database and media into place, verifies SQLite, and restores
the previous paths if activation fails. Delete-all uses the same offline lease,
preserves the application installation, recreates the migrated empty database
and directory structure, and removes local backups only after the explicit
backup-loss acknowledgement.

Both Uvicorn processes hold shared leases for their complete lifetimes. P7
systemd units coordinate stop, offline maintenance activation, migration,
reconciliation, and restart. The web process remains unprivileged; only the
fixed device helper crosses the root boundary.

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
- short-lived phone-upload sessions containing a token digest, lifecycle
  timestamps, bounded attempt count, safe error code, and optional committed
  garment reference; and
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

### Phone-upload session lifecycle

The durable lifecycle is `pending`, `opened`, `uploading`, `processing`, then
`completed`, with `failed`, `cancelled`, and `expired` alternatives. A `failed`
session is retryable only while its attempt count and expiry permit it;
`cancelled`, `expired`, and `completed` are terminal.
At least 256 bits of entropy are generated for every raw token. SQLite stores
only its lowercase SHA-256 digest. Tokens are single-use and remain invalid
after completion, cancellation, expiry, or regeneration. A failed token can be
claimed again only when its public status explicitly reports `retryable`.

Opening a valid mobile page may transition `pending` to `opened`. An atomic
SQLite compare-and-set claims one upload and increments its attempt count, so
two phones can view the same page but at most one request can enter `uploading`.
Once the stream has completed, the session becomes `processing` while the
existing secure importer validates and persists it. A committed garment is
associated before `completed` is published. Restart recovery checks the stable
import idempotency key before trusting a stale status: an already committed
import becomes `completed` even when a concurrent failure, cancellation, or
expiry was recorded. An interrupted, uncommitted attempt returns to an allowed
retry/failure state without creating another garment.

Expiry and retention are configurable. Session cleanup scans indexed candidates
in bounded batches. One periodic or operator pass shares a single batch budget
across committed-import recovery, overdue `pending`, `opened`, or retryable
`failed` expiry, interrupted-claim recovery, and deletion of only `completed`,
`cancelled`, or `expired` rows older than the retention cutoff. A failed row
must first expire. Startup reaches full consistency by repeating those bounded
recovery transactions until a pass is not full; it never uses one unbounded
transaction. The defaults are a 300-second coarse interval, 100-record batch,
and 24-hour terminal retention. Every committed garment and registered image is
retained. The import workflow, optional cutout worker, both listener startups,
and periodic/operator cleanup own abandoned-attempt handling under the same
cross-process gate. One aggregate periodic or operator budget is shared between
session rows and stale attempt directories. Both recovery paths are idempotent,
and periodic session work performs no row mutation when there is nothing to
change, limiting SD-card churn.

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

Each Muse listener runs one Uvicorn worker and uses short SQLAlchemy sessions
and explicit transactions. Every connection enables foreign-key enforcement, a
bounded busy timeout, WAL journaling, and `synchronous=FULL`. The stronger default prioritizes
acknowledged-write durability on appliance storage; its latency must still be
measured on the target SD card or NVMe device. WAL keeps normal reads responsive
during writes.

Alembic is the only production schema migration mechanism. Direct
`metadata.create_all()` startup behavior is intentionally avoided. Migrations
are written explicitly for SQLite, are forward- and reverse-testable, and CI
checks that model metadata matches the committed migration head. SQLite DDL is
not treated as a cross-file transaction with media, so P7 stops both listeners
and creates a verified Muse safety backup before changing the active release.
Code rollback is allowed only when the previous release reports the current
database revision compatible; the deployment system never downgrades SQLite
automatically.

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

Local-device and phone imports run in separate server processes but share one
owner-only cross-process import gate beneath the data root. The gate bounds
Pillow memory and CPU use and prevents startup reconciliation from deleting an
attempt owned by the other listener. It is released automatically when a
process exits, and its lock file is never deleted during normal cleanup.

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
only the locked Python environment, both compiled frontends, SQLite data, Pillow,
the pure-Python multipart parser, and Chromium in kiosk mode. Pillow publishes
CPython 3.13 Linux ARM64 wheels with the required common image codecs. The Pi
does not need Node.js, Redis, PostgreSQL, a task queue, a downloaded ML model, or
a network connection for core wardrobe use.

The main service binds to loopback and the upload service binds to one generated
private-LAN address. Each runs one Uvicorn worker. P7 installs coordinated
systemd preparation, main, phone, network-refresh, and templated kiosk units.
Migrations and startup reconciliation complete before listeners start, and
application lifecycle operations coordinate both listener processes. Images
are kept out of SQLite to limit database growth and memory pressure. Outfit
collection queries aggregate placement counts in SQLite and reserve full
garment/image hydration for detail reads.

An optional advertised hostname is configured separately. If it is itself an
IPv4 literal, it must equal the listener's exact private bind address, just as
the explicit advertised-IPv4 field must. That bound IPv4 is
therefore the deterministic readable fallback. `muse.local` is supported when
mDNS and Avahi are already available, but it is not required. The address
inspection utility excludes loopback, link-local, Docker, VPN, and virtual
interfaces; the production listener never substitutes a discovered address
that differs from its explicit bind. Loopback is limited to CI or same-machine
development and cannot advertise a LAN hostname or address. No public DNS,
tunnel, cloud relay, or Internet connection is involved.

On an Apple M4 development machine, a warmed 20-placement synthetic preview
render measured a `0.2334 s` median and `0.2383 s` maximum across five runs and
produced a 40,034-byte WebP. This is regression evidence only, not Raspberry Pi
validation. Target-device render latency, Chromium interaction smoothness,
memory, temperature, throttling, storage behavior, and power-loss recovery
remain acceptance work in `docs/raspberry-pi-validation.md`.

## Deferred capabilities

The current vertical slice does not implement ML-backed background removal,
automatic metadata detection, exact duplicate-outfit
detection, search, arbitrary filters, favorites, cloud synchronization,
recommendations, or multi-user accounts. A fullscreen or long-press Saved Outfit
preview is an optional convenience. The other discovery and automation features
remain optional or post-MVP. Later features must preserve the two-listener
boundary, local API, migration, storage, and offline guarantees described here.
