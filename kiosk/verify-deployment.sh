#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
require_systemd=0
if [[ "${1:-}" == --require-systemd ]]; then
  require_systemd=1
elif [[ "$#" -ne 0 ]]; then
  printf 'Usage: %s [--require-systemd]\n' "$0" >&2
  exit 2
fi

command -v shellcheck >/dev/null || {
  printf 'shellcheck is required.\n' >&2
  exit 1
}
shell_files=()
while IFS= read -r shell_file; do
  shell_files+=("$shell_file")
done < <(grep -RIl '^#!/usr/bin/env bash' "$SCRIPT_DIR")
shellcheck "${shell_files[@]}"
if command -v shfmt >/dev/null; then
  shfmt -d -i 2 -ci "${shell_files[@]}"
elif [[ "$require_systemd" -eq 1 ]]; then
  printf 'shfmt is required.\n' >&2
  exit 1
else
  printf 'shfmt unavailable; deterministic shell-format verification skipped on this host.\n'
fi

"$PYTHON_BIN" -m py_compile \
  "$SCRIPT_DIR/lib/release.py" \
  "$SCRIPT_DIR/lib/network_env.py" \
  "$SCRIPT_DIR/muse-doctor" \
  "$SCRIPT_DIR/muse-display-config" \
  "$SCRIPT_DIR/verify-listeners.py"

grep -Fq '/opt/muse/current/kiosk/muse-backend serve --host 127.0.0.1 --port 8000' "$SCRIPT_DIR/systemd/muse-main.service"
grep -Fq 'EnvironmentFile=/run/muse/network.env' "$SCRIPT_DIR/systemd/muse-phone-upload.service"
grep -Fq 'ConditionPathExists=/run/muse/network.env' "$SCRIPT_DIR/systemd/muse-phone-upload.service"
grep -Fq -- '--check-existing' "$SCRIPT_DIR/systemd/muse-phone-upload.service"
for kiosk_environment in \
  'Environment=HOME=/var/lib/muse-kiosk/%i' \
  'Environment=XDG_CONFIG_HOME=/var/lib/muse-kiosk/%i/config' \
  'Environment=XDG_CACHE_HOME=/var/lib/muse-kiosk/%i/cache' \
  'Environment=XDG_DATA_HOME=/var/lib/muse-kiosk/%i/data' \
  'Environment=MUSE_KIOSK_PROFILE=/var/lib/muse-kiosk/%i/chromium'; do
  grep -Fq "$kiosk_environment" "$SCRIPT_DIR/systemd/muse-kiosk@.service"
done
grep -Fq 'UMask=0077' "$SCRIPT_DIR/systemd/muse-kiosk@.service"
for chromium_flag in \
  '--kiosk' \
  '--no-first-run' \
  '--no-default-browser-check' \
  '--password-store=basic' \
  '--disable-breakpad' \
  '--disable-crash-reporter' \
  '--disable-session-crashed-bubble' \
  '--disable-background-networking' \
  '--disable-component-update' \
  '--disable-domain-reliability' \
  '--disable-sync' \
  '--no-pings' \
  '--disable-features=Translate,MediaRouter,OptimizationHints' \
  '--user-data-dir=' \
  '--ozone-platform=wayland'; do
  grep -Fq -- "$chromium_flag" "$SCRIPT_DIR/launch-kiosk.sh"
done
if grep -Eq -- '--no-sandbox|--remote-debugging' "$SCRIPT_DIR/launch-kiosk.sh"; then
  printf 'Unsafe Chromium production flag detected.\n' >&2
  exit 1
fi

if ! command -v systemd-analyze >/dev/null; then
  if [[ "$require_systemd" -eq 1 ]]; then
    printf 'systemd-analyze is required.\n' >&2
    exit 1
  fi
  printf 'systemd-analyze unavailable; unit syntax verification skipped on this host.\n'
  exit 0
fi

sandbox="$(mktemp -d "${TMPDIR:-/tmp}/muse-systemd-verify.XXXXXX")"
trap 'rm -rf -- "$sandbox"' EXIT
install -d -m 0755 \
  "$sandbox/etc/systemd/system" \
  "$sandbox/etc/muse" \
  "$sandbox/opt/muse/current/backend" \
  "$sandbox/opt/muse/current/.venv/bin" \
  "$sandbox/opt/muse/current/kiosk/lib" \
  "$sandbox/run/muse" \
  "$sandbox/run/user" \
  "$sandbox/var/lib/muse" \
  "$sandbox/var/lib/muse-kiosk/test" \
  "$sandbox/etc"
cp "$SCRIPT_DIR/systemd/"* "$sandbox/etc/systemd/system/"
printf 'root:x:0:0:root:/root:/bin/sh\nmuse:x:999:999:Muse:/nonexistent:/usr/sbin/nologin\ntest:x:1000:1000:Test:/nonexistent:/bin/sh\n' >"$sandbox/etc/passwd"
printf 'root:x:0:\nmuse:x:999:\ntest:x:1000:\n' >"$sandbox/etc/group"
printf 'MUSE_ENVIRONMENT=production\n' >"$sandbox/etc/muse/muse.env"
# DefaultDependencies adds standard boot and shutdown targets beyond those named by Muse units.
for target in \
  basic.target \
  graphical.target \
  local-fs.target \
  multi-user.target \
  network-online.target \
  shutdown.target \
  sysinit.target \
  timers.target; do
  printf '[Unit]\nDescription=CI stub for %s\n' "$target" >"$sandbox/etc/systemd/system/$target"
done
for target in sysinit.target basic.target shutdown.target; do
  if [[ ! -f "$sandbox/etc/systemd/system/$target" ]]; then
    printf 'Missing systemd DefaultDependencies target stub: %s\n' "$target" >&2
    exit 1
  fi
done
touch \
  "$sandbox/opt/muse/current/.venv/bin/python" \
  "$sandbox/opt/muse/current/kiosk/muse-backend" \
  "$sandbox/opt/muse/current/kiosk/refresh-network.sh" \
  "$sandbox/opt/muse/current/kiosk/launch-kiosk.sh" \
  "$sandbox/opt/muse/current/kiosk/lib/network_env.py"
chmod 0755 \
  "$sandbox/opt/muse/current/.venv/bin/python" \
  "$sandbox/opt/muse/current/kiosk/muse-backend" \
  "$sandbox/opt/muse/current/kiosk/refresh-network.sh" \
  "$sandbox/opt/muse/current/kiosk/launch-kiosk.sh"

systemd-analyze --root="$sandbox" verify \
  muse-prepare.service \
  muse-main.service \
  muse-phone-upload.service \
  muse-network-refresh.service \
  muse-network-refresh.timer \
  muse-update-backup.service \
  'muse-kiosk@test.service'
