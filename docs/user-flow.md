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
Upload from Device
```

Phone upload through a QR code remains part of the intended final MVP, but it is
implemented after the complete local-device flow.

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

- Appearance
- Display
- Startup
- Data & Backup
- About Muse

Settings should remain secondary and never interfere with the main wardrobe experience.

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
