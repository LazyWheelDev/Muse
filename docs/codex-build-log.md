# Codex build log

## 2026-07-15 — P2.2–P3.1 local garment vertical slice

### Scope completed

- Added streamed local JPEG, PNG, and WebP garment import with validated
  metadata and idempotent retry support.
- Preserved exact original bytes and generated normalized and thumbnail WebP
  derivatives before acknowledging an import.
- Added logical image groups, content hashes, processing state, processing
  attempts, and persistent best-effort cutout work through an Alembic migration.
- Added a bounded one-job local background worker, restart recovery, import
  manifests, compensation, and orphan diagnostics.
- Replaced the Wardrobe placeholder with carousel, category, grid, fullscreen,
  Details, soft-delete, and Outfit Builder handoff behavior.
- Added the local Add Garment form with preview, validation, progress,
  cancellation during transfer, safe finalization, and retry behavior.
- Added the read-only/editable Clothing Details screen with image navigation,
  metadata persistence, unsaved-change protection, and delete confirmation.
- Kept all required fonts, icons, media, API calls, and processing local at
  runtime. QR import and a high-quality ML cutout processor remain deferred.

### Architectural decisions

- `python-multipart` parses bounded request chunks into an owner-only temporary
  attempt. The application never uses an in-memory whole-file form parser.
- Pillow validates signatures and decoded content, applies EXIF orientation and
  safe color conversion, and emits configurable `1600 px` display and `384 px`
  thumbnail derivatives by default.
- A durable manifest coordinates atomic filesystem promotion with the SQLite
  transaction. Startup reconciliation uses recorded database ownership before
  compensating files and preserves ambiguous data for inspection.
- Optional cleanup uses one persistent SQLite-backed worker. A single atomic
  claim reduces write contention; interrupted work is reset or terminalized at
  startup according to its attempt count.
- The shipped conservative Pillow processor accepts meaningful existing alpha
  or a high-confidence uniform connected border. Otherwise it records a
  truthful fallback without affecting import success.
- TanStack Query owns remote frontend state. Validated Wardrobe URL parameters
  own category, selected garment, and grid context; no second global client
  store was introduced.
- Media selection is cutout, normalized, then original for large views and
  thumbnail-first for grids. One source photograph's variants remain one
  carousel image group.

### Dependency assessment

- Added `pillow==12.3.0` and `python-multipart==0.0.32` to the locked Python
  environment. Both support Python 3.13 without a cloud service; Pillow has a
  Linux AArch64 wheel in its published distributions.
- Added `@tanstack/react-query@5.101.2` for cancellable queries, bounded polling,
  cache updates, and invalidation. Added `lucide-react@1.24.0` for locally
  bundled interface icons; bespoke garment symbols remain local SVG components.
- `rembg` and ONNX Runtime were assessed but not shipped. Model provisioning,
  Python 3.13/Linux AArch64 installation, peak memory, latency, temperature, and
  recovery must all pass the Raspberry Pi checklist before an ML adapter can
  replace the conservative processor.

### Verification results

- Backend: 162 pytest tests passed with 89.49% branch coverage; the configured
  threshold remains 85%.
- Backend static checks: Ruff format, Ruff lint, and strict mypy passed across 60
  Python source and test files.
- Frontend: 70 Vitest tests in 13 files passed; TypeScript, ESLint with zero
  warnings, and Prettier passed.
- Browser: the route-shell check and the real production vertical-flow check
  passed in Chromium at `1280 × 800`. The latter used a valid PNG multipart
  upload against FastAPI and covered import, Wardrobe, grid, Details edit,
  reload persistence, soft deletion, and the empty state.
- Migration: an empty database upgraded to `20260715_0002`, model consistency
  reported no pending operations, downgrade to `20260715_0001` succeeded, and
  re-upgrade to head passed SQLite integrity and foreign-key checks.
- Production frontend build: JavaScript was approximately `391.38 kB`
  (`120.90 kB` gzip) and CSS was `29.73 kB` (`5.62 kB` gzip).
- Browser network checks observed thumbnail and normalized/cutout requests,
  no original request on the healthy derivative path, no external origin, no
  page error, and no page-level horizontal overflow. Strengthened kiosk checks
  also keep Wardrobe, Details, and Add at document `scrollY = 0` and constrain
  long form/detail content to the intended internal panels.

### Development-machine measurements

Measurements used an Apple M4 Mac (`arm64`, Darwin 25.5.0), Python 3.13.14,
Node.js 24.18.0, local temporary storage, and one Uvicorn worker. They are not
Raspberry Pi results.

- Direct processing of a synthetic 4000 × 3000 JPEG to 1600 × 1200 and 384 ×
  288 derivatives took 0.142 seconds.
- A real HTTP import of that 12-megapixel, 214,400-byte JPEG returned `201` in
  0.194 seconds. Server RSS was 90,816 KiB before the request, peaked at 290,432
  KiB during core import and about 332,560 KiB during optional processing, then
  settled near 228,064 KiB after work completed.
- The normalized file was 5,032 bytes, the thumbnail 622 bytes, and the optional
  cutout 9,704 bytes. The original remained exactly 214,400 bytes.
- Seventeen health probes during the large import had a 12.97 ms maximum.
- With 60 persisted garments, 59 additional small WebP imports had a 23.60 ms
  median and 242.37 ms maximum acknowledgement. Repeated 100-item collection
  reads had a 4.95 ms median; while the worker was active, collection reads had
  a 5.75 ms median and health probes had a 0.65 ms median.
- All 60 optional jobs reached `completed` once. Ten later collection/detail
  reads did not increase the total attempt count. A clean service restart
  returned the same 60 garments and media records.
- An initial artificial burst exposed one safely retried SQLite busy claim. The
  claim was changed to one atomic `UPDATE … RETURNING`; a repeat 60-import burst
  reached terminal state in 12.55 seconds with no busy warning.

### Major Codex-assisted activities

- Audited the repository, product documents, approved mockups, existing API,
  storage boundaries, migrations, test suites, and CI workflow before changes.
- Researched pinned dependency compatibility, licensing, offline behavior, and
  Linux AArch64 packaging.
- Implemented and reviewed backend ingestion, processing, recovery, frontend
  screens, typed data access, accessibility behavior, documentation, and CI.
- Added injected-failure, migration, unit, integration, and real-browser tests;
  iterated on upload finalization, URL safety, SQLite contention, short writes,
  preview-only browser behavior, and definite kiosk image geometry after review
  findings.
- Measured production-like HTTP behavior with a 12-megapixel input and 60-item
  data set, then verified persistence across a service restart.

### Remaining validation

- Run `docs/raspberry-pi-validation.md` on the intended Raspberry Pi 5, display,
  cooling, and storage before calling the milestone target-hardware validated.
- Record Pi latency, peak RSS, temperature/throttling, Chromium smoothness,
  filesystem durability, burst contention, and controlled power-loss recovery.
- The conservative background processor will intentionally fall back on many
  real photographs. A higher-quality offline ML adapter is a later change and
  must not download a model at runtime.
