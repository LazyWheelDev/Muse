import fcntl
import os
import stat
from collections.abc import Iterator
from contextlib import contextmanager

from muse_backend.config import Settings


class RuntimeServicesActiveError(RuntimeError):
    pass


class RuntimeServiceLock:
    """POSIX lease: servers hold shared locks; offline maintenance needs exclusive."""

    def __init__(self, settings: Settings) -> None:
        self._path = settings.runtime_lock_path

    def _open(self) -> int:
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self._path, flags, 0o600)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            os.close(descriptor)
            raise RuntimeError("runtime lock is not a regular file")
        os.fchmod(descriptor, 0o600)
        return descriptor

    @contextmanager
    def shared(self) -> Iterator[None]:
        descriptor = self._open()
        try:
            fcntl.flock(descriptor, fcntl.LOCK_SH)
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    @contextmanager
    def exclusive(self) -> Iterator[None]:
        descriptor = self._open()
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeServicesActiveError(
                    "stop both Muse listeners before applying staged maintenance"
                ) from error
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)
