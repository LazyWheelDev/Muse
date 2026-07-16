import platform
from pathlib import Path

from muse_backend.platform.contracts import MemoryStatus, ThermalStatus

_MAX_PROC_BYTES = 64 * 1024


def _read_bounded(path: Path) -> str | None:
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > _MAX_PROC_BYTES:
            return None
        return path.read_text(encoding="utf-8", errors="replace")[:_MAX_PROC_BYTES]
    except OSError:
        return None


class LocalPlatformAdapter:
    """Read-only, standard-library device information. Never invokes a shell."""

    @staticmethod
    def operating_system() -> str:
        release = _read_bounded(Path("/etc/os-release"))
        if release:
            values: dict[str, str] = {}
            for line in release.splitlines():
                key, separator, value = line.partition("=")
                if separator and key in {"PRETTY_NAME", "NAME"}:
                    values[key] = value.strip().strip('"')[:120]
            if values:
                return values.get("PRETTY_NAME", values.get("NAME", "Linux"))
        return f"{platform.system()} {platform.release()}"[:120]

    @staticmethod
    def architecture() -> str:
        return platform.machine()[:40] or "unknown"

    @staticmethod
    def python_version() -> str:
        return platform.python_version()

    @staticmethod
    def memory() -> MemoryStatus:
        meminfo = _read_bounded(Path("/proc/meminfo"))
        if meminfo is None:
            return MemoryStatus(None, None)
        values: dict[str, int] = {}
        for line in meminfo.splitlines():
            key, separator, raw = line.partition(":")
            if not separator or key not in {"MemTotal", "MemAvailable"}:
                continue
            parts = raw.strip().split()
            if len(parts) == 2 and parts[0].isdecimal() and parts[1] == "kB":
                values[key] = int(parts[0]) * 1024
        return MemoryStatus(values.get("MemTotal"), values.get("MemAvailable"))

    @staticmethod
    def uptime_seconds() -> int | None:
        uptime = _read_bounded(Path("/proc/uptime"))
        if uptime is None:
            return None
        try:
            value = int(float(uptime.split(maxsplit=1)[0]))
        except (ValueError, IndexError):
            return None
        return max(value, 0)

    @staticmethod
    def thermal() -> ThermalStatus:
        # Raspberry Pi exposes millidegrees Celsius here. Absence is expected on
        # development machines and must not be presented as healthy hardware.
        raw = _read_bounded(Path("/sys/class/thermal/thermal_zone0/temp"))
        if raw is None:
            return ThermalStatus(None, "unavailable")
        try:
            temperature = float(raw.strip()) / 1000.0
        except ValueError:
            return ThermalStatus(None, "unavailable")
        if not -20 <= temperature <= 150:
            return ThermalStatus(None, "unavailable")
        return ThermalStatus(
            round(temperature, 1),
            "warning" if temperature >= 80 else "not_checked",
        )
