# Muse

Muse is a dedicated smart wardrobe designed for a touchscreen device powered by Raspberry Pi.

It helps users organize their clothes, browse their wardrobe visually, compose outfits, and save combinations through a polished offline-first experience.

## Vision

Muse turns a physical wardrobe into an interactive digital product.

The final device is designed to launch directly into Muse, without exposing the underlying operating system, desktop, terminal, or technical setup.

## Core Principles

- Offline first
- No mandatory subscription
- Local storage by default
- Touchscreen focused
- Simple and polished
- User controlled
- Raspberry Pi ready

## Build Week MVP

The first version of Muse will include:

- A visual wardrobe library
- Clothing categories
- A silhouette-based outfit builder
- Manual clothing placement and layering
- Saved outfits
- Local storage
- Phone-based clothing import
- Raspberry Pi kiosk mode

## Out of Scope for the MVP

The following features are intentionally excluded from the Build Week version:

- Photorealistic AI virtual try-on
- Cloud accounts
- Social features
- Marketplace integration
- Complex retailer scraping
- Weather recommendations
- Calendar integration
- Automatic outfit selection
- Native mobile applications

## Repository Structure

```text
assets/      Brand assets, screenshots, icons, and media
backend/     API, local database, image handling, and business logic
docs/        Product documentation, architecture, roadmap, and decisions
frontend/    Main touchscreen interface
kiosk/       Raspberry Pi startup, deployment, and kiosk configuration
```

## Frontend Foundation

The frontend is a React, TypeScript, and Vite application. The current milestone provides the reusable Muse application shell, design tokens, local fonts, route placeholders, and automated quality checks. It does not yet implement the complete product screens.

### Prerequisites

- Node.js `24.18.0`
- npm `11.16.0`

The supported versions are recorded in `.nvmrc`, `frontend/package.json`, and the committed lockfile. With `nvm` installed:

```bash
nvm install
nvm use
```

### Install

From the repository root:

```bash
cd frontend
npm ci
npx playwright install chromium
```

On Linux, install Chromium and its operating-system dependencies with:

```bash
npx playwright install --with-deps chromium
```

### Development

```bash
cd frontend
npm run dev
```

Vite prints the local development URL. The five application-shell routes are:

```text
/
/wardrobe
/outfit-builder
/saved-outfits
/settings
```

### Production Build

```bash
cd frontend
npm run build
npm run preview
```

The future FastAPI production host must serve the built frontend and return `index.html` for non-API application routes so direct navigation continues to work.

### Verification

Run the complete frontend verification suite:

```bash
cd frontend
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run test:e2e
```

Useful development commands:

```bash
npm run format
npm run test:watch
```

`npm run test:e2e` builds the production bundle automatically, starts a temporary Vite preview server, and checks every shell route in Chromium at the target `1280 × 800` viewport.

### Offline Runtime Assets

Inter and Playfair Display are packaged through Fontsource and emitted into the production bundle by Vite. Muse does not request fonts, CSS, icons, or other required interface assets from a CDN at runtime. The approved PNG mockups remain design references and are not shipped as application UI.
