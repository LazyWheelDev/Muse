# Raspberry Pi operator runbook

This is tomorrow's end-to-end physical deployment sequence. It intentionally
starts with discovery and contains stop points. Replace values in angle brackets
only after observing them. Do not run display-changing commands until the
connected hardware reports the intended mode and touch device.

## 1. Connect and power the hardware

1. Keep Pi power disconnected.
2. Connect the 1280 × 800 display's HDMI cable to the intended Pi output.
3. Connect the display's USB touch/data cable, not only its power cable.
4. Connect keyboard and network recovery access if available.
5. Power the display, then the Raspberry Pi.
6. Confirm that firmware/boot video is visible and not cropped.
7. Confirm that the desktop appears before attempting kiosk setup.

**Checkpoint A:** stop if there is no video, unstable power, no desktop, or an
obvious cooling problem. Resolve hardware wiring without editing Muse or boot
configuration.

## 2. Record baseline discovery over SSH

From the Mac:

```bash
ssh kyle@muse.local
```

On the Pi, record non-destructive facts:

```bash
date --iso-8601=seconds
uname -a
uname -m
cat /etc/os-release
tr -d '\0' </proc/device-tree/model; echo
free -h
df -hT
findmnt -no SOURCE,FSTYPE,OPTIONS /
python3 --version || true
python3.13 --version || true
uv --version || true
command -v chromium chromium-browser || true
chromium --version 2>/dev/null || chromium-browser --version 2>/dev/null || true
loginctl list-sessions
loginctl show-session "$(loginctl list-sessions --no-legend | awk -v u="$USER" '$3==u {print $1; exit}')" \
  -p Type -p Class -p State -p Remote -p Display
find /sys/class/drm -maxdepth 2 -name status -print -exec sh -c 'cat "$1"; test ! -f "${1%status}modes" || cat "${1%status}modes"' _ {} \;
grep -E '^(N: Name|H: Handlers)' /proc/bus/input/devices
command -v libinput >/dev/null && sudo libinput list-devices || true
command -v kmsprint >/dev/null && sudo kmsprint || true
command -v wlr-randr >/dev/null && wlr-randr || true
command -v xrandr >/dev/null && xrandr --current --verbose || true
for fb in /sys/class/graphics/fb*; do
  printf '%s: ' "$fb"
  cat "$fb/virtual_size" "$fb/mode" 2>/dev/null || true
done
vcgencmd measure_temp 2>/dev/null || cat /sys/class/thermal/thermal_zone0/temp
vcgencmd get_throttled 2>/dev/null || true
ip -j route show default
ip -j -4 address show scope global
ss -ltnp
```

Touch each corner on the desktop or a safe input test surface. Record which DRM
connector, display mode, refresh rate, input device, desktop session, and
interface are actually active. Do not assume `wlan0`, X11, Wayland, HDMI-A-1,
or a touch product name.

**Checkpoint B:** stop and review the saved output. Continue only when Linux is
64-bit AArch64, the intended display is connected, USB touch is detected, and
there is adequate free space. If Python 3.13, uv 0.11.28, Chromium, iproute2,
sudo, systemd, or the appropriate session tools are missing, review the actual
OS repositories and obtain explicit approval before installing prerequisites.
Do not add an arbitrary Python repository automatically.

## 3. Confirm prerequisites without changing the OS

```bash
apt-cache policy python3.13 python3.13-venv chromium chromium-browser \
  iproute2 sqlite3 avahi-daemon unclutter
systemctl --version
systemd-analyze --version
```

If packages must be installed, write down the exact package names from this OS
release and obtain operator approval. Installation is outside the automated Muse
installer. After approved prerequisite work, rerun Section 2.

**Checkpoint C:** the exact Python interpreter must report `3.13.x`; `uv
--version` must report `0.11.28`; Chromium must have one detected executable.

## 4. Build the release on the Mac

Exit the SSH session. From the Muse repository on the Mac:

```bash
git status --short
git branch --show-current
git fetch --prune origin main
git rev-parse HEAD
git rev-parse origin/main
./kiosk/build-release.sh
```

The first command must be empty and both commit IDs must match unless a reviewed
new local deployment commit is intentionally selected. Copy the exact archive
path printed by the build:

```bash
ARCHIVE='<exact absolute archive path printed above>'
UV_PROJECT_ENVIRONMENT=venv uv run --project backend \
  python kiosk/lib/release.py verify-archive "$ARCHIVE" >/dev/null
```

**Checkpoint D:** stop if either Vite build, manifest validation, checksum
validation, or clean-tree check fails. Do not transfer a partial release.

## 5. Dry-run and install

Still on the Mac:

```bash
./kiosk/deploy.sh --host muse.local --user kyle --release "$ARCHIVE" --dry-run
```

This performs no SSH or device change. Review the release ID and target. Then,
with the Pi powered, connected, and checkpoints approved:

```bash
./kiosk/deploy.sh --host muse.local --user kyle --release "$ARCHIVE"
```

Enter sudo authentication only in the remote prompt. Do not interrupt migration
or readiness verification.

**Checkpoint E:** stop on any installer error. Do not manually repoint
`/opt/muse/current`, delete `/var/lib/muse`, or downgrade the database. Preserve
the displayed failure and journal output.

## 6. Verify services and security boundaries

Reconnect:

```bash
ssh kyle@muse.local
sudo /opt/muse/current/kiosk/muse-ctl status
sudo /opt/muse/current/kiosk/muse-ctl readiness
sudo /opt/muse/current/kiosk/muse-ctl network-verify
sudo systemd-analyze verify /etc/systemd/system/muse-*.service /etc/systemd/system/muse-*.timer
sudo systemd-analyze security muse-main.service muse-phone-upload.service muse-prepare.service
sudo /opt/muse/current/.venv/bin/python /opt/muse/current/kiosk/muse-doctor \
  --full --output /tmp/muse-device-discovery.json
```

Confirm:

- main readiness is HTTP 200;
- port 8000 is exactly `127.0.0.1`;
- port 8787 is absent when no private address exists, or bound to exactly the
  discovered private IPv4;
- restricted core paths all return 404;
- `/var/lib/muse` is private and database checks pass;
- the active release and commit match the built manifest;
- no hardening directive is rejected by the target systemd version.

**Checkpoint F:** do not continue to physical acceptance if the main API is on
`0.0.0.0`, database integrity fails, permissions are broad, or the restricted
listener exposes a core route.

## 7. Confirm kiosk, resolution, touch, and session integration

```bash
sudo systemctl status 'muse-kiosk@kyle.service' --no-pager
sudo systemctl show 'muse-kiosk@kyle.service' \
  --property=User --property=MainPID --property=Environment --no-pager
sudo systemctl cat 'muse-kiosk@kyle.service'
sudo stat -c '%U:%G %a %n' \
  /var/lib/muse-kiosk/kyle \
  /var/lib/muse-kiosk/kyle/config \
  /var/lib/muse-kiosk/kyle/cache \
  /var/lib/muse-kiosk/kyle/data \
  /var/lib/muse-kiosk/kyle/chromium
KIOSK_PID="$(sudo systemctl show 'muse-kiosk@kyle.service' --property=MainPID --value)"
sudo sh -c 'tr "\0" "\n" < "/proc/$1/environ"' sh "$KIOSK_PID" | \
  grep -E '^(HOME|XDG_CONFIG_HOME|XDG_CACHE_HOME|XDG_DATA_HOME|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS|WAYLAND_DISPLAY|DISPLAY|MUSE_KIOSK_PROFILE)='
sudo sh -c 'tr "\0" " " < "/proc/$1/cmdline"; echo' sh "$KIOSK_PID"
sudo journalctl -b -u 'muse-kiosk@kyle.service' -n 200 --no-pager
```

Confirm that every listed kiosk directory is owned by `kyle` and mode `700`;
HOME/XDG/profile values point beneath `/var/lib/muse-kiosk/kyle`; the runtime
path uses the actual operator UID; and a Wayland command contains
`--ozone-platform=wayland`. An X11-only command must omit the Wayland override
and expose `DISPLAY=:0`. The journal must not contain
`chrome_crashpad_handler: --database is required`, an exit-code-21 loop, a
keyring prompt, or verbose debug logging. A non-fatal GCM
`PHONE_REGISTRATION_ERROR` may still be reported by Chromium 150; record it and
confirm that it does not restart the active service.

The desktop and browser chrome should disappear after readiness. Local QR
upload, touch input, and navigation must still work. If the kiosk cannot enter
the detected graphical session, do not add multiple autostart systems. Review
the actual `loginctl` session and choose one session-native integration before
changing the unit.

From a terminal inside the graphical session, inspect the exact planned change:

```bash
/opt/muse/current/kiosk/muse-display-config resolution \
  --output '<detected connector>' --mode 1280x800 --dry-run
```

Only when `1280x800` is actually advertised and the planned command is correct:

```bash
/opt/muse/current/kiosk/muse-display-config resolution \
  --output '<detected connector>' --mode 1280x800 \
  --apply --confirm 'APPLY MUSE DISPLAY'
```

For X11 only, review touch and blanking dry-runs before applying:

```bash
/opt/muse/current/kiosk/muse-display-config touch \
  --touch-device '<detected touch name>' --output '<detected connector>' --dry-run
/opt/muse/current/kiosk/muse-display-config blanking --dry-run
/opt/muse/current/kiosk/muse-display-config cursor --dry-run
```

On Wayland, the touch and blanking helpers intentionally refuse. Select the
actual compositor mechanism based on discovery rather than editing X11 or boot
files. The display helper's reversal uses `--revert --confirm 'REVERT MUSE
DISPLAY'` with the same action and identifiers.

**Checkpoint G:** all four corners must align, the full 1280 × 800 UI must be
visible without cropping, and no desktop, terminal, notification, first-run, or
browser chrome may appear during normal use.

## 8. Reboot and prove automatic startup

```bash
sudo systemctl reboot
```

Wait for the Pi to return. Confirm cold boot reaches Home without manual input,
then reconnect:

```bash
ssh kyle@muse.local
sudo /opt/muse/current/kiosk/muse-ctl status
sudo /opt/muse/current/kiosk/muse-ctl network-verify
sudo systemctl is-active 'muse-kiosk@kyle.service'
sudo systemctl show 'muse-kiosk@kyle.service' --property=MainPID --property=NRestarts --no-pager
sudo journalctl -b -u 'muse-kiosk@kyle.service' --no-pager
```

This is the first permitted real reboot in the procedure. Record boot-to-Home
time, service states, display mode, touch alignment, temperature, and throttling.

## 9. Run the hackathon flow

Use only disposable or intended Muse data:

1. Import one garment locally.
2. From a real iPhone on the same private LAN, open the QR flow, verify the URL
   resolves locally, upload one garment, and confirm it appears automatically.
3. Edit Clothing Details.
4. Create an outfit; drag, resize, rotate, change layers, and save it.
5. Reopen it from Saved Outfits.
6. Change a Setting and confirm persistence.
7. Test Sleep Display and wake.
8. Create and verify a backup:

   ```bash
   sudo /opt/muse/current/kiosk/muse-ctl backup
   sudo /opt/muse/current/kiosk/muse-ctl backup-verify
   ```

9. Disconnect WAN while retaining loopback and, for phone testing, a private
   LAN. Confirm normal wardrobe use makes no external request.
10. Restart only Muse and prove recovery:

    ```bash
    sudo /opt/muse/current/kiosk/muse-ctl restart
    sudo /opt/muse/current/kiosk/muse-ctl readiness
    ```

11. Reboot once more and confirm the imported garments, outfit, and Settings
    remain.
12. Use the supported UI shutdown action only after capabilities show available;
    otherwise use `sudo systemctl poweroff` and record why helper validation
    failed.

## 10. Collect sanitized evidence

```bash
sudo /opt/muse/current/.venv/bin/python /opt/muse/current/kiosk/muse-doctor \
  --full --output /tmp/muse-validation-final.json
sudo journalctl -u muse-prepare.service -u muse-main.service \
  -u muse-phone-upload.service -u 'muse-kiosk@kyle.service' \
  --since today --no-pager > /tmp/muse-services.txt
vcgencmd measure_temp 2>/dev/null || cat /sys/class/thermal/thermal_zone0/temp
vcgencmd get_throttled 2>/dev/null || true
```

Review files before copying them. Do not collect QR screenshots, upload tokens,
request headers, environment files, wardrobe metadata, media filenames, or
personal images. Complete [hackathon-acceptance.md](hackathon-acceptance.md),
then continue with the exhaustive
[raspberry-pi-validation.md](raspberry-pi-validation.md) only when appropriate.
