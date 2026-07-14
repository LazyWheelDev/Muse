# Outfit Builder Screen

## Purpose

The Outfit Builder is the central creative workspace of Muse.

It allows the user to combine garments from the local wardrobe, preview them together on the Muse silhouette, adjust their placement when necessary, and save the completed combination as an outfit.

---

## Approved Visual Reference

![Muse Outfit Builder Screen](../assets/ui/mockups/05-outfit-builder.png)

This mockup is the official visual reference for the Outfit Builder screen.

---

## Screen Summary

The Outfit Builder can be explained in one sentence:

> Combine garments and create a complete outfit.

This screen is the functional heart of Muse.

It must remain visual, intuitive, touch-friendly, and understandable without instructions.

---

## Header

The upper section contains:

- A `Home` button in the upper-left corner
- The page title `Outfit Builder` centered at the top
- A subtle champagne divider beneath the title

### Home Button

The Home button returns to the Home screen.

If the current outfit contains unsaved changes, Muse must display a confirmation dialog before leaving.

Suggested options:

```text
Save Outfit
Discard Changes
Cancel
```

---

## Main Layout

The screen is divided into three primary zones:

1. Commands panel on the left
2. Muse silhouette workspace in the center
3. Garment category controls on the right

Additional contextual actions appear beneath the main workspace.

The central silhouette remains the visual focus of the screen.

---

## Muse Silhouette

The central panel contains the Muse silhouette.

The silhouette must be:

- Minimal
- Elegant
- Recognizable
- Non-photorealistic
- Visually consistent with the Muse identity
- Suitable for layering garment images

The silhouette should resemble a refined fashion mannequin rather than a realistic human body.

It provides stable visual zones for:

- Head
- Top
- Pants
- Shoes

Future versions may support additional zones such as:

- Outerwear
- Dress
- Scarf
- Accessories
- Full body
- Legwear

These additional zones must not complicate the MVP.

---

## Garment Zones

Each main body zone displays one selected garment at a time.

Initial zones:

```text
Head
Top
Pants
Shoes
```

Each zone contains:

- Previous garment arrow
- Current garment preview
- Next garment arrow

The arrows cycle only through garments assigned to the corresponding category.

Example:

```text
Head arrows  → Hats and compatible head items
Top arrows   → Shirts, sweaters, jackets, and compatible tops
Pants arrows → Trousers, skirts, and compatible lower-body items
Shoes arrows → Shoes only
```

The user must never cycle into an unrelated garment category.

---

## Previous and Next Controls

Each garment zone includes visible left and right arrows.

### Previous

Selects the previous compatible garment in the current category.

### Next

Selects the next compatible garment in the current category.

### Behavior

When an arrow is pressed:

1. Muse selects the next or previous compatible garment.
2. The new garment appears smoothly.
3. The garment receives its saved or default transformation.
4. The outfit becomes unsaved.
5. The currently active garment becomes selectable for command adjustments.

The transition should feel immediate and smooth.

Recommended animation duration:

```text
180 to 260 ms
```

Swipe interaction may also be supported, but visible arrows must remain available.

---

## Empty Garment State

A body zone may contain no selected garment.

When empty:

- Keep the Muse silhouette visible
- Display no broken image
- Keep the previous and next controls available when compatible garments exist
- Allow category selection from the right panel

An optional neutral placeholder may indicate the empty zone.

The user must not be forced to select an item for every category.

---

## Category Controls

The right panel contains large rectangular category cards.

Initial categories:

- Head
- Top
- Pants
- Shoes

Each card contains:

- Category icon
- Category name
- Large touch area
- Muse card styling

---

## Opening a Category

When the user presses a category card:

1. Muse opens a wardrobe selection view for that category.
2. Only compatible garments are displayed.
3. The current Outfit Builder state remains preserved.
4. The user selects one garment.
5. Muse returns to Outfit Builder.
6. The selected garment appears in the correct body zone.

Example:

```text
Press Head
    ↓
Open Head wardrobe
    ↓
Select hat
    ↓
Return to Outfit Builder
    ↓
Hat appears in Head zone
```

The category selection view may use:

- Fullscreen grid
- Modal grid
- Wardrobe-style overlay

It must follow the established Wardrobe visual language.

---

## State Preservation During Category Selection

Opening a category must preserve:

- All currently selected garments
- Garment transformations
- Layer order
- Unsaved state
- Outfit name when already entered
- Current command selection
- Origin screen context

Selecting another garment must not reset the rest of the outfit.

---

## Commands Panel

The left panel contains manual garment adjustment controls.

The commands are secondary tools.

Most garments should appear in a reasonable default position automatically.

The command panel exists when manual refinement is needed.

---

## Active Garment

