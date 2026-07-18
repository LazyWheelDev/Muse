# Raspberry Pi production deployment

This document defines the production architecture used by Muse. On July 17,
2026, it was exercised on the intended Raspberry Pi 5 with 8 GB RAM, Raspberry
Pi OS, labwc/Wayland, Chromium 150, and a `1280 × 800` touchscreen. The operator
manually validated kiosk startup, touch, Wardrobe, Clothing Details, local and
QR phone import, Outfit Builder, Saved Outfits, Settings, network status,
persistence, and backups. That record is a functional hardware baseline, not a
substitute for installing and cold-booting each immutable release. Follow
[raspberry-pi-operator-runbook.md](raspberry-pi-operator-runbook.md) on the
target device and record every checkpoint before declaring the device ready.

## Repository audit discrepancies resolved in P7

The pre-change implementation already enforced the two-listener security model,
production loopback guard, staged-maintenance lease, readiness contract, locked
Python 3.13 environment, and two Vite builds. Documentation still described
systemd, kiosk startup, privileged actions, coordinated maintenance activation,
and pre-migration backup as future work; the repository had no kiosk scripts or
units. The older README also showed a manually fixed phone IP and a frontend
path outside the active-release model. P7 resolves those discrepancies with the
versioned layout, runtime address generator, supervised services, constrained
helper, and operator workflows below. No existing API was moved onto the LAN.

## Architecture

Muse is installed as immutable, root-owned releases with persistent data and
configuration outside the active code tree:

| Responsibility                        | Path                                 | Owner and mode                                          |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| Release code and compiled frontends   | `/opt/muse/releases/<release-id>`    | `root:root`; directories `0555`, files `0444` or `0555` |
| Atomic active release                 | `/opt/muse/current`                  | root-owned relative symlink                             |
| Deployment state                      | `/opt/muse/state`                    | `root:root`, `0755`; non-sensitive IDs only             |
| Wardrobe data, SQLite, media, backups | `/var/lib/muse`                      | `muse:muse`, `0700`                                     |
| Chromium profile and XDG state        | `/var/lib/muse-kiosk/<desktop-user>` | desktop user; directories `0700`, service umask `0077`  |
| Production settings                   | `/etc/muse/muse.env`                 | `root:muse`, `0640`                                     |
| Shared volatile runtime directory     | `/run/muse`                          | `root:muse`, `0750`, recreated by systemd-tmpfiles      |
| Generated network settings            | `/run/muse/network.env`              | `root:muse`, `0640`, atomic and ephemeral               |
| Logs                                  | journald                             | no application log files                                |

The `muse` service account has no login shell and owns only private application
data. Chromium runs as the existing graphical desktop user and cannot read
`/var/lib/muse`. Neither service uses an operator home directory for normal
application state.

The complete API and device SPA always bind `127.0.0.1:8000`. A separate
FastAPI process binds one generated RFC1918 IPv4 on port `8787` and retains its
existing allow-listed phone upload routes. It never receives the main router,
Settings, media browsing, readiness details, OpenAPI, or device actions.

## Required Raspberry Pi OS prerequisites

The installer detects and refuses unsupported prerequisites; it does not add
repositories, download an arbitrary interpreter, or modify the OS package set.
Review actual package availability first. The target needs:

- 64-bit Linux AArch64;
- Python `3.13.x`, including the standard-library `venv` support supplied by the
  selected OS packaging;
- `uv 0.11.28` available to root during installation;
- systemd including `systemd-tmpfiles`, sudo, iproute2 (`ip` and `ss`), and
  standard GNU user-management tools;
- system Chromium, detected as `/usr/bin/chromium` or
  `/usr/bin/chromium-browser`;
- SQLite command-line tools for optional manual inspection;
- Avahi only when `muse.local` mDNS advertisement is desired;
- the actual graphical session and display tools detected during the runbook.

`curl`, Node.js, npm, Vite, Playwright, Git, and the development Mac are not
runtime dependencies. Node and npm are used only to produce `dist` and
`dist-phone` on the development machine.

## Release build

From a clean development checkout:

```bash
./kiosk/build-release.sh
```

