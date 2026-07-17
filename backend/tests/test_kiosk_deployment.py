import gzip
import importlib.util
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from muse_backend.config import Settings
from muse_backend.domain.exceptions import ResourceConflictError
from muse_backend.services.device_control import (
    DeviceAction,
    DeviceControlCapability,
    DeviceControlService,
)
from muse_backend.services.import_admission import InterprocessImportLock
from muse_backend.services.production import prepare_production
from muse_backend.storage.local import LocalStorageService

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
KIOSK_ROOT = REPOSITORY_ROOT / "kiosk"


def _load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


release = _load_module("muse_release_tool", KIOSK_ROOT / "lib" / "release.py")
network = _load_module("muse_network_env", KIOSK_ROOT / "lib" / "network_env.py")

VALID_RELEASE_ID = "20260716T120000Z-0123456789ab"
SECRET_ASSIGNMENT_PATTERN = re.compile(r"(?i)\b(password|secret|token)=\S+")
PHONE_TOKEN_PATTERN = re.compile(r"#token=[A-Za-z0-9_-]{43}")


def _write_release_manifest(root: Path) -> None:
    files: dict[str, dict[str, int | str]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != "release-manifest.json":
            relative = path.relative_to(root).as_posix()
            files[relative] = {"size": path.stat().st_size, "sha256": release.sha256(path)}
    manifest = {
        "schema_version": 1,
        "release_id": VALID_RELEASE_ID,
        "git_commit": "0" * 40,
        "build_timestamp": "2026-07-16T12:00:00Z",
        "source_dirty": False,
        "expected_paths": list(release.REQUIRED_PATHS),
        "frontend": {"device": {}, "phone": {}},
        "files": files,
    }
    (root / "release-manifest.json").write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def _minimal_release(tmp_path: Path, *, include_kiosk: bool = False) -> Path:
    root = tmp_path / VALID_RELEASE_ID
    for relative in release.REQUIRED_PATHS:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"fixture for {relative}\n", encoding="utf-8")
    if include_kiosk:
        shutil.rmtree(root / "kiosk")
        shutil.copytree(
            KIOSK_ROOT,
            root / "kiosk",
            ignore=shutil.ignore_patterns("tests", *release.FORBIDDEN_PARTS),
        )
        for script in (root / "kiosk").rglob("*"):
            if script.is_file() and script.read_bytes().startswith(b"#!"):
                script.chmod(0o755)
    _write_release_manifest(root)
    return root


def _archive_release(root: Path, destination: Path) -> Path:
    with (
        destination.open("wb") as raw,
        gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed,
        tarfile.open(fileobj=compressed, mode="w") as archive,
    ):
        archive.add(root, arcname=root.name)
    return destination


def _sanitize_installer_output(value: str, temporary_root: Path) -> str:
    sanitized = value
    replacements = {
        str(temporary_root): "<temporary-root>",
        str(REPOSITORY_ROOT): "<repository>",
        str(Path.home()): "<home>",
    }
    for sensitive, replacement in sorted(replacements.items(), key=lambda item: -len(item[0])):
        if sensitive and sensitive != "/":
            sanitized = sanitized.replace(sensitive, replacement)
    sanitized = PHONE_TOKEN_PATTERN.sub("#token=<redacted>", sanitized)
    sanitized = SECRET_ASSIGNMENT_PATTERN.sub(r"\1=<redacted>", sanitized)
    return sanitized.strip() or "<empty>"


def _run_sandbox_install(command: list[str], *, invocation: str, temporary_root: Path) -> None:
    failure: tuple[int, str, str] | None = None
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        stdout = error.stdout if isinstance(error.stdout, str) else ""
        stderr = error.stderr if isinstance(error.stderr, str) else ""
        failure = (error.returncode, stdout, stderr)
    if failure is None:
        return
    return_code, stdout, stderr = failure
    pytest.fail(
        f"sandbox installer failed during {invocation} invocation\n"
        f"return code: {return_code}\n"
        f"stdout (sanitized):\n{_sanitize_installer_output(stdout, temporary_root)}\n"
        f"stderr (sanitized):\n{_sanitize_installer_output(stderr, temporary_root)}",
        pytrace=False,
    )


def _run_test_launcher(
    *,
    use_wayland: bool,
) -> tuple[list[str], dict[str, str], Path, int]:
    with tempfile.TemporaryDirectory(prefix="muse-kiosk-launch-", dir="/tmp") as temporary:
        root = Path(temporary)
        runtime = root / "runtime"
        runtime.mkdir()
        x11_socket = root / "X0"
        display_socket_path = runtime / "wayland-0" if use_wayland else x11_socket

        current = root / "opt/muse/current"
        (current / "kiosk").mkdir(parents=True)
        wait_readiness = current / "kiosk/wait-readiness.sh"
        wait_readiness.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
        wait_readiness.chmod(0o755)

        browser = root / "chromium"
        browser.write_text(
            "#!/usr/bin/env bash\n"
            'printf \'%s\\n\' "$@" >"${MUSE_TEST_CAPTURE}/arguments"\n'
            'env >"${MUSE_TEST_CAPTURE}/environment"\n',
            encoding="utf-8",
        )
        browser.chmod(0o755)
        browser_fallback = root / "chromium-browser"

        kiosk_root = root / "var/lib/muse-kiosk"
        profile = kiosk_root / "operator/chromium"
        capture = root / "capture"
        capture.mkdir()

        launcher_text = (KIOSK_ROOT / "launch-kiosk.sh").read_text(encoding="utf-8")
        replacements = (
            ("/usr/bin/chromium-browser", str(browser_fallback)),
            ("/usr/bin/chromium", str(browser)),
            ("/opt/muse/current", str(current)),
            ("/var/lib/muse-kiosk", str(kiosk_root)),
            ("/run/user/${uid}", str(runtime)),
            ("/tmp/.X11-unix/X0", str(x11_socket)),
        )
        for original, replacement in replacements:
            launcher_text = launcher_text.replace(original, replacement)
        launcher = root / "launch-kiosk.sh"
        launcher.write_text(launcher_text, encoding="utf-8")
        launcher.chmod(0o755)

        environment = {
            key: value
            for key, value in os.environ.items()
            if key
            not in {"DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"}
        }
        environment.update(
            {
                "MUSE_KIOSK_PROFILE": str(profile),
                "MUSE_TEST_CAPTURE": str(capture),
            }
        )
        with socket.socket(socket.AF_UNIX) as display_socket:
            display_socket.bind(str(display_socket_path))
            subprocess.run(
                ["bash", str(launcher)],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
                env=environment,
            )

        arguments = (capture / "arguments").read_text(encoding="utf-8").splitlines()
        captured_environment = dict(
            line.split("=", 1)
            for line in (capture / "environment").read_text(encoding="utf-8").splitlines()
            if "=" in line
        )
        profile_mode = profile.stat().st_mode & 0o777
        return arguments, captured_environment, profile, profile_mode


def test_release_id_and_path_validation_reject_traversal() -> None:
    for value in ("../release", "/absolute", "latest", "20260716T120000Z-ABCDEF012345"):
        with pytest.raises(release.ReleaseError):
            release.validate_release_id(value)
    for value in (
        "backend/.env",
        "local-data/muse.sqlite3",
        "frontend/node_modules/a.js",
        "../escape",
    ):
        with pytest.raises(release.ReleaseError):
            release._safe_relative(value)


def test_release_manifest_accepts_complete_release_and_rejects_checksum_mismatch(
    tmp_path: Path,
) -> None:
    root = _minimal_release(tmp_path)
    manifest = release.verify_release_directory(root)
    assert manifest["release_id"] == VALID_RELEASE_ID

    (root / "backend/pyproject.toml").write_text("tampered\n", encoding="utf-8")
    with pytest.raises(release.ReleaseError, match="checksum mismatch"):
        release.verify_release_directory(root)


def test_release_manifest_rejects_missing_build(tmp_path: Path) -> None:
    root = _minimal_release(tmp_path)
    (root / "frontend/dist/index.html").unlink()
    with pytest.raises(release.ReleaseError, match="file set mismatch"):
        release.verify_release_directory(root)


def test_archive_rejects_path_traversal(tmp_path: Path) -> None:
    archive_path = tmp_path / "unsafe.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        info = tarfile.TarInfo(f"{VALID_RELEASE_ID}/../../escape")
        info.size = 1
        archive.addfile(info, io.BytesIO(b"x"))
    with pytest.raises(release.ReleaseError, match="unsafe archive path"):
        release.verify_archive(archive_path, extract=None)


def test_release_archive_contains_no_environment_or_local_data(tmp_path: Path) -> None:
    root = _minimal_release(tmp_path / "source")
    archive_path = _archive_release(root, tmp_path / "release.tar.gz")
    release.verify_archive(archive_path, extract=None)
    with tarfile.open(archive_path, "r:gz") as archive:
        names = [member.name for member in archive.getmembers()]
    assert not any("backend/.env" in name for name in names)
    assert not any("local-data" in Path(name).parts for name in names)
    assert not any("node_modules" in Path(name).parts for name in names)


def test_release_backend_wrapper_uses_source_and_survives_release_move(tmp_path: Path) -> None:
    initial = tmp_path / "staging" / VALID_RELEASE_ID
    (initial / ".venv/bin").mkdir(parents=True)
    (initial / ".venv/bin/python").symlink_to(sys.executable)
    package = initial / "backend/src/muse_backend"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "cli.py").write_text(
        "import sys\nprint('release-wrapper:' + ','.join(sys.argv[1:]))\n",
        encoding="utf-8",
    )
    (initial / "kiosk").mkdir()
    wrapper = initial / "kiosk/muse-backend"
    shutil.copy2(KIOSK_ROOT / "muse-backend", wrapper)
    wrapper.chmod(0o755)

    first = subprocess.run(
        [str(wrapper), "before"],
        check=True,
        capture_output=True,
        text=True,
    )
    activated = tmp_path / "releases" / VALID_RELEASE_ID
    activated.parent.mkdir()
    shutil.move(initial, activated)
    result = subprocess.run(
        [str(activated / "kiosk/muse-backend"), "after"],
        check=True,
        capture_output=True,
        text=True,
    )

    assert first.stdout.strip() == "release-wrapper:before"
    assert result.stdout.strip() == "release-wrapper:after"


def test_network_environment_accepts_one_private_address_and_is_atomic(tmp_path: Path) -> None:
    routes = [{"dst": "default", "dev": "end0", "gateway": "192.168.4.1"}]
    addresses = [
        {
            "ifname": "end0",
            "addr_info": [
                {"family": "inet6", "local": "fe80::1"},
                {"family": "inet", "local": "192.168.4.25"},
            ],
        }
    ]
    assert network.select_interface(routes, None) == "end0"
    address = network.select_address(addresses)
    content = network.environment_content(address, "muse.local")
    assert "MUSE_PHONE_UPLOAD_BIND_HOST=192.168.4.25" in content
    assert "MUSE_PHONE_UPLOAD_ADVERTISED_IPV4=192.168.4.25" in content
    assert "upload" not in content.lower() or "token" not in content.lower()

    destination = tmp_path / "run" / "network.env"
    assert network.write_environment(destination, content, owner=None, group=None)
    assert not network.write_environment(destination, content, owner=None, group=None)
    assert destination.stat().st_mode & 0o777 == 0o640


def test_network_environment_read_only_check_rejects_stale_content(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "network.env"
    active = network.private_ipv4("192.168.4.25")
    destination.write_text(network.environment_content(active, "muse.local"), encoding="utf-8")

    def fake_ip(arguments: list[str]) -> Any:
        if arguments == ["route", "show", "default"]:
            return [{"dst": "default", "dev": "end0"}]
        return [{"ifname": "end0", "addr_info": [{"family": "inet", "local": "192.168.4.25"}]}]

    monkeypatch.setattr(network, "_ip_json", fake_ip)
    assert network.check_existing(
        destination,
        interface=None,
        advertised_host="muse.local",
    ) == ("end0", active)

    destination.write_text(
        network.environment_content(network.private_ipv4("192.168.4.26"), "muse.local"),
        encoding="utf-8",
    )
    with pytest.raises(network.NetworkEnvironmentError, match="stale"):
        network.check_existing(destination, interface=None, advertised_host="muse.local")


def test_network_environment_rejects_public_link_local_and_ambiguous_addresses() -> None:
    for value in ("8.8.8.8", "169.254.1.2", "127.0.0.1", "224.0.0.1", "invalid"):
        with pytest.raises(network.NetworkEnvironmentError):
            network.private_ipv4(value)
    with pytest.raises(network.NetworkEnvironmentError, match="unambiguous"):
        network.select_interface(
            [{"dst": "default", "dev": "eth0"}, {"dst": "default", "dev": "wlan0"}],
            None,
        )
    with pytest.raises(network.NetworkEnvironmentError, match="unambiguous"):
        network.select_address(
            [
                {
                    "addr_info": [
                        {"family": "inet", "local": "10.0.0.2"},
                        {"family": "inet", "local": "10.0.0.3"},
                    ]
                }
            ]
        )


def test_systemd_and_chromium_security_contracts() -> None:
    main_unit = (KIOSK_ROOT / "systemd/muse-main.service").read_text(encoding="utf-8")
    phone_unit = (KIOSK_ROOT / "systemd/muse-phone-upload.service").read_text(encoding="utf-8")
    kiosk_unit = (KIOSK_ROOT / "systemd/muse-kiosk@.service").read_text(encoding="utf-8")
    launcher = (KIOSK_ROOT / "launch-kiosk.sh").read_text(encoding="utf-8")
    installer = (KIOSK_ROOT / "install-on-pi.sh").read_text(encoding="utf-8")

    assert "muse-backend serve --host 127.0.0.1 --port 8000" in main_unit
    assert ".venv/bin/muse-backend" not in main_unit
    assert "User=muse" in main_unit
    assert "EnvironmentFile=/run/muse/network.env" in phone_unit
    assert "ConditionPathExists=/run/muse/network.env" in phone_unit
    assert "--check-existing" in phone_unit
    assert "--owner" not in phone_unit
    assert "User=%i" in kiosk_unit and "User=root" not in kiosk_unit
    assert "--no-sandbox" not in launcher
    assert "--remote-debugging" not in launcher
    assert 'rm -rf -- "$data_root"' not in installer
    assert "ProtectSystem=strict" in main_unit
    assert "NoNewPrivileges=true" in main_unit

    required_kiosk_environment = {
        "Environment=HOME=/var/lib/muse-kiosk/%i",
        "Environment=XDG_CONFIG_HOME=/var/lib/muse-kiosk/%i/config",
        "Environment=XDG_CACHE_HOME=/var/lib/muse-kiosk/%i/cache",
        "Environment=XDG_DATA_HOME=/var/lib/muse-kiosk/%i/data",
        "Environment=MUSE_KIOSK_PROFILE=/var/lib/muse-kiosk/%i/chromium",
    }
    assert required_kiosk_environment <= set(kiosk_unit.splitlines())
    assert "UMask=0077" in kiosk_unit
    for directory in ("config", "cache", "data", "chromium"):
        assert f'"${{kiosk_data_root}}/${{operator_user}}/{directory}"' in installer
    assert 'chown -R "${operator_user}:${operator_group}"' in installer
    assert "kiosk/launch-kiosk.sh" in release.REQUIRED_PATHS
    assert "kiosk/systemd/muse-kiosk@.service" in release.REQUIRED_PATHS


def test_wayland_launcher_uses_validated_private_kiosk_configuration() -> None:
    arguments, environment, profile, profile_mode = _run_test_launcher(use_wayland=True)

    required_flags = {
        "--ozone-platform=wayland",
        "--kiosk",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--disable-breakpad",
        "--disable-crash-reporter",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-domain-reliability",
        "--disable-sync",
        "--no-pings",
        "--disable-features=Translate,MediaRouter,OptimizationHints",
    }
    assert required_flags <= set(arguments)
    assert arguments[-1] == "http://127.0.0.1:8000"
    assert f"--user-data-dir={profile}" in arguments
    assert environment["WAYLAND_DISPLAY"] == "wayland-0"
    assert "DISPLAY" not in environment
    assert environment["XDG_RUNTIME_DIR"].endswith("/runtime")
    assert environment["DBUS_SESSION_BUS_ADDRESS"] == (
        f"unix:path={environment['XDG_RUNTIME_DIR']}/bus"
    )
    assert profile_mode == 0o700


def test_x11_launcher_keeps_x11_backend_compatibility() -> None:
    arguments, environment, _profile, _profile_mode = _run_test_launcher(use_wayland=False)

    assert "--ozone-platform=wayland" not in arguments
    assert environment["DISPLAY"] == ":0"
    assert "WAYLAND_DISPLAY" not in environment


def test_display_dry_run_cannot_be_combined_with_mutation(tmp_path: Path) -> None:
    state = tmp_path / "display-state.json"
    result = subprocess.run(
        [
            sys.executable,
            str(KIOSK_ROOT / "muse-display-config"),
            "cursor",
            "--dry-run",
            "--apply",
            "--confirm",
            "APPLY MUSE DISPLAY",
        ],
        check=False,
        capture_output=True,
        text=True,
        env={**os.environ, "MUSE_DISPLAY_STATE": str(state)},
    )
    assert result.returncode == 1
    assert "cannot be combined" in result.stderr
    assert not state.exists()


def test_device_control_uses_only_fixed_non_shell_commands(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        environment="testing",
        data_root=tmp_path / "data",
        frontend_build_path=tmp_path / "device",
        phone_upload_frontend_build_path=tmp_path / "phone",
        platform_capability_mode="raspberry_pi",
        device_control_helper_path=tmp_path / "muse-device-control",
        device_control_sudo_path=tmp_path / "sudo",
        phone_upload_enabled=False,
    )
    LocalStorageService(settings).create_required_directories()
    calls: list[tuple[list[str], bool]] = []

    def fake_run(arguments: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        calls.append((arguments, bool(kwargs["shell"])))
        stdout = "muse-device-control-ready\n" if arguments[-1] == "probe" else ""
        return subprocess.CompletedProcess(arguments, 0, stdout=stdout, stderr="")

    monkeypatch.setattr(DeviceControlService, "_validate_helper", lambda _self: None)
    monkeypatch.setattr(subprocess, "run", fake_run)
    service = DeviceControlService(settings)

    assert service.capability() == DeviceControlCapability(True, "available", None)
    service.schedule(DeviceAction.REBOOT_DEVICE)

    assert all(shell is False for _arguments, shell in calls)
    assert calls[-1][0] == [
        str(settings.device_control_sudo_path),
        "-n",
        "--",
        str(settings.device_control_helper_path),
        "reboot_device",
    ]
    assert settings.device_action_marker_path.is_file()

    settings.device_action_marker_path.unlink()
    with (
        InterprocessImportLock(settings).acquire(blocking=False),
        pytest.raises(ResourceConflictError),
    ):
        service.schedule(DeviceAction.RESTART_APPLICATION)
    assert not settings.device_action_marker_path.exists()

    def fail_action(arguments: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        if arguments[-1] == "probe":
            return subprocess.CompletedProcess(
                arguments,
                0,
                stdout="muse-device-control-ready\n",
                stderr="",
            )
        return subprocess.CompletedProcess(
            arguments,
            1,
            stdout="",
            stderr="sensitive broker detail",
        )

    monkeypatch.setattr(subprocess, "run", fail_action)
    with pytest.raises(RuntimeError, match="could not be scheduled"):
        service.schedule(DeviceAction.SHUTDOWN_DEVICE)
    assert not settings.device_action_marker_path.exists()


def test_production_preparation_is_idempotent_and_preserves_data(tmp_path: Path) -> None:
    settings = Settings(
        environment="testing",
        data_root=tmp_path / "data",
        frontend_build_path=tmp_path / "device",
        phone_upload_frontend_build_path=tmp_path / "phone",
        phone_upload_enabled=False,
    )
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    sentinel = settings.data_root / "preserve-me"
    sentinel.write_text("wardrobe\n", encoding="utf-8")

    assert prepare_production(settings) is None
    assert prepare_production(settings) is None

    assert sentinel.read_text(encoding="utf-8") == "wardrobe\n"
    assert settings.database_path.is_file()


def test_rollback_state_selects_previous_release_without_touching_data(tmp_path: Path) -> None:
    root = tmp_path / "sandbox"
    opt = root / "opt/muse"
    state = opt / "state"
    releases = opt / "releases"
    first = "20260716T120000Z-0123456789ab"
    second = "20260716T130000Z-abcdef012345"
    for release_id in (first, second):
        (releases / release_id).mkdir(parents=True)
    state.mkdir(parents=True)
    (state / "previous-release").write_text(first + "\n", encoding="utf-8")
    (opt / "current").symlink_to(f"releases/{second}")
    data = root / "var/lib/muse"
    data.mkdir(parents=True)
    sentinel = data / "preserve-me"
    sentinel.write_text("wardrobe\n", encoding="utf-8")

    subprocess.run(
        [
            "bash",
            str(KIOSK_ROOT / "rollback.sh"),
            "--operator",
            "kyle",
            "--root-prefix",
            str(root),
            "--no-services",
        ],
        check=True,
    )

    assert os.readlink(opt / "current") == f"releases/{first}"
    assert (state / "active-release").read_text(encoding="utf-8").strip() == first
    assert sentinel.read_text(encoding="utf-8") == "wardrobe\n"


def test_installer_and_rollback_reject_unsafe_target_roots(tmp_path: Path) -> None:
    archive = tmp_path / "release.tar.gz"
    release_tool = tmp_path / "release.py"
    archive.write_bytes(b"not reached")
    release_tool.write_text("# not reached\n", encoding="utf-8")
    installer = subprocess.run(
        [
            "bash",
            str(KIOSK_ROOT / "install-on-pi.sh"),
            "--archive",
            str(archive),
            "--release-tool",
            str(release_tool),
            "--operator",
            "kyle",
            "--root-prefix",
            "/",
            "--no-services",
            "--skip-dependencies",
            "--python-bin",
            sys.executable,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert installer.returncode == 2
    assert "absolute, non-root" in installer.stderr

    result = subprocess.run(
        [
            "bash",
            str(KIOSK_ROOT / "rollback.sh"),
            "--operator",
            "kyle",
            "--root-prefix",
            "/",
            "--no-services",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "Unsafe sandbox rollback" in result.stderr
    assert not (tmp_path / "unexpected").exists()


@pytest.mark.skipif(sys.platform == "darwin", reason="sandbox installer exercises GNU/Linux tools")
def test_sandbox_install_is_idempotent_and_preserves_data(tmp_path: Path) -> None:
    release_root = _minimal_release(tmp_path / "source", include_kiosk=True)
    archive = _archive_release(release_root, tmp_path / "release.tar.gz")
    sandbox = tmp_path / "sandbox"
    data = sandbox / "var/lib/muse"
    data.mkdir(parents=True)
    sentinel = data / "preserve-me"
    sentinel.write_text("wardrobe\n", encoding="utf-8")
    config = sandbox / "etc/muse"
    config.mkdir(parents=True)
    environment = config / "muse.env"
    environment.write_text("MUSE_ENVIRONMENT=production\n", encoding="utf-8")
    environment.chmod(0o640)
    operator_user = subprocess.run(
        ["id", "-un"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    command = [
        "bash",
        str(KIOSK_ROOT / "install-on-pi.sh"),
        "--archive",
        str(archive),
        "--release-tool",
        str(KIOSK_ROOT / "lib/release.py"),
        "--operator",
        operator_user,
        "--root-prefix",
        str(sandbox),
        "--no-services",
        "--skip-dependencies",
        "--python-bin",
        sys.executable,
    ]
    _run_sandbox_install(command, invocation="first", temporary_root=tmp_path)
    kiosk_operator_root = sandbox / "var/lib/muse-kiosk" / operator_user
    for directory in (
        kiosk_operator_root,
        kiosk_operator_root / "config",
        kiosk_operator_root / "cache",
        kiosk_operator_root / "data",
        kiosk_operator_root / "chromium",
    ):
        directory.chmod(0o755)
    _run_sandbox_install(command, invocation="second", temporary_root=tmp_path)

    assert sentinel.read_text(encoding="utf-8") == "wardrobe\n"
    assert (sandbox / "opt/muse/current").is_symlink()
    assert environment.read_text(encoding="utf-8") == "MUSE_ENVIRONMENT=production\n"
    assert environment.stat().st_mode & 0o777 == 0o640
    assert (sandbox / "opt/muse/releases" / VALID_RELEASE_ID).stat().st_mode & 0o777 == 0o555
    for directory in (
        kiosk_operator_root,
        kiosk_operator_root / "config",
        kiosk_operator_root / "cache",
        kiosk_operator_root / "data",
        kiosk_operator_root / "chromium",
    ):
        assert directory.stat().st_mode & 0o777 == 0o700
        assert directory.stat().st_uid == os.getuid()
        assert directory.stat().st_gid == os.getgid()