Commands apply only to the currently selected garment.

The active garment may be selected by:

- Touching it directly on the silhouette
- Selecting its body zone
- Changing it with a previous or next arrow
- Selecting it from a category grid

The active garment should receive a subtle selection indicator.

The indicator must not visually damage the outfit preview.

---

## Move Controls

Move controls use four directional buttons:

```text
Up
Left
Right
Down
```

Each press moves the active garment by a small predictable amount.

Press-and-hold may repeat movement gradually.

Movement must remain constrained to the visible workspace.

The garment must not become permanently lost outside the screen.

---

## Resize Controls

Resize controls contain:

```text
Decrease size
Increase size
```

The controls adjust the active garment proportionally by default.

The garment must preserve its aspect ratio unless an advanced adjustment mode is intentionally introduced later.

Minimum and maximum limits must prevent unusable sizes.

---

## Rotate Controls

Rotate controls contain:

```text
Rotate left
Rotate right
```

Each press rotates the active garment by a small fixed angle.

Recommended step:

```text
2 to 5 degrees
```

Rotation must remain smooth and reversible.

---

## Layer Controls

Layer controls allow the active garment to move:

```text
Forward
Backward
```

Layer controls are useful when garments overlap.

Examples:

- Jacket above shirt
- Scarf above top
- Shoes above trousers where appropriate

Muse must prevent invalid or confusing layer states where practical.

Default layer ordering should follow garment type.

---

## Automatic Placement

When a garment is added, Muse automatically assigns:

- Body zone
- Default position
- Default size
- Default rotation
- Default layer

Automatic placement must provide a usable starting point.

The user should not need to manually position every garment from zero.

Manual commands refine the result when necessary.

---

## Garment Transformation Data

Each garment placed in an outfit stores:

- Position X
- Position Y
- Scale
- Rotation
- Layer index
- Body zone

These values belong to the outfit instance.

Changing a garment inside one outfit must not modify its placement inside every other saved outfit.

---

## Wardrobe Return Button

A contextual `Wardrobe` button may appear in the lower-left corner.

It appears only when Outfit Builder was opened from:

- Wardrobe
- Clothing Details
- A Wardrobe selection flow

It does not appear when Outfit Builder was opened directly from Home.

### Behavior

When pressed:

- Return to the exact previous Wardrobe context
- Preserve the current unsaved outfit temporarily
- Preserve selected garments and transformations
- Preserve the previously selected Wardrobe category and garment

The user must be able to return to Outfit Builder without losing progress.

---

## Save Outfit Button

The large rectangular `Save Outfit` button appears beneath the central workspace.

It is the primary action on this screen.

When pressed:

1. Muse validates the current outfit.
2. Muse checks whether the exact outfit already exists.
3. The user enters or confirms an outfit name.
4. Muse saves all garments and transformations.
5. A preview image is generated.
6. The saved state is confirmed.

---

## Outfit Naming

When saving a new outfit, Muse asks for a name.

The name may be entered using:

- On-screen keyboard
- Connected physical keyboard
- Future phone-based input

Suggested default name:

```text
Look 01
```

The user may replace it with a custom name.

Examples:

```text
Casual Monday
Dinner Outfit
Summer Look
Black and Beige
```

---

## Duplicate Outfit Detection

Before saving, Muse compares the current composition with existing outfits.

The comparison should include:

- Selected garment identifiers
- Body-zone assignments
- Garment transformations
- Layer order

If an identical outfit already exists, Muse displays:

```text
This outfit is already saved.
```

Available actions:

```text
Open Existing Outfit
Save as a Copy
Cancel
```

Muse must not silently create unnecessary duplicates.

---

## Saved State

After a successful save:

- Display a clear confirmation
- Keep the outfit visible
- Mark the current composition as saved
- Store the outfit name and preview
- Make it immediately available in Saved Outfits

If the user modifies anything afterward:

```text
Saved → Unsaved changes
```

The Save Outfit control becomes active again.

---

## Editing an Existing Outfit

When an outfit is opened from Saved Outfits:

- Load all garments
- Load all transformations
- Load all layers
- Load the outfit name
- Mark the composition as saved

After a modification, the user may:

```text
Update Outfit
Save as New Outfit
Cancel Changes
```

Deleting an outfit may be available through an additional action or confirmation menu.

Deletion must not delete the clothing items themselves.

---

## Outfit Preview

Muse generates a preview image when saving.

The preview should show:

- Muse silhouette
- Selected garments
- Current transformations
- Current layer order
- Clean neutral background

The preview is used in the Saved Outfits screen.

Preview generation must work locally without Internet access.

---

## Loading State

While garment data is loading:

