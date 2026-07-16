#!/usr/bin/env python3
"""Generate Muse's private-LAN EnvironmentFile from one unambiguous interface."""

from __future__ import annotations

import argparse
import grp
import ipaddress
import json
import os
import pwd
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

RFC1918 = (
    ipaddress.IPv4Network("10.0.0.0/8"),
    ipaddress.IPv4Network("172.16.0.0/12"),
    ipaddress.IPv4Network("192.168.0.0/16"),
)
HOST_PATTERN = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$"
)


class NetworkEnvironmentError(RuntimeError):
    pass


def private_ipv4(value: str) -> ipaddress.IPv4Address:
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError as error:
        raise NetworkEnvironmentError("network address is malformed") from error
    if not any(address in network for network in RFC1918):
        raise NetworkEnvironmentError("network address is not RFC1918 private IPv4")
    if (
        address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
    ):
        raise NetworkEnvironmentError("network address is not usable")
    return address


def select_interface(routes: Any, requested: str | None) -> str:
    if requested is not None:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,32}", requested):
            raise NetworkEnvironmentError("configured interface name is invalid")
        return requested
    if not isinstance(routes, list):
        raise NetworkEnvironmentError("default-route data is invalid")
    interfaces = {
        route.get("dev")
        for route in routes
        if isinstance(route, dict)
        and route.get("dst", "default") == "default"
        and isinstance(route.get("dev"), str)
        and route.get("dev") != "lo"
    }
    if len(interfaces) != 1:
        raise NetworkEnvironmentError("default route does not select one unambiguous interface")
    return str(next(iter(interfaces)))


def select_address(address_records: Any) -> ipaddress.IPv4Address:
    if not isinstance(address_records, list) or len(address_records) != 1:
        raise NetworkEnvironmentError("address data must describe exactly one interface")
    record = address_records[0]
    if not isinstance(record, dict) or not isinstance(record.get("addr_info"), list):
        raise NetworkEnvironmentError("interface address data is invalid")
    candidates: list[ipaddress.IPv4Address] = []
    for entry in record["addr_info"]:
        if not isinstance(entry, dict) or entry.get("family") != "inet":
            continue
        local = entry.get("local")
        if not isinstance(local, str):
            continue
        try:
            candidates.append(private_ipv4(local))
        except NetworkEnvironmentError:
            continue
    unique = sorted(set(candidates), key=int)
    if len(unique) != 1:
        raise NetworkEnvironmentError(
            "interface does not have one unambiguous private IPv4 address"
        )
    return unique[0]


def validate_advertised_host(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    normalized = value.lower().removesuffix(".")
    if not HOST_PATTERN.fullmatch(normalized):
        raise NetworkEnvironmentError("advertised hostname is invalid")
    return normalized


def environment_content(address: ipaddress.IPv4Address, advertised_host: str | None) -> str:
    hosts = [str(address)]
    lines = [
        "# Generated atomically by Muse. Do not edit.",
        f"MUSE_PHONE_UPLOAD_BIND_HOST={address}",
        f"MUSE_PHONE_UPLOAD_ADVERTISED_IPV4={address}",
    ]
    if advertised_host is not None:
        hosts.append(advertised_host)
        lines.append(f"MUSE_PHONE_UPLOAD_ADVERTISED_HOST={advertised_host}")
    lines.append(
        "MUSE_PHONE_UPLOAD_TRUSTED_HOSTS='" + json.dumps(hosts, separators=(",", ":")) + "'"
    )
    return "\n".join(lines) + "\n"


def write_environment(
    destination: Path,
    content: str,
    *,
    owner: str | None,
    group: str | None,
) -> bool:
    destination = destination.resolve()
    destination.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    previous = None
    try:
        if destination.is_symlink():
            raise NetworkEnvironmentError("runtime EnvironmentFile cannot be a symbolic link")
        previous = destination.read_text(encoding="utf-8") if destination.is_file() else None
    except OSError as error:
        raise NetworkEnvironmentError("runtime EnvironmentFile cannot be read safely") from error
    descriptor, temporary_name = tempfile.mkstemp(prefix="network.env.", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(0o640)
        if owner is not None or group is not None:
            uid = pwd.getpwnam(owner).pw_uid if owner is not None else -1
            gid = grp.getgrnam(group).gr_gid if group is not None else -1
            os.chown(temporary, uid, gid)
        os.replace(temporary, destination)
        directory = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)
    return previous != content


def _ip_json(arguments: list[str]) -> Any:
    result = subprocess.run(
        ["/usr/sbin/ip", "-j", *arguments],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
        shell=False,
        env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"},
    )
    return json.loads(result.stdout)


def generate(
    destination: Path,
    *,
    interface: str | None,
    advertised_host: str | None,
    owner: str | None,
    group: str | None,
) -> tuple[str, ipaddress.IPv4Address, bool]:
    routes = _ip_json(["route", "show", "default"])
    selected_interface = select_interface(routes, interface)
    addresses = _ip_json(["-4", "address", "show", "dev", selected_interface, "scope", "global"])
    address = select_address(addresses)
    host = validate_advertised_host(advertised_host)
    changed = write_environment(
        destination,
        environment_content(address, host),
        owner=owner,
        group=group,
    )
    return selected_interface, address, changed


def check_existing(
    destination: Path,
    *,
    interface: str | None,
    advertised_host: str | None,
) -> tuple[str, ipaddress.IPv4Address]:
    if destination.is_symlink() or not destination.is_file():
        raise NetworkEnvironmentError("runtime EnvironmentFile is missing or unsafe")
    routes = _ip_json(["route", "show", "default"])
    selected_interface = select_interface(routes, interface)
    addresses = _ip_json(["-4", "address", "show", "dev", selected_interface, "scope", "global"])
    address = select_address(addresses)
    expected = environment_content(address, validate_advertised_host(advertised_host))
    try:
        actual = destination.read_text(encoding="utf-8")
    except OSError as error:
        raise NetworkEnvironmentError("runtime EnvironmentFile cannot be read safely") from error
    if actual != expected:
        raise NetworkEnvironmentError(
            "runtime EnvironmentFile is stale or does not match the active network"
        )
    return selected_interface, address


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/run/muse/network.env"))
    parser.add_argument(
        "--interface", default=os.environ.get("MUSE_DEPLOY_NETWORK_INTERFACE") or None
    )
    parser.add_argument(
        "--advertised-host",
        default=os.environ.get("MUSE_DEPLOY_ADVERTISED_HOST") or None,
    )
    parser.add_argument("--owner")
    parser.add_argument("--group")
    parser.add_argument("--check-existing", action="store_true")
    args = parser.parse_args()
    try:
        if args.check_existing:
            if args.owner is not None or args.group is not None:
                raise NetworkEnvironmentError(
                    "read-only validation does not accept ownership changes"
                )
            interface, address = check_existing(
                args.output,
                interface=args.interface,
                advertised_host=args.advertised_host,
            )
            print(f"Muse private-network configuration validated on {interface} ({address})")
            return 0
        interface, address, changed = generate(
            args.output,
            interface=args.interface,
            advertised_host=args.advertised_host,
            owner=args.owner,
            group=args.group,
        )
    except (
        NetworkEnvironmentError,
        OSError,
        subprocess.SubprocessError,
        json.JSONDecodeError,
    ) as error:
        print(f"Muse private-network configuration unavailable: {error}", file=os.sys.stderr)
        return 1
    print(
        f"Muse private-network configuration ready on {interface} ({address}); changed={str(changed).lower()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
