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

- [ ] Create a temporary upload session
- [ ] Generate an expiring token
- [ ] Generate a QR code
- [ ] Create a mobile-friendly upload page
- [ ] Upload from a phone on the local network
- [ ] Notify the Muse interface when upload completes
- [ ] Expire old upload sessions

### Fallback

If QR upload is not ready for the first stable build, local browser upload remains available.

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

- [ ] Create the primary navigation
- [ ] Add Wardrobe
- [ ] Add Outfit Builder
- [ ] Add Saved Outfits
- [ ] Add Settings
- [ ] Ensure navigation is touch-friendly
- [ ] Avoid hover-only behavior

---

## P6.2 Visual System

- [ ] Define typography
- [ ] Define spacing
- [ ] Define icons
- [ ] Define surfaces and cards
- [ ] Define transitions
- [ ] Define empty states
- [ ] Define loading states
- [ ] Ensure consistent component styling

---

## P6.3 Startup Experience

- [ ] Create the Muse startup screen
- [ ] Add the Muse logo
- [ ] Add a short startup animation
- [ ] Transition smoothly to the home screen
- [ ] Avoid delaying application readiness unnecessarily

---

## P6.4 Accessibility and Touch

- [ ] Use large touch targets
- [ ] Ensure readable text
- [ ] Provide visible focus states
- [ ] Support keyboard navigation during development
- [ ] Avoid controls requiring precise pointer movement
- [ ] Test important flows with limited dexterity in mind

---

# Phase 7: Raspberry Pi Deployment

## P7.1 Production Build

- [ ] Build the frontend for production
- [ ] Serve the frontend locally
- [ ] Configure production paths
- [ ] Configure persistent data storage
- [ ] Confirm offline operation

---

## P7.2 Kiosk Mode

- [ ] Configure Chromium kiosk mode
- [ ] Hide browser controls
- [ ] Disable unnecessary system UI
- [ ] Open Muse automatically
- [ ] Restore Muse after Chromium restarts

---

## P7.3 Automatic Startup

- [ ] Create the backend systemd service
- [ ] Create the kiosk startup service
- [ ] Wait for backend health before opening Muse
- [ ] Restart failed services
- [ ] Add readable local logs
- [ ] Test a full device reboot

---

# Phase 8: Reliability

## P8.1 Backend Tests

- [ ] Test the health endpoint
- [ ] Test clothing CRUD
- [ ] Test outfit CRUD
- [ ] Test upload validation
- [ ] Test database persistence
- [ ] Test invalid input handling

---

## P8.2 Frontend Tests

- [ ] Test critical components
- [ ] Test wardrobe loading
- [ ] Test outfit saving
- [ ] Test error states
- [ ] Test critical touchscreen interactions where practical

---

## P8.3 End-to-End Demo Flow

- [ ] Launch Muse
- [ ] Import a garment
- [ ] Categorize it
- [ ] Browse the wardrobe
- [ ] Add garments to the silhouette
- [ ] Adjust transformations
- [ ] Change layer order
- [ ] Save the outfit
- [ ] Restart Muse
- [ ] Confirm all data persists

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
