import math
import os
import warnings
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from types import MappingProxyType
from typing import Final

from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError

from muse_backend.domain.enums import BodyZone, ImageKind

LOGICAL_WORKSPACE_WIDTH: Final = 640
LOGICAL_WORKSPACE_HEIGHT: Final = 800
OUTFIT_PREVIEW_WIDTH: Final = 600
OUTFIT_PREVIEW_HEIGHT: Final = 750
OUTFIT_PREVIEW_MIME_TYPE: Final = "image/webp"

MAX_SOURCE_DIMENSION = 12_000
MAX_SOURCE_PIXELS = 24_000_000
MAX_WORKING_DIMENSION = 4_096

BODY_ZONE_BASE_WIDTHS = MappingProxyType(
    {
        BodyZone.HEAD: 0.28,
        BodyZone.NECK: 0.34,
        BodyZone.UPPER_BODY: 0.50,
        BodyZone.FULL_BODY: 0.56,
        BodyZone.LOWER_BODY: 0.42,
        BodyZone.FEET: 0.40,
        BodyZone.ACCESSORY: 0.30,
    }
)

_CANDIDATE_PRIORITY = MappingProxyType(
    {
        ImageKind.CUTOUT: 0,
        ImageKind.NORMALIZED: 1,
        ImageKind.ORIGINAL: 2,
    }
)
_SUPPORTED_SOURCE_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
_RENDER_LOCK = Lock()

_BACKGROUND_COLOR = (246, 239, 229, 255)
_MANNEQUIN_FILL = (224, 216, 205, 255)
_MANNEQUIN_OUTLINE = (198, 186, 172, 255)
_PLACEHOLDER_FILL = (211, 201, 188, 238)
_PLACEHOLDER_OUTLINE = (157, 142, 125, 255)


@dataclass(frozen=True, slots=True)
class PreviewImageCandidate:
    """One local garment image that may be used to render a placement."""

    path: Path
    kind: ImageKind

    def __post_init__(self) -> None:
        if not isinstance(self.path, Path):
            raise TypeError("candidate path must be a pathlib.Path")
        if not isinstance(self.kind, ImageKind) or self.kind not in _CANDIDATE_PRIORITY:
            raise ValueError("preview candidates must be cutout, normalized, or original images")


def canonicalize_preview_candidates(
    candidates: Iterable[PreviewImageCandidate],
) -> tuple[PreviewImageCandidate, ...]:
    """Return candidates in deterministic quality order, retaining same-kind order."""

    indexed_candidates = tuple(enumerate(candidates))
    if any(not isinstance(candidate, PreviewImageCandidate) for _, candidate in indexed_candidates):
        raise TypeError("candidates must contain PreviewImageCandidate values")
    return tuple(
        candidate
        for _, candidate in sorted(
            indexed_candidates,
            key=lambda pair: (_CANDIDATE_PRIORITY[pair[1].kind], pair[0]),
        )
    )


@dataclass(frozen=True, slots=True)
class OutfitPreviewPlacement:
    """A normalized, center-positioned garment placement for preview rendering."""

    clothing_item_id: int
    body_zone: BodyZone
    position_x: float
    position_y: float
    scale: float
    rotation: float
    layer_index: int
    candidates: tuple[PreviewImageCandidate, ...]

    def __post_init__(self) -> None:
        if (
            isinstance(self.clothing_item_id, bool)
            or not isinstance(self.clothing_item_id, int)
            or self.clothing_item_id < 1
        ):
            raise ValueError("clothing_item_id must be a positive integer")
        if not isinstance(self.body_zone, BodyZone):
            raise TypeError("body_zone must be a BodyZone")
        _validate_finite_range("position_x", self.position_x, minimum=0.0, maximum=1.0)
        _validate_finite_range("position_y", self.position_y, minimum=0.0, maximum=1.0)
        _validate_finite_range("scale", self.scale, minimum=0.1, maximum=4.0)
        _validate_finite_range("rotation", self.rotation, minimum=-180.0, maximum=180.0)
        if (
            isinstance(self.layer_index, bool)
            or not isinstance(self.layer_index, int)
            or self.layer_index < 0
        ):
            raise ValueError("layer_index must be a non-negative integer")
        object.__setattr__(
            self,
            "candidates",
            canonicalize_preview_candidates(self.candidates),
        )


