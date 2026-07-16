# MVP Scope

## Goal

The goal of the Build Week MVP is to deliver a polished, reliable, and visually impressive product experience.

Muse should feel like a real consumer product rather than a technical prototype.

---

# Included Features

## Wardrobe

- Clothing library
- Categories
- Clothing details

## Outfit Builder

- Muse silhouette
- Add, remove, and cycle local wardrobe garments
- Direct and command-based manual placement
- One proportional scale value and rotation per placement
- Deterministic layer ordering, including overlapping garments
- Local generated outfit preview
- Create, reopen, update, save as new, and soft-delete outfits
- Recover the current editor draft during the browser session

## Import

- QR code
- Phone upload
- Local image import
- Background removal
- Manual categorization

Local-device import was implemented before the completed phone QR flow. Phone
upload is short-lived, single-use, and available only through a restricted
listener on the trusted local network; the complete Muse API remains loopback
only. Search, arbitrary filters, and favorites are not part of the current MVP;
category navigation is the Wardrobe's only collection refinement.

## Storage

- SQLite database
- Local image storage
- Saved outfits in the approved three-column grid
- Immutable local `600 × 750` preview WebP files

## Settings and startup

- Approved five-card Settings layout: W & N, Display, Data, Device, About Muse
- Persisted interface dimming, screen timeout, and Reduced Motion preferences
- Safe local storage summary, backup creation, archive validation, staged restore,
  and guarded data reset
- Capability-aware network, device, and power information without privileged
  command execution
- Branded Splash sequence integrated with real backend readiness and a
  reduced-motion recovery path
- Consistent loading, offline, empty, error, success, and destructive states

## Device

- Raspberry Pi-compatible software and narrow platform-capability contracts
- Touchscreen interface at `1280 × 800`
- Node-free production builds served by the loopback backend

Physical systemd installation, Chromium kiosk installation, display/touch
calibration, privileged restart/shutdown activation, and hardware performance
acceptance belong to P7. P6 must report these capabilities honestly as requiring
deployment configuration rather than simulating success.

---

# Explicitly Out of Scope

These features will NOT be implemented during Build Week.

- AI outfit recommendations
- Cloud synchronization
- Multiple user accounts
- Marketplace integration
- Automatic web scraping
- Weather integration
- Calendar integration
- Native mobile applications
- Social features
- Photorealistic virtual try-on

---

# Success Criteria

The MVP is considered successful if a user can:

1. Launch Muse.
2. Import clothing.
3. Browse the wardrobe.
4. Build an outfit.
5. Save the outfit.
6. Relaunch Muse and recover all saved data.
7. Experience the application through a polished touchscreen interface.
8. Inspect safe device and network status, change application display preferences,
   and create a verified local backup without Internet access.
9. Recover gracefully when startup readiness is delayed or unavailable.

Exact duplicate-outfit detection, automatic metadata detection, HEIC/HEIF
decoding, and a fullscreen or long-press Saved Outfit preview are optional
extensions, not MVP completion gates. Local-device import preceded phone QR
import. Background removal remains best-effort and local, with the original
image as the mandatory fallback.
