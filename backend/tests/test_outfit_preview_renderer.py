from pathlib import Path

import pytest
from PIL import Image

from muse_backend.domain.enums import BodyZone, ImageKind
from muse_backend.services import outfit_preview_renderer as preview_renderer
from muse_backend.services.outfit_preview_renderer import (
    OUTFIT_PREVIEW_HEIGHT,
    OUTFIT_PREVIEW_MIME_TYPE,
    OUTFIT_PREVIEW_WIDTH,
    OutfitPreviewPlacement,
    PreviewImageCandidate,
    render_outfit_preview,
)

pytestmark = pytest.mark.unit


def _save_image(
    path: Path,
    color: tuple[int, int, int, int],
    *,
    size: tuple[int, int] = (100, 100),
) -> None:
    image = Image.new("RGBA", size, color)
    try:
        image.save(path, format="PNG")
    finally:
        image.close()


def _placement(
    candidates: tuple[PreviewImageCandidate, ...],
    *,
    clothing_item_id: int = 1,
    body_zone: BodyZone = BodyZone.UPPER_BODY,
    position_x: float = 0.5,
    position_y: float = 0.5,
    scale: float = 1.0,
    rotation: float = 0.0,
    layer_index: int = 0,
) -> OutfitPreviewPlacement:
    return OutfitPreviewPlacement(
        clothing_item_id=clothing_item_id,
        body_zone=body_zone,
        position_x=position_x,
        position_y=position_y,
        scale=scale,
        rotation=rotation,
        layer_index=layer_index,
        candidates=candidates,
    )


def _pixel(path: Path, position: tuple[int, int]) -> tuple[int, int, int]:
    with Image.open(path) as image:
        image.load()
        value = image.convert("RGB").getpixel(position)
    assert isinstance(value, tuple)
    return int(value[0]), int(value[1]), int(value[2])


def test_renderer_writes_fixed_static_webp_and_metadata(tmp_path: Path) -> None:
    destination = tmp_path / "preview.webp"

    result = render_outfit_preview([], destination)

    assert result.width == OUTFIT_PREVIEW_WIDTH == 600
    assert result.height == OUTFIT_PREVIEW_HEIGHT == 750
    assert result.mime_type == OUTFIT_PREVIEW_MIME_TYPE == "image/webp"
    assert result.byte_size == destination.stat().st_size > 0
    with Image.open(destination) as rendered:
        rendered.load()
        assert rendered.format == "WEBP"
        assert rendered.size == (600, 750)
        assert getattr(rendered, "n_frames", 1) == 1


def test_renderer_sorts_layers_back_to_front_and_is_deterministic(tmp_path: Path) -> None:
    red_path = tmp_path / "red.png"
    blue_path = tmp_path / "blue.png"
    _save_image(red_path, (255, 0, 0, 255))
    _save_image(blue_path, (0, 0, 255, 255))
    back = _placement(
        (PreviewImageCandidate(red_path, ImageKind.CUTOUT),),
        clothing_item_id=9,
        layer_index=0,
    )
    front = _placement(
        (PreviewImageCandidate(blue_path, ImageKind.CUTOUT),),
        clothing_item_id=3,
        layer_index=1,
    )
    first = tmp_path / "first.webp"
    second = tmp_path / "second.webp"

    render_outfit_preview([front, back], first)
    render_outfit_preview([back, front], second)

    assert first.read_bytes() == second.read_bytes()
    assert _pixel(first, (300, 375)) == (0, 0, 255)


def test_positive_rotation_is_clockwise_about_garment_center(tmp_path: Path) -> None:
    source = tmp_path / "asymmetric.png"
    image = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    try:
        for x in range(40, 61):
            for y in range(0, 31):
                image.putpixel((x, y), (255, 0, 0, 255))
        image.save(source, format="PNG")
    finally:
        image.close()
    destination = tmp_path / "clockwise.webp"

    render_outfit_preview(
        [
            _placement(
                (PreviewImageCandidate(source, ImageKind.CUTOUT),),
                rotation=90.0,
            )
        ],
        destination,
    )

    right_marker = _pixel(destination, (410, 375))
    left_side = _pixel(destination, (190, 375))
    assert right_marker == (255, 0, 0)
    assert left_side != (255, 0, 0)


def test_candidates_are_canonicalized_and_original_is_not_decoded_after_cutout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cutout = tmp_path / "cutout.png"
    normalized = tmp_path / "normalized.png"
    original = tmp_path / "original.png"
    _save_image(cutout, (20, 180, 80, 255))
    _save_image(normalized, (255, 0, 0, 255))
    _save_image(original, (0, 0, 255, 255))
    candidate = _placement(
        (
            PreviewImageCandidate(original, ImageKind.ORIGINAL),
            PreviewImageCandidate(normalized, ImageKind.NORMALIZED),
            PreviewImageCandidate(cutout, ImageKind.CUTOUT),
        )
    )
    decoded: list[Path] = []
    original_decode = preview_renderer._decode_candidate

    def tracking_decode(value: PreviewImageCandidate) -> Image.Image:
        decoded.append(value.path)
        return original_decode(value)

    monkeypatch.setattr(preview_renderer, "_decode_candidate", tracking_decode)
    destination = tmp_path / "preferred.webp"

    render_outfit_preview([candidate], destination)

    assert decoded == [cutout]
    assert _pixel(destination, (300, 375)) == (20, 180, 80)


def test_missing_and_corrupt_candidates_fall_back_to_original(tmp_path: Path) -> None:
    missing = tmp_path / "missing.png"
    corrupt = tmp_path / "corrupt.png"
    corrupt.write_bytes(b"not an image")
    original = tmp_path / "original.png"
    _save_image(original, (240, 120, 20, 255))
    destination = tmp_path / "fallback.webp"

    render_outfit_preview(
        [
            _placement(
                (
                    PreviewImageCandidate(missing, ImageKind.CUTOUT),
                    PreviewImageCandidate(corrupt, ImageKind.NORMALIZED),
                    PreviewImageCandidate(original, ImageKind.ORIGINAL),
                )
            )
        ],
        destination,
    )

    assert _pixel(destination, (300, 375)) == (240, 120, 20)


def test_all_unusable_candidates_render_a_neutral_placeholder(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.webp"
    placeholder = tmp_path / "placeholder.webp"
    render_outfit_preview([], baseline)

    render_outfit_preview(
        [
            _placement(
                (PreviewImageCandidate(tmp_path / "missing.png", ImageKind.CUTOUT),),
                body_zone=BodyZone.ACCESSORY,
                position_x=0.15,
                position_y=0.2,
            )
        ],
        placeholder,
    )

    sample = (90, 150)
    assert _pixel(placeholder, sample) != _pixel(baseline, sample)


@pytest.mark.parametrize(
    ("width", "height", "dimension_limit", "pixel_limit"),
    [
        (33, 2, 32, 1_000),
        (9, 8, 32, 64),
    ],
)
def test_source_bounds_reject_unsafe_candidate_and_use_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    width: int,
    height: int,
    dimension_limit: int,
    pixel_limit: int,
) -> None:
    unsafe = tmp_path / "unsafe.png"
    fallback = tmp_path / "fallback.png"
    _save_image(unsafe, (255, 0, 0, 255), size=(width, height))
    _save_image(fallback, (15, 30, 210, 255), size=(4, 4))
    monkeypatch.setattr(preview_renderer, "MAX_SOURCE_DIMENSION", dimension_limit)
    monkeypatch.setattr(preview_renderer, "MAX_SOURCE_PIXELS", pixel_limit)
    destination = tmp_path / "bounded.webp"

    render_outfit_preview(
        [
            _placement(
                (
                    PreviewImageCandidate(unsafe, ImageKind.CUTOUT),
                    PreviewImageCandidate(fallback, ImageKind.NORMALIZED),
                )
            )
        ],
        destination,
    )

    assert _pixel(destination, (300, 375)) == (15, 30, 210)


def test_unsafe_working_dimensions_use_next_candidate(tmp_path: Path) -> None:
    extreme_aspect = tmp_path / "extreme.png"
    fallback = tmp_path / "fallback.png"
    _save_image(extreme_aspect, (255, 0, 0, 255), size=(1, 100))
    _save_image(fallback, (40, 160, 220, 255))
    destination = tmp_path / "working-bounds.webp"

    render_outfit_preview(
        [
            _placement(
                (
                    PreviewImageCandidate(extreme_aspect, ImageKind.CUTOUT),
                    PreviewImageCandidate(fallback, ImageKind.NORMALIZED),
                )
            )
        ],
        destination,
    )

    assert _pixel(destination, (300, 375)) == (40, 160, 220)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("position_x", -0.01),
        ("position_y", 1.01),
        ("scale", 0.09),
        ("scale", 4.01),
        ("rotation", -181.0),
        ("rotation", 181.0),
        ("position_x", float("nan")),
    ],
)
def test_placement_rejects_transform_values_outside_persistence_bounds(
    field: str,
    value: float,
) -> None:
    values = {
        "position_x": 0.5,
        "position_y": 0.5,
        "scale": 1.0,
        "rotation": 0.0,
    }
    values[field] = value

    with pytest.raises(ValueError):
        OutfitPreviewPlacement(
            clothing_item_id=1,
            body_zone=BodyZone.UPPER_BODY,
            position_x=values["position_x"],
            position_y=values["position_y"],
            scale=values["scale"],
            rotation=values["rotation"],
            layer_index=0,
            candidates=(),
        )


def test_thumbnail_candidate_is_rejected() -> None:
    with pytest.raises(ValueError):
        PreviewImageCandidate(Path("thumbnail.webp"), ImageKind.THUMBNAIL)


def test_existing_destination_is_not_overwritten(tmp_path: Path) -> None:
    destination = tmp_path / "preview.webp"
    destination.write_bytes(b"existing")

    with pytest.raises(FileExistsError):
        render_outfit_preview([], destination)

    assert destination.read_bytes() == b"existing"
