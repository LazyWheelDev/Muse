# Development Backlog

## Objective

Deliver a polished, reliable, and demonstrable Muse MVP before the Build Week deadline.

The backlog is ordered by dependency and priority.

A task must not begin before its required dependencies are complete.

---

# Phase 1: Project Foundation

## P1.1 Frontend Setup

- [x] Create the React, TypeScript, and Vite application
- [x] Configure strict TypeScript
- [x] Add linting and formatting
- [x] Create the base folder structure
- [x] Add environment configuration
- [x] Add a basic application shell
- [x] Confirm the frontend runs locally

### Definition of Done

- The frontend starts without errors
- The initial page renders
- Type checking passes
- Linting passes

---

## P1.2 Backend Setup

- [x] Create the FastAPI application
- [x] Add configuration management
- [x] Add a health-check endpoint
- [x] Create the backend folder structure
- [x] Add dependency management
- [x] Configure local development startup
- [x] Add an initial backend test

### Definition of Done

- The backend starts without errors
- `GET /health` returns a successful response
- The initial test suite passes

---

## P1.3 Frontend and Backend Connection

- [x] Configure the frontend API base URL
- [x] Fetch the backend health status
- [x] Display a clear connection error when unavailable
- [x] Confirm cross-origin configuration works locally

### Definition of Done

- The frontend successfully communicates with FastAPI
- Connection failures are handled visibly

---

# Phase 2: Data Foundation

## P2.1 Database Setup

- [x] Configure SQLite
- [x] Create database initialization
- [x] Enable foreign-key constraints
- [x] Add a migration strategy
- [x] Separate development data from production data

### Definition of Done

- The database is created by the explicit migration command
- The schema can be reproduced from a clean installation

---

## P2.2 Clothing Data Model

- [x] Create the clothing item model
- [x] Add clothing categories
- [x] Add optional metadata fields
- [x] Add image reference fields
- [x] Add timestamps
- [x] Add validation rules

### Required Fields

- Name
- Category
- Image reference

### Optional Fields

- Color
- Brand
- Size
- Material
- Price
- Notes

---

## P2.3 Outfit Data Model

- [x] Create the outfit model
- [x] Create the outfit item relationship
- [x] Store garment position
- [x] Store garment scale
- [x] Store garment rotation
- [x] Store garment layer order
- [x] Add timestamps

### Definition of Done

- An outfit can reference several clothing items
- Each item can store its visual transformation

---

# Phase 3: Wardrobe Library

## P3.1 Clothing API

- [x] Create clothing items
- [x] List clothing items
- [x] Read one clothing item
- [x] Update clothing items
- [x] Delete clothing items
- [x] Filter by category
- [x] Handle missing records cleanly

---

## P3.2 Wardrobe Interface

- [x] Create the wardrobe page
- [x] Create clothing cards
- [x] Display garment images
- [x] Display categories
- [x] Add empty state
- [x] Add loading state
- [x] Add error state
- [x] Add touch-friendly navigation

---

## P3.3 Clothing Details

- [x] Create the clothing details view
- [x] Edit clothing metadata
- [x] Delete a clothing item with confirmation
- [x] Return to the wardrobe cleanly

---

## P3.4 Deferred discovery features

Search, arbitrary filters, and favorites are deferred beyond the current MVP.
Category navigation remains part of P3.1 and P3.2.

---

# Phase 4: Clothing Import

## P4.1 Local Image Upload

- [x] Accept JPEG images
- [x] Accept PNG images
- [x] Accept WebP images
- [x] Enforce file-size limits
- [x] Generate safe filenames
- [x] Store original images locally
- [x] Reject unsupported files safely

---

## P4.2 Image Processing

- [x] Create the image-processing service
- [x] Normalize image orientation
- [x] Generate thumbnails
- [x] Produce a transparent cutout when possible
- [x] Preserve the original image
- [x] Provide a fallback when processing fails

---

## P4.3 Clothing Import Form

- [x] Upload an image
- [x] Preview the image
- [x] Enter a garment name
- [x] Select a category
- [x] Add optional details
- [x] Save the garment
- [x] Display clear validation errors

---

## P4.4 Phone Upload Session

