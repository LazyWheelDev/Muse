# Codex build log

## 2026-07-18 — Cold-boot runtime-directory correction

### Confirmed root cause

- The first full Pi reboot reached systemd mount-namespace construction with
  `/run/muse` absent. `muse-prepare.service` declared that path in
  `ReadWritePaths`, so it failed at `NAMESPACE` with status `226` before Muse
  application code could run. Main, phone upload, network refresh, and kiosk
  then failed through their declared dependencies.
- The installer had created `/run/muse` as `root:muse`, mode `0750`, which made
  every warm activation pass. `/run` is volatile, however, and the repository
  shipped neither a tmpfiles rule nor a runtime-directory producer for the next
  boot. Persistent `/var/lib/muse` data and backups were never in scope of the
  failure and were not reset or modified during diagnosis.

### Permanent correction and regression

- Added a packaged `systemd-tmpfiles` rule for `/run/muse` with the existing
  `root:muse`, mode-`0750` security contract. The installer places it in
  `/usr/lib/tmpfiles.d/muse.conf`, applies it before activation, and refuses to
  continue if the resulting type, ownership, or mode is wrong.
- Preparation explicitly requires and follows
  `systemd-tmpfiles-setup.service`. A `RuntimeDirectory` on the `User=muse`
  unit was rejected because it would make the shared directory application-user
  owned and couple its lifecycle to one service.
- The Linux deployment verifier no longer pre-creates its `/run/muse` fixture.
  It starts with the path absent, invokes the real tmpfiles implementation in an
  isolated root with a real `root:muse` identity mapping, asserts mode and
  numeric ownership, and only then verifies the service graph.
- Earlier validation missed the defect because `systemd-analyze verify` checks
  unit structure without starting the mount namespace, the verifier supplied
  the missing directory itself, the installer regression used `--no-services`,
  and physical readiness had only been checked during warm activation. The
  documented per-release cold-boot gate remained open and caught the failure.

### Verification status

- Focused local kiosk/deployment tests passed 21 tests with the Linux-only
  installer test skipped on macOS. Ruff, Bash syntax, ShellCheck, shfmt, static
  deployment verification, and whitespace checks passed.
- The complete backend suite passed 269 tests with the same platform skip and
  85.21% branch coverage. Frontend typecheck, ESLint, Prettier, dependency audit,
  230 Vitest tests, and both production builds passed with the pinned Node and
  npm versions.
- The Linux clean-root tmpfiles execution, corrected immutable archive, and
  physical cold boot are recorded after their respective gates complete.

## 2026-07-17 — Build Week demo release stabilization

### Physical baseline and release fixes

- The operator exercised Muse on the intended Raspberry Pi 5 with 8 GB RAM,
  Raspberry Pi OS, labwc/Wayland, Chromium 150, and the `1280 × 800`
  touchscreen. Touch navigation, Wardrobe, Clothing Details, local and QR phone
  import, Outfit Builder, Saved Outfits, Settings, local-network status,
  persistence, and backups worked on the device.
- That run isolated three release-integration defects. Chromium needed read-only
  visibility of the compositor-owned Wayland runtime while retaining its private
  HOME, XDG directories, profile, and temporary storage. Main-process local
  address discovery needed `AF_NETLINK` for Python's `socket.if_nameindex()`.
  Activation also needed to clear a previously rate-limited selected kiosk
  instance before starting it.
- The committed kiosk unit now uses `PrivateTmp=true`,
  `ProtectHome=read-only`, and one explicit writable path,
  `/var/lib/muse-kiosk/%i`. The main unit permits `AF_UNIX`, `AF_INET`,
  `AF_INET6`, and `AF_NETLINK` while its complete HTTP application remains
  loopback-bound. Release activation resets failed state for prepare, main,
  phone upload, and `muse-kiosk@<operator>` before enable/start.
- Focused tests and the deployment verifier enforce those exact unit contracts,
  the activation ordering, and Chromium's private profile, Wayland,
  password-store, Crashpad, and session-recovery flags. No product feature,
  approved mockup, database schema, storage contract, or runtime network
  boundary changed.

### Verification results