@dataclass(frozen=True, slots=True)
class OutfitPreviewRenderResult:
    width: int
    height: int
    mime_type: str
    byte_size: int


def render_outfit_preview(
    placements: Sequence[OutfitPreviewPlacement],
    destination: Path,
) -> OutfitPreviewRenderResult:
    """Render an offline outfit preview to a caller-owned, previously unused path."""

    if not isinstance(destination, Path):
        raise TypeError("destination must be a pathlib.Path")
    if destination.suffix.lower() != ".webp":
        raise ValueError("outfit previews must use a .webp destination")
    if not destination.parent.is_dir():
        raise FileNotFoundError("outfit preview destination directory does not exist")
    if any(not isinstance(placement, OutfitPreviewPlacement) for placement in placements):
        raise TypeError("placements must contain OutfitPreviewPlacement values")

    ordered_placements = sorted(
        placements,
        key=lambda placement: (placement.layer_index, placement.clothing_item_id),
    )
    with _RENDER_LOCK:
        return _render_locked(ordered_placements, destination)


def _validate_finite_range(name: str, value: float, *, minimum: float, maximum: float) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number")
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be finite and between {minimum} and {maximum}")


def _render_locked(
    placements: Sequence[OutfitPreviewPlacement],
    destination: Path,
) -> OutfitPreviewRenderResult:
    canvas = Image.new(
        "RGBA",
        (LOGICAL_WORKSPACE_WIDTH, LOGICAL_WORKSPACE_HEIGHT),
        _BACKGROUND_COLOR,
    )
    output: Image.Image | None = None
    created_destination = False
    try:
        _draw_mannequin(canvas)
        for placement in placements:
            transformed = _render_placement_image(placement)
            try:
                center_x = round(placement.position_x * LOGICAL_WORKSPACE_WIDTH)
                center_y = round(placement.position_y * LOGICAL_WORKSPACE_HEIGHT)
                left = round(center_x - transformed.width / 2)
                top = round(center_y - transformed.height / 2)
                canvas.alpha_composite(transformed, (left, top))
            finally:
                transformed.close()

        resized = canvas.resize(
            (OUTFIT_PREVIEW_WIDTH, OUTFIT_PREVIEW_HEIGHT),
            Image.Resampling.LANCZOS,
            reducing_gap=3.0,
        )
        try:
            output = resized.convert("RGB")
        finally:
            resized.close()

        try:
            with destination.open("xb") as handle:
                created_destination = True
                output.save(
                    handle,
                    format="WEBP",
                    lossless=True,
                    method=4,
                    exact=True,
                    exif=b"",
                    icc_profile=None,
                )
                handle.flush()
                os.fsync(handle.fileno())
            destination.chmod(0o600)
            byte_size = destination.stat().st_size
        except Exception:
            if created_destination:
                destination.unlink(missing_ok=True)
            raise
    finally:
        canvas.close()
        if output is not None:
            output.close()

    return OutfitPreviewRenderResult(
        width=OUTFIT_PREVIEW_WIDTH,
        height=OUTFIT_PREVIEW_HEIGHT,
        mime_type=OUTFIT_PREVIEW_MIME_TYPE,
        byte_size=byte_size,
    )


def _draw_mannequin(canvas: Image.Image) -> None:
    draw = ImageDraw.Draw(canvas, "RGBA")
    outline_width = 4
    draw.ellipse(
        (276, 43, 364, 131),
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
        width=outline_width,
    )
    draw.rounded_rectangle(
        (301, 126, 339, 177),
        radius=12,
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
        width=outline_width,
    )
    draw.polygon(
        ((257, 174), (383, 174), (417, 389), (363, 440), (277, 440), (223, 389)),
        fill=_MANNEQUIN_FILL,
    )
    draw.line(
        ((257, 174), (383, 174), (417, 389), (363, 440), (277, 440), (223, 389), (257, 174)),
        fill=_MANNEQUIN_OUTLINE,
        width=outline_width,
        joint="curve",
    )
    draw.polygon(
        ((257, 184), (222, 196), (159, 428), (197, 439), (274, 235)),
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
    )
    draw.polygon(
        ((383, 184), (418, 196), (481, 428), (443, 439), (366, 235)),
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
    )
    draw.ellipse(
        (150, 416, 202, 456),
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
        width=outline_width,
    )
    draw.ellipse(
        (438, 416, 490, 456),
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
        width=outline_width,
    )
    draw.polygon(
        ((278, 435), (318, 435), (310, 720), (257, 720)),
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
    )
    draw.polygon(
        ((322, 435), (362, 435), (383, 720), (330, 720)),
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
    )
    draw.rounded_rectangle(
        (226, 704, 311, 756),
        radius=20,
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
        width=outline_width,
    )
    draw.rounded_rectangle(
        (329, 704, 414, 756),
        radius=20,
        fill=_MANNEQUIN_FILL,
        outline=_MANNEQUIN_OUTLINE,
        width=outline_width,
    )


