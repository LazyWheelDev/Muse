from pathlib import Path

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse, Response

from muse_backend.domain.exceptions import FrontendBuildUnavailableError


def frontend_build_available(build_path: Path) -> bool:
    index_path = build_path / "index.html"
    try:
        index_path.resolve(strict=True).relative_to(build_path.resolve(strict=True))
        return index_path.is_file() and not index_path.is_symlink()
    except (OSError, RuntimeError, ValueError):
        return False


def register_frontend_routes(app: FastAPI, build_path: Path) -> None:
    @app.api_route("/{frontend_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend_fallback(frontend_path: str, request: Request) -> Response:
        del request
        if frontend_path == "api" or frontend_path.startswith("api/"):
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