- Backend dependency locking, Ruff format/lint, and strict mypy passed. The
  complete backend suite passed 268 tests with one platform skip and 85.79%
  branch coverage against the unchanged 85% threshold. The skip covers the
  Linux-only sandbox-install integration on the macOS development host.
- Frontend dependency installation and the high-severity npm audit passed with
  no vulnerability. TypeScript, ESLint with zero warnings, Prettier, and Vitest
  passed; Vitest ran 230 tests in 34 files.
- Both production frontends built with the pinned Node.js 24.18.0 and npm
  11.16.0 toolchain. The device entry was 505.13 kB JavaScript (153.32 kB gzip)
  and 63.23 kB CSS (10.42 kB gzip); the phone entry was 213.74 kB JavaScript
  (67.48 kB gzip) and 10.00 kB CSS (2.81 kB gzip). Vite retains the known
  device-entry `>500 kB` advisory.
- The `1280 × 800` route-shell check passed. The two production garment/outfit
  scenarios, the complete QR phone-upload scenario, and the isolated production
  Settings/backup/restore/delete-all scenario all passed against disposable
  storage. The destructive Settings scenario never used `/var/lib/muse` or the
  production database.
- Twenty focused kiosk/deployment tests passed with the same Linux-only skip.
  Bash syntax, ShellCheck, shfmt, Python helper compilation, and the deployment
  verifier's static checks passed. `systemd-analyze` is unavailable on the macOS
  host, so target-version unit verification remains an explicit CI and Pi
  checkpoint.
- A fresh SQLite database upgraded through `20260715_0003`, reported current
  migration status and no pending model operation, downgraded to
  `20260715_0002`, and re-upgraded to head. `integrity_check` returned `ok` and
  `foreign_key_check` returned no row at each inspected revision.

### Build Week collaboration and remaining gate

- Codex and GPT-5.6 Sol supported the repository audits, phased implementation,
  secure import and two-listener design, tests, release engineering, and
  diagnosis of the physical systemd/Wayland failures. The human retained MVP,
  visual, privacy, hardware, network, risk, and final release decisions. Muse
  has no runtime dependency on Codex, an OpenAI model, or an OpenAI API.
- This physical run is a functional hardware baseline, not acceptance of every
  future archive. The final demo archive must still be installed after a
  separate verified production backup, the temporary systemd drop-ins removed,
  and the Pi cold-booted. Existing garments and outfits must survive and the
  kiosk, network, QR path, and service boundaries must pass without an override
  before the release can be called demo-ready.

## 2026-07-16 — P6.1–P6.4 final product experience

### Scope completed

- Replaced the placeholder Home and Settings shells with the approved four-card
  Home and five-card Settings compositions while preserving Wardrobe, Details,
  Add Garment, Outfit Builder, and Saved Outfits context.
- Added W & N, Display, Data, Device, and About Muse routes plus the separate
  capability-aware Power dialog and application-level display-sleep overlay.
- Added the readiness-aware Muse Splash using local HTML, CSS, SVG, fonts, and
  motion only. It supports full, shortened, Reduced Motion, waiting, black
  transition, persistent recovery, Retry, deep-link, and single-play behavior.
- Added typed persisted preferences for the friendly device name, interface
  dimming, screen timeout, Reduced Motion, and Splash mode. Interface dimming is
  explicitly not hardware backlight control.
- Added sanitized local network, storage, device, capability, and maintenance
  status. Privileged Wi-Fi, restart, reboot, shutdown, kiosk, systemd, hardware
  brightness, and touch-calibration actions remain unavailable until the P7
  deployment adapters and physical Raspberry Pi validation exist.
- Added consistent loading, empty, offline, success, safe failure, destructive,
  and restart-required states without adding cloud services, remote assets,
  accounts, search, favorites, AI features, or a dark theme.

### Backup, restore, and deletion safety

- Local backup creation uses SQLite's online-backup API, snapshot-owned regular
  media, a closed versioned manifest, SHA-256 checksums, bounded streaming, and
  atomic archive promotion. Phone-upload sessions, logs, caches, temporary data,
  environment files, nested backups, and secrets are excluded.
