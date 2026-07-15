# Muse Design System

## Purpose

This document defines the global visual and interaction rules for Muse.

Every screen, component, animation, and future feature must follow this design system so the product remains coherent, recognizable, touch-friendly, and simple to use.

Muse must feel like a dedicated premium household product, not a conventional website or desktop application.

---

## Design Direction

Muse is defined by:

- Warm minimalism
- Premium simplicity
- Clear interaction
- Large touch targets
- Soft depth
- Calm visual hierarchy
- Invisible technology
- Consistent navigation
- Offline-first reliability

The interface must feel elegant without becoming decorative or complicated.

Every element must have a clear purpose.

---

## Core Design Principles

### Function First

Every visible component must help the user understand or complete an action.

Unnecessary elements must not be added.

### Touch First

Muse is designed primarily for a touchscreen.

The interface must never require precise mouse movement, hover interactions, or very small controls.

### Instant Understanding

Every screen should immediately answer:

1. Where am I?
2. What can I do here?
3. How do I return?

### Premium Simplicity

Muse should feel refined through proportion, spacing, typography, and subtle depth.

It must not rely on excessive visual effects.

### Consistency

The same type of action must always use the same visual language throughout the application.

### Product Before Technology

The operating system, browser, terminal, and technical infrastructure must remain invisible to the user.

---

## Color Palette

### Core Colors

| Token           |     Value | Usage                                 |
| --------------- | --------: | ------------------------------------- |
| Background      | `#F6EFE5` | Main application background           |
| Background Soft | `#FBF6EE` | Lighter page areas                    |
| Surface         | `#FFF9F1` | Cards, buttons, panels                |
| Surface Muted   | `#F1E6D7` | Secondary surfaces and icon circles   |
| Border          | `#E2D3BF` | Subtle component borders              |
| Champagne       | `#C9A66B` | Main accent, icons, highlights        |
| Champagne Dark  | `#A98249` | Pressed states and stronger accents   |
| Primary Text    | `#302E2A` | Titles and primary content            |
| Secondary Text  | `#756F66` | Descriptions and secondary labels     |
| Muted Text      | `#A49B90` | Placeholders and inactive information |

### Status Colors

| Status   |     Value | Usage                              |
| -------- | --------: | ---------------------------------- |
| Success  | `#4F7D45` | Saved states and completed actions |
| Warning  | `#A77937` | Unsaved changes or attention       |
| Danger   | `#A55650` | Delete actions and errors          |
| Disabled | `#C8BFB4` | Inactive controls                  |

Status colors must be used sparingly.

The champagne accent remains the dominant product color.

---

## Background Identity

Every primary Muse screen uses:

- A warm ivory or beige background
- A very large, low-contrast `M` watermark
- The watermark centered or extended beyond the screen edges
- Extremely low opacity so it never reduces readability

The large `M` is part of the identity of Muse and should remain visually consistent across all major screens.

It must never compete with the content.

---

## Typography

### Display Typeface

Use **Playfair Display** for:

- Page titles
- The Muse wordmark
- Large section labels
- Important outfit and garment names when appropriate

### Interface Typeface

Use **Inter** for:

- Buttons
- Form values
- Descriptions
- Settings
- Status messages
- Technical information

### Typography Rules

- Page titles must be clearly visible and centered.
- Body text must remain highly readable.
- Text must never be unnecessarily small.
- Long text blocks should be avoided.
- Important controls should use direct and understandable labels.
- Decorative typography must never reduce usability.

---

## Page Header

Most primary screens use the following structure:

- Navigation action in the upper-left corner
- Page title centered at the top
- Optional contextual action in the upper-right corner
- A small champagne divider beneath the title

Examples:

- `Home`
- `Back`
- `Saved Outfits`
- `Saved`

The header layout must remain stable across screens.

---

## Cards and Panels

### Standard Card

Cards use:

- Warm white or ivory surfaces
- Large rounded corners
- Thin beige borders
- Soft, diffused shadows
- Generous internal spacing
- No harsh outlines
- No dark surfaces

