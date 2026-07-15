import re
import unicodedata
from pathlib import PurePosixPath

_WINDOWS_DRIVE_PATTERN = re.compile(r"^[A-Za-z]:")


def normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def normalize_required_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("must not be blank")
    if any(unicodedata.category(character) == "Cc" for character in normalized):
        raise ValueError("must not contain control characters")
    return normalized


def normalize_relative_path(value: str) -> str:
    candidate = value.strip()
    if not candidate:
        raise ValueError("must not be empty")
    if len(candidate) > 500:
        raise ValueError("must not exceed 500 characters")
    if "\x00" in candidate:
        raise ValueError("must not contain null bytes")
    if any(unicodedata.category(character) == "Cc" for character in candidate):
        raise ValueError("must not contain control characters")
    if "\\" in candidate:
        raise ValueError("must use portable forward slashes")
    if "://" in candidate or _WINDOWS_DRIVE_PATTERN.match(candidate):
        raise ValueError("must be a relative filesystem path")

    raw_parts = candidate.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise ValueError("must not contain empty or traversal segments")
    if any(len(part) > 240 for part in raw_parts):
        raise ValueError("path segments must not exceed 240 characters")

    path = PurePosixPath(candidate)
    if path.is_absolute():
        raise ValueError("must be relative")
    return path.as_posix()