- [x] Create a persistent temporary upload session
- [x] Generate a hashed, single-use, expiring token
- [x] Generate a local QR code with a readable URL fallback
- [x] Keep the complete Muse API loopback-only
- [x] Add a separate restricted listener for the trusted LAN
- [x] Create an accessible mobile-friendly upload page
- [x] Upload a real image and metadata through the existing secure importer
- [x] Notify and refresh the Muse interface when upload completes
- [x] Prevent concurrent submission and replay
- [x] Reconcile interrupted sessions and expire old sessions in bounded batches
- [x] Preserve local-device import as the equal first option
- [x] Document the truthful JPEG, PNG, WebP, and HEIC/HEIF contract

---

# Phase 5: Outfit Builder

## P5.1 Muse Silhouette

- [x] Create the default Muse silhouette
- [x] Center it in the outfit workspace
- [x] Ensure it scales correctly
- [x] Support the target landscape resolution
- [x] Keep the visual style minimal and premium

---

## P5.2 Garment Selection

- [x] Open the wardrobe from the outfit builder
- [x] Select a clothing item
- [x] Add it to the silhouette
- [x] Remove it from the current outfit
- [x] Prevent accidental duplicate additions by activating an existing placement

---

## P5.3 Garment Transformation

- [x] Move garments
- [x] Resize garments
- [x] Rotate garments
- [x] Support one proportional scale adjustment
- [x] Reset garment transformation
- [x] Use touch-friendly controls

---

## P5.4 Layer Management

- [x] Move a garment forward
- [x] Move a garment backward
- [x] Display the current layer order
- [x] Preserve layer order while editing
- [x] Prevent invalid layer states

---

## P5.5 Outfit Saving

- [x] Name an outfit
- [x] Save all selected garments
- [x] Save all garment transformations
- [x] Reload a saved outfit
- [x] Update an existing outfit or save the edit as a new outfit
- [x] Delete an outfit with confirmation
- [x] Generate and reconcile an immutable local outfit preview
- [x] Preserve and validate the in-progress editor session draft

P5 is development-complete. Raspberry Pi 5 latency, touch, temperature,
throttling, storage, and interruption validation remains required before a
hardware release claim. Exact duplicate-outfit detection is an optional
extension and is not part of P5 completion.

---

# Phase 6: Product Experience

## P6.1 Navigation

- [x] Keep Home as the four-card primary navigation root
- [x] Preserve Wardrobe, Details, Builder, Saved Outfits, and import context
- [x] Add the approved five-card Settings landing screen
- [x] Add dedicated W & N, Display, Data, Device, and About routes
- [x] Add consistent Home, Back, not-found, and unsaved-change escapes
- [x] Keep navigation touch-friendly and independent of hover
- [x] Add the capability-aware Power menu and application sleep overlay

---

## P6.2 Visual System

- [x] Apply the approved local Inter and Playfair Display typography
- [x] Apply the Muse spacing, icon, surface, card, radius, and shadow tokens
- [x] Complete the approved Home and Settings compositions
- [x] Reuse coherent headers, buttons, dialogs, panels, controls, and status states
- [x] Keep transitions restrained and respect Reduced Motion
- [x] Standardize understandable loading, empty, offline, error, and success states
- [x] Preserve the approved ivory/champagne identity with no dark theme

---

## P6.3 Startup Experience

- [x] Implement the local CSS/HTML Muse wordmark and droplet sequence
- [x] Coordinate the Splash with the real readiness contract
- [x] Hold the final composition when readiness is late without looping
- [x] Add bounded retry and a branded persistent-failure recovery state
- [x] Add cold-start, reload, internal-navigation, and deep-link replay behavior
- [x] Add a persisted Reduced Motion path
- [x] Transition through the brief black state into Home or the requested route

---

## P6.4 Accessibility and Touch

- [x] Keep essential controls at least `56 × 56 px`
- [x] Use readable text and functional contrast instead of champagne-only labels
- [x] Provide visible focus, logical keyboard access, and semantic labels
- [x] Trap and restore dialog focus and keep the safer Cancel action focused
- [x] Provide semantic alternatives to gestures and avoid precise-pointer controls
- [x] Announce progress and avoid color-only communication
- [x] Preserve functionality with Reduced Motion and the display asleep

P6 is software-complete. The release contract is verified on development and CI
environments. A July 17, 2026 Raspberry Pi 5 functional baseline now covers the
touchscreen product flow, kiosk, persistence, local network, QR upload, and
backups. Exhaustive timing, thermal, throttling, large-data, interruption, and
per-archive cold-boot acceptance remain open. Privileged controls stay bounded
by the installed P7 capabilities.

