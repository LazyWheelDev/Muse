# AGENTS.md

## Project

Muse is an offline-first smart wardrobe designed for a dedicated Raspberry Pi touchscreen device.

## Product Goal

Build a polished MVP that allows users to:

1. Import clothing items
2. Organize them in a visual wardrobe
3. Place them on a silhouette
4. Control garment layers manually
5. Save complete outfits
6. Run the product in kiosk mode on Raspberry Pi

## Product Rules

- The MVP must remain focused.
- Do not add features outside the approved scope.
- New ideas must be documented under Version 2.
- Prefer reliability over feature count.
- Prefer polish over complexity.
- Essential functionality must work without Internet.
- No mandatory paid APIs.
- No runtime dependency on OpenAI models.
- The user must remain in control of outfit selection.
- Avoid hardcoded demo-only behavior.

## Engineering Rules

- Use clear, maintainable code.
- Keep modules small and focused.
- Add types wherever supported.
- Add validation at system boundaries.
- Add error handling for user-facing actions.
- Avoid unnecessary dependencies.
- Document important architectural decisions.
- Never commit secrets or credentials.
- Keep setup reproducible.
- Update documentation when behavior changes.

## Proposed Stack

### Frontend

- React
- TypeScript
- Vite
- CSS modules or a lightweight styling system

### Backend

- Python
- FastAPI
- SQLite
- Pillow or equivalent local image processing tools

### Device

- Raspberry Pi OS
- Chromium kiosk mode
- systemd service for automatic startup

## Development Priorities

1. Product foundation
2. Wardrobe data model
3. Wardrobe library
4. Outfit builder
5. Import workflow
6. Persistence
7. Kiosk deployment
8. Polish
9. Demo reliability

## Forbidden During MVP

Do not implement:

- AI-generated outfit recommendations
- Cloud synchronization
- Social networking
- Marketplace features
- Complex scraping
- Native mobile apps
- Photorealistic virtual try-on
- Multi-user account systems

## Definition of Done

A task is done only when:

- The feature works
- Errors are handled
- The UI is understandable
- Tests pass when applicable
- Documentation is updated
- The feature does not break the MVP scope