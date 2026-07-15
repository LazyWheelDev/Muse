import json
import stat
from pathlib import Path, PurePosixPath

from starlette.responses import FileResponse

from muse_backend.domain.exceptions import FrontendBuildUnavailableError, ResourceNotFoundError

_MAX_MANIFEST_BYTES = 1024 * 1024
_MAX_MANIFEST_FILES = 64


def _regular_file(path: Path) -> bool:
    try:
        metadata = path.stat(follow_symlinks=False)
        return stat.S_ISREG(metadata.st_mode) and not path.is_symlink()
    except OSError:
        return False


def phone_frontend_build_available(root: Path) -> bool:
    if not _regular_file(root / "index.html"):
        return False
    try:
        files = _manifest_files(root)
    except FrontendBuildUnavailableError:
        return False
    if not files:
        return False
    try:
        resolved_root = root.resolve()
    except (OSError, RuntimeError):
        return False
    for relative_path in files:
        candidate = root.joinpath(*PurePosixPath(relative_path).parts)
        try:
            candidate.resolve().relative_to(resolved_root)
        except (OSError, RuntimeError, ValueError):
            return False
        if not _regular_file(candidate):
            return False
    return True


def phone_index_response(root: Path) -> FileResponse:
    index = root / "index.html"
    if not phone_frontend_build_available(root):
        raise FrontendBuildUnavailableError()
    return FileResponse(
        index,
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


def _manifest_files(root: Path) -> set[str]:
    manifest = root / ".vite" / "manifest.json"
    try:
        manifest_size = manifest.stat(follow_symlinks=False).st_size
    except OSError as error:
        raise FrontendBuildUnavailableError() from error
    if not _regular_file(manifest) or manifest_size > _MAX_MANIFEST_BYTES:
        raise FrontendBuildUnavailableError()
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FrontendBuildUnavailableError() from error
    if not isinstance(payload, dict):
        raise FrontendBuildUnavailableError()
    entry = payload.get("index.html")
    if not isinstance(entry, dict) or entry.get("isEntry") is not True:
        raise FrontendBuildUnavailableError()
    candidate = entry.get("file")
    if not isinstance(candidate, str):
        raise FrontendBuildUnavailableError()
    files = {_safe_manifest_file(candidate)}
    for key in ("css", "assets"):
        candidates = entry.get(key, [])
        if not isinstance(candidates, list) or any(
            not isinstance(value, str) for value in candidates
        ):
            raise FrontendBuildUnavailableError()
        files.update(_safe_manifest_file(value) for value in candidates)
    if len(files) > _MAX_MANIFEST_FILES:
        raise FrontendBuildUnavailableError()
    return files


def _safe_manifest_file(value: str) -> str:
    normalized = PurePosixPath(value)
    if (
        normalized.is_absolute()
        or not normalized.parts
        or any(part in {"", ".", ".."} for part in normalized.parts)
    ):
        raise FrontendBuildUnavailableError()
    return normalized.as_posix()


def phone_asset_response(root: Path, relative_path: str) -> FileResponse:
    try:
        normalized = PurePosixPath(relative_path)
        if (
            normalized.is_absolute()
            or not normalized.parts
            or any(part in {"", ".", ".."} for part in normalized.parts)
        ):
            raise ValueError
        rendered = normalized.as_posix()
    except ValueError as error:
        raise ResourceNotFoundError(
            code="phone_asset_not_found",
            message="The requested phone upload asset was not found.",
        ) from error
    if rendered not in _manifest_files(root):
        raise ResourceNotFoundError(
            code="phone_asset_not_found",
            message="The requested phone upload asset was not found.",
        )
    candidate = root.joinpath(*normalized.parts)
    try:
        candidate.resolve().relative_to(root.resolve())
    except (OSError, RuntimeError, ValueError) as error:
        raise ResourceNotFoundError(
            code="phone_asset_not_found",
            message="The requested phone upload asset was not found.",
        ) from error
    if not _regular_file(candidate):
        raise ResourceNotFoundError(
            code="phone_asset_not_found",
            message="The requested phone upload asset was not found.",
        )
    return FileResponse(
        candidate,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )
