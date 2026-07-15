import asyncio
from collections.abc import Awaitable, Callable

from fastapi import Request
from pydantic import ValidationError

from muse_backend.config import Settings
from muse_backend.database.engine import Database
from muse_backend.domain.exceptions import DomainValidationError
from muse_backend.schemas.clothing import ClothingItemCreate
from muse_backend.services.import_admission import ImportAdmission
from muse_backend.services.imports import GarmentImportService, ImportResult
from muse_backend.services.multipart_import import ParsedImportUpload, parse_import_request
from muse_backend.storage.local import LocalStorageService

ImportHook = Callable[[ParsedImportUpload, ClothingItemCreate], Awaitable[None]]
AdmissionHook = Callable[[], Awaitable[None]]
IdempotencyKeyProvider = Callable[[], str | None]
ImportedHook = Callable[[ImportResult], Awaitable[None]]


class GarmentImportWorkflow:
    def __init__(
        self,
        *,
        settings: Settings,
        storage: LocalStorageService,
        database: Database,
        admission: ImportAdmission,
    ) -> None:
        self.settings = settings
        self.storage = storage
        self.database = database
        self.admission = admission

    async def run(
        self,
        request: Request,
        *,
        idempotency_key: str | None | IdempotencyKeyProvider,
        busy_code: str = "clothing_import_busy",
        busy_message: str = "Muse is already processing another local garment import.",
        on_admitted: AdmissionHook | None = None,
        on_parsed: ImportHook | None = None,
        on_imported: ImportedHook | None = None,
        parse_timeout_seconds: float | None = None,
    ) -> ImportResult:
        async with self.admission.claim(busy_code=busy_code, busy_message=busy_message):
            if on_admitted is not None:
                await on_admitted()
            if parse_timeout_seconds is None:
                parsed = await parse_import_request(
                    request, storage=self.storage, settings=self.settings
                )
            else:
                async with asyncio.timeout(parse_timeout_seconds):
                    parsed = await parse_import_request(
                        request, storage=self.storage, settings=self.settings
                    )
            try:
                metadata = ClothingItemCreate.model_validate(parsed.metadata)
            except ValidationError as error:
                self.storage.delete_temporary_tree(parsed.attempt_relative_path)
                raise DomainValidationError(
                    code="invalid_import_metadata",
                    message="The garment information did not pass validation.",
                    details={
                        "fields": [
                            {
                                "location": [str(part) for part in issue["loc"]],
                                "message": issue["msg"],
                                "type": issue["type"],
                            }
                            for issue in error.errors()
                        ]
                    },
                ) from error
            try:
                if on_parsed is not None:
                    await on_parsed(parsed, metadata)
            except asyncio.CancelledError:
                self.storage.delete_temporary_tree(parsed.attempt_relative_path)
                raise
            except Exception:
                self.storage.delete_temporary_tree(parsed.attempt_relative_path)
                raise
            service = GarmentImportService(
                settings=self.settings,
                storage=self.storage,
                database=self.database,
            )
            resolved_idempotency_key = (
                idempotency_key() if callable(idempotency_key) else idempotency_key
            )
            import_task = asyncio.create_task(
                asyncio.to_thread(
                    service.import_item,
                    parsed,
                    metadata,
                    idempotency_key=resolved_idempotency_key,
                )
            )
            try:
                result = await asyncio.shield(import_task)
            except asyncio.CancelledError:
                result = await import_task
                if on_imported is not None:
                    await self._run_imported_hook(on_imported, result)
                raise
            if on_imported is not None:
                await self._run_imported_hook(on_imported, result)
            return result

    @staticmethod
    async def _run_imported_hook(hook: ImportedHook, result: ImportResult) -> None:
        hook_task: asyncio.Future[None] = asyncio.ensure_future(hook(result))
        try:
            await asyncio.shield(hook_task)
        except asyncio.CancelledError:
            await hook_task
            raise