Use `--allow-dirty` only as an explicit development exception. The manifest
records that exception. `--output DIR` and `--release-id ID` are available for
controlled automation.

The builder runs `npm ci`, type-checks through the existing frontend build,
builds both frontends, validates both Vite manifests and their referenced
files, and creates `release-output/muse-<release-id>.tar.gz`. The allowlist
contains backend source, migrations, `pyproject.toml`, `uv.lock`, the two
compiled frontends, kiosk assets, and deployment documentation. It excludes
Git data, `.env`, local data, virtual environments, Node modules, development
caches, test output, and personal files.

`release-manifest.json` records the release ID, full Git commit, UTC build time,
dirty state, required paths, frontend entry metadata, sizes, and SHA-256 for
every packaged file. Archive extraction rejects absolute paths, traversal,
links, special files, unknown top-level directories, missing files, extra
files, and checksum mismatches.

## First installation and repeat deployment

Validate locally without a network connection to the Pi:

```bash
./kiosk/deploy.sh \
  --host muse.local \
  --user kyle \
  --release /path/printed/by/build-release \
  --dry-run
```

After completing the discovery checkpoints in the operator runbook, remove
`--dry-run`. The deploy wrapper uses a mode-`0700` random `/tmp` directory,
copies the archive plus fixed installer and verifier, and invokes that copied
installer under sudo. It never sends a generated shell program and never reads
from an operator home directory.

The root installer:

1. requires Linux AArch64 and Python 3.13;
2. verifies the archive before extraction;
3. creates the dedicated service account and fixed ownership layout;
4. extracts to `/opt/muse/staging/<release-id>`;
5. verifies the extracted manifest and checksums;
6. runs
   `uv sync --locked --no-dev --no-editable --no-install-project --no-python-downloads`
   into that release's `.venv`;
7. makes the completed release root-owned and non-writable;
8. installs `/usr/lib/tmpfiles.d/muse.conf` and applies it to create the shared
   `root:muse`, mode-`0750` `/run/muse` directory;
9. stages the systemd units, constrained helper, and exact sudoers allowlist;
10. creates `/etc/muse/muse.env` only when it does not already exist;
11. migrates and checks a disposable database under `/run/muse` as the `muse`
    account without touching wardrobe data;
12. installs root-owned service assets only after preflight succeeds;
13. activates the release atomically and verifies readiness and listener
    isolation.

`--offline-dependencies` tells uv to use only a previously populated local
cache. Normal runtime never invokes uv.
Muse runs the immutable `backend/src` tree through `kiosk/muse-backend`, which
sets a release-relative `PYTHONPATH` and directly executes `.venv/bin/python`.
This avoids non-relocatable generated console-script shebangs and keeps Alembic
anchored to the active release's `backend` directory.

## Update and backup sequence

An update preserves `/var/lib/muse` and `/etc/muse/muse.env`. Before switching
away from an active release, `muse-update-backup.service` creates and validates
a backup using Muse's existing snapshot and archive contract. Activation then
stops kiosk and both listeners, records the previous release, atomically swaps
`/opt/muse/current`, reruns preparation, starts services, waits up to 90 seconds
for readiness, verifies port bindings, and only then records `active-release`.
Before starting the selected kiosk instance, activation resets failed state for
prepare, main, phone upload, and `muse-kiosk@<operator>`. A kiosk that previously
hit systemd's start-rate limit can therefore recover during the same controlled
activation rather than requiring an unrelated manual reset.
If a database already exists but there is no recorded active release, first
activation refuses to guess its provenance; the operator must import or verify
an explicit Muse backup before proceeding.

Preparation runs as `muse` while no listener is active. It applies an already
user-confirmed staged restore or delete-all operation using the existing fixed
confirmation, migrates to head, reconciles interrupted imports, phone sessions,
outfit previews, and committed backup cleanup, clears a stale device-action
marker, and runs SQLite integrity checks. It does not create a new destructive
authorization and does not apply unstaged maintenance.

## Rollback and migration boundary

Run:

```bash
sudo /opt/muse/current/kiosk/rollback.sh --operator kyle
```

