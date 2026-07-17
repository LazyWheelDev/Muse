#!/usr/bin/env python3
"""Build and validate deterministic Muse release archives using only the stdlib."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

SCHEMA_VERSION = 1
RELEASE_ID_PATTERN = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}(?:-[a-z0-9][a-z0-9-]{0,20})?$")
REQUIRED_PATHS = (
    "backend/pyproject.toml",
    "backend/uv.lock",
    "backend/alembic.ini",
    "backend/src/muse_backend/__init__.py",
    "backend/migrations/env.py",
    "frontend/dist/index.html",
    "frontend/dist/.vite/manifest.json",
    "frontend/dist-phone/index.html",
    "frontend/dist-phone/.vite/manifest.json",
    "kiosk/install-on-pi.sh",
    "kiosk/launch-kiosk.sh",
    "kiosk/muse-backend",
    "kiosk/systemd/muse-kiosk@.service",
    "kiosk/systemd/muse-main.service",
    "docs/raspberry-pi-deployment.md",
    "docs/raspberry-pi-operator-runbook.md",
)
FORBIDDEN_PARTS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "local-data",
    "test-results",
    "playwright-report",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}
MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024


class ReleaseError(RuntimeError):
    pass


def validate_release_id(value: str) -> str:
    if not RELEASE_ID_PATTERN.fullmatch(value):
        raise ReleaseError(
            "release ID must be UTC timestamp, 12-character lowercase Git SHA, and optional slug"
        )
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git(repo: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *arguments],
        check=True,
        capture_output=True,
        text=True,
        shell=False,
    )
    return result.stdout.strip()


def _safe_relative(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or ".." in path.parts or "." in path.parts:
        raise ReleaseError(f"unsafe release path: {value!r}")
    if any(part in FORBIDDEN_PARTS for part in path.parts):
        raise ReleaseError(f"forbidden release path: {value!r}")
    if any(part == ".env" or part.startswith(".env.") for part in path.parts):
        raise ReleaseError(f"environment file cannot enter a release: {value!r}")
    return path


def _copy_file(source: Path, target: Path) -> None:
    if source.is_symlink() or not source.is_file():
        raise ReleaseError(f"required source file is not a regular file: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target, follow_symlinks=False)
    target.chmod(0o755 if source.stat().st_mode & 0o111 else 0o644)


def _copy_tree(source: Path, target: Path, *, exclude: set[str] | None = None) -> None:
    if source.is_symlink() or not source.is_dir():
        raise ReleaseError(f"required source directory is unavailable: {source}")
    excluded = exclude or set()
    for candidate in sorted(source.rglob("*")):
        relative = candidate.relative_to(source)
        if any(part in excluded or part in FORBIDDEN_PARTS for part in relative.parts):
            continue
        _safe_relative(relative.as_posix())
        if candidate.is_symlink():
            raise ReleaseError(f"symbolic links are not allowed in releases: {candidate}")
        if candidate.is_dir():
            continue
        if not candidate.is_file():
            raise ReleaseError(f"special files are not allowed in releases: {candidate}")
        _copy_file(candidate, target / relative)


def validate_vite_build(build: Path, label: str) -> dict[str, Any]:
    index = build / "index.html"
    manifest_path = build / ".vite" / "manifest.json"
    if index.is_symlink() or not index.is_file() or index.stat().st_size == 0:
        raise ReleaseError(f"{label} frontend index.html is missing or empty")
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ReleaseError(f"{label} Vite manifest is missing")
    try:
        manifest: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"{label} Vite manifest is invalid") from error
    if not isinstance(manifest, dict) or not manifest:
        raise ReleaseError(f"{label} Vite manifest is empty")
    entries = [
        key for key, value in manifest.items() if isinstance(value, dict) and value.get("isEntry")
    ]
    if len(entries) != 1:
        raise ReleaseError(f"{label} Vite manifest must contain exactly one entry")
    referenced: set[str] = set()
    for value in manifest.values():
        if not isinstance(value, dict):
            raise ReleaseError(f"{label} Vite manifest contains an invalid record")
        for key in ("file", "css", "assets"):
            raw = value.get(key, [])
            paths = [raw] if isinstance(raw, str) else raw
            if not isinstance(paths, list) or any(not isinstance(item, str) for item in paths):
                raise ReleaseError(f"{label} Vite manifest has invalid {key} metadata")
            for item in paths:
                safe = _safe_relative(item)
                target = build / Path(*safe.parts)
                if target.is_symlink() or not target.is_file() or target.stat().st_size == 0:
                    raise ReleaseError(f"{label} Vite asset is missing or empty: {item}")
                referenced.add(item)
    return {
        "entry": entries[0],
        "manifest_sha256": sha256(manifest_path),
        "index_sha256": sha256(index),
        "referenced_files": sorted(referenced),
    }


def _copy_release_sources(repo: Path, release: Path) -> dict[str, Any]:
    device = validate_vite_build(repo / "frontend" / "dist", "device")
    phone = validate_vite_build(repo / "frontend" / "dist-phone", "phone")
    for relative in (
        "README.md",
        "LICENSE",
        "backend/pyproject.toml",
        "backend/uv.lock",
        "backend/.python-version",
        "backend/alembic.ini",
        "backend/README.md",
    ):
        _copy_file(repo / relative, release / relative)
    _copy_tree(repo / "backend" / "src", release / "backend" / "src")
    _copy_tree(repo / "backend" / "migrations", release / "backend" / "migrations")
    _copy_tree(repo / "frontend" / "dist", release / "frontend" / "dist")
    _copy_tree(repo / "frontend" / "dist-phone", release / "frontend" / "dist-phone")
    _copy_tree(repo / "kiosk", release / "kiosk", exclude={"tests"})
    for name in (
        "architecture.md",
        "raspberry-pi-deployment.md",
        "raspberry-pi-operator-runbook.md",
        "raspberry-pi-validation.md",
        "hackathon-acceptance.md",
    ):
        _copy_file(repo / "docs" / name, release / "docs" / name)
    return {"device": device, "phone": phone}


def _file_manifest(release: Path) -> dict[str, dict[str, int | str]]:
    files: dict[str, dict[str, int | str]] = {}
    for path in sorted(release.rglob("*")):
        relative = path.relative_to(release).as_posix()
        _safe_relative(relative)
        if path.is_symlink():
            raise ReleaseError(f"symbolic links are not allowed in releases: {relative}")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ReleaseError(f"special files are not allowed in releases: {relative}")
        files[relative] = {"size": path.stat().st_size, "sha256": sha256(path)}
    return files


def verify_release_directory(release: Path) -> dict[str, Any]:
    manifest_path = release / "release-manifest.json"
    if (
        manifest_path.is_symlink()
        or not manifest_path.is_file()
        or manifest_path.stat().st_size > 16 * 1024 * 1024
    ):
        raise ReleaseError("release manifest is missing, linked, or oversized")
    try:
        manifest: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError("release manifest is invalid") from error
    if not isinstance(manifest, dict) or set(manifest) != {
        "schema_version",
        "release_id",
        "git_commit",
        "build_timestamp",
        "source_dirty",
        "expected_paths",
        "frontend",
        "files",
    }:
        raise ReleaseError("release manifest has an unexpected schema")
    validate_release_id(str(manifest["release_id"]))
    if manifest["schema_version"] != SCHEMA_VERSION:
        raise ReleaseError("release manifest schema version is unsupported")
    if not isinstance(manifest["git_commit"], str) or not re.fullmatch(
        r"[0-9a-f]{40}", manifest["git_commit"]
    ):
        raise ReleaseError("release Git commit is invalid")
    if manifest["expected_paths"] != list(REQUIRED_PATHS):
        raise ReleaseError("release expected-path contract is invalid")
    expected_files = manifest["files"]
    if not isinstance(expected_files, dict) or not expected_files:
        raise ReleaseError("release checksum table is invalid")
    actual_files = _file_manifest(release)
    actual_files.pop("release-manifest.json", None)
    if set(actual_files) != set(expected_files):
        missing = sorted(set(expected_files) - set(actual_files))
        unexpected = sorted(set(actual_files) - set(expected_files))
        raise ReleaseError(f"release file set mismatch; missing={missing}, unexpected={unexpected}")
    for relative, metadata in actual_files.items():
        if metadata != expected_files[relative]:
            raise ReleaseError(f"release checksum mismatch: {relative}")
    for required in REQUIRED_PATHS:
        if required not in expected_files or expected_files[required]["size"] == 0:
            raise ReleaseError(f"required release artifact is missing or empty: {required}")
    return manifest


def _archive(release: Path, destination: Path, *, source_epoch: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.unlink(missing_ok=True)
    with temporary.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
            paths = [release, *sorted(release.rglob("*"))]
            for path in paths:
                relative = Path(release.name) / path.relative_to(release)
                info = archive.gettarinfo(str(path), arcname=relative.as_posix())
                info.uid = 0
                info.gid = 0
                info.uname = "root"
                info.gname = "root"
                info.mtime = source_epoch
                info.mode = (
                    0o555 if path.is_dir() else (0o555 if os.access(path, os.X_OK) else 0o444)
                )
                if path.is_file():
                    with path.open("rb") as source:
                        archive.addfile(info, source)
                else:
                    archive.addfile(info)
        compressed.flush()
    os.replace(temporary, destination)


def build_release(repo: Path, output: Path, release_id: str | None, allow_dirty: bool) -> Path:
    repo = repo.resolve()
    commit = _git(repo, "rev-parse", "HEAD")
    dirty = bool(_git(repo, "status", "--porcelain", "--untracked-files=normal"))
    if dirty and not allow_dirty:
        raise ReleaseError(
            "working tree is not clean; commit changes or pass --allow-dirty explicitly"
        )
    timestamp = datetime.now(UTC).replace(microsecond=0)
    selected = release_id or f"{timestamp.strftime('%Y%m%dT%H%M%SZ')}-{commit[:12]}"
    validate_release_id(selected)
    output = output.resolve()
    release = output / selected
    if release.exists():
        raise ReleaseError(f"release output already exists: {release}")
    release.mkdir(parents=True)
    try:
        frontend = _copy_release_sources(repo, release)
        files = _file_manifest(release)
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "release_id": selected,
            "git_commit": commit,
            "build_timestamp": timestamp.isoformat().replace("+00:00", "Z"),
            "source_dirty": dirty,
            "expected_paths": list(REQUIRED_PATHS),
            "frontend": frontend,
            "files": files,
        }
        (release / "release-manifest.json").write_text(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        verify_release_directory(release)
        source_epoch = int(_git(repo, "show", "-s", "--format=%ct", commit))
        archive = output / f"muse-{selected}.tar.gz"
        _archive(release, archive, source_epoch=source_epoch)
        verify_archive(archive, extract=None)
        return archive
    except Exception:
        shutil.rmtree(release, ignore_errors=True)
        raise


def _validated_members(archive: tarfile.TarFile) -> tuple[str, list[tarfile.TarInfo]]:
    members = archive.getmembers()
    if not members or len(members) > 100_000:
        raise ReleaseError("release archive is empty or contains too many entries")
    top_levels: set[str] = set()
    total = 0
    for member in members:
        path = PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or len(path.parts) < 1:
            raise ReleaseError(f"unsafe archive path: {member.name!r}")
        top_levels.add(path.parts[0])
        if not member.isfile() and not member.isdir():
            raise ReleaseError(f"release archive contains a link or special file: {member.name}")
        if member.isfile():
            total += member.size
            if total > MAX_ARCHIVE_BYTES:
                raise ReleaseError("release archive expands beyond the safety limit")
    if len(top_levels) != 1:
        raise ReleaseError("release archive must contain exactly one top-level directory")
    release_id = next(iter(top_levels))
    validate_release_id(release_id)
    return release_id, members


def verify_archive(path: Path, extract: Path | None) -> dict[str, Any]:
    path = path.resolve()
    if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
        raise ReleaseError("release archive is missing, linked, or empty")
    with tarfile.open(path, mode="r:gz") as archive:
        release_id, _members = _validated_members(archive)
        if extract is None:
            with tempfile.TemporaryDirectory(prefix="muse-release-verify-") as temporary:
                root = Path(temporary)
                archive.extractall(root, filter="data")
                manifest = verify_release_directory(root / release_id)
        else:
            root = extract.resolve()
            if root.exists() and any(root.iterdir()):
                raise ReleaseError("release extraction destination must be empty")
            root.mkdir(parents=True, exist_ok=True)
            archive.extractall(root, filter="data")
            manifest = verify_release_directory(root / release_id)
    if manifest["release_id"] != release_id:
        raise ReleaseError("archive directory and manifest release IDs do not match")
    return manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build")
    build.add_argument("--repo", type=Path, required=True)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--release-id")
    build.add_argument("--allow-dirty", action="store_true")
    verify_dir = commands.add_parser("verify-directory")
    verify_dir.add_argument("path", type=Path)
    verify_tar = commands.add_parser("verify-archive")
    verify_tar.add_argument("path", type=Path)
    verify_tar.add_argument("--extract", type=Path)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "build":
            archive = build_release(args.repo, args.output, args.release_id, args.allow_dirty)
            print(archive)
        elif args.command == "verify-directory":
            print(json.dumps(verify_release_directory(args.path), sort_keys=True))
        else:
            print(json.dumps(verify_archive(args.path, args.extract), sort_keys=True))
    except (OSError, ReleaseError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(f"release error: {error}", file=os.sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
