from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class MemoryStatus:
    total_bytes: int | None
    available_bytes: int | None


@dataclass(frozen=True, slots=True)
class ThermalStatus:
    temperature_celsius: float | None
    status: Literal["not_checked", "warning", "unavailable"]