- Restore treats every archive as hostile. It rejects traversal, links and
  special files, duplicate or case-colliding paths, unsupported or encrypted
  entries, excessive entry count, archive or expanded size, compression bombs,
  checksum failures, invalid SQLite, foreign-key errors, and incompatible
  migration heads. Archive entries are validated and staged without unbounded
  buffering or `extractall()`.
- Restore and delete-all are activation-safe across the two-listener runtime.
  The running main and restricted listeners hold shared POSIX leases; the
  explicit offline CLI requires an exclusive lease and refuses to modify live
  data while either process is active. Durable activation journals, rollback
  staging, directory synchronization, startup reconciliation, and bounded
  cleanup cover interrupted activation without deleting a committed garment.
- Delete-all requires two UI confirmations, the exact
  `DELETE ALL MUSE DATA` phrase, backup-loss acknowledgement, and the same
  stopped-service activation contract. It recreates the migrated empty database
  and required private directories without deleting application code or builds.
- The Settings API remains on the production loopback application only. Its
  mutations are typed, body-limited, JSON-only, and same-origin checked. The LAN
  listener exposes none of the Settings, backup, device, maintenance, core CRUD,
  media browsing, documentation, or main SPA surface.

### Accessibility and interaction decisions

- Essential Settings, Home, power, sleep, dialog, and recovery controls retain
  at least `56 × 56 px` targets, visible focus, semantic labels, keyboard use,
  reduced-motion behavior, and text alongside state or color.
- Dialog focus is trapped and restored. Destructive flows focus Cancel first;
  the two delete-all stages intentionally remount so the safer action receives
  focus again before the exact phrase can be entered.
- Screen sleep preserves the active route and consumes the wake interaction.
  The startup gate preserves the requested deep link and never replays the full
  Splash during internal navigation.

### Verification results

- Ruff format/lint and strict mypy passed. The complete backend suite passed 246
  tests with 85.63% branch coverage against the unchanged 85% threshold. A
  focused independent replay of the Settings, backup/maintenance, and system API
  suites passed 26 tests; no new dependency or Alembic revision was required.
- Frontend typecheck, ESLint with zero warnings, Prettier, and both production
  builds passed. Vitest passed 220 tests in 34 files.
- The expanded route-shell Playwright check passed in 13.1 seconds across Home,
  Wardrobe, Outfit Builder, Saved Outfits, Settings, and all five Settings
  subsections at `1280 × 800`, with locally mocked readiness/status contracts,
  local fonts, no external request, and no page-level horizontal overflow.
- The isolated production P6 Playwright scenario passed in 19.2 seconds. It
  observed the real Splash/readiness transition, traversed all Settings
  sections, persisted Reduced Motion, generated a valid PNG garment and outfit,
  created a checked backup, staged and activated restore only after stopping
  both listeners, verified restored database/media, required both delete-all UI
  stages, activated deletion offline, and rechecked readiness, reset
  preferences, LAN-route isolation, local-only browser requests, SQLite
  `quick_check`, foreign keys, empty data/media rows, and empty backup storage.
  The first full replay caught the final delete-confirmation focus regression;
  the dialog lifecycle was corrected and the complete scenario then passed.
- The existing production garment/outfit scenarios passed 2/2 in 19.8 seconds,
  and the P4 phone-upload scenario passed 1/1 in 17.5 seconds after P6. Both
  listeners released their ports after each run.
- A fresh database upgraded through `20260715_0003`, downgraded to
  `20260715_0002`, and re-upgraded to head. Alembic detected no pending model
  operations; SQLite `quick_check` and `integrity_check` returned `ok`, with no
  foreign-key violations.
- The final device build emitted a 501.51 kB main JavaScript entry (152.19 kB
  gzip) and 63.23 kB main CSS (10.42 kB gzip), with Settings sections split into
  lazy chunks from 1.48 to 8.21 kB JavaScript. The unchanged dedicated mobile
  build emitted 213.74 kB JavaScript (67.48 kB gzip) and 10.00 kB CSS (2.81 kB
  gzip). Vite still reports the main-entry `>500 kB` advisory.
