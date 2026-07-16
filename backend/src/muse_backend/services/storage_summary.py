import shutil
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from muse_backend.config import Settings
from muse_backend.database.models.clothing import ClothingImage, ClothingItem
from muse_backend.database.models.outfit import Outfit
from muse_backend.schemas.settings import StorageSummary


def _regular_file_size(path: Path) -> int:
    try:
        if path.is_symlink() or not path.is_file():
            return 0
        return path.stat().st_size
    except OSError:
        return 0


def _bounded_tree_stats(root: Path, *, max_files: int = 100_000) -> tuple[int, int]:
    files = 0
    total = 0
    if root.is_symlink() or not root.is_dir():
        return files, total
    try:
        for path in root.rglob("*"):
            if files >= max_files:
                break
            if path.is_symlink() or not path.is_file():
                continue
            files += 1
            total += path.stat().st_size
    except OSError:
        pass
    return files, total


def storage_summary(session: Session, settings: Settings) -> StorageSummary:
    clothing_items = session.scalar(
        select(func.count()).select_from(ClothingItem).where(ClothingItem.deleted_at.is_(None))
    )
    soft_deleted_clothing_items = session.scalar(
        select(func.count()).select_from(ClothingItem).where(ClothingItem.deleted_at.is_not(None))
    )
    outfits = session.scalar(
        select(func.count()).select_from(Outfit).where(Outfit.deleted_at.is_(None))
    )
    media_files = session.scalar(select(func.count()).select_from(ClothingImage))
    image_bytes = session.scalar(select(func.coalesce(func.sum(ClothingImage.byte_size), 0)))
    preview_count, preview_bytes = _bounded_tree_stats(settings.outfit_preview_root)
    backup_archives = [
        path
        for path in settings.backup_root.glob("*.muse-backup.zip")
        if path.is_file() and not path.is_symlink()
    ]
    backup_count = len(backup_archives)
    backup_bytes = sum(_regular_file_size(path) for path in backup_archives)
    usage = shutil.disk_usage(settings.data_root)
    database_bytes = sum(
        _regular_file_size(candidate)
        for candidate in (
            settings.database_path,
            Path(f"{settings.database_path}-wal"),
            Path(f"{settings.database_path}-shm"),
        )
    )
    return StorageSummary(
        clothing_items=int(clothing_items or 0),
        soft_deleted_clothing_items=int(soft_deleted_clothing_items or 0),
        outfits=int(outfits or 0),
        media_files=int(media_files or 0) + preview_count,
        media_bytes=int(image_bytes or 0) + preview_bytes,
        image_bytes=int(image_bytes or 0),
        outfit_preview_bytes=preview_bytes,
        database_bytes=database_bytes,
        backup_count=backup_count,
        backup_bytes=backup_bytes,
        disk_total_bytes=usage.total,
        disk_free_bytes=usage.free,
        calculated_at=datetime.now(UTC),
    )
