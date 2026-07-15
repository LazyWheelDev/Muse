from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from muse_backend.config import Settings
from muse_backend.database.engine import Database
from muse_backend.database.migrations import (
    check_migration_consistency,
    downgrade_database,
    migration_status,
    upgrade_database,
)
from muse_backend.storage.local import LocalStorageService

pytestmark = pytest.mark.integration

REVISION_1 = "20260715_0001"
REVISION_2 = "20260715_0002"


def _insert_legacy_clothing_item(connection: sa.Connection, name: str) -> int:
    return int(
        connection.execute(
            sa.text(
                """
                INSERT INTO clothing_items (name, garment_category)
                VALUES (:name, 'top')
                RETURNING id
                """
            ),
            {"name": name},
        ).scalar_one()
    )


def _insert_legacy_image(
    connection: sa.Connection,
    *,
    clothing_item_id: int,
    image_kind: str,
    suffix: str,
    is_primary: bool = False,
) -> int:
    return int(
        connection.execute(
            sa.text(
                """
                INSERT INTO clothing_images (
                    clothing_item_id,
                    image_kind,
                    relative_path,
                    mime_type,
                    width,
                    height,
                    byte_size,
                    is_primary
                )
                VALUES (
                    :clothing_item_id,
                    :image_kind,
                    :relative_path,
                    'image/jpeg',
                    800,
                    600,
                    1234,
                    :is_primary
                )
                RETURNING id
                """
            ),
            {
                "clothing_item_id": clothing_item_id,
                "image_kind": image_kind,
                "relative_path": f"garments/original/{suffix}.jpg",
                "is_primary": is_primary,
            },
        ).scalar_one()
    )


def _image_migration_snapshot(database: Database) -> list[tuple[int, str, str, int]]:
    with database.engine.connect() as connection:
        rows = connection.execute(
            sa.text(
                """
                SELECT id, image_kind, image_group_id, display_order
                FROM clothing_images
                ORDER BY id
                """
            )
        ).all()
    return [(int(row[0]), str(row[1]), str(row[2]), int(row[3])) for row in rows]


def test_import_migration_backfills_legacy_images_and_downgrades_without_row_loss(
    settings: Settings,
) -> None:
    LocalStorageService(settings).create_required_directories()
    upgrade_database(settings, REVISION_1)
    database = Database(settings.database_path)

    try:
        with database.engine.begin() as connection:
            grouped_item_id = _insert_legacy_clothing_item(connection, "Grouped legacy item")
            _insert_legacy_image(
                connection,
                clothing_item_id=grouped_item_id,
                image_kind="original",
                suffix="grouped-original",
                is_primary=True,
            )
            _insert_legacy_image(
                connection,
                clothing_item_id=grouped_item_id,
                image_kind="processed",
                suffix="grouped-processed",
            )
            _insert_legacy_image(
                connection,
                clothing_item_id=grouped_item_id,
                image_kind="thumbnail",
                suffix="grouped-thumbnail",
            )

            conflicting_item_id = _insert_legacy_clothing_item(
                connection, "Conflicting legacy item"
            )
            _insert_legacy_image(
                connection,
                clothing_item_id=conflicting_item_id,
                image_kind="original",
                suffix="conflict-first",
                is_primary=True,
            )
            _insert_legacy_image(
                connection,
                clothing_item_id=conflicting_item_id,
                image_kind="original",
                suffix="conflict-second",
            )
            _insert_legacy_image(
                connection,
                clothing_item_id=conflicting_item_id,
                image_kind="processed",
                suffix="conflict-processed",
            )

        upgrade_database(settings, REVISION_2)
        assert migration_status(settings, database).current_revisions == (REVISION_2,)
        check_migration_consistency(settings)

        inspector = inspect(database.engine)
        clothing_columns = {column["name"] for column in inspector.get_columns("clothing_items")}
        assert {
            "image_processing_state",
            "processing_attempts",
            "processing_error_code",
            "processing_started_at",
            "processing_completed_at",
            "import_idempotency_key",
        } <= clothing_columns
        image_columns = {column["name"] for column in inspector.get_columns("clothing_images")}
        assert {"content_sha256", "image_group_id", "display_order"} <= image_columns

        with database.engine.connect() as connection:
            clothing_states = connection.execute(
                sa.text(
                    """
                    SELECT image_processing_state, processing_attempts
                    FROM clothing_items
                    ORDER BY id
                    """
                )
            ).all()
        assert [tuple(row) for row in clothing_states] == [
            ("not_requested", 0),
            ("not_requested", 0),
        ]

        snapshot = _image_migration_snapshot(database)
        assert all(kind != "processed" for _, kind, _, _ in snapshot)
        assert all(len(group_id) == 32 and group_id.isascii() for _, _, group_id, _ in snapshot)
        assert all(group_id == group_id.lower() for _, _, group_id, _ in snapshot)

        grouped = snapshot[:3]
        assert {group_id for _, _, group_id, _ in grouped} == {grouped[0][2]}
        assert {display_order for _, _, _, display_order in grouped} == {0}

        conflicting = snapshot[3:]
        assert len({group_id for _, _, group_id, _ in conflicting}) == len(conflicting)
        assert [display_order for _, _, _, display_order in conflicting] == [0, 1, 2]

        with pytest.raises(IntegrityError), database.engine.begin() as connection:
            connection.execute(
                sa.text(
                    """
                    UPDATE clothing_items
                    SET image_processing_state = 'invented_state'
                    WHERE id = :item_id
                    """
                ),
                {"item_id": grouped_item_id},
            )

        with pytest.raises(IntegrityError), database.engine.begin() as connection:
            connection.execute(
                sa.text(
                    """
                    UPDATE clothing_images
                    SET content_sha256 = 'NOT-LOWER-HEX'
                    WHERE id = :image_id
                    """
                ),
                {"image_id": grouped[0][0]},
            )

        row_count = len(snapshot)
        stable_groups = {image_id: group_id for image_id, _, group_id, _ in snapshot}

        downgrade_database(settings, REVISION_1)
        assert migration_status(settings, database).current_revisions == (REVISION_1,)
        downgraded_inspector = inspect(database.engine)
        downgraded_columns = {
            column["name"] for column in downgraded_inspector.get_columns("clothing_images")
        }
        assert "image_group_id" not in downgraded_columns
        with database.engine.connect() as connection:
            assert connection.scalar(sa.text("SELECT count(*) FROM clothing_images")) == row_count
            assert (
                connection.scalar(
                    sa.text("SELECT count(*) FROM clothing_images WHERE image_kind = 'processed'")
                )
                == 2
            )

        upgrade_database(settings, REVISION_2)
        upgraded_again = _image_migration_snapshot(database)
        assert len(upgraded_again) == row_count
        assert {image_id: group_id for image_id, _, group_id, _ in upgraded_again} == stable_groups
    finally:
        database.dispose()