Rollback first executes the previous release's `migration-status` against the
current database. If the database is compatible, only the code symlink changes;
the database is never downgraded. If a new migration makes the previous code
incompatible, rollback exits with status `3` and leaves the new release selected.
Use the recorded `last-update-backup` only through an explicit, verified Muse
restore decision. Never copy SQLite files or run an automatic Alembic downgrade
as rollback.

Failed activation attempts automatic code-only rollback under the same
compatibility check. A successful code rollback also restores the previous
release's systemd units, device helper, and exact sudoers file before services
restart. A first installation with no previous release stops the failed
services and removes only the active code symlink. Personal data and backups are
never deleted.

## systemd services

| Unit                         | Role                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| `muse-prepare.service`       | Offline maintenance, migrations, reconciliation, integrity |
| `muse-main.service`          | One-worker full app on `127.0.0.1:8000`                    |
| `muse-phone-upload.service`  | Restricted listener using `/run/muse/network.env`          |
| `muse-network-refresh.timer` | Bounded 30-second DHCP/interface reconciliation            |
| `muse-kiosk@<user>.service`  | Chromium in the detected graphical session                 |
| `muse-update-backup.service` | Verified pre-update safety backup                          |

Backend services use `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
empty capability and ambient sets, private temporary storage, address-family
restrictions, an owner-only umask, and explicit writable paths. `DynamicUser`
is intentionally omitted because persistent `/var/lib/muse` ownership must
remain stable. `ProcSubset=pid` is omitted because device diagnostics read
bounded `/proc` files. The main service permits `AF_NETLINK` in addition to
Unix, IPv4, and IPv6 sockets because Python's `socket.if_nameindex()` uses the
netlink interface on Raspberry Pi OS during local-address discovery. The main
HTTP listener remains explicitly bound to `127.0.0.1`.

`/run` is a volatile tmpfs and is empty again after a cold boot. The packaged
`/usr/lib/tmpfiles.d/muse.conf` therefore recreates `/run/muse` as
`root:muse`, mode `0750`, before `muse-prepare.service` constructs its mount
namespace. The preparation unit explicitly requires and follows
`systemd-tmpfiles-setup.service`. Ownership remains with root so the `muse`
application account can traverse and read the root-owned `0640` network file
but cannot replace it. `RuntimeDirectory=muse` is intentionally not used:
because preparation runs as `muse`, it would weaken that ownership and couple a
directory shared by several services to one unit's lifecycle.

The kiosk uses `PrivateTmp=true` and `ProtectHome=read-only`. The latter keeps
the compositor-owned `/run/user/<uid>/wayland-*` socket visible but read-only;
the unit does not add `/run/user` to its writable paths. Its only explicit
writable filesystem path is `/var/lib/muse-kiosk/<desktop-user>`. Chromium
therefore retains the real Wayland socket while HOME, XDG state, and its profile
remain private and operator-owned. `MemoryDenyWriteExecute` is applied to the
Python services and must be confirmed by the physical run.

Run `systemd-analyze verify` and `systemd-analyze security` on the target after
installation; the CI syntax check cannot prove target-version compatibility.

## Dynamic private-network configuration

`network_env.py` selects either the explicitly configured
`MUSE_DEPLOY_NETWORK_INTERFACE` or exactly one default-route interface. It then
requires exactly one RFC1918 IPv4. Loopback, public, link-local, multicast,
malformed, and ambiguous results fail closed. The generator writes only bind
address, advertised IPv4, optional advertised hostname, and exact trusted hosts
through a mode-`0640` atomic replacement. It never reads or prints upload tokens.
The phone service performs a read-only pre-start comparison against the current
interface and refuses a missing, stale, or mismatched root-generated file.

The network timer stops only the phone listener when no valid address exists;
the loopback app stays available offline. When DHCP state changes, it regenerates
the file and restarts the main and phone processes so both use the same endpoint.
Do not set `0.0.0.0` or a public address. Set
`MUSE_DEPLOY_ADVERTISED_HOST=muse.local` only when mDNS is working; direct IPv4
remains the fallback.

## Chromium kiosk

The templated service runs as the graphical account, waits for local readiness,
detects a Wayland socket or the X11 `:0` socket, and detects the installed
Chromium name. `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, and
the Chromium profile all resolve beneath the operator-owned, mode-`0700`
`/var/lib/muse-kiosk/<desktop-user>` tree. The launcher derives
`XDG_RUNTIME_DIR` and the session bus from the runtime UID instead of assuming a
username or UID. A detected Wayland socket selects `--ozone-platform=wayland`;
an X11-only session receives no Wayland override.