- On the local macOS ARM64 development machine, the warmed production main
  process used 89,040 KiB RSS and the restricted listener used 88,784 KiB RSS.
  Five local calls settled at about 1.8–2.2 ms for the empty storage summary and
  4.1–4.3 ms for device status. An empty-database backup produced a 4,580-byte
  archive in 8.5 ms. These small-data measurements are regression evidence,
  not representative backup-load or Raspberry Pi acceptance results.

These times and bundle sizes are development-machine regression evidence, not
Raspberry Pi performance measurements.

### CI, documentation, and Codex assistance

- CI now runs the locked P6 Playwright command against disposable loopback
  listeners, verifies final migration and SQLite state, stops both processes on
  every outcome, scans for maintenance archives/logs/PID files, and scrubs P6
  diagnostics before short-retention failure upload.
- README, contributor, backend/frontend runtime, architecture, scope, backlog,
  design-system, Splash, Home, Settings, user-flow, and Raspberry Pi validation
  documentation now describe the implemented contracts and their limits.
- Codex was used for repository audit, coordinated backend/frontend/release
  implementation, threat-focused review of the two-listener and archive
  boundaries, test design, failure diagnosis, accessibility correction, and
  documentation. Muse has no runtime dependency on Codex, OpenAI models, cloud
  services, or an Internet connection.
- The official working-tree security diff scan reviewed all 57 assigned files
  and coverage receipts. It produced no reportable finding. One developer-only
  E2E process-control candidate was dynamically validated and excluded by the
  product-boundary policy; the harness was nevertheless hardened with private
  exclusive runtime roots, no-follow file creation, retained child-process
  authority, command-identity checks, and bounded shutdown waits.

### Remaining validation

- At P6 closure no Raspberry Pi result was claimed. The July 17 functional
  baseline recorded above supersedes that historical status. The exhaustive
  timing, memory, thermal, large-data, interruption, and final immutable-release
  cold-boot checks remain governed by `docs/raspberry-pi-validation.md`.

## 2026-07-15 — P4.4 secure local-network phone upload

### Scope completed

- Added the two-listener runtime boundary: the complete Muse SPA and API remain
  loopback-only, while a separate restricted FastAPI application exposes only
  safe listener status, the dedicated mobile build, token-owned status, and one
  streamed garment upload on a configured private LAN interface.
- Added persistent phone-upload sessions through Alembic revision
  `20260715_0003`, including token digest, lifecycle timestamps, bounded attempt
  count, safe error code, committed garment reference, expiry and retention
  indices, and uniqueness constraints.
- Added the complete Add Garment method choice, device QR/status experience,
  locally bundled responsive phone page, image preview and metadata form,
  upload progress, terminal states, automatic Wardrobe invalidation, and
  navigation to the committed Clothing Details screen.
- Reused the existing streaming multipart parser, signature/MIME/decode limits,
  exact-original preservation, normalized and thumbnail derivatives, optional
  cutout fallback, manifests, atomic promotion, structured errors, and startup
  import reconciliation. No weaker second ingestion path was introduced.
- Kept all runtime assets and processing local. No account, cloud relay, tunnel,
  remote QR service, analytics, paid API, or Internet connection was added.

### Security and lifecycle decisions

- The production `serve` command rejects non-loopback binds and the main
  application also rejects non-loopback clients. `serve-phone-upload` starts a
  separate one-worker application with no clothing/outfit/Settings/media CRUD,
  SPA fallback, OpenAPI, interactive docs, or privileged device action.
- Every raw token contains 256 bits of cryptographic entropy. SQLite stores only
  its SHA-256 digest. The raw value exists in the initial QR URL fragment,
  origin-scoped mobile `sessionStorage`, and `X-Muse-Upload-Token`; it is removed
  from visible history, never returned by later device status, and never written
  to application or access logs.
- Strict Host and same-origin checks, bounded metadata and streamed image sizes,
  receive timeout, request IDs, security headers, in-memory rate control, and a
  shared cross-process import gate protect the restricted listener. CORS and LAN
  membership are not treated as authentication.
