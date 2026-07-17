#!/usr/bin/env bash
set -Eeuo pipefail

release_id=""
operator_user=""
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
    printf 'Python is required for atomic activation.\n' >&2
    exit 1
  }
  "$python_command" -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$source" "$destination"
}

usage() {
  printf 'Usage: %s --release-id ID --operator USER [--root-prefix DIR --no-services]\n' "$0"
}

while (($# > 0)); do
  case "$1" in
    --release-id)
      release_id="${2:-}"
      shift 2
      ;;
    --operator)
      operator_user="${2:-}"
      shift 2
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
      usage
      exit 0
      ;;
    *)
      printf 'Unknown activation argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}(-[a-z0-9][a-z0-9-]{0,20})?$ ]] || {
  printf 'Invalid release ID.\n' >&2
  exit 2
}
[[ "$operator_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || {
  printf 'Invalid operator account.\n' >&2
  exit 2
}
if [[ -n "$root_prefix" ]]; then
  [[ "$root_prefix" == /* && "$root_prefix" != / ]] || {
    printf 'Unsafe root prefix.\n' >&2
    exit 2
  }
  [[ "$no_services" -eq 1 ]] || {
    printf 'A root prefix requires --no-services.\n' >&2
    exit 2
  }
fi

opt_root="${root_prefix}/opt/muse"
data_root="${root_prefix}/var/lib/muse"
state_root="${opt_root}/state"
release_root="${opt_root}/releases/${release_id}"
current_link="${opt_root}/current"
[[ -d "$release_root" && ! -L "$release_root" ]] || {
  printf 'Installed release is missing.\n' >&2
  exit 1
}
mkdir -p -- "$state_root"
printf '%s\n' "$operator_user" >"${state_root}/kiosk-user.tmp"
chmod 644 "${state_root}/kiosk-user.tmp"
mv -f -- "${state_root}/kiosk-user.tmp" "${state_root}/kiosk-user"

current_id=""
if [[ -L "$current_link" ]]; then
  current_id="$(basename -- "$(readlink -- "$current_link")")"
  [[ "$current_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}(-[a-z0-9][a-z0-9-]{0,20})?$ ]] || {
    printf 'Current release link is unsafe.\n' >&2
    exit 1
  }
fi

if [[ "$no_services" -ne 1 ]]; then
  preflight_root="$(mktemp -d /run/muse/migration-preflight.XXXXXX)"
  cleanup_preflight() {
    rm -rf -- "$preflight_root"
  }
  trap cleanup_preflight EXIT HUP INT TERM
  chown muse:muse "$preflight_root"
  chmod 0700 "$preflight_root"
  preflight_environment=(
    "--setenv=MUSE_ENVIRONMENT=testing"
    "--setenv=MUSE_DATA_ROOT=${preflight_root}"
    "--setenv=MUSE_PHONE_UPLOAD_ENABLED=false"
    "--setenv=MUSE_SERVE_FRONTEND=false"
  )
  systemd-run --quiet --wait --collect \
    --unit="muse-migration-preflight-migrate-${release_id}" \
    --property=User=muse \
    --property=Group=muse \
    "${preflight_environment[@]}" \
    "${release_root}/kiosk/muse-backend" migrate
  systemd-run --quiet --wait --collect \
    --unit="muse-migration-preflight-check-${release_id}" \
    --property=User=muse \
    --property=Group=muse \
    "${preflight_environment[@]}" \
    "${release_root}/kiosk/muse-backend" migration-check
  cleanup_preflight
  trap - EXIT HUP INT TERM
fi

if [[ "$no_services" -ne 1 && -z "$current_id" && -f "${data_root}/muse.sqlite3" ]]; then
  printf 'Existing Muse data has no active release. Import or verify an explicit backup before first activation.\n' >&2
  exit 1
fi

if [[ "$no_services" -ne 1 && -n "$current_id" && -f "${data_root}/muse.sqlite3" ]]; then
  systemctl start muse-update-backup.service
  latest_backup="$(find "${data_root}/backups" -maxdepth 1 -type f -name '*.muse-backup.zip' -printf '%T@ %f\n' | sort -nr | awk 'NR==1 {print $2}')"
  [[ "$latest_backup" =~ ^[0-9a-f]{32}\.muse-backup\.zip$ ]] || {
    printf 'A verified pre-update backup was not recorded.\n' >&2
    exit 1
  }
  printf '%s\n' "${latest_backup%%.*}" >"${state_root}/last-update-backup.tmp"
  chmod 600 "${state_root}/last-update-backup.tmp"
  mv -f -- "${state_root}/last-update-backup.tmp" "${state_root}/last-update-backup"
fi

if [[ "$no_services" -ne 1 ]]; then
  for unit in "${release_root}"/kiosk/systemd/*; do
    install -m 0644 -o root -g root "$unit" "/etc/systemd/system/$(basename -- "$unit")"
  done
  install -m 0755 -o root -g root \
    "${release_root}/kiosk/device-control-helper" /usr/libexec/muse-device-control
  install -m 0440 -o root -g root \
    "${release_root}/kiosk/muse-device-control.sudoers" /etc/sudoers.d/muse-device-control
  visudo -cf /etc/sudoers.d/muse-device-control >/dev/null
  systemctl daemon-reload
  systemctl enable \
    muse-prepare.service \
    muse-main.service \
    muse-network-refresh.timer \
    "muse-kiosk@${operator_user}.service"
  systemctl stop "muse-kiosk@${operator_user}.service" muse-phone-upload.service muse-main.service || true
fi

if [[ -n "$current_id" && "$current_id" != "$release_id" ]]; then
  printf '%s\n' "$current_id" >"${state_root}/previous-release.tmp"
  chmod 644 "${state_root}/previous-release.tmp"
  mv -f -- "${state_root}/previous-release.tmp" "${state_root}/previous-release"
fi

ln -s -- "releases/${release_id}" "${opt_root}/current.next"
atomic_replace "${opt_root}/current.next" "$current_link"

if [[ "$no_services" -eq 1 ]]; then
  printf '%s\n' "$release_id" >"${state_root}/active-release"
  exit 0
fi

systemctl reset-failed \
  muse-prepare.service \
  muse-main.service \
  muse-phone-upload.service \
  "muse-kiosk@${operator_user}.service"
systemctl restart muse-prepare.service
systemctl start muse-main.service
systemctl enable --now muse-network-refresh.timer
systemctl start muse-network-refresh.service
systemctl enable --now "muse-kiosk@${operator_user}.service"

if /opt/muse/current/kiosk/wait-readiness.sh --timeout 90 &&
  /opt/muse/current/.venv/bin/python /opt/muse/current/kiosk/verify-listeners.py; then
  printf '%s\n' "$release_id" >"${state_root}/active-release.tmp"
  chmod 644 "${state_root}/active-release.tmp"
  mv -f -- "${state_root}/active-release.tmp" "${state_root}/active-release"
  printf 'Activated Muse release %s.\n' "$release_id"
  exit 0
fi

printf 'Release %s failed readiness; attempting code-only rollback.\n' "$release_id" >&2
if [[ -n "$current_id" ]]; then
  if /opt/muse/current/kiosk/rollback.sh --operator "$operator_user" --automatic; then
    printf 'Automatic code-only rollback completed.\n' >&2
  else
    printf 'Automatic rollback was blocked or failed. Use the recorded safety backup for explicit recovery.\n' >&2
  fi
else
  systemctl stop "muse-kiosk@${operator_user}.service" muse-phone-upload.service muse-main.service || true
  rm -f -- "$current_link"
fi
exit 1
