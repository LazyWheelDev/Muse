import asyncio
import fcntl
import os
import stat
import threading
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, asynccontextmanager, contextmanager

from muse_backend.config import Settings
from muse_backend.domain.exceptions import ResourceConflictError, StorageOperationError


class InterprocessImportLock:
    """Crash-releasing POSIX lock shared by imports and startup reconciliation."""

    def __init__(self, settings: Settings) -> None:
        self.path = settings.import_lock_path
        self._thread_lock = threading.Lock()

    def _open(self) -> int:
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(self.path, flags, 0o600)
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise OSError("import lock is not a regular file")
            os.fchmod(descriptor, 0o600)
            return descriptor
        except OSError as error:
            raise StorageOperationError from error

    @contextmanager
    def acquire(self, *, blocking: bool) -> Iterator[None]:
        acquired_locally = self._thread_lock.acquire(blocking=blocking)
        if not acquired_locally:
            raise ResourceConflictError(
                code="clothing_import_busy",
                message="Muse is already processing another local garment import.",
            )
        descriptor: int | None = None
        operation = fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
        try:
            descriptor = self._open()
            try:
                fcntl.flock(descriptor, operation)
            except BlockingIOError as error:
                raise ResourceConflictError(
                    code="clothing_import_busy",
                    message="Muse is already processing another local garment import.",
                ) from error
            yield
        finally:
            if descriptor is not None:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                finally:
                    os.close(descriptor)
            self._thread_lock.release()


class ImportAdmission:
    def __init__(self, settings: Settings) -> None:
        self.local_lock = asyncio.Lock()
        self.interprocess_lock = InterprocessImportLock(settings)

    @asynccontextmanager
    async def claim(
        self,
        *,
        busy_code: str = "clothing_import_busy",
        busy_message: str = "Muse is already processing another local garment import.",
    ) -> AsyncIterator[None]:
        try:
            await asyncio.wait_for(self.local_lock.acquire(), timeout=0.01)
        except TimeoutError as error:
            raise ResourceConflictError(code=busy_code, message=busy_message) from error
        try:
            with ExitStack() as stack:
                try:
                    stack.enter_context(self.interprocess_lock.acquire(blocking=False))
                except ResourceConflictError as error:
                    raise ResourceConflictError(code=busy_code, message=busy_message) from error
                yield
        finally:
            self.local_lock.release()
