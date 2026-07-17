#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

profile="${MUSE_KIOSK_PROFILE:-}"
[[ "$profile" == /var/lib/muse-kiosk/*/chromium ]] || {
  printf 'Muse kiosk profile path is not provisioned.\n' >&2
  exit 1
}
mkdir -p -- "$profile"
chmod 700 "$profile"

/opt/muse/current/kiosk/wait-readiness.sh --timeout 75

uid="$(id -u)"
runtime="/run/user/${uid}"
if [[ -d "$runtime" ]]; then
  export XDG_RUNTIME_DIR="$runtime"
  export DBUS_SESSION_BUS_ADDRESS="unix:path=${runtime}/bus"
fi

display_ready=0
display_backend=""
for _attempt in $(seq 1 60); do
  wayland_socket=""
  if [[ -d "$runtime" ]]; then
    wayland_socket="$(find "$runtime" -maxdepth 1 -type s -name 'wayland-*' -print -quit 2>/dev/null || true)"
  fi
  if [[ -n "$wayland_socket" ]]; then
    wayland_display="$(basename -- "$wayland_socket")"
    export WAYLAND_DISPLAY="$wayland_display"
    display_backend="wayland"
    display_ready=1
    break
  fi
  if [[ -S /tmp/.X11-unix/X0 ]]; then
    export DISPLAY=:0
    display_backend="x11"
    display_ready=1
    break
  fi
  sleep 1
done
[[ "$display_ready" -eq 1 ]] || {
  printf 'No active Wayland or X11 desktop session was detected.\n' >&2
  exit 1
}

chromium=""
for candidate in /usr/bin/chromium /usr/bin/chromium-browser; do
  if [[ -x "$candidate" && ! -L "$candidate" ]]; then
    chromium="$candidate"
    break
  fi
done
[[ -n "$chromium" ]] || {
  printf 'A supported system Chromium executable was not detected.\n' >&2
  exit 1
}

cursor_flag="$(dirname -- "$profile")/cursor-hide-enabled"
if [[ -f "$cursor_flag" && ! -L "$cursor_flag" && -x /usr/bin/unclutter ]]; then
  /usr/bin/unclutter --timeout 2 --ignore-scrolling --fork
fi

chromium_arguments=(
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
  "--user-data-dir=${profile}"
)
if [[ "$display_backend" == wayland ]]; then
  chromium_arguments=(--ozone-platform=wayland "${chromium_arguments[@]}")
fi

exec "$chromium" \
  "${chromium_arguments[@]}" \
  http://127.0.0.1:8000