- Main-process session creation and regeneration now require an exact-address,
  no-redirect, no-DNS `/listener-status` probe with a 500 ms timeout. The
  restricted process becomes ready only with a current migration and a valid
  compiled mobile build. Its minimal status route revalidates the bounded Vite
  manifest and every allow-listed asset, including after startup. Active device
  status reports this bounded reachability result without sending a token or
  exposing diagnostics.
- Transactional compare-and-set admission and the stable
  `phone-upload:{session_id}` import idempotency key ensure one session can
  commit at most one garment across two phones, retry, cancellation races, and
  restart. Recovery treats a durably committed garment as authoritative even
  when a stale failed, cancelled, or expired status was recorded.
- Sessions default to ten minutes. Periodic cleanup runs no more often than
  every five minutes and shares one 100-record budget across recovery, expiry,
  deletion of completed, cancelled, or expired rows retained for 24 hours, and
  stale temporary attempts. Startup drains session state through repeated
  bounded transactions and each listener removes one bounded attempt batch.
  Imports, optional cutout processing, and cleanup share one process/thread-safe
  cross-process gate, so cleanup cannot race an active temporary file and never
  removes a committed garment or registered media.

### Frontend and dependency decisions

- The device application retains TanStack Query as the only server-state owner.
  Its bounded polling slows after a retryable failure and stops only once the
  session is completed, cancelled, or expired. The phone page is a separate
  Vite entry and keeps its form/progress state local.
- Added `qrcode.react@4.2.0` (ISC, no runtime dependencies) for local device QR
  rendering. Added `jsqr@1.4.0` (Apache-2.0) and `pngjs@7.0.0` (MIT) only as E2E
  development dependencies to decode the displayed QR; they are not included
  in production browser bundles.
- JPEG, PNG, and WebP remain the complete supported input contract. HEIC and
  HEIF are rejected with actionable guidance. A HEIF decoder was not added
  because its complete codec/license/resource behavior has not passed Python
  3.13 Linux AArch64 and physical Raspberry Pi acceptance.

### Verification results

- The complete backend suite passed 228 tests with 87.87% branch coverage
  against the unchanged 85% threshold; the phone session, listener, and cleanup
  suites contribute 28 focused tests. Ruff format/lint passed across 83 Python
  files and strict mypy passed across 62 source files. The complete suite also
  passed with SQLite `ResourceWarning` promoted to an error after closing the
  migration test's direct connection explicitly.
- A fresh database upgraded to `20260715_0003`; migration status and model
  consistency passed. Downgrade to `20260715_0002`, re-upgrade to head, SQLite
  `quick_check`/`integrity_check`, and foreign-key checks passed.
- The frontend unit suite passed 197 tests in 30 files. TypeScript build-mode
  typecheck, ESLint with zero warnings, Prettier, and both Vite production builds
  passed.
- The real production P4 Playwright scenario passed in 12.1 seconds. It decoded
  the displayed QR, used a `390 × 844` phone context to upload a valid PNG,
  observed automatic Details navigation on the `1280 × 800` device, verified
  exact original bytes and derivatives, rejected multipart replay with `409`
  before and after stopping/restarting both listeners, re-read the persistent
  garment, and observed no external origin or page-level horizontal overflow.
- The device build emitted 476.06 kB JavaScript (145.20 kB gzip) and 49.96 kB
  CSS (8.47 kB gzip). The dedicated mobile build emitted 213.74 kB JavaScript
  (67.48 kB gzip) and 10.00 kB CSS (2.81 kB gzip), comfortably below the 150 KiB
  mobile JavaScript-plus-CSS acceptance target. These are development-machine
  bundle measurements, not Raspberry Pi memory or latency results.
- A warmed development-machine run measured 88,160 KiB RSS for the main process
  and 87,680 KiB RSS for the restricted listener. Five clean browser contexts
  reached a visible QR in `173.6`, `67.2`, `65.9`, `65.5`, and `65.5 ms`
  (median `65.9 ms`). These Apple M4 measurements are regression evidence only;
  the physical Pi memory and timing acceptance remains open.