def _render_placement_image(placement: OutfitPreviewPlacement) -> Image.Image:
    for candidate in placement.candidates:
        try:
            source = _decode_candidate(candidate)
            try:
                return _scale_and_rotate_image(source, placement)
            finally:
                source.close()
        except (
            FileNotFoundError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            UnidentifiedImageError,
            OSError,
            SyntaxError,
            ValueError,
        ):
            continue
    placeholder = _placeholder_image(placement.body_zone, placement.scale)
    try:
        return _rotate_image(placeholder, placement.rotation)
    finally:
        placeholder.close()


def _decode_candidate(candidate: PreviewImageCandidate) -> Image.Image:
    if candidate.path.is_symlink() or not candidate.path.is_file():
        raise FileNotFoundError(candidate.path)
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(candidate.path) as opened:
            width, height = opened.size
            if width <= 0 or height <= 0:
                raise ValueError("candidate has invalid dimensions")
            if max(width, height) > MAX_SOURCE_DIMENSION:
                raise ValueError("candidate exceeds the source dimension limit")
            if width * height > MAX_SOURCE_PIXELS:
                raise ValueError("candidate exceeds the source pixel limit")
            if opened.format not in _SUPPORTED_SOURCE_FORMATS:
                raise ValueError("candidate uses an unsupported image format")
            if getattr(opened, "n_frames", 1) != 1:
                raise ValueError("animated candidates are not supported")
            opened.load()
            oriented = ImageOps.exif_transpose(opened)
            try:
                return oriented.convert("RGBA")
            finally:
                if oriented is not opened:
                    oriented.close()


def _scale_and_rotate_image(
    source: Image.Image,
    placement: OutfitPreviewPlacement,
) -> Image.Image:
    target_width = max(
        1,
        round(
            LOGICAL_WORKSPACE_WIDTH * BODY_ZONE_BASE_WIDTHS[placement.body_zone] * placement.scale
        ),
    )
    target_height = max(1, round(target_width * source.height / source.width))
    if max(target_width, target_height) > MAX_WORKING_DIMENSION:
        raise ValueError("candidate aspect ratio creates an unsafe rendering size")
    resized = source.resize(
        (target_width, target_height),
        Image.Resampling.LANCZOS,
        reducing_gap=3.0,
    )
    try:
        return _rotate_image(resized, placement.rotation)
    finally:
        resized.close()


def _rotate_image(source: Image.Image, rotation: float) -> Image.Image:
    if rotation == 0:
        return source.copy()
    return source.rotate(
        -rotation,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=(0, 0, 0, 0),
    )


def _placeholder_image(body_zone: BodyZone, scale: float) -> Image.Image:
    width = max(1, round(LOGICAL_WORKSPACE_WIDTH * BODY_ZONE_BASE_WIDTHS[body_zone] * scale))
    height = max(1, round(width * 1.20))
    if max(width, height) > MAX_WORKING_DIMENSION:
        raise ValueError("placeholder dimensions exceed the rendering limit")
    placeholder = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(placeholder, "RGBA")
    stroke = max(2, round(width * 0.018))
    inset = max(stroke, round(width * 0.04))
    radius = max(4, round(width * 0.08))
    draw.rounded_rectangle(
        (inset, inset, width - inset - 1, height - inset - 1),
        radius=radius,
        fill=_PLACEHOLDER_FILL,
        outline=_PLACEHOLDER_OUTLINE,
        width=stroke,
    )
    draw.line(
        (inset * 2, height - inset * 2, width - inset * 2, inset * 2),
        fill=_PLACEHOLDER_OUTLINE,
        width=stroke,
    )
    return placeholder
