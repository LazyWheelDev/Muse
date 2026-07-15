from fastapi import APIRouter
from starlette.responses import FileResponse

from muse_backend.api.dependencies import StorageDependency
from muse_backend.domain.exceptions import ResourceNotFoundError

router = APIRouter(tags=["media"])


@router.get("/media/{relative_path:path}", response_class=FileResponse)
def get_media(relative_path: str, storage: StorageDependency) -> FileResponse:
    path = storage.resolve_media_path(relative_path)
    try:
        is_unavailable = path.is_symlink() or not path.is_file()
    except OSError:
        is_unavailable = True
    if (
        is_unavailable
        or not storage.is_approved_image_path(path)
        or not storage.is_approved_persistent_media_location(path)
    ):
        raise ResourceNotFoundError(
            code="media_not_found",
            message="The requested local media file was not found.",
        )
    return FileResponse(
        path,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )
