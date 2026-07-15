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
8. completion or fallback of optional image processing.

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

Inspect browser requests while scrolling the grid. Cards should request
thumbnails, not every original file. Reopening an unchanged garment must not
regenerate derivatives.

## Offline operation

Disconnect Ethernet and Wi-Fi without disabling loopback, restart Muse, and
repeat import, Wardrobe, Details edit, reload, and soft delete. Confirm:

- local fonts, icons, images, the API, and the SPA still work;
- no required request targets a non-loopback origin;
- no background-removal model download is attempted; and
- existing data remains available after another restart.

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

Never automate hard power cuts against irreplaceable storage.

## Touchscreen and kiosk acceptance

At `1280 × 800`, verify Wardrobe, Add Garment, Details, dialogs, grid, and
fullscreen image mode with touch and a keyboard:

- no page-level horizontal overflow;
- all essential controls have at least `56 × 56 px` targets;
- focus is visible and dialog focus is contained and restored;
- previous/next buttons provide an alternative to swipe;
- destructive actions require explicit confirmation;
- reduced-motion mode preserves all functionality;
- long metadata and validation messages remain readable; and
- kiosk reload, direct route navigation, and browser Back preserve context.

## Result record

Record pass/fail, measurements, logs, screenshots, and any throttling for each
section. A release is not Pi-validated until this procedure has been run on the
actual target hardware; CI and development-machine measurements should be
reported separately.