- Keep the silhouette visible
- Preserve the three-panel layout
- Display subtle placeholders
- Keep Home available
- Avoid blocking the whole screen unnecessarily

---

## Error State

If a garment fails to load:

- Keep the remaining outfit visible
- Display a neutral placeholder in the affected zone
- Offer Retry
- Offer Select Another Garment

If saving fails:

- Preserve the complete current outfit
- Display a clear error
- Offer Retry
- Never discard the user's work

Suggested message:

```text
Muse could not save this outfit.
Your current outfit has been preserved.
```

---

## Offline Behavior

All core Outfit Builder functionality must work without Internet access.

Offline functionality includes:

- Selecting garments
- Cycling through garments
- Opening local category views
- Moving garments
- Resizing garments
- Rotating garments
- Changing layers
- Saving outfits
- Loading saved outfits
- Generating previews

Internet access must never be required for outfit creation.

---

## Touch Interaction

The screen must support:

- Large category cards
- Large previous and next arrows
- Large command buttons
- Direct garment selection
- Clear pressed states
- No hover-dependent actions
- Comfortable spacing

Commands requiring repeated input may support press-and-hold.

Accidental touches must not delete or permanently modify data.

---

## Visual Rules

The Outfit Builder must use:

- Warm ivory background
- Large low-contrast background `M`
- Champagne accents
- Rounded ivory panels
- Soft warm shadows
- Dark primary text
- Consistent Playfair Display titles
- Consistent Inter interface text
- No dark theme
- No permanent bottom navigation
- No small mobile-style controls

The approved mockup and Muse design system are the visual sources of truth.

---

## Accessibility

The screen must provide:

- Large touch targets
- Visible active garment state
- Accessible labels for every command
- Keyboard alternatives during development
- Reduced-motion support
- Clear saved and unsaved states
- Visible focus indicators
- Predictable command behavior

Suggested accessible labels:

```text
Return to Home
Previous head item
Next head item
Previous top
Next top
Previous pants
Next pants
Previous shoes
Next shoes
Open Head wardrobe
Open Top wardrobe
Open Pants wardrobe
Open Shoes wardrobe
Move garment up
Move garment down
Move garment left
Move garment right
Decrease garment size
Increase garment size
Rotate garment left
Rotate garment right
Move garment forward
Move garment backward
Save outfit
Return to Wardrobe
```

---

## Responsive Behavior

Primary target:

```text
1280 × 800 landscape touchscreen
```

At the target resolution:

- Commands panel remains visible
- Silhouette remains large
- Category controls remain visible
- Save Outfit remains easy to reach
- No horizontal page scrolling occurs

On smaller development screens:

- Panels may reduce proportionally
- Vertical scrolling may be allowed
- The central workspace must remain usable
- Touch targets must not become too small

Portrait mode is outside the MVP scope.

---

## Performance

The Outfit Builder must remain smooth on Raspberry Pi hardware.

Targets:

- Immediate category response
- Smooth garment transitions
- Smooth transformation updates
- No visible full-page reload
- No network dependency
- Efficient local image rendering

Large garment images should use optimized processed versions while preserving originals separately.

---

## Implementation Guidance

Suggested component structure:

```text
OutfitBuilderPage
├── PageHeader
│   ├── HomeButton
│   └── PageTitle
├── OutfitBuilderLayout
│   ├── CommandPanel
│   │   ├── MoveControls
│   │   ├── ResizeControls
│   │   ├── RotateControls
│   │   └── LayerControls
│   ├── OutfitWorkspace
│   │   ├── MuseSilhouette
│   │   ├── GarmentZone
│   │   ├── PreviousNextControls
│   │   └── ActiveGarmentIndicator
│   └── CategoryControlPanel
│       └── CategoryCard
├── ContextualWardrobeButton
├── SaveOutfitButton
├── OutfitNameDialog
├── DuplicateOutfitDialog
├── UnsavedChangesDialog
└── BackgroundMonogram
```

Possible route:

```text
/outfit-builder
```

Optional navigation state:

```text
origin
garmentId
outfitId
selectedCategory
returnPath
```

---

## Definition of Done

The Outfit Builder is complete when:

- The layout matches the approved mockup.
- The Muse silhouette renders correctly.
- Each category cycles only through compatible garments.
- Category cards open filtered garment selection views.
- Selecting a garment preserves the rest of the outfit.
- Manual movement works.
- Resize works.
- Rotation works.
- Layer controls work.
- Automatic placement provides a usable default.
- The Wardrobe return button appears only in the correct context.
- Saving stores garments and transformations.
- Duplicate outfits are detected.
- Saved outfits can be reopened and edited.
- Preview images are generated locally.
- Unsaved work is protected.
- The complete workflow works without Internet access.
- Performance remains smooth on Raspberry Pi.