import json
import logging
import os
import stat
import subprocess
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from muse_backend.config import PlatformCapabilityMode, Settings
from muse_backend.domain.exceptions import ResourceConflictError
from muse_backend.services.import_admission import InterprocessImportLock

logger = logging.getLogger(__name__)


class DeviceAction(StrEnum):
    RESTART_APPLICATION = "restart_application"
    REBOOT_DEVICE = "reboot_device"
    SHUTDOWN_DEVICE = "shutdown_device"


@dataclass(frozen=True, slots=True)
class DeviceControlCapability:
    available: bool
    state: Literal[
        "available",
        "unavailable",
        "requires_deployment_configuration",
    ]
    reason: str | None


class DeviceControlService:
    """Invoke only the provisioned, root-owned Muse helper with fixed arguments."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def capability(self) -> DeviceControlCapability:
        if self.settings.platform_capability_mode is not PlatformCapabilityMode.RASPBERRY_PI:
            return DeviceControlCapability(
                False,
                "requires_deployment_configuration",
                "Requires validated Raspberry Pi deployment configuration.",
            )
        reason = self._validate_helper()
        if reason is not None:
            return DeviceControlCapability(False, "unavailable", reason)
        try:
            result = subprocess.run(
                self._command("probe"),
                check=False,
                capture_output=True,
                text=True,
                timeout=self.settings.device_control_timeout_seconds,
                shell=False,
                env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"},
            )
        except (OSError, subprocess.TimeoutExpired):
            return DeviceControlCapability(
                False,
                "unavailable",
                "The constrained device-control helper could not be verified.",
            )
        if result.returncode != 0 or result.stdout.strip() != "muse-device-control-ready":
            return DeviceControlCapability(
                False,
                "unavailable",
                "The constrained device-control authorization is unavailable.",
            )
        return DeviceControlCapability(True, "available", None)

    def schedule(self, action: DeviceAction) -> None:
        capability = self.capability()
        if not capability.available:
            raise RuntimeError(capability.reason or "device control is unavailable")
        marker = self.settings.device_action_marker_path
        with InterprocessImportLock(self.settings).acquire(blocking=False):
            try:
                descriptor = os.open(
                    marker,
                    os.O_WRONLY
                    | os.O_CREAT
                    | os.O_EXCL
                    | getattr(os, "O_CLOEXEC", 0)
                    | getattr(os, "O_NOFOLLOW", 0),
                    0o600,
                )
            except FileExistsError as error:
                raise ResourceConflictError(
                    code="device_action_pending",
                    message="A device action is already scheduled.",
                ) from error
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                    json.dump({"action": action.value}, output, separators=(",", ":"))
                    output.flush()
                    os.fsync(output.fileno())
                marker.chmod(0o600)
                result = subprocess.run(
                    self._command(action.value),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=self.settings.device_control_timeout_seconds,
                    shell=False,
                    env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"},
                )
                if result.returncode != 0:
                    raise RuntimeError("the constrained device action could not be scheduled")
            except Exception:
                marker.unlink(missing_ok=True)
                raise
        logger.warning("Scheduled constrained Muse device action: %s", action.value)

    def clear_stale_marker(self) -> None:
        self.settings.device_action_marker_path.unlink(missing_ok=True)

    def _command(self, argument: str) -> list[str]:
        return [
            str(self.settings.device_control_sudo_path),
            "-n",
            "--",
            str(self.settings.device_control_helper_path),
            argument,
        ]

    def _validate_helper(self) -> str | None:
        helper = self.settings.device_control_helper_path
        sudo = self.settings.device_control_sudo_path
        try:
            helper_status = helper.stat(follow_symlinks=False)
            sudo_status = sudo.stat(follow_symlinks=False)
        except OSError:
            return "The constrained device-control helper is not installed."
        if (
            not stat.S_ISREG(helper_status.st_mode)
            or helper_status.st_uid != 0
            or helper_status.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
            or not helper_status.st_mode & stat.S_IXUSR
        ):
            return "The constrained device-control helper has unsafe ownership or permissions."
        if (
            not stat.S_ISREG(sudo_status.st_mode)
            or sudo_status.st_uid != 0
            or sudo_status.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
            or not sudo_status.st_mode & stat.S_IXUSR
        ):
            return "The fixed privilege broker is unavailable or unsafe."
        return None
