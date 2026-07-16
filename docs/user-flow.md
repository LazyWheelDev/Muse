# User Flow

## Goal

Muse is designed to provide a simple, intuitive, and enjoyable wardrobe experience.

The user should never feel lost or overwhelmed. Every screen should naturally guide them toward their next action.

The primary goals of Muse are:

- Organize clothing
- Build outfits
- Save outfits

---

# Main Navigation

Muse is built around four primary sections:

- Wardrobe
- Outfit Builder
- Saved Outfits
- Settings

The Home screen serves as the starting point and provides quick access to each section.

---

# Boot Flow

```text
Power On
    ↓
Muse Splash Screen
    ↓
Home Screen
```

The operating system, browser, and desktop must remain hidden from the user.

Muse should feel like a dedicated product rather than a computer application.

---

# Home Flow

```text
Home
    ↓
Choose an Action

• Wardrobe
• Outfit Builder
• Saved Outfits
• Settings
```

---

# Wardrobe Flow

```text
Home
    ↓
Wardrobe
    ↓
Browse Clothing
    ↓
Select Garment
    ↓
Garment Details
```

From the garment details page the user can:

- Add the garment to an outfit
- Edit information
- Delete the garment
- Return to the wardrobe

---

# Clothing Import Flow

```text
Wardrobe
    ↓
Add Garment
    ↓
Choose Import Method

• Upload on this device
• Upload from phone
```

The local-device choice opens the established image and metadata form. The
phone choice creates a short-lived local session and displays its QR code,
readable network URL, expiry countdown, cancel, and regenerate controls.
Creation occurs only after a short loopback-side reachability check confirms
that the restricted LAN listener and compiled phone page are ready. If that
check fails, Muse shows a retryable local-network unavailable state and does
not issue a token.

Then:

```text
Select Image
    ↓
Process Image
    ↓
Preview
    ↓
Enter Garment Name
    ↓
Select Category
    ↓
Optional Details
    ↓
Save
    ↓
Garment Appears in Wardrobe
```

If image processing fails, the user must still be able to save the garment using the original image.

The phone branch is:

```text
Generate Local Session
    ↓
Scan QR Code on Phone
    ↓
Open Responsive Muse Page
    ↓
Select or Capture JPEG, PNG, or WebP
    ↓
Preview + Enter Required Metadata
    ↓
Upload through Secure Streaming Import
    ↓
Muse Shows Receiving then Processing
    ↓
Import Complete
    ↓
Wardrobe Refreshes and Opens Garment
```

The phone and Muse must remain on the same trusted local network. The mobile
page shows clear expired, already-used, cancelled, unavailable, unsupported
format, and retryable-failure states. Cancelling or generating a new code makes
the previous token unusable. A completed token cannot import another garment.
No cloud relay, public DNS, account, Internet connection, or external QR service
is involved.

---

# Outfit Builder Flow

```text
Home
    ↓
Outfit Builder
    ↓
Muse Silhouette
    ↓
Select or Cycle Garment
    ↓
Place Garment
```

The user can then:

- Move garments
- Resize garments
- Rotate garments
- Change layer order
- Remove garments
- Add more garments
- Keep several different garments in the same body zone

When finished:

```text
Save Outfit
    ↓
Enter or Confirm Outfit Name
    ↓
Generate Local Preview
    ↓
Saved
```

The current draft is held in one editor session and recovered from validated,
versioned session storage after a reload. Opening the Wardrobe to select a
garment preserves the draft through an explicit local round-trip marker,
including category changes, Clothing Details, and Add Garment. Opening Wardrobe
from Home has no such marker and begins a new outfit when the previous editor
state is clean. Failed saves keep every local edit available for a retry. When
an existing outfit is opened, the user may update it, save the edit as a new
outfit, restore the saved version, or delete it with confirmation.

---

# Saved Outfits Flow

```text
Home
    ↓
Saved Outfits
    ↓
Select Card from Three-Column Grid
    ↓
Outfit Builder
```

Available actions:

- Tap a card to reopen the exact saved outfit in Outfit Builder
- Update the existing outfit
- Save the edit as a new outfit
- Delete the outfit with confirmation
- Return to approximately the same grid position

The grid uses the saved local `600 × 750` WebP preview and a neutral fallback
if that file cannot be displayed. A fullscreen or long-press preview is an
optional later convenience and is not required to reopen or manage an outfit.

---

# Settings Flow

```text
Home
    ↓
Settings
```

Settings available in the MVP:

- W & N
- Display
- Data
- Device
- About Muse

The round Power control remains separate from those five sections. It opens
capability-aware display and device actions without exposing the underlying
operating system.

Settings should remain secondary and never interfere with the main wardrobe experience.

```text
Settings
    ├─ W & N → local/offline and phone-listener status
    ├─ Display → interface dimming, timeout, Reduced Motion
    ├─ Data → storage, backups, restore, cleanup, delete all
    ├─ Device → safe status and deployment capabilities
    ├─ About Muse → local-first product and license information
    └─ Power → Sleep Display or capability-aware unavailable actions
```

Every subsection Back action returns to Settings. Home returns directly to Home.
Already persisted preferences remain applied. The application-level sleep layer
wakes on touch, pointer, or keyboard input and preserves the current route.

## Backup and restore flow

```text
Data
    ↓
Create Backup
    ↓
Snapshot + checksum validation
    ↓
Backup listed locally
```

A replace restore requires explicit confirmation. The running application
validates and stages the archive, creates a safety backup, and reports that a
restart is required. It does not claim that live data changed. P7 service
coordination will stop both listeners, invoke the offline activation command,
and restart Muse. After activation, readiness and SQLite/media reconciliation
must succeed before Home appears.

Delete all data uses two visual confirmations plus the exact typed phrase. The
backend additionally requires acknowledgement that local backups are removed.
Activation is offline for the same two-listener safety reason and recreates an
empty migrated data layout without deleting the application.

---

# Navigation Rules

- The user must always know where they are.
- The user must always know how to go back.
- No important action should require more than two taps from the Home screen.
- All touch targets must be large enough for comfortable touchscreen interaction.
- Destructive actions must require confirmation.
- Hover interactions must never be required.

---

# Error Handling

When an action fails:

```text
Show Clear Error
        ↓
Explain What Happened
        ↓
Offer Retry
        ↓
Offer Cancel
```

The application must never leave the user on a broken or unusable screen.

---

# User Flow Principles

Every screen should immediately answer three questions:

1. Where am I?
2. What can I do here?
3. How do I go back?

If a screen cannot answer these questions within a few seconds, it should be redesigned.

---

# Design Philosophy

Muse should feel calm, premium, and effortless.

The interface should never feel technical or overwhelming.

Every interaction should be intentional, smooth, and focused on helping the user organize and plan outfits with the least amount of effort.
