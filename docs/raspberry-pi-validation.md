# Raspberry Pi 5 validation

This procedure validates Muse on the target Raspberry Pi 5 hardware. Results
from a development laptop are useful for regression tracking, but they are not
substitutes for this hardware run.

## Target environment

- Raspberry Pi 5 with 8 GB RAM
- 64-bit Raspberry Pi OS
- the intended touchscreen at `1280 × 800`
- the intended SD card or NVMe storage
- system Chromium in kiosk mode
- one FastAPI/Uvicorn worker managed by systemd
- a production frontend build served by FastAPI
- the locked Python 3.13 environment

Record the Muse commit, OS image, kernel, Python, Chromium, storage model, and
whether active cooling is fitted before beginning.

## Prepare a representative data set

Use a disposable copy of the production configuration. Import at least 60
garments across every category, including JPEG, PNG, and WebP sources. Include:

- portrait and landscape photographs;
- EXIF-rotated JPEG files;
- images with and without transparency;
- files close to the configured upload limit; and
- enough garments to exercise several grid scroll lengths.

Create at least 60 saved outfits so the approved three-column grid spans several
rows. Include outfits with 1, 5, and 20 placements, several distinct garments
overlapping in one body zone, rotations near both limits, minimum and maximum
practical scales, and changed layer order. Soft-delete at least one garment only
after an outfit references it, and soft-delete at least one outfit so preview
ownership and retained-reference behavior can be checked.

Do not use the only copy of personal wardrobe data for destructive or power-loss
testing.

## Baseline checks

Run these commands on the Pi and retain their output with the test record:

```bash
uname -a
python3 --version
chromium --version
vcgencmd get_throttled
vcgencmd measure_temp
systemctl status muse --no-pager
curl --fail --show-error http://127.0.0.1:8000/api/v1/health
curl --fail --show-error http://127.0.0.1:8000/api/v1/readiness
```

Run the database checks against the configured data root:

```bash
sqlite3 /var/lib/muse/muse.sqlite3 'PRAGMA quick_check; PRAGMA foreign_key_check;'
```

`quick_check` must return `ok`; `foreign_key_check` must return no rows.

## Timed user flows

Measure five cold starts and five warm repetitions. Record median and slowest
results for:

1. systemd service start to readiness;
2. Chromium launch to visible Wardrobe content;
3. first Wardrobe render with 60 or more garments;
4. category change;
5. grid-to-Details navigation;
6. metadata save;
7. import acknowledgement; and
8. completion or fallback of optional image processing;
9. opening Outfit Builder and first usable Canvas render;
10. command movement and direct drag response with 20 placements;
11. create save through the `600 × 750` local preview response;
12. placement-changing update and preview replacement;
13. name-only update with preview reuse; and
14. first Saved Outfits render and vertical scroll with 60 or more outfits.

Use Chromium DevTools only for a diagnostic rerun because it changes memory and
timing. For service timing, capture monotonic timestamps around readiness polls.

## Resource and responsiveness checks

During idle, grid scrolling, import, and background processing, record:

```bash
ps -C muse-backend -o pid,pcpu,rss,vsz,etime,cmd
ps -C chromium -o pid,pcpu,rss,vsz,etime,cmd
vcgencmd measure_temp
vcgencmd get_throttled
df -h /var/lib/muse
du -sh /var/lib/muse
```

While one garment is processing, repeatedly open Wardrobe, switch categories,
open Details, and call health/readiness. The UI must stay usable and API reads
must not wait for the image processor to finish. Confirm only one image-processing
job runs at a time and that memory does not grow with queued garments.

While saving a 20-placement outfit preview, continue calling health, readiness,
and outfit collection endpoints from another process. Record backend and
Chromium peak RSS, CPU, temperature, throttling, preview wall time, response
latency, and output size. Repeat a placement-changing update and confirm the old
preview disappears only after the new row and preview are durable. Confirm a
name-only update reuses the same preview path.

Inspect browser requests while scrolling the grid. Cards should request
thumbnails, not every original file. Reopening an unchanged garment must not
regenerate derivatives.

Inspect Saved Outfits requests separately. Cards should request generated
preview WebP files, should not fetch every source garment image, and should not
regenerate previews on page open. The first visible cards should load promptly;
later rows may lazy-load. Record dropped frames or visible stalls while
scrolling.

## Offline operation

Disconnect Ethernet and Wi-Fi without disabling loopback, restart Muse, and
repeat import, Wardrobe, Details edit, reload, and soft delete. Confirm:

- local fonts, icons, images, the API, and the SPA still work;
- no required request targets a non-loopback origin;
- no background-removal model download is attempted; and
- existing data remains available after another restart.

