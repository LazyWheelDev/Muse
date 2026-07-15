import hashlib
import io
import logging
import os
import warnings
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from muse_backend.config import Settings
from muse_backend.domain.exceptions import DomainValidationError

logger = logging.getLogger(__name__)

SUPPORTED_FORMATS = {
    "JPEG": ("image/jpeg", frozenset({".jpg", ".jpeg"})),
    "PNG": ("image/png", frozenset({".png"})),
    "WEBP": ("image/webp", frozenset({".webp"})),
}
ALLOWED_INPUT_MODES = frozenset(
    {"1", "L", "LA", "P", "RGB", "RGBA", "CMYK", "I", "I;16", "I;16B", "I;16L"}
)
MAX_ICC_PROFILE_BYTES = 1024 * 1024


@dataclass(frozen=True, slots=True)
class ValidatedImage:
    format: str
    mime_type: str
    extension: str
    encoded_width: int
    encoded_height: int
    display_width: int
    display_height: int
    byte_size: int
    content_sha256: str


@dataclass(frozen=True, slots=True)
class GeneratedDerivative:
    temp_path: Path
    mime_type: str
    width: int
    height: int
    byte_size: int
    content_sha256: str


@dataclass(frozen=True, slots=True)
class ProcessedUpload:
    validated: ValidatedImage
    normalized: GeneratedDerivative
    thumbnail: GeneratedDerivative


def _validation_error(code: str, message: str) -> DomainValidationError:
    return DomainValidationError(code=code, message=message)


def _signature_format(header: bytes) -> str | None:
    if header.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "WEBP"
    return None


def _file_sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def _safe_filename_suffix(filename: str) -> str:
    if (
        not filename
        or len(filename) > 255
        or filename != filename.strip()
        or "/" in filename
        or "\\" in filename
        or any(ord(character) < 32 or ord(character) == 127 for character in filename)
    ):
        raise _validation_error(
            "invalid_upload_filename",
            "The selected image filename is invalid.",
        )
    return PurePosixPath(filename).suffix.lower()


def _browser_safe_image(image: Image.Image) -> Image.Image:
    oriented = ImageOps.exif_transpose(image)
    has_alpha = "A" in oriented.getbands() or "transparency" in oriented.info
    alpha = oriented.convert("RGBA").getchannel("A") if has_alpha else None
    profile = oriented.info.get("icc_profile")
    converted: Image.Image
    if isinstance(profile, bytes) and profile:
        if len(profile) > MAX_ICC_PROFILE_BYTES:
            raise _validation_error(
                "invalid_image_metadata",
                "The image contains unsupported color metadata.",
            )
        try:
            source_profile = ImageCms.ImageCmsProfile(io.BytesIO(profile))
            target_profile = ImageCms.createProfile("sRGB")
            cms_input = oriented if oriented.mode in {"RGB", "CMYK"} else oriented.convert("RGB")
            transformed = ImageCms.profileToProfile(
                cms_input,
                source_profile,
                target_profile,
                outputMode="RGB",
            )
            if transformed is None:
                raise ImageCms.PyCMSError("color transform returned no image")
            converted = transformed
        except (ImageCms.PyCMSError, OSError, TypeError, ValueError):
            logger.warning("Ignoring an invalid embedded image color profile")
            converted = oriented.convert("RGB")
    else:
        converted = oriented.convert("RGB")
    if alpha is not None:
        converted.putalpha(alpha)
    return converted


def _write_webp(
    image: Image.Image,
    destination: Path,
    *,
    max_dimension: int,
    quality: int,
) -> GeneratedDerivative:
    output = image.copy()
    output.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS, reducing_gap=3.0)
    output_size = output.size
    try:
        with destination.open("xb") as handle:
            output.save(
                handle,
                format="WEBP",
                quality=quality,
                method=4,
                exact=True,
                exif=b"",
                icc_profile=None,
            )
            handle.flush()
            os.fsync(handle.fileno())
        destination.chmod(0o600)
        payload = destination.read_bytes()
        with Image.open(destination) as verification:
            verification.load()
            if verification.format != "WEBP" or verification.size != output.size:
                raise OSError("generated derivative verification failed")
    except (OSError, ValueError) as error:
        destination.unlink(missing_ok=True)
        raise _validation_error(
            "image_processing_failed",
            "Muse could not create a safe local image.",
        ) from error
    finally:
        output.close()
    return GeneratedDerivative(
        temp_path=destination,
        mime_type="image/webp",
        byte_size=len(payload),
        content_sha256=hashlib.sha256(payload).hexdigest(),
        width=output_size[0],
        height=output_size[1],
    )