The production command opens `http://127.0.0.1:8000` with this validated flag
set:

```text
--ozone-platform=wayland  # Wayland sessions only
--kiosk
--no-first-run
--no-default-browser-check
--password-store=basic
--disable-breakpad
--disable-crash-reporter
--disable-session-crashed-bubble
--disable-background-networking
--disable-component-update
--disable-domain-reliability
--disable-sync
--no-pings
--disable-features=Translate,MediaRouter,OptimizationHints
--user-data-dir=/var/lib/muse-kiosk/<desktop-user>/chromium
```

The initial permanent service failed with exit code `21` and logged
`chrome_crashpad_handler: --database is required`. A manual launch using the
private HOME/XDG tree and the crash-reporting flags above reached Muse in
fullscreen, accepted touch input, and ran until an intentional 15-second
timeout returned `124`. `--password-store=basic` is required because the
system-managed kiosk is not allowed to wait for an interactive Linux keyring
creation/unlock prompt. Muse does not save browser passwords, and all kiosk
state remains inside the private operator-owned tree.

The first production unit also hid the real Wayland socket with
`ProtectHome=true`; an interim drop-in proved the narrower permanent contract.
`ProtectHome=read-only` restores read-only socket visibility, `PrivateTmp=true`
keeps Chromium temporary files private, and only the dedicated kiosk state tree
is writable. The committed unit now contains that contract directly, so the
temporary `runtime-fix.conf` override must be removed only after the new release
is active and its effective unit has been inspected.

