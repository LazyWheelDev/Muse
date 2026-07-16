#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  printf 'muse-network-refresh must run as root.\n' >&2
  exit 1
fi

RUNTIME_ENV=/run/muse/network.env
old_checksum=""
if [[ -f "$RUNTIME_ENV" && ! -L "$RUNTIME_ENV" ]]; then
  old_checksum="$(sha256sum "$RUNTIME_ENV" | awk '{print $1}')"
fi

if /opt/muse/current/.venv/bin/python /opt/muse/current/kiosk/lib/network_env.py \
  --output "$RUNTIME_ENV" --owner muse --group muse; then
  new_checksum="$(sha256sum "$RUNTIME_ENV" | awk '{print $1}')"
  if [[ "$new_checksum" != "$old_checksum" ]]; then
    systemctl try-restart muse-main.service
    systemctl restart muse-phone-upload.service
  elif ! systemctl is-active --quiet muse-phone-upload.service; then
    systemctl start muse-phone-upload.service
  fi
  exit 0
fi

rm -f -- "$RUNTIME_ENV"
if systemctl is-active --quiet muse-phone-upload.service; then
  systemctl stop muse-phone-upload.service
fi
if [[ -n "$old_checksum" ]]; then
  systemctl try-restart muse-main.service
fi
printf 'Muse phone upload remains safely disabled until one private IPv4 is available.\n'