def test_import_migration_installs_on_a_fresh_database(tmp_path: Path) -> None:
    settings = Settings(
        environment="testing",
        data_root=tmp_path / "fresh-data",
        frontend_build_path=tmp_path / "frontend-dist",
    )

    upgrade_database(settings)

    assert migration_status(settings).is_current
    assert migration_status(settings).current_revisions == (REVISION_2,)
    check_migration_consistency(settings)


def test_import_migration_downgrade_restores_legacy_primary_and_retains_cutout_file(
    settings: Settings,
) -> None:
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    upgrade_database(settings, REVISION_1)
    database = Database(settings.database_path)

    try:
        with database.engine.begin() as connection:
            item_id = _insert_legacy_clothing_item(connection, "Cutout garment")
            _insert_legacy_image(
                connection,
                clothing_item_id=item_id,
                image_kind="original",
                suffix="cutout-original",
                is_primary=True,
            )
            _insert_legacy_image(
                connection,
                clothing_item_id=item_id,
                image_kind="processed",
                suffix="cutout-normalized",
            )

        upgrade_database(settings, REVISION_2)
        cutout_file = settings.cutout_image_root / ("c" * 32 + ".webp")
        cutout_file.write_bytes(b"cutout-remains-for-operator-recovery")
        with database.engine.begin() as connection:
            group_id = connection.scalar(
                sa.text(
                    """
                    SELECT image_group_id
                    FROM clothing_images
                    WHERE clothing_item_id = :item_id AND image_kind = 'normalized'
                    """
                ),
                {"item_id": item_id},
            )
            connection.execute(
                sa.text(
                    "UPDATE clothing_images SET is_primary = 0 WHERE clothing_item_id = :item_id"
                ),
                {"item_id": item_id},
            )
            connection.execute(
                sa.text(
                    """
                    INSERT INTO clothing_images (
                        clothing_item_id, image_kind, relative_path, mime_type,
                        width, height, byte_size, is_primary, content_sha256,
                        image_group_id, display_order
                    )
                    VALUES (
                        :item_id, 'cutout', :relative_path, 'image/webp',
                        800, 600, 36, 1, :content_sha256, :group_id, 0
                    )
                    """
                ),
                {
                    "item_id": item_id,
                    "relative_path": f"garments/cutouts/{cutout_file.name}",
                    "content_sha256": "a" * 64,
                    "group_id": group_id,
                },
            )

        downgrade_database(settings, REVISION_1)

        with database.engine.connect() as connection:
            images = connection.execute(
                sa.text(
                    """
                    SELECT image_kind, is_primary
                    FROM clothing_images
                    WHERE clothing_item_id = :item_id
                    ORDER BY image_kind
                    """
                ),
                {"item_id": item_id},
            ).all()
        assert [tuple(row) for row in images] == [("original", 0), ("processed", 1)]
        assert cutout_file.read_bytes() == b"cutout-remains-for-operator-recovery"
    finally:
        database.dispose()
