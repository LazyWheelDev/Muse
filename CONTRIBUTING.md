# Contributing to Muse

Muse is an offline-first smart wardrobe for a dedicated Raspberry Pi
touchscreen. Keep changes within the approved MVP and follow `AGENTS.md`, the
design-system documentation, and the approved mockups.

## Toolchain and setup

Use the checked-in toolchain versions:

- Python `3.13.x`
- uv `0.11.28`
- Node.js `24.18.0`
- npm `11.16.0`

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

Use `npx playwright install --with-deps chromium` on a Linux environment that
also needs Playwright's operating-system packages. Do not install project Python
packages globally or replace `npm ci` with an unlocked CI install.

If macOS Python reports skipped hidden `.pth` files from `.venv`, export
`UV_PROJECT_ENVIRONMENT=venv` before sync and backend commands; that alternate
environment path is gitignored.

If dependency declarations change, regenerate and commit the appropriate lockfile
with the tool's pinned version. Do not hand-edit generated lock data.

## Development startup

Start and migrate FastAPI first:

```bash
cd backend
uv run muse-backend migrate
uv run muse-backend serve --reload
```

Then start Vite in a second terminal:

```bash
cd frontend
npm run dev
```

The browser calls relative `/api/v1` paths. Vite proxies `/api` to FastAPI; do
not add a hard-coded production host. Local API documentation is available at
`http://127.0.0.1:8000/api/docs`.

Copy `backend/.env.example` or `frontend/.env.example` only when overrides are
needed. Never commit `.env`, secrets, machine paths, local databases, uploaded
media, test output, or coverage data.

## Required checks

Before handing off backend changes, run:

```bash
cd backend
uv run ruff format --check .
uv run ruff check .
uv run mypy src tests
uv run pytest
uv run muse-backend migration-check
```

Useful focused commands are:

```bash
uv run ruff format .
uv run pytest -m unit --no-cov
uv run pytest -m integration --no-cov
```

Before handing off frontend changes, run:

```bash
cd frontend
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run test:e2e
```

Apply frontend formatting with `npm run format`; use `npm run test:watch` while
iterating. Playwright exercises Chromium at `1280 × 800`.

To run the destructive full-stack browser smoke check, first build the frontend
and start FastAPI against a newly migrated disposable data root. Then run, from
another terminal:

```bash
cd frontend
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8000 npm run test:e2e:production
```

The test imports, edits, reloads, and soft-deletes its own garment. Never target
an existing personal or production wardrobe.

Run both suites for cross-stack changes. GitHub Actions performs locked installs,
all static checks and tests, a clean-database migration check, the frontend
production build, shell Playwright tests, and a production same-origin smoke
test through FastAPI.

## Backend conventions

- Keep API routes, Pydantic schemas, services, repositories, SQLAlchemy models,
  storage, and configuration in their existing focused packages.
- Use the application factory and injected settings in tests. Never point tests
  at development or production data.
- Validate at HTTP and storage boundaries, then keep domain rules in services.
- Use explicit transactions for multi-row operations. Translate expected
  conflicts into structured application errors rather than exposing traces or
  database implementation details.
- Keep API changes versioned below `/api/v1` and update OpenAPI-facing schemas,
  tests, and documentation together.
- Use relative POSIX paths in persisted media references. Resolve paths only
  through the local-storage abstraction; reject traversal, absolute paths, and
  caller-selected destination names.
- Stream garment multipart bodies directly into the configured temporary root.
  Do not replace this with `request.form()`, `UploadFile`, or an in-memory body
  buffer without re-establishing the same size, cleanup, and crash guarantees.
- Preserve source bytes exactly. Generate normalized, thumbnail, and optional
  cutout variants as separate records in one logical image group; never treat
  derivatives as separate carousel photographs.
- Keep optional processing outside long SQLite transactions. Any change to the
  import manifest or reconciliation protocol requires injected-failure and
  restart tests.
- Do not call SQLAlchemy `metadata.create_all()` as a runtime migration shortcut.

### Schema changes

Create an Alembic revision for every persistent model change, inspect the
generated operations, and test it from an empty database. Apply and verify with:

```bash
cd backend
uv run muse-backend migrate
uv run muse-backend migration-status
uv run muse-backend migration-check
```

Where practical, test downgrade and re-upgrade locally as well. Normal server
startup must remain migration-free so schema changes are deliberate and
observable.

To reset only a development database:

```bash
uv run muse-backend reset-dev --confirm
```

This is destructive to the configured SQLite database. The command rejects test
and production environments and deliberately leaves media in place.

### Data-model invariants

- Garment category and Outfit Builder body zone are separate concepts.
- Outfit placement `x` and `y` are normalized garment-center coordinates, use a
  top-left origin, and remain in `[0, 1]`.
- Placement uses one proportional scale value and an explicit layer.
- Several garments may occupy the same body zone.
- Soft-deleted garments are excluded from Wardrobe queries, but existing outfit
  references remain readable. Never delete their files implicitly.

## Frontend conventions

- Use strict TypeScript and keep components small and focused.
- Prefer semantic HTML and accessible names before adding ARIA.
- Preserve visible keyboard focus and the `56 × 56 px` minimum touch target.
- Do not require hover or motion for essential behavior. Honor
  `prefers-reduced-motion`.
- Use `frontend/src/styles/tokens.css` and CSS Modules rather than one-off visual
  values or a heavyweight styling runtime.
- Keep required fonts, icons, and graphics local. Do not add CDN or runtime
  network dependencies for core behavior.
- Treat `assets/ui/mockups/` as approved references, not runtime UI assets.
- Keep backend access behind the typed API client, pass `AbortSignal` where
  lifecycle cancellation matters, and present unavailable states accessibly.
- Keep server state in TanStack Query and Wardrobe navigation context in
  validated URL parameters. Invalidate clothing collections after import,
  update, and soft deletion rather than maintaining a competing global store.
- Revoke every local image-preview object URL and keep multipart upload progress,
  cancellation, and structured errors in the centralized clothing client.
- Do not introduce a dark theme during the MVP.

## Scope discipline

Do not add cloud synchronization, AI outfit recommendations, social features,
marketplace behavior, complex scraping, native mobile applications,
photorealistic try-on, or multi-user accounts during the MVP. Search, filters,
favorites, automatic metadata detection, and exact duplicate-outfit detection
are also outside the current milestone. New ideas belong in
`docs/version-2.md` rather than implementation code.

Update tests and documentation whenever behavior, commands, configuration, API
contracts, or architecture change.

Hardware acceptance follows
[docs/raspberry-pi-validation.md](docs/raspberry-pi-validation.md). Development
machine measurements must be reported separately from real Raspberry Pi results.
