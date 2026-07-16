#!/usr/bin/env bash
set -Eeuo pipefail

host=""
operator_user=""
archive=""
dry_run=0
offline_dependencies=0
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
PYTHON_BIN="${PYTHON_BIN:-}"

if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in \
    "${REPOSITORY_ROOT}/backend/.venv/bin/python" \
    "${REPOSITORY_ROOT}/backend/venv/bin/python" \
    "$(command -v python3 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]] &&
      "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)'; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi
[[ -n "$PYTHON_BIN" ]] || {
  printf 'Python 3.13 is required on the deployment Mac.\n' >&2
  exit 1
}

usage() {
  printf 'Usage: %s --host HOST --user USER --release ARCHIVE [--dry-run] [--offline-dependencies]\n' "$0"
}

while (($# > 0)); do
  case "$1" in
    --host)
      host="${2:-}"
      shift 2
      ;;
    --user)
      operator_user="${2:-}"
      shift 2
      ;;
    --release)
      archive="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --offline-dependencies)
      offline_dependencies=1
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown deploy argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$ ]] || {
  printf 'Invalid target host.\n' >&2
  exit 2
}
[[ "$operator_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || {
  printf 'Invalid target user.\n' >&2
  exit 2
}
[[ -f "$archive" && ! -L "$archive" ]] || {
  printf 'Release archive is missing or unsafe.\n' >&2
  exit 2
}
archive="$(cd -- "$(dirname -- "$archive")" && pwd -P)/$(basename -- "$archive")"

manifest_json="$("$PYTHON_BIN" "${SCRIPT_DIR}/lib/release.py" verify-archive "$archive")"
release_id="$(printf '%s' "$manifest_json" | "$PYTHON_BIN" -c 'import json,sys; print(json.load(sys.stdin)["release_id"])')"
target="${operator_user}@${host}"

if [[ "$dry_run" -eq 1 ]]; then
  printf 'Dry run verified release %s for %s.\n' "$release_id" "$target"
  printf 'No SSH, SCP, sudo, installation, service restart, or device change was performed.\n'
  exit 0
fi

command -v ssh >/dev/null || {
  printf 'ssh is required for deployment.\n' >&2
  exit 1
}
command -v scp >/dev/null || {
  printf 'scp is required for deployment.\n' >&2
  exit 1
}

remote_staging="$(ssh -- "$target" 'umask 077; directory=$(mktemp -d /tmp/muse-deploy.XXXXXX); printf "%s\n" "$directory"')"
[[ "$remote_staging" =~ ^/tmp/muse-deploy\.[A-Za-z0-9]{6,}$ ]] || {
  printf 'Remote staging path was unsafe.\n' >&2
  exit 1
}
cleanup() {
  ssh -- "$target" "rm -rf -- '${remote_staging}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

scp -- \
  "$archive" \
  "${SCRIPT_DIR}/install-on-pi.sh" \
  "${SCRIPT_DIR}/lib/release.py" \
  "${target}:${remote_staging}/"

remote_archive="${remote_staging}/$(basename -- "$archive")"
install_command="sudo /bin/bash '${remote_staging}/install-on-pi.sh' --archive '${remote_archive}' --release-tool '${remote_staging}/release.py' --operator '${operator_user}'"
if [[ "$offline_dependencies" -eq 1 ]]; then
  install_command+=" --offline-dependencies"
fi
ssh -tt -- "$target" "$install_command"
printf 'Deployment command completed for Muse release %s.\n' "$release_id"
