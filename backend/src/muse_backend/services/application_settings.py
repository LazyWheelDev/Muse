import json
from dataclasses import dataclass
from typing import Literal, cast

from sqlalchemy.orm import Session

from muse_backend.repositories.settings import ApplicationSettingsRepository
from muse_backend.schemas.settings import (
    ApplicationPreferences,
    ApplicationPreferencesUpdate,
    ScreenTimeoutMinutes,
    SplashMode,
)

_DEVICE_NAME = "device_name"
_BRIGHTNESS = "interface_brightness_percent"
_TIMEOUT = "screen_timeout_minutes"
_REDUCED_MOTION = "reduced_motion"
_SPLASH_MODE = "splash_mode"


@dataclass(frozen=True, slots=True)
class _SettingSpec:
    default: str | int | bool
    value_type: Literal["string", "integer", "boolean"]


_SPECS: dict[str, _SettingSpec] = {
    _DEVICE_NAME: _SettingSpec("Muse", "string"),
    _BRIGHTNESS: _SettingSpec(100, "integer"),
    _TIMEOUT: _SettingSpec(10, "integer"),
    _REDUCED_MOTION: _SettingSpec(False, "boolean"),
    _SPLASH_MODE: _SettingSpec("full", "string"),
}


class ApplicationSettingsService:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._repository = ApplicationSettingsRepository()

    def get(self) -> ApplicationPreferences:
        values = {key: self._read(key, spec) for key, spec in _SPECS.items()}
        return ApplicationPreferences(
            device_name=cast(str, values[_DEVICE_NAME]),
            interface_brightness_percent=cast(int, values[_BRIGHTNESS]),
            screen_timeout_minutes=cast(ScreenTimeoutMinutes, values[_TIMEOUT]),
            reduced_motion=cast(bool, values[_REDUCED_MOTION]),
            splash_mode=cast(SplashMode, values[_SPLASH_MODE]),
        )

    def update(self, update: ApplicationPreferencesUpdate) -> ApplicationPreferences:
        changes = update.model_dump(exclude_none=True)
        for key, value in changes.items():
            spec = _SPECS[key]
            self._repository.put(
                self._session,
                key=key,
                value_json=json.dumps(value, separators=(",", ":")),
                value_type=spec.value_type,
            )
        self._session.commit()
        return self.get()

    def _read(self, key: str, spec: _SettingSpec) -> str | int | bool:
        row = self._repository.get(self._session, key)
        if row is None or row.value_type != spec.value_type:
            return spec.default
        try:
            value = json.loads(row.value_json)
        except (json.JSONDecodeError, TypeError):
            return spec.default
        if spec.value_type == "boolean" and type(value) is bool:
            return value
        if spec.value_type == "integer" and type(value) is int:
            if key == _BRIGHTNESS and 20 <= value <= 100:
                return value
            if key == _TIMEOUT and value in {0, 5, 10, 15, 30}:
                return value
        if spec.value_type == "string" and isinstance(value, str):
            if (
                key == _DEVICE_NAME
                and 1 <= len(value) <= 48
                and not any(ord(character) < 32 or ord(character) == 127 for character in value)
            ):
                return value
            if key == _SPLASH_MODE and value in {"full", "reduced"}:
                return value
        return spec.default