def validate_and_process_upload(
    source: Path,
    *,
    filename: str,
    declared_mime_type: str,
    settings: Settings,
) -> ProcessedUpload:
    byte_size = source.stat().st_size
    if byte_size == 0:
        raise _validation_error("empty_image", "The selected image is empty.")
    suffix = _safe_filename_suffix(filename)
    with source.open("rb") as handle:
        header = handle.read(16)
    signature_format = _signature_format(header)
    if signature_format is None:
        raise _validation_error(
            "unsupported_image_format",
            "Muse supports JPEG, PNG, and WebP images.",
        )
    expected_mime, expected_suffixes = SUPPORTED_FORMATS[signature_format]
    declared_type = declared_mime_type.lower()
    if declared_type not in {expected_mime, "application/octet-stream"} or (
        suffix not in expected_suffixes
    ):
        raise _validation_error(
            "image_mime_mismatch",
            "The image content does not match its declared type.",
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as probe:
                actual_format = probe.format
                encoded_width, encoded_height = probe.size
                frames = getattr(probe, "n_frames", 1)
                mode = probe.mode
                if actual_format != signature_format:
                    raise _validation_error(
                        "image_mime_mismatch",
                        "The image content does not match its declared type.",
                    )
                if frames != 1:
                    raise _validation_error(
                        "animated_image_unsupported",
                        "Animated images are not supported.",
                    )
                if encoded_width <= 0 or encoded_height <= 0:
                    raise _validation_error(
                        "invalid_image_dimensions",
                        "The image dimensions are invalid.",
                    )
                if max(encoded_width, encoded_height) > settings.max_image_dimension:
                    raise _validation_error(
                        "image_dimensions_exceeded",
                        "The image dimensions exceed the configured local limit.",
                    )
                if encoded_width * encoded_height > settings.max_image_pixels:
                    raise _validation_error(
                        "image_pixel_limit_exceeded",
                        "The image contains too many pixels.",
                    )
                if mode not in ALLOWED_INPUT_MODES:
                    raise _validation_error(
                        "image_color_mode_unsupported",
                        "The image color mode is not supported.",
                    )
                probe.verify()

            with Image.open(source) as decoded:
                decoded.load()
                browser_safe = _browser_safe_image(decoded)
    except DomainValidationError:
        raise
    except Image.DecompressionBombError as error:
        raise _validation_error(
            "image_pixel_limit_exceeded",
            "The image contains too many pixels.",
        ) from error
    except Image.DecompressionBombWarning as error:
        raise _validation_error(
            "image_pixel_limit_exceeded",
            "The image contains too many pixels.",
        ) from error
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as error:
        raise _validation_error(
            "corrupt_image",
            "The selected image could not be decoded safely.",
        ) from error

    try:
        normalized = _write_webp(
            browser_safe,
            source.parent / "normalized.webp",
            max_dimension=settings.normalized_image_max_dimension,
            quality=settings.normalized_webp_quality,
        )
        thumbnail = _write_webp(
            browser_safe,
            source.parent / "thumbnail.webp",
            max_dimension=settings.thumbnail_max_dimension,
            quality=settings.thumbnail_webp_quality,
        )
        validated = ValidatedImage(
            format=signature_format,
            mime_type=expected_mime,
            extension=min(expected_suffixes, key=len),
            encoded_width=encoded_width,
            encoded_height=encoded_height,
            display_width=browser_safe.width,
            display_height=browser_safe.height,
            byte_size=byte_size,
            content_sha256=_file_sha256(source),
        )
        return ProcessedUpload(
            validated=validated,
            normalized=normalized,
            thumbnail=thumbnail,
        )
    finally:
        browser_safe.close()