### Card Behavior

Interactive cards must:

- React visibly when pressed
- Use a subtle scale or shadow change
- Remain readable in every state
- Provide a large touch area
- Avoid hover-only feedback

### Card Hierarchy

Larger cards represent:

- Primary sections
- Clothing previews
- Saved outfits
- Major settings categories

Smaller cards represent:

- Categories
- Secondary controls
- Individual commands

---

## Buttons

### Round Buttons

Round buttons are reserved for quick or local actions.

Examples:

- Information
- Edit
- Delete
- Fullscreen
- Grid view
- Move
- Rotate
- Resize
- Layer control
- Previous and next item

Round buttons should contain a clear icon and may include a short label beneath them.

### Rectangular Buttons

Rectangular buttons are reserved for:

- Navigation
- Primary actions
- Major confirmations

Examples:

- Add Garment
- Open in Outfit Builder
- Save Outfit
- Wardrobe
- Home
- Saved Outfits

### Button Rules

- Minimum touch target: `56 × 56 px`
- Primary rectangular buttons should be visually dominant
- Destructive actions must use danger styling or confirmation
- Disabled buttons must remain visible but clearly inactive
- Buttons must not depend on hover states
- Text and icons must remain centered and balanced

---

## Icons

Icons must use:

- Thin, elegant outlines
- Rounded line endings where possible
- Champagne or muted brown coloring
- Consistent line weight
- Simple recognizable shapes

Icons must never become overly detailed.

Common icon categories include:

- Home
- Wardrobe
- Mannequin
- Clothing
- Saved outfit
- Settings
- Information
- Edit
- Delete
- Fullscreen
- Grid
- Wi-Fi
- Display
- Storage
- Device
- Power

---

## Touch Interaction

Muse is designed for fingers rather than precise pointer input.

### Interaction Rules

- Touch targets must be large and well-spaced.
- Important controls must not be placed too close together.
- No essential action may require hovering.
- Swipe gestures must have visible alternatives where practical.
- Long-press interactions may provide optional previews, but must not be the only way to access an essential function.
- Destructive actions must require confirmation.
- The interface must remain usable for people with limited dexterity.

---

## Navigation Rules

- Home provides access to all four primary sections.
- Primary screens use a visible Home or Back button.
- Navigation must remain predictable.
- The user should never be trapped inside a screen.
- Contextual return buttons may appear only when relevant.
- The interface must preserve the user's current state when temporarily opening another view.

Example:

If the user opens Wardrobe from Outfit Builder to select a garment, returning to Outfit Builder must preserve the current outfit.

---

## Layout

### Target Display

Primary target:

- Landscape touchscreen
- Approximately `1280 × 800`
- Raspberry Pi device

### Layout Rules

- Content must remain comfortable at the target resolution.
- Primary screens should use clear visual zones.
- Important content should not touch screen edges.
- Panels must have generous spacing.
- The layout should remain balanced even when some content is missing.
- Vertical scrolling is allowed when necessary.
- Horizontal scrolling should only be used for deliberate carousels.

---

## Spacing

Use a consistent spacing system based on multiples of eight.

Recommended values:

- `8 px` for very small internal gaps
- `16 px` for related elements
- `24 px` for standard component spacing
- `32 px` for sections
- `48 px` or more between major visual zones

Screens must feel spacious, not empty.

---

## Shadows and Depth

Muse uses soft depth rather than strong contrast.

Recommended shadow character:

- Large blur
- Low opacity
- Warm neutral tone
- Minimal vertical offset

Avoid:

- Hard black shadows
- Heavy glass effects
- Neon glows
- Strong gradients
- Excessive transparency

Subtle glass-like depth may be used only when it remains readable and consistent with the warm Muse palette.

---

## Images

Garment and outfit imagery should:

- Use clean backgrounds where possible
- Preserve the garment's real proportions
- Avoid unnecessary cropping
- Remain centered
- Use consistent preview areas
- Support fullscreen viewing
- Support carousel indicators when multiple images exist

The original image must remain available when automated processing fails.

---

## Information Structure

Clothing details are divided into two groups.

### Primary Information

- Name
- Category
- Brand
- Size
- Color

### Additional Information

- Material
- Season
- Purchase price
- Purchase date
- Notes
- Future optional metadata

This separation must remain visually clear but subtle.

---

## Status States

### Saved

Use:

- Green outline or green icon
- Clear `Saved` label
- No excessive animation

### Unsaved Changes

Use:

- Warm warning color
- Clear `Unsaved changes` label
- Visible save action

### Error

Use:

- Clear description
- Retry or cancel action
- Danger color used only where necessary

### Loading

Use:

- Soft progress indication
- Skeleton or subtle animation
- No visually aggressive spinner

### Empty State

Empty screens must explain:

- Why no content exists
- What the user can do next

---

## Animation and Motion

Animations must support understanding rather than decoration.

### General Motion

- Recommended duration: `180–280 ms`
- Use smooth ease-out transitions
- Avoid bouncing or exaggerated movement
- Cards may gently rise or scale when pressed
- Screen transitions should feel calm
- Garments should move smoothly when changed

### Reduced Motion

Muse should support a reduced-motion setting where possible.

Essential functionality must remain fully usable without animation.

---

## Splash Animation

The Splash Screen is the main exception to the restrained motion rule.

Sequence:

1. A champagne-colored droplet appears at the top center.
2. The droplet falls toward a recessed `M`.
3. A fading liquid trail follows the droplet.
4. The droplet reaches the `M` and fills its shape.
5. The completed golden `M` appears.
6. The letters `U`, `S`, and `E` enter individually from outside the screen.
7. Each arriving letter gently pushes the word until `Muse` becomes centered.
8. A panel-like reveal displays the tagline:
   `Your wardrobe, reimagined.`
9. The complete composition remains visible briefly.
10. The composition compresses toward the center.
11. The screen transitions momentarily to black.
12. The large background `M` opens into the Home screen.
13. Home cards appear smoothly.

The complete animation must feel premium and deliberate.

It must not delay access unnecessarily.

Recommended total duration:

- Approximately `2.5–4 seconds`
- Skippable after the first launch if needed
- Reduced or disabled through accessibility preferences

---

## Connectivity

Muse is offline-first, not permanently offline.

Core wardrobe functions must work without Internet access.

Internet connectivity may support:

- Phone uploads over the local network
- Software updates
- Future retailer integrations
- Optional product lookup
- Future barcode or web search features

Loss of Internet access must never block:

- Browsing garments
- Building outfits
- Saving outfits
- Viewing saved data
- Using the touchscreen interface

---

## Accessibility

Muse should support:

- Large text
- Large touch areas
- Strong readable contrast
- Visible focus indicators
- Keyboard navigation during development
- Reduced motion where possible
- Clear error messages
- Confirmation before destructive actions
- Interfaces usable with limited dexterity

Accessibility is part of the product design, not an optional addition.

---

## Consistency Rules

Every screen must follow these rules:

- Warm beige and ivory theme
- Champagne accent
- Large background `M`
- Centered page title
- Soft cards and shadows
- Large touch controls
- Round buttons for quick actions
- Rectangular buttons for navigation and primary actions
- Clear Home or Back navigation
- No unnecessary visual clutter
- No unexpected dark theme
- No feature that breaks the established visual language

---

## Design Review Checklist

Before approving a new screen, verify:

- Does it clearly belong to Muse?
- Does it use the correct color palette?
- Is the large background `M` present where appropriate?
- Is the page title correctly positioned?
- Are touch targets sufficiently large?
- Are quick actions round?
- Are navigation and primary actions rectangular?
- Is the hierarchy immediately understandable?
- Can the screen be explained in one sentence?
- Can a first-time user understand it without instructions?
- Does the screen remain usable without Internet access?
- Does it avoid unnecessary complexity?

If any answer is no, the screen must be revised before implementation.
