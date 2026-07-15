# Contributing to Muse

Muse is an offline-first smart wardrobe for a dedicated Raspberry Pi touchscreen. Keep changes focused on the approved MVP and follow the product and engineering rules in `AGENTS.md`.

## Development Setup

The frontend requires Node.js `24.18.0` and npm `11.16.0`.

From the repository root:

```bash
nvm install
nvm use
cd frontend
npm ci
npx playwright install chromium
```

Linux contributors can install the browser and its required system packages together:

```bash
npx playwright install --with-deps chromium
```

Start the frontend development server with:

```bash
cd frontend
npm run dev
```

## Frontend Quality Checks

Before handing off a frontend change, run:

```bash
cd frontend
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run test:e2e
```

To apply project formatting or run unit tests interactively:

```bash
npm run format
npm run test:watch
```

The GitHub Actions frontend workflow runs the same deterministic checks with `npm ci` and tests the route shell in Chromium at `1280 × 800`.

## Frontend Conventions

- Use strict TypeScript and keep components small and focused.
- Prefer semantic HTML and accessible names before adding ARIA.
- Preserve visible keyboard focus and a minimum `56 × 56 px` touch target for interactive controls.
- Do not require hover or animation for essential behavior.
- Support `prefers-reduced-motion` and keep motion restrained.
- Use the tokens in `frontend/src/styles/tokens.css` instead of introducing one-off colors, spacing, radii, shadows, or timings.
- Use CSS Modules for component styles and global CSS only for reset, tokens, fonts, and application-wide accessibility behavior.
- Keep required runtime assets local. Do not add CDN fonts, remote CSS, or mandatory network requests.
- Treat `assets/ui/mockups/` as approved references, not runtime application assets.
- Do not introduce a dark theme during the MVP.
- Add or update tests whenever behavior changes.
- Update documentation when commands, architecture, or user-visible behavior changes.

## Scope Discipline

Do not add cloud synchronization, AI outfit recommendations, social features, marketplace behavior, scraping, native mobile applications, photorealistic try-on, or multi-user accounts during the MVP. New ideas belong in the Version 2 documentation rather than the implementation backlog.

Do not commit secrets, environment-specific databases, uploaded garments, generated previews, test reports, coverage output, or dependency directories. The root `.gitignore` defines the expected local-only paths while allowing `.env.example` files to remain tracked.
