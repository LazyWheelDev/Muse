#!/usr/bin/env bash
set -Eeuo pipefail

timeout_seconds=90
while (($# > 0)); do
  case "$1" in
    --timeout)
      (($# >= 2)) || exit 2
      timeout_seconds="$2"
      shift 2
      ;;
    *)
      printf 'Unknown readiness argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done
[[ "$timeout_seconds" =~ ^[1-9][0-9]{0,3}$ ]] || {
  printf 'Invalid readiness timeout.\n' >&2
  exit 2
}

deadline=$((SECONDS + timeout_seconds))
while ((SECONDS < deadline)); do
  if /opt/muse/current/.venv/bin/python - <<'PY'; then
import urllib.request

try:
    with urllib.request.urlopen("http://127.0.0.1:8000/api/v1/readiness", timeout=1) as response:
        raise SystemExit(0 if response.status == 200 else 1)
except Exception:
    raise SystemExit(1)
PY
    exit 0
  fi
  sleep 1
done
printf 'Muse did not become ready within %s seconds.\n' "$timeout_seconds" >&2
exit 1
