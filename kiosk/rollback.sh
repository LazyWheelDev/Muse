#!/usr/bin/env bash
set -Eeuo pipefail

operator_user=""
automatic=0
root_prefix=""
no_services=0

atomic_replace() {
  local source="$1"
  local destination="$2"
  local python_command=""
  for candidate in /usr/bin/python3.13 "$(command -v python3 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      python_command="$candidate"
      break
    fi
  done
  [[ -n "$python_command" ]] || {
    printf 'Python is required for atomic rollback.\n' >&2
    exit 1
  }
  "$python_command" -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$source" "$destination"
}

while (($# > 0)); do
  case "$1" in
    --operator)
      operator_user="${2:-}"
      shift 2
      ;;
    --automatic)
      automatic=1
      shift
      ;;
    --root-prefix)
      root_prefix="${2:-}"
      shift 2
      ;;
    --no-services)
      no_services=1
      shift
      ;;
    --help | -h)
      printf 'Usage: %s --operator USER [--automatic] [--root-prefix DIR --no-services]\n' "$0"
      exit 0
      ;;
    *)
      printf 'Unknown rollback argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

[[ "$operator_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || {
  printf 'Invalid operator account.\n' >&2
  exit 2
}
if [[ -n "$root_prefix" ]]; then
  [[ "$root_prefix" == /* && "$root_prefix" != / && "$no_services" -eq 1 ]] || {
    printf 'Unsafe sandbox rollback.\n' >&2
    exit 2
  }
fi

opt_root="${root_prefix}/opt/muse"
state_root="${opt_root}/state"
current_link="${opt_root}/current"
[[ -f "${state_root}/previous-release" && ! -L "${state_root}/previous-release" ]] || {
  printf 'No previous Muse release is recorded.\n' >&2
  exit 1
}
target_id="$(tr -d '\n' <"${state_root}/previous-release")"
[[ "$target_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}(-[a-z0-9][a-z0-9-]{0,20})?$ ]] || {
  printf 'Previous release state is invalid.\n' >&2
  exit 1
}
target="${opt_root}/releases/${target_id}"
[[ -d "$target" && ! -L "$target" ]] || {
  printf 'Previous release files are unavailable.\n' >&2
  exit 1
}

current_id=""
if [[ -L "$current_link" ]]; then
  current_id="$(basename -- "$(readlink -- "$current_link")")"
fi

if [[ "$no_services" -ne 1 ]]; then
  systemctl stop "muse-kiosk@${operator_user}.service" muse-phone-upload.service muse-main.service || true
  if ! systemd-run --quiet --wait --collect --unit=muse-rollback-compatibility \
    --property=User=muse \
    --property=Group=muse \
    --property=EnvironmentFile=/etc/muse/muse.env \
    --property=EnvironmentFile=-/run/muse/network.env \
    "${target}/kiosk/muse-backend" migration-status; then
    printf 'Rollback blocked: the current database revision is not supported by the previous release. No downgrade was attempted.\n' >&2
    return_code=3
    if [[ "$automatic" -ne 1 ]]; then
      printf 'Restore only from an explicitly selected, verified Muse backup if recovery is required.\n' >&2
    fi
    exit "$return_code"
  fi
fi

ln -s -- "releases/${target_id}" "${opt_root}/current.next"
atomic_replace "${opt_root}/current.next" "$current_link"

if [[ "$no_services" -eq 1 ]]; then
  printf '%s\n' "$target_id" >"${state_root}/active-release"
  [[ -z "$current_id" ]] || printf '%s\n' "$current_id" >"${state_root}/previous-release"
  exit 0
fi

for unit in "${target}"/kiosk/systemd/*; do
  install -m 0644 -o root -g root "$unit" "/etc/systemd/system/$(basename -- "$unit")"
done
install -m 0755 -o root -g root \
  "${target}/kiosk/device-control-helper" /usr/libexec/muse-device-control
install -m 0440 -o root -g root \
  "${target}/kiosk/muse-device-control.sudoers" /etc/sudoers.d/muse-device-control
visudo -cf /etc/sudoers.d/muse-device-control >/dev/null
systemctl daemon-reload
systemctl reset-failed muse-prepare.service muse-main.service muse-phone-upload.service
systemctl restart muse-prepare.service
systemctl start muse-main.service
systemctl start muse-network-refresh.service
systemctl start "muse-kiosk@${operator_user}.service"
if ! /opt/muse/current/kiosk/wait-readiness.sh --timeout 90; then
  printf 'Previous release did not become ready; manual recovery is required.\n' >&2
  exit 1
fi
printf '%s\n' "$target_id" >"${state_root}/active-release.tmp"
chmod 644 "${state_root}/active-release.tmp"
mv -f -- "${state_root}/active-release.tmp" "${state_root}/active-release"
if [[ -n "$current_id" ]]; then
  printf '%s\n' "$current_id" >"${state_root}/previous-release.tmp"
  chmod 644 "${state_root}/previous-release.tmp"
  mv -f -- "${state_root}/previous-release.tmp" "${state_root}/previous-release"
fi
printf 'Rolled Muse back to release %s without changing the database.\n' "$target_id"