Also create, update, save as new, reopen, and delete an outfit while offline.
Reload Chromium with an unsaved Builder draft and confirm the validated session
record recovers its name, placements, active garment, layer order, and saved
baseline. Reopen Saved Outfits and confirm every card uses only loopback/local
assets and a missing preview falls back without making the outfit inaccessible.

## Recovery and interruption

Use disposable data for these tests.

1. Cancel an upload from Chromium and verify the temporary upload tree is clean.
2. Stop the service during optional processing, restart it, and verify the item
   reaches a terminal processing or fallback state.
3. Send `SIGKILL` during repeated imports at different phases, restart, then
   check readiness, database integrity, temporary files, import manifests, and
   visible garments.
4. Perform controlled hard-power interruptions during import and metadata save.
   After every reboot, run `quick_check` and `foreign_key_check`, compare garment
   and media counts, and verify every visible image can be opened.
5. Verify an acknowledged garment always has its exact original plus usable
   normalized and thumbnail records. Optional cutout loss must never make the
   garment unavailable.
6. Send `SIGKILL` during preview render, manifest write, promotion, and the
   database ownership transaction. After each restart, confirm the previous
   outfit/preview or the complete new outfit/preview is visible, never a partial
   update.
7. Inject an unwritable preview destination and a failed database update. A
   failed create must leave no outfit row or registered preview; a failed update
   must preserve the previous row, placements, and preview path.
8. Interrupt cleanup after a successful placement update, restart, and confirm
   manifest reconciliation removes the superseded unregistered preview while
   preserving every registered preview.
9. Soft-delete an outfit, restart, and confirm its registered preview remains an
   owner-protected file. Confirm orphan cleanup never treats a soft-deleted row
   as unowned.

Never automate hard power cuts against irreplaceable storage.

## Touchscreen and kiosk acceptance

At `1280 × 800`, verify Wardrobe, Add Garment, Details, Outfit Builder, Saved
Outfits, dialogs, grid, and fullscreen garment-image mode with touch and a
keyboard:

- no page-level horizontal overflow;
- all essential controls have at least `56 × 56 px` targets;
- focus is visible and dialog focus is contained and restored;
- previous/next buttons provide an alternative to swipe;
- destructive actions require explicit confirmation;
- reduced-motion mode preserves all functionality;
- long metadata and validation messages remain readable; and
- kiosk reload, direct route navigation, and browser Back preserve context.

For Outfit Builder, verify direct Canvas selection and drag, every semantic move,
scale, rotate, layer, reset, remove, clear, save, update, save-as-new, cancel,
and delete control. Confirm several garments can overlap in one body zone, the
topmost opaque garment is selected, no placement can be lost permanently beyond
the workspace, and pointer movement does not issue API mutations.

For Saved Outfits, confirm exactly three card columns at the target viewport,
internal vertical scrolling, no page-level horizontal overflow, neutral missing
preview fallback, correct newest-updated order, direct card-to-Builder routing,
and approximate grid-position restoration. Long press and fullscreen outfit
preview are optional and should not be recorded as failures when absent.

## Current non-Pi evidence and remaining status

On 2026-07-15 the production frontend and same-origin backend were measured on
an Apple M4 (`arm64`) development machine with Python 3.13.14 and headless
Chromium at `1280 × 800`:

- 20-placement create and changed-placement update medians were `322.813 ms`
  and `324.916 ms`; name-only and unchanged-placement medians were `4.774 ms`
  and `9.921 ms` with preview reuse.
- Health and outfit-list p95 latency stayed at `1.697 ms` and `2.410 ms` across
  50 concurrent requests each during a preview update, with no failed response.
- A warmed 60-outfit list had a `1.154 ms` median. Scrolling the complete
  three-column grid requested 60 local previews and 6,238,310 preview bytes,
  with no original-garment or external request.
- A 60-event direct drag caused 60 Canvas redraws, no network request, no API
  mutation, and no long task over 50 ms. Animation-frame intervals had a
  `10.8 ms` median and `26.3 ms` p95 under the Playwright harness.

A lower-level warmed renderer benchmark of 20 placements using one repeated
synthetic `800 × 1200` WebP had a `0.2334 s` median and `0.2383 s` maximum and
produced a 40,034-byte lossless preview. These results are useful only as
development regression baselines. Native browser lazy loading requested 27 of
60 previews initially, so full-grid transfer, decode, and scroll behavior need
particular attention on the target device.

No Raspberry Pi result is recorded yet. All timing, responsiveness, memory,
temperature, throttling, touch, storage, systemd, kiosk, and interruption checks
in this document remain open until executed on the specified device.

## Result record

Record pass/fail, measurements, logs, screenshots, and any throttling for each
section. A release is not Pi-validated until this procedure has been run on the
actual target hardware; CI and development-machine measurements should be
reported separately.