- Documentation passed targeted Prettier formatting, CI YAML parsing, the
  repository whitespace check, and a repository search confirming no loopback
  configuration advertises `127.0.0.1` as a LAN address.

### CI and production contract

- CI now checks the locked Python environment, migration downgrade/re-upgrade,
  SQLite integrity, both frontend builds, restricted-route isolation, strict
  Host rejection, and the real device/phone workflow against an initially empty
  P4-only data root.
- The P4 browser harness disables secret-bearing traces/screenshots/video,
  decodes the rendered QR in memory, uploads a real PNG from a `390 × 844`
  context, verifies the `1280 × 800` device transition, rejects replay, restarts
  both real processes through local PID control, and rechecks persistence and
  replay. CI also deletes the P4 failure report and any residual diagnostic file
  containing a token URL before artifact upload, covering Playwright-generated
  error contexts. Muse exposes no test-only restart API.
- Production commands use the locked Python executable directly. Once `dist`
  and `dist-phone` are built, neither listener needs Node or Internet access.
  Physical systemd installation remains part of the kiosk deployment milestone.

### Remaining validation

- No Raspberry Pi performance result is claimed. Run the expanded
  `docs/raspberry-pi-validation.md` procedure on the intended Pi 5, touchscreen,
  storage, cooling, Wi-Fi, iPhone, and Android phone before release.
- Record listener RSS, near-limit upload peak memory/CPU, QR render time, mobile
  bundle transfer size, main-API responsiveness, cleanup cost, Wi-Fi
  interruption recovery, temperature/throttling, touch accessibility, mDNS and
  direct-IP behavior, and coordinated process restart on the target hardware.

## 2026-07-15 — P5.1–P5.5 Outfit Builder and Saved Outfits

### Scope completed

- Added the local Muse valet silhouette and Canvas 2D workspace, with direct
  topmost-garment selection and drag plus semantic command alternatives.
- Added body-zone garment cycling and the in-place category picker. Garment
  category and placement zone remain separate, several distinct garments may
  overlap in one zone, and re-selecting the same garment activates rather than
  duplicates it.
- Added proportional resize, clockwise rotation, bounded movement, reset,
  remove/clear, deterministic forward/backward layer controls, and the visible
  ordered garment list.
- Added create, reopen, update, save-as-new, restore, and confirmed soft-delete
  outfit workflows through the versioned local API.
- Replaced Saved Outfits with the approved three-column grid at `1280 × 800`,
  including loading, empty, error, local preview fallback, lazy image loading,
  newest-updated order, and browser-session scroll restoration.
- Added one reducer-backed editor session with a saved baseline and versioned,
  validated, 512 KiB-bounded `sessionStorage` recovery. Failed saves preserve
  the draft; temporary Wardrobe selection reuses it without a competing store.
- Kept exact duplicate-outfit detection and long-press/fullscreen Saved preview
  as optional extensions. Search, filters, favorites, cloud services, and
  runtime network assets were not introduced.

### Cross-stack placement and preview contract

- Browser and backend use one logical `640 × 800` workspace. `x` and `y` are
  normalized garment-center coordinates from the top-left; scale is one
  proportional value; positive rotation is clockwise; and ascending unique
  layers render from back to front.
- The shared body-zone base-width fractions are `0.28` head, `0.34` neck,
  `0.50` upper body, `0.56` full body, `0.42` lower body, `0.40` feet, and
  `0.30` accessory. Garment height preserves the selected image's aspect ratio.
- Creating an outfit or changing placements generates a deterministic local
  `600 × 750` lossless WebP with Pillow. Candidate priority is cutout,
  normalized, then original; a bounded neutral placeholder isolates an invalid
  or missing garment image.
- Preview files use unique immutable names. A private staging directory,
  durable manifest, atomic promotion, short ownership transaction, compensation,
  and startup reconciliation protect filesystem/database consistency. Failed
  updates preserve the previous row and preview; name-only and unchanged edits
  reuse it; successful replacements clean the obsolete unregistered file.
- Soft deletion retains the registered preview. Reconciliation treats active
  and soft-deleted outfit rows as owners until an explicit permanent-retention
  policy is designed.

### API and dependency decisions

