import json
import time
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse, Response

from muse_backend.domain.exceptions import FrontendBuildUnavailableError

_MAX_INDEX_BYTES = 1024 * 1024
_MAX_MANIFEST_BYTES = 4 * 1024 * 1024


class _LocalAssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.assets: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        value = (
            attributes.get("src")
            if tag == "script"
            else attributes.get("href")
            if tag == "link"
            else None
        )
        if value and not value.startswith(("data:", "#")):
            self.assets.add(value)


def _safe_build_asset(build_path: Path, relative_path: str) -> bool:
    clean = relative_path.split("?", 1)[0].split("#", 1)[0].removeprefix("/")
    if not clean or "://" in clean or any(part.startswith(".") for part in Path(clean).parts):
        return False
    try:
        root = build_path.resolve(strict=True)
        candidate = (build_path / clean).resolve(strict=True)
        candidate.relative_to(root)
        return candidate.is_file() and not candidate.is_symlink()
    except (OSError, RuntimeError, ValueError):
        return False


def _manifest_assets_available(build_path: Path, index_assets: set[str]) -> bool:
    manifest_path = build_path / ".vite" / "manifest.json"
    try:
        if (
            manifest_path.is_symlink()
            or not manifest_path.is_file()
            or manifest_path.stat().st_size > _MAX_MANIFEST_BYTES
        ):
            return False
        manifest: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict) or not manifest:
            return False
        assets = {
            asset.split("?", 1)[0].split("#", 1)[0].removeprefix("/") for asset in index_assets
        }
        has_entry = False
        for key, entry in manifest.items():
            if not isinstance(entry, dict):
                return False
            file_value = entry.get("file")
            if not isinstance(file_value, str):
                return False
            assets.add(file_value)
            has_entry = has_entry or entry.get("isEntry") is True
            for list_key in ("css", "assets"):
                values = entry.get(list_key, [])
                if not isinstance(values, list) or any(
                    not isinstance(value, str) for value in values
                ):
                    return False
                assets.update(values)
            for reference_key in ("imports", "dynamicImports"):
                references = entry.get(reference_key, [])
                if not isinstance(references, list) or any(
                    not isinstance(reference, str) or reference not in manifest
                    for reference in references
                ):
                    return False
            if not isinstance(key, str):
                return False
        if not has_entry or not all(_safe_build_asset(build_path, asset) for asset in assets):
            return False
        actual_files = {
            path.relative_to(build_path).as_posix()
            for path in build_path.rglob("*")
            if path.is_file() and not path.is_symlink()
        }
        return actual_files == assets | {"index.html", ".vite/manifest.json"}
    except (OSError, json.JSONDecodeError, UnicodeError):
        return False


@lru_cache(maxsize=16)
def _frontend_build_available_cached(
    build_path_text: str,
    index_signature: tuple[int, int],
    manifest_signature: tuple[int, int],
    cache_bucket: int,
) -> bool:
    del index_signature, manifest_signature, cache_bucket
    build_path = Path(build_path_text)
    index_path = build_path / "index.html"
    try:
        index_path.resolve(strict=True).relative_to(build_path.resolve(strict=True))
        if (
            not index_path.is_file()
            or index_path.is_symlink()
            or index_path.stat().st_size > _MAX_INDEX_BYTES
        ):
            return False
        parser = _LocalAssetParser()
        parser.feed(index_path.read_text(encoding="utf-8"))
        return all(
            _safe_build_asset(build_path, asset) for asset in parser.assets
        ) and _manifest_assets_available(build_path, parser.assets)
    except (OSError, RuntimeError, UnicodeError, ValueError):
        return False


def frontend_build_available(build_path: Path) -> bool:
    index_path = build_path / "index.html"
    manifest_path = build_path / ".vite" / "manifest.json"
    try:
        index_stat = index_path.stat()
        manifest_stat = manifest_path.stat()
        return _frontend_build_available_cached(
            str(build_path.resolve(strict=True)),
            (index_stat.st_mtime_ns, index_stat.st_size),
            (manifest_stat.st_mtime_ns, manifest_stat.st_size),
            int(time.monotonic() // 5),
        )
    except (OSError, RuntimeError):
        return False


def register_frontend_routes(app: FastAPI, build_path: Path) -> None:
    @app.api_route("/{frontend_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend_fallback(frontend_path: str, request: Request) -> Response:
        del request
        if frontend_path == "api" or frontend_path.startswith("api/"):
            raise HTTPException(status_code=404)
        if any(part.startswith(".") for part in Path(frontend_path).parts):
            raise HTTPException(status_code=404)
        if not frontend_build_available(build_path):
            raise FrontendBuildUnavailableError()

        if frontend_path and Path(frontend_path).suffix:
            try:
                build_root = build_path.resolve(strict=True)
                candidate = (build_path / frontend_path).resolve(strict=True)
                candidate.relative_to(build_root)
            except (OSError, RuntimeError, ValueError) as error:
                raise HTTPException(status_code=404) from error
            try:
                is_file = candidate.is_file()
            except OSError as error:
                raise HTTPException(status_code=404) from error
            if not is_file:
                raise HTTPException(status_code=404)
            cache_control = (
                "public, max-age=31536000, immutable"
                if frontend_path.startswith("assets/")
                else "no-cache"
            )
            return FileResponse(candidate, headers={"Cache-Control": cache_control})

        return FileResponse(
            build_path / "index.html",
            media_type="text/html",
            headers={"Cache-Control": "no-cache"},
        )