Chromium 150 also emitted non-fatal GCM `PHONE_REGISTRATION_ERROR` messages
during the successful manual run. Chromium's documented
[`--disable-background-networking`](https://source.chromium.org/chromium/chromium/src/+/main:chrome/common/chrome_switches.cc)
switch is the narrow supported control for background networking; Muse combines
it with component-update, domain-reliability, sync, ping, Media Router,
Translate, and Optimization Hints suppression. The current Chromium switch
registry exposes no supported general `--disable-gcm` switch. Push API
background-mode controls affect browser lifetime, not all in-process GCM users,
so adding one would not be an evidence-based fix for this message. Muse does not
add an invented flag, disable all networking, or install a firewall workaround.
Recheck the journal after physical redeployment; the GCM line may remain useful
diagnostic noise, but it must not restart the service or block local HTTP, QR
upload, touch, or rendering.

The kiosk does not use incognito, remote debugging, `--no-sandbox`, or another
sandbox-disabling flag. Browser `sessionStorage` and the existing Splash
behavior therefore remain intact.

The service does not install multiple desktop autostart systems. If the target
graphical session does not permit the system unit to access its compositor,
stop at the runbook checkpoint and choose one session-native integration after
recording the actual display stack; do not enable a second competing launcher.

## Device-control boundary

The web application never runs as root and never accepts a command, executable,
argument list, or service name. It exposes only three typed values:
`restart_application`, `reboot_device`, and `shutdown_device`. Capability
reporting is available only when production mode is configured and the fixed
helper and sudo broker are root-owned, executable, non-writable by group/other,
and pass a non-mutating probe.

The sudoers file authorizes the `muse` account to invoke exactly four full
commands: probe and the three fixed actions. The helper schedules the action
after two seconds so HTTP can acknowledge first, logs only the action name to
journald, and internally uses fixed systemctl operations. It cannot execute a
frontend-supplied shell command. A pending marker rejects new mutations while
the shared import/backup/preview gate proves long-running work is idle. Services
receive up to five minutes for graceful shutdown and retain crash-recovery
protocols.

Hardware brightness and touch calibration remain unavailable to the web API.
The UI-only Sleep Display behavior is unchanged.

## Display and touch preparation

Never edit boot configuration or force a mode from the advertised screen
specification alone. First run the discovery command:

```bash
sudo /opt/muse/current/.venv/bin/python \
  /opt/muse/current/kiosk/muse-doctor --full \
  --output /tmp/muse-device-discovery.json
```

`muse-display-config` is an opt-in runtime helper. It defaults to dry-run and
also accepts explicit `--dry-run`. `resolution` requires the selected output to
advertise `1280x800`; `touch` and `blanking` work only through a detected X11
session; on Wayland they refuse until the actual compositor mechanism is
selected. `cursor` requires installed `unclutter`. Apply and reversal require
the exact confirmations `APPLY MUSE DISPLAY` and `REVERT MUSE DISPLAY`.
Before changing its state file it creates a timestamped backup, and after a
runtime change it verifies the resulting state. It never edits `/boot`.

Examples, only after reviewing dry-run output:

```bash
muse-display-config resolution --output HDMI-A-1 --mode 1280x800 --dry-run
muse-display-config resolution --output HDMI-A-1 --mode 1280x800 \
  --apply --confirm 'APPLY MUSE DISPLAY'
muse-display-config resolution --output HDMI-A-1 --mode 1280x800 \
  --revert --confirm 'REVERT MUSE DISPLAY'
```

The dedicated Chromium profile and flags prevent browser first-run and update
prompts. OS notifications and compositor blanking must be addressed only after
the target desktop is identified. Do not apply generic X11 changes to Wayland.

## Diagnostics and operations

`muse-doctor` emits sanitized human output by default and JSON with `--json`.
It reports release IDs, service state, readiness, bound addresses, Chromium,
versions, display connectors/modes, touch names, database integrity, private
data permissions, free space, aggregate data size, backup size/time, thermal
state, throttling, recent error count, and mDNS state. It does not dump the
environment, token, QR URL, wardrobe metadata, or media filenames. Release,
loopback, readiness, database, and permission failures produce a nonzero exit.

Common commands:

```bash
sudo /opt/muse/current/kiosk/muse-ctl status
sudo /opt/muse/current/kiosk/muse-ctl start
sudo /opt/muse/current/kiosk/muse-ctl stop
sudo /opt/muse/current/kiosk/muse-ctl restart
sudo /opt/muse/current/kiosk/muse-ctl logs main
sudo /opt/muse/current/kiosk/muse-ctl logs phone
sudo /opt/muse/current/kiosk/muse-ctl readiness
sudo /opt/muse/current/kiosk/muse-ctl backup
sudo /opt/muse/current/kiosk/muse-ctl backup-verify
sudo /opt/muse/current/kiosk/muse-ctl database-integrity
sudo /opt/muse/current/kiosk/muse-ctl network-verify
sudo /opt/muse/current/kiosk/muse-ctl kiosk-restart
```

## Local-first runtime contract

After installation and dependency synchronization, core Muse use requires no
GitHub, npm, Node.js, Vite, CDN, hosted font, external QR generator, model,
cloud API, Internet route, Mac, or telemetry endpoint. Frontends, fonts, QR
generation, image processing, SQLite, and backups remain on the Pi. Phone import
uses only the shared trusted private LAN; wardrobe use needs only loopback.
Optional Internet connectivity may later support explicitly initiated software
updates, but it is not a dependency of the current product flows.

## Uninstallation and data removal

To remove application code while preserving personal data:

```bash
sudo systemctl disable --now 'muse-kiosk@kyle.service' muse-network-refresh.timer \
  muse-phone-upload.service muse-main.service muse-prepare.service
sudo rm -f /etc/systemd/system/muse-*.service /etc/systemd/system/muse-*.timer
sudo rm -f /usr/lib/tmpfiles.d/muse.conf \
  /usr/libexec/muse-device-control /etc/sudoers.d/muse-device-control
sudo rm -rf /opt/muse /var/lib/muse-kiosk
sudo rmdir /run/muse 2>/dev/null || true
sudo systemctl daemon-reload
```

This intentionally leaves `/var/lib/muse` and `/etc/muse/muse.env`. Full data
removal is a separate destructive decision: first create and export a verified
backup, stop services, review the exact two paths, and only then explicitly
remove `/var/lib/muse` and `/etc/muse`. Never combine full data removal with an
ordinary uninstall or update.
