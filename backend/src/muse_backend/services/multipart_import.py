import asyncio
import hashlib
import json
import os
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import BinaryIO, Self
from uuid import uuid4

from fastapi import Request
from python_multipart import MultipartParser
from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import parse_options_header
from starlette.requests import ClientDisconnect

from muse_backend.config import Settings
from muse_backend.domain.exceptions import DomainValidationError, MuseError
from muse_backend.storage.local import LocalStorageService


@dataclass(frozen=True, slots=True)
class ParsedImportUpload:
    attempt_id: str
    attempt_relative_path: str
    image_path: Path
    original_filename: str
    declared_mime_type: str
    metadata: dict[str, object]
    byte_size: int
    content_sha256: str


class _MultipartCallbacks:
    def __init__(self, *, destination: Path, settings: Settings) -> None:
        self.destination = destination
        self.settings = settings
        self.current_header_field = bytearray()
        self.current_header_value = bytearray()
        self.headers: dict[bytes, bytes] = {}
        self.current_part: str | None = None
        self.parts_seen: set[str] = set()
        self.metadata_bytes = bytearray()
        self.image_handle: BinaryIO | None = None
        self.image_size = 0
        self.image_hash = hashlib.sha256()
        self.original_filename: str | None = None
        self.declared_mime_type: str | None = None

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback
        self.close_image()

    def callbacks(self) -> dict[str, object]:
        return {
            "on_part_begin": self.on_part_begin,
            "on_header_field": self.on_header_field,
            "on_header_value": self.on_header_value,
            "on_header_end": self.on_header_end,
            "on_headers_finished": self.on_headers_finished,
            "on_part_data": self.on_part_data,
            "on_part_end": self.on_part_end,
        }

    def on_part_begin(self) -> None:
        self.current_header_field.clear()
        self.current_header_value.clear()
        self.headers.clear()
        self.current_part = None

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self.current_header_field.extend(data[start:end])

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self.current_header_value.extend(data[start:end])

    def on_header_end(self) -> None:
        name = bytes(self.current_header_field).lower()
        if not name or name in self.headers:
            raise self._invalid("The import contains invalid multipart headers.")
        self.headers[name] = bytes(self.current_header_value)
        self.current_header_field.clear()
        self.current_header_value.clear()

    def on_headers_finished(self) -> None:
        disposition, options = parse_options_header(self.headers.get(b"content-disposition"))
        if disposition != b"form-data" or b"name" not in options:
            raise self._invalid("The import contains an invalid multipart part.")
        try:
            part_name = options[b"name"].decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise self._invalid("The import contains an invalid multipart part.") from error
        if part_name not in {"metadata", "image"} or part_name in self.parts_seen:
            raise self._invalid("The import contains duplicate or unexpected multipart parts.")
        self.current_part = part_name
        self.parts_seen.add(part_name)
        if part_name == "metadata":
            if b"filename" in options:
                raise self._invalid("The garment metadata part must not be a file.")
            metadata_type, _ = parse_options_header(self.headers.get(b"content-type"))
            if metadata_type not in {b"", b"application/json"}:
                raise self._invalid("The garment metadata must be JSON.")
            return

        filename = options.get(b"filename")
        if filename is None:
            raise self._invalid("The garment image filename is missing.")
        try:
            self.original_filename = filename.decode("utf-8", errors="strict")
            self.declared_mime_type = self.headers[b"content-type"].decode("ascii", errors="strict")
        except (KeyError, UnicodeDecodeError) as error:
            raise self._invalid("The garment image type is missing or invalid.") from error
        try:
            descriptor = os.open(
                self.destination,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                0o600,
            )
            self.image_handle = os.fdopen(descriptor, "wb")
        except OSError as error:
            raise MuseError(
                status_code=503,
                code="storage_operation_failed",
                message="Muse could not prepare local storage for this import.",
            ) from error

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        payload = data[start:end]
        if self.current_part == "metadata":
            if len(self.metadata_bytes) + len(payload) > self.settings.max_import_overhead_bytes:
                raise self._invalid("The garment metadata is too large.")
            self.metadata_bytes.extend(payload)
            return
        if self.current_part == "image" and self.image_handle is not None:
            self.image_size += len(payload)
            if self.image_size > self.settings.max_upload_size_bytes:
                raise MuseError(
                    status_code=413,
                    code="upload_too_large",
                    message="The selected image exceeds the configured local upload limit.",
                )
            try:
                written = self.image_handle.write(payload)
                if written != len(payload):
                    raise OSError("temporary upload write was incomplete")
            except OSError as error:
                raise MuseError(
                    status_code=503,
                    code="storage_operation_failed",
                    message="Muse could not write the selected image to local storage.",
                ) from error
            self.image_hash.update(payload)
            return
        raise self._invalid("The import contains invalid multipart data.")

    def on_part_end(self) -> None:
        if self.current_part == "image":
            self.close_image()

    def close_image(self) -> None:
        if self.image_handle is None:
            return
        try:
            self.image_handle.flush()
            os.fsync(self.image_handle.fileno())
        finally:
            self.image_handle.close()
            self.image_handle = None

    def result(self, *, attempt_id: str, attempt_relative_path: str) -> ParsedImportUpload:
        if self.parts_seen != {"metadata", "image"}:
            raise self._invalid("Both garment metadata and an image are required.")
        if self.original_filename is None or self.declared_mime_type is None:
            raise self._invalid("The garment image is incomplete.")
        try:
            decoded = json.loads(self.metadata_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise self._invalid("The garment metadata is not valid JSON.") from error
        if not isinstance(decoded, dict) or any(not isinstance(key, str) for key in decoded):
            raise self._invalid("The garment metadata must be a JSON object.")
        return ParsedImportUpload(
            attempt_id=attempt_id,
            attempt_relative_path=attempt_relative_path,
            image_path=self.destination,
            original_filename=self.original_filename,
            declared_mime_type=self.declared_mime_type,
            metadata=decoded,
            byte_size=self.image_size,
            content_sha256=self.image_hash.hexdigest(),
        )

    @staticmethod
    def _invalid(message: str) -> DomainValidationError:
        return DomainValidationError(code="invalid_multipart_request", message=message)


async def _parser_write(parser: MultipartParser, chunk: bytes) -> None:
    task = asyncio.create_task(asyncio.to_thread(parser.write, chunk))
    try:
        written = await asyncio.shield(task)
    except asyncio.CancelledError:
        # Shield the callback thread and join it before the caller removes the
        # attempt directory. Otherwise a cancelled request could race a write.
        with suppress(Exception):
            await task
        raise
    if written != len(chunk):
        raise ValueError("multipart parser did not consume the complete request chunk")


async def _parser_finalize(parser: MultipartParser) -> None:
    task = asyncio.create_task(asyncio.to_thread(parser.finalize))
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        with suppress(Exception):
            await task
        raise


async def parse_import_request(
    request: Request,
    *,
    storage: LocalStorageService,
    settings: Settings,
) -> ParsedImportUpload:
    content_type, options = parse_options_header(request.headers.get("content-type"))
    boundary = options.get(b"boundary")
    if content_type != b"multipart/form-data" or not boundary:
        raise DomainValidationError(
            code="invalid_multipart_request",
            message="The import must use multipart form data.",
        )
    maximum_request_size = settings.max_upload_size_bytes + settings.max_import_overhead_bytes
    declared_length = request.headers.get("content-length")
    if declared_length is not None:
        try:
            parsed_length = int(declared_length)
            if parsed_length < 0:
                raise ValueError
            if parsed_length > maximum_request_size:
                raise MuseError(
                    status_code=413,
                    code="upload_too_large",
                    message="The selected image exceeds the configured local upload limit.",
                )
        except ValueError as error:
            raise DomainValidationError(
                code="invalid_multipart_request",
                message="The import Content-Length is invalid.",
            ) from error

    attempt_id = uuid4().hex
    attempt_relative_path = attempt_id
    attempt_directory = storage.resolve_temp_path(attempt_relative_path)
    try:
        attempt_directory.mkdir(mode=0o700, parents=False, exist_ok=False)
        destination = attempt_directory / "upload.bin"
        with _MultipartCallbacks(destination=destination, settings=settings) as state:
            parser = MultipartParser(
                boundary,
                state.callbacks(),  # type: ignore[arg-type]
                max_size=maximum_request_size,
                max_header_count=8,
                max_header_size=4224,
            )
            received_size = 0
            async for chunk in request.stream():
                received_size += len(chunk)
                if received_size > maximum_request_size:
                    raise MuseError(
                        status_code=413,
                        code="upload_too_large",
                        message="The selected image exceeds the configured local upload limit.",
                    )
                for start in range(0, len(chunk), settings.upload_chunk_size_bytes):
                    await _parser_write(
                        parser,
                        chunk[start : start + settings.upload_chunk_size_bytes],
                    )
            await _parser_finalize(parser)
            return state.result(
                attempt_id=attempt_id,
                attempt_relative_path=attempt_relative_path,
            )
    except ClientDisconnect as error:
        storage.delete_temporary_tree(attempt_relative_path)
        raise MuseError(
            status_code=400,
            code="upload_cancelled",
            message="The local image upload was cancelled.",
        ) from error
    except asyncio.CancelledError:
        storage.delete_temporary_tree(attempt_relative_path)
        raise
    except (MultipartParseError, ValueError) as error:
        storage.delete_temporary_tree(attempt_relative_path)
        raise DomainValidationError(
            code="invalid_multipart_request",
            message="The multipart import could not be parsed safely.",
        ) from error
    except Exception:
        storage.delete_temporary_tree(attempt_relative_path)
        raise
