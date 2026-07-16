#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
OUTPUT_DIR="${REPOSITORY_ROOT}/release-output"
ALLOW_DIRTY=0
RELEASE_ID=""
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

usage() {
  printf 'Usage: %s [--output DIR] [--release-id ID] [--allow-dirty]\n' "$0"
}

while (($# > 0)); do
  case "$1" in
    --output)
      (($# >= 2)) || {
        usage >&2
        exit 2
      }
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --release-id)
      (($# >= 2)) || {
        usage >&2
        exit 2
      }
      RELEASE_ID="$2"
      shift 2
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$ALLOW_DIRTY" -ne 1 ]] && [[ -n "$(git -C "$REPOSITORY_ROOT" status --porcelain --untracked-files=normal)" ]]; then
  printf 'Refusing to build from a dirty working tree. Commit changes or pass --allow-dirty explicitly.\n' >&2
  exit 1
fi

command -v node >/dev/null || {
  printf 'Node.js is required only on the build machine.\n' >&2
  exit 1
}
command -v npm >/dev/null || {
  printf 'npm is required only on the build machine.\n' >&2
  exit 1
}
if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
  printf 'Python 3.13 is required on the build machine.\n' >&2
  exit 1
fi
"$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)' || {
  printf 'Muse release builds require Python 3.13.x.\n' >&2
  exit 1
}
expected_node="v$(tr -d '[:space:]' <"${REPOSITORY_ROOT}/.nvmrc")"
expected_npm="$(node -p "require('${REPOSITORY_ROOT}/frontend/package.json').packageManager.split('@')[1]")"
actual_node="$(node --version)"
actual_npm="$(npm --version)"
if [[ "$actual_node" != "$expected_node" || "$actual_npm" != "$expected_npm" ]]; then
  printf 'Muse release builds require Node %s and npm %s; detected Node %s and npm %s.\n' \
    "$expected_node" "$expected_npm" "$actual_node" "$actual_npm" >&2
  exit 1
fi

(
  cd -- "${REPOSITORY_ROOT}/frontend"
  npm ci
  npm run build
)

arguments=(build --repo "$REPOSITORY_ROOT" --output "$OUTPUT_DIR")
if [[ -n "$RELEASE_ID" ]]; then
  arguments+=(--release-id "$RELEASE_ID")
fi
if [[ "$ALLOW_DIRTY" -eq 1 ]]; then
  arguments+=(--allow-dirty)
fi

"$PYTHON_BIN" "${SCRIPT_DIR}/lib/release.py" "${arguments[@]}"