---

# Phase 7: Raspberry Pi Deployment

## P7.1 Production Build

- [x] Build the frontend for production
- [x] Serve the frontend locally
- [x] Configure production paths
- [x] Configure persistent data storage
- [x] Confirm local-first operation without a mandatory Internet route

---

## P7.2 Kiosk Mode

- [x] Configure Chromium kiosk mode
- [x] Hide browser controls
- [x] Disable unnecessary system UI
- [x] Open Muse automatically
- [x] Restore Muse after Chromium restarts

---

## P7.3 Automatic Startup

- [x] Create the backend systemd service
- [x] Create the kiosk startup service
- [x] Wait for backend health before opening Muse
- [x] Restart failed services
- [x] Add readable local logs
- [ ] Test a full device reboot

The July 17 run validated the installed functional baseline. The final checkbox
remains open until the new immutable release is deployed without its temporary
systemd drop-ins and passes one clean cold reboot with production data intact.

---

# Phase 8: Reliability

## P8.1 Backend Tests

- [x] Test the health endpoint
- [x] Test clothing CRUD
- [x] Test outfit CRUD
- [x] Test upload validation
- [x] Test database persistence
- [x] Test invalid input handling

---

## P8.2 Frontend Tests

- [x] Test critical components
- [x] Test wardrobe loading
- [x] Test outfit saving
- [x] Test error states
- [x] Test critical touchscreen interactions where practical

---

## P8.3 End-to-End Demo Flow

- [x] Launch Muse
- [x] Import a garment
- [x] Categorize it
- [x] Browse the wardrobe
- [x] Add garments to the silhouette
- [x] Adjust transformations
- [x] Change layer order
- [x] Save the outfit
- [x] Restart Muse
- [x] Confirm all data persists

---

## P8.4 Demo Fallbacks

- [ ] Prepare sample wardrobe data
- [ ] Prepare processed garment images
- [ ] Prepare a local backup
- [ ] Prepare a development-computer demo
- [ ] Ensure the demo does not depend on Internet access
- [ ] Document recovery steps

---

# Phase 9: Submission

## P9.1 Documentation

- [ ] Update README setup instructions
- [ ] Document supported platforms
- [ ] Document Raspberry Pi installation
- [ ] Add architecture overview
- [ ] Add screenshots
- [ ] Add sample data instructions
- [ ] Add licensing information

---

## P9.2 Devpost Submission

- [ ] Select Apps for Your Life
- [ ] Complete the project story
- [ ] Add the technology tags
- [ ] Add the GitHub repository
- [ ] Add the public demo video
- [ ] Add the required Codex session ID
- [ ] Explain how Codex accelerated development
- [ ] Explain how GPT-5.6 was used
- [ ] Verify every required field

---

## P9.3 Demo Video

- [ ] Write the script
- [ ] Record the startup experience
- [ ] Record clothing import
- [ ] Record wardrobe browsing
- [ ] Record outfit creation
- [ ] Record outfit saving
- [ ] Explain Codex usage
- [ ] Explain GPT-5.6 usage
- [ ] Keep the final video under three minutes
- [ ] Upload it publicly to YouTube

---

# Version 2 Parking Lot

These tasks must not begin before the MVP gate is passed.

- [ ] Multiple profiles
- [ ] Personal user photo
- [ ] Weather integration
- [ ] Calendar integration
- [ ] Clothing availability and laundry status
- [ ] Product URL import
- [ ] Visual product matching
- [ ] Retail search
- [ ] Cloud synchronization
- [ ] Native mobile application
- [ ] AI outfit recommendations
- [ ] Advanced virtual try-on

---

# MVP Gate

Version 2 work is allowed only when:

- [ ] The complete core flow works
- [ ] Data persists after restart
- [ ] Core tests pass
- [ ] The interface is polished
- [ ] The Raspberry Pi build works
- [ ] A fallback demo works
- [ ] The README is accurate
- [ ] The submission requirements are understood

Only one Version 2 feature may be developed at a time.

---

# Working Rule

For every task:

1. Implement the smallest complete version.
2. Test it.
3. Document it.
4. Commit it.
5. Move to the next task.

Finish first. Improve later.