- Added typed clients and local handlers for `POST /api/v1/outfits`,
  `GET /api/v1/outfits`, `GET /api/v1/outfits/{id}`,
  `PATCH /api/v1/outfits/{id}`, and `DELETE /api/v1/outfits/{id}`.
- Outfit summaries expose preview dimensions and counts; details hydrate
  placement transforms plus active/deleted garment reference state and ordered
  display-image fallbacks.
- No schema migration or new runtime dependency was required. The implementation
  reuses React, TanStack Query, Canvas 2D, FastAPI, SQLAlchemy, SQLite, and the
  existing locked Pillow dependency. The silhouette is a bundled local SVG.

### Verification results

- Backend focused preview and outfit API suites: 32 tests passed, including a
  stale unchanged-placement concurrency regression. The complete backend suite
  passed 198 tests with 88.90% branch coverage against the unchanged 85%
  threshold; Ruff format/lint and strict mypy also passed.
- The complete frontend suite passed 130 tests in 23 files. TypeScript
  build-mode typecheck, ESLint with zero warnings, Prettier, and the production
  Vite build passed; the build emitted 443.77 kB JavaScript (134.59 kB gzip) and
  42.42 kB CSS (7.51 kB gzip), plus locally bundled fonts and SVG.
- The route-shell Playwright check and both real same-origin production
  scenarios passed in Chromium at `1280 × 800`. The P5 scenario covers
  import/build/transform/layer/save/reload/update/copy/delete, a `600 × 750`
  preview, three-column grid, 56 px key touch targets, aligned silhouette
  geometry, local-only requests, no unnecessary original-image request, and no
  page-level horizontal overflow.
- Updated documentation passed targeted Prettier checking and the repository
  whitespace check (`git diff --check`).

### Development-machine measurements

Measurements used the production frontend and same-origin FastAPI service on an
Apple M4 (`arm64`) machine with Python 3.13.14 and headless Chromium at
`1280 × 800`. They are development regression evidence, not Raspberry Pi
results.

- Real API create and placement-changing update requests with 20 placements had
  `322.813 ms` and `324.916 ms` medians over five runs. The representative
  `600 × 750` lossless WebP was 266,712 bytes.
- Name-only and unchanged-placement updates had `4.774 ms` and `9.921 ms`
  medians over ten runs, retained the same preview URL, and created no new
  preview file.
- During a separate `339.050 ms` preview update, 50 concurrent health requests
  had `1.697 ms` p95 latency and 50 outfit-list requests had `2.410 ms` p95
  latency; every response was `200`.
- With 60 active outfits, warmed 100-item list requests had a `1.154 ms` median
  and returned 15,784 bytes. The complete three-column grid requested 60 local
  previews totaling 6,238,310 bytes after incremental scrolling, with no
  source-original or external request.
- A 60-event direct drag produced 60 Canvas redraws, zero network requests,
  zero API mutations, and no browser long task over 50 ms. Animation-frame
  intervals had a `10.8 ms` median and `26.3 ms` p95; the harness included
  deliberate per-event waits and Playwright overhead.
- A lower-level warmed renderer benchmark using one repeated synthetic
  `800 × 1200` WebP had a `0.2334 s` median and `0.2383 s` maximum and produced
  a 40,034-byte preview.

Native browser lazy loading requested 27 of 60 previews in the initial grid
viewport. The complete scroll transferred 6.24 MB of preview bodies; decode,
scroll, memory, and storage performance must be remeasured on the Raspberry Pi.

### Remaining validation

- Execute the expanded `docs/raspberry-pi-validation.md` procedure on the
  intended Raspberry Pi 5, touchscreen, storage, cooling, systemd service, and
  Chromium kiosk build.
- Record target-device preview latency, Canvas and three-column-grid smoothness,
  API responsiveness, peak RSS, storage use, temperature/throttling, touch and
  keyboard accessibility, offline restart, reconciliation, and controlled
  interruption behavior before claiming Raspberry Pi validation.

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
  runtime. QR import was deliberately deferred to P4.4 and is now complete; a
  high-quality ML cutout processor remains deferred.

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
