# Architecture

## Overview

Muse is an offline-first smart wardrobe designed to run as a dedicated touchscreen experience on Raspberry Pi.

The application is built around four core components:

- Frontend
- Backend
- Database
- Device

Each component has a single responsibility and communicates through well-defined interfaces.

---

## System Architecture

```text
+------------------------+
|   Phone / Local Upload |
+-----------+------------+
            |
            v
+------------------------+
|      FastAPI Backend   |
+-----------+------------+
            |
            v
+------------------------+
| React Touch UI         |
+-----------+------------+
            |
            v
+------------------------+
| SQLite + Image Storage |
+-----------+------------+
            |
            v
+------------------------+
| Raspberry Pi Kiosk     |
+------------------------+
```

---

## Frontend

### Technology

- React
- TypeScript
- Vite

### Responsibilities

- Display the wardrobe
- Display clothing details
- Build outfits
- Manage clothing layers
- Touchscreen interaction
- Communicate with the backend API

---

## Backend

### Technology

- Python
- FastAPI

### Responsibilities

- Business logic
- Image processing
- Clothing management
- Outfit management
- Local API
- Database access

---

## Database

### Technology

SQLite

### Stores

- Clothing items
- Outfits
- Application settings
- Image references

Images themselves are stored on the local filesystem.

---

## Device Layer

Muse is designed to run on:

- Raspberry Pi 5
- Raspberry Pi OS
- Chromium Kiosk Mode

The device launches directly into Muse without exposing the operating system.

---

## Design Principles

- Offline First
- Touch First
- Local First
- Simple Architecture
- Modular Components
- No Mandatory Cloud
- No Paid Runtime APIs

---

## Data Flow

```text
Phone
   ↓
Upload
   ↓
Backend
   ↓
Image Processing
   ↓
SQLite
   ↓
Frontend
   ↓
User
```

---

## Development Environments

### Development

- macOS
- Windows
- Linux

### Production

- Raspberry Pi
- Fullscreen kiosk mode

---

## Future Extensions

The architecture is intentionally modular to support future features such as:

- AI outfit recommendations
- Cloud synchronization
- Retail integrations
- Advanced virtual try-on

These features are outside the MVP scope.

---

## Architecture Rule

Every new feature must integrate into the existing architecture without increasing unnecessary complexity.

When in doubt:

Prefer simplicity.