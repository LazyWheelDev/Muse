#!/usr/bin/env bash
set -Eeuo pipefail

archive=""
release_tool=""
operator_user=""
root_prefix=""
dry_run=0
offline_dependencies=0
no_services=0
skip_dependencies=0
requested_python=""

usage() {
  printf 'Usage: %s --archive FILE --release-tool FILE --operator USER [--dry-run] [--offline-dependencies] [--root-prefix DIR --no-services]\n' "$0"
}

while (($# > 0)); do
  case "$1" in
    --archive)
      archive="${2:-}"
      shift 2
      ;;
    --release-tool)
      release_tool="${2:-}"
      shift 2
      ;;
    --operator)
      operator_user="${2:-}"
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
    --root-prefix)
      root_prefix="${2:-}"
      shift 2
      ;;
    --no-services)
      no_services=1
      shift
      ;;
    --skip-dependencies)
      skip_dependencies=1
      shift
      ;;
    --python-bin)
      requested_python="${2:-}"
      shift 2
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown installer argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$archive" && -f "$archive" && ! -L "$archive" ]] || {
  printf 'Release archive is missing or unsafe.\n' >&2
  exit 2
}
[[ -n "$release_tool" && -f "$release_tool" && ! -L "$release_tool" ]] || {
  printf 'Release verifier is missing or unsafe.\n' >&2
  exit 2
}
[[ "$operator_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || {
  printf 'Invalid operator account.\n' >&2
  exit 2
}
if [[ -n "$root_prefix" ]]; then
  [[ "$root_prefix" == /* && "$root_prefix" != / && "$no_services" -eq 1 ]] || {
    printf 'A sandbox root must be absolute, non-root, and use --no-services.\n' >&2
    exit 2
  }
  if [[ "$skip_dependencies" -ne 1 ]]; then
    printf 'Sandbox installs must use --skip-dependencies.\n' >&2
    exit 2
  fi
  [[ -n "$requested_python" ]] || {
    printf 'Sandbox installs require an explicit --python-bin.\n' >&2
    exit 2
  }
elif [[ -n "$requested_python" ]]; then
  printf -- '--python-bin is available only for sandbox tests.\n' >&2
  exit 2
elif [[ "${EUID}" -ne 0 ]]; then
  printf 'The production installer must run as root.\n' >&2
  exit 1
fi

python_bin=""
for candidate in "$requested_python" /usr/bin/python3.13 "$(command -v python3.13 2>/dev/null || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)'; then
      python_bin="$candidate"
      break
    fi
  fi
done
[[ -n "$python_bin" ]] || {
  printf 'Muse requires Python 3.13.x. Install the documented Raspberry Pi OS prerequisite and rerun.\n' >&2
  exit 1
}

if [[ -z "$root_prefix" ]]; then
  [[ "$(uname -s)" == Linux ]] || {
    printf 'Production installation requires Linux.\n' >&2
    exit 1
  }
  architecture="$(uname -m)"
  [[ "$architecture" == aarch64 || "$architecture" == arm64 ]] || {
    printf 'Production installation requires Linux AArch64; detected %s.\n' "$architecture" >&2
    exit 1
  }
  if [[ -r /proc/device-tree/model ]]; then
    model="$(tr -d '\0\n' </proc/device-tree/model)"
    printf 'Detected hardware model: %s\n' "$model"
  else
    printf 'Hardware model was not detected; architecture remains the installation boundary.\n'
  fi
fi

manifest_json="$($python_bin "$release_tool" verify-archive "$archive")"
release_id="$(printf '%s' "$manifest_json" | "$python_bin" -c 'import json,sys; print(json.load(sys.stdin)["release_id"])')"
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}(-[a-z0-9][a-z0-9-]{0,20})?$ ]] || {
  printf 'Verified release ID is invalid.\n' >&2
  exit 1
}

if [[ "$dry_run" -eq 1 ]]; then
  printf 'Dry run verified release %s.\n' "$release_id"
  printf 'Would preserve /var/lib/muse and /etc/muse/muse.env, install immutable code under /opt/muse/releases, synchronize production-only dependencies, and activate atomically.\n'
  exit 0
fi

opt_root="${root_prefix}/opt/muse"
data_root="${root_prefix}/var/lib/muse"
config_root="${root_prefix}/etc/muse"
runtime_root="${root_prefix}/run/muse"
kiosk_data_root="${root_prefix}/var/lib/muse-kiosk"
systemd_root="${root_prefix}/etc/systemd/system"
libexec_root="${root_prefix}/usr/libexec"
sudoers_root="${root_prefix}/etc/sudoers.d"

if [[ -z "$root_prefix" ]]; then
  getent passwd muse >/dev/null || useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin muse
  id "$operator_user" >/dev/null 2>&1 || {
    printf 'Desktop operator account %s does not exist.\n' "$operator_user" >&2
    exit 1
  }
fi

install -d -m 0755 "${opt_root}" "${opt_root}/releases" "${opt_root}/staging" "${opt_root}/state"
install -d -m 0700 "$data_root"
install -d -m 0750 "$config_root" "$runtime_root"
install -d -m 0755 "$kiosk_data_root" "$systemd_root" "$libexec_root" "$sudoers_root"
install -d -m 0700 "${kiosk_data_root}/${operator_user}" "${kiosk_data_root}/${operator_user}/chromium"
if [[ -z "$root_prefix" ]]; then
  chown -R muse:muse "$data_root"
  chown root:muse "$config_root" "$runtime_root"
  chown -R "${operator_user}:${operator_user}" "${kiosk_data_root}/${operator_user}"
fi

staging="${opt_root}/staging/${release_id}"
rm -rf -- "$staging"
install -d -m 0700 "$staging"
"$python_bin" "$release_tool" verify-archive "$archive" --extract "$staging" >/dev/null
extracted="${staging}/${release_id}"
release="${opt_root}/releases/${release_id}"

if [[ "$skip_dependencies" -ne 1 ]]; then
  python_constraint="$($python_bin -c 'import sys,tomllib; print(tomllib.load(open(sys.argv[1], "rb"))["project"]["requires-python"])' "${extracted}/backend/pyproject.toml")"
  [[ "$python_constraint" == '>=3.13,<3.14' ]] || {
    printf 'Release Python constraint %s does not match the validated production installer contract.\n' "$python_constraint" >&2
    exit 1
  }
fi

if [[ -e "$release" ]]; then
  [[ -d "$release" && ! -L "$release" ]] || {
    printf 'Existing release path is unsafe.\n' >&2
    exit 1
  }
  existing_manifest="$(sha256sum "${release}/release-manifest.json" | awk '{print $1}')"
  staged_manifest="$(sha256sum "${extracted}/release-manifest.json" | awk '{print $1}')"
  [[ "$existing_manifest" == "$staged_manifest" ]] || {
    printf 'Release ID already exists with different content.\n' >&2
    exit 1
  }
  if [[ "$skip_dependencies" -ne 1 ]]; then
    if [[ ! -x "${release}/.venv/bin/python" ]] || ! "${release}/kiosk/muse-backend" --help >/dev/null; then
      printf 'Existing release is incomplete: its locked production environment is unavailable.\n' >&2
      exit 1
    fi
  fi
  rm -rf -- "$staging"
else
  if [[ "$skip_dependencies" -ne 1 ]]; then
    uv_bin="$(command -v uv 2>/dev/null || true)"
    [[ -n "$uv_bin" ]] || {
      printf 'uv 0.11.28 is required as a documented installation prerequisite.\n' >&2
      exit 1
    }
    [[ "$("$uv_bin" --version)" == 'uv 0.11.28'* ]] || {
      printf 'Muse requires uv 0.11.28 for locked production synchronization.\n' >&2
      exit 1
    }
    sync_arguments=(sync --locked --no-dev --no-editable --no-install-project --no-python-downloads --python "$python_bin")
    if [[ "$offline_dependencies" -eq 1 ]]; then
      sync_arguments+=(--offline)
    fi
    (
      cd -- "${extracted}/backend"
      UV_PROJECT_ENVIRONMENT="${extracted}/.venv" "$uv_bin" "${sync_arguments[@]}"
    )
    "${extracted}/kiosk/muse-backend" --help >/dev/null
  fi
  if [[ -z "$root_prefix" ]]; then
    chown -hR root:root "$extracted"
  fi
  find "$extracted" -type d -exec chmod 0555 {} +
  find "$extracted" -type f -perm -u=x -exec chmod 0555 {} +
  find "$extracted" -type f ! -perm -u=x -exec chmod 0444 {} +
  mv -- "$extracted" "$release"
  rmdir -- "$staging"
fi

if [[ ! -e "${config_root}/muse.env" ]]; then
  if [[ -z "$root_prefix" ]]; then
    install -m 0640 -o root -g muse "${release}/kiosk/muse.env.example" "${config_root}/muse.env"
  else
    install -m 0640 "${release}/kiosk/muse.env.example" "${config_root}/muse.env"
  fi
fi

if [[ -n "$root_prefix" ]]; then
  for unit in "${release}"/kiosk/systemd/*; do
    install -m 0644 "$unit" "${systemd_root}/$(basename -- "$unit")"
  done
  install -m 0755 "${release}/kiosk/device-control-helper" "${libexec_root}/muse-device-control"
  install -m 0440 "${release}/kiosk/muse-device-control.sudoers" "${sudoers_root}/muse-device-control"
fi

activation_arguments=(--release-id "$release_id" --operator "$operator_user")
if [[ -n "$root_prefix" ]]; then
  activation_arguments+=(--root-prefix "$root_prefix" --no-services)
fi
"${release}/kiosk/activate-release.sh" "${activation_arguments[@]}"
printf 'Muse release %s installation completed.\n' "$release_id"
