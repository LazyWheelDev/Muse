from collections.abc import Mapping
from typing import Any


class MuseError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = dict(details) if details is not None else None


class ResourceNotFoundError(MuseError):
    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(status_code=404, code=code, message=message)


class ResourceConflictError(MuseError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=409, code=code, message=message, details=details)


class DomainValidationError(MuseError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=422, code=code, message=message, details=details)


class StorageOperationError(MuseError):
    def __init__(self) -> None:
        super().__init__(
            status_code=503,
            code="storage_operation_failed",
            message="Muse could not complete the local storage operation.",
        )


class DatabaseUnavailableError(MuseError):
    def __init__(self) -> None:
        super().__init__(
            status_code=503,
            code="database_unavailable",
            message="Muse could not access its local database.",
        )


class FrontendBuildUnavailableError(MuseError):
    def __init__(self) -> None:
        super().__init__(
            status_code=503,
            code="frontend_build_unavailable",
            message="The Muse interface is not available on this device yet.",
        )
