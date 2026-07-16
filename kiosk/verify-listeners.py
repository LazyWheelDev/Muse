#!/usr/bin/env python3
"""Verify Muse loopback binding and restricted listener isolation."""

from __future__ import annotations

import ipaddress
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

RFC1918 = (
    ipaddress.IPv4Network("10.0.0.0/8"),
    ipaddress.IPv4Network("172.16.0.0/12"),
    ipaddress.IPv4Network("192.168.0.0/16"),
)


def listening_addresses(port: int) -> set[str]:
    result = subprocess.run(
        ["/usr/bin/ss", "-H", "-ltn", f"sport = :{port}"],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
        shell=False,
    )
    addresses: set[str] = set()
    for line in result.stdout.splitlines():
        columns = line.split()
        if len(columns) >= 4:
            local = columns[3]
            host = local.rsplit(":", 1)[0].strip("[]")
            addresses.add(host)
    return addresses


def runtime_address(path: Path) -> str | None:
    if not path.is_file() or path.is_symlink():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"MUSE_PHONE_UPLOAD_BIND_HOST=([0-9.]+)", line)
        if match:
            address = ipaddress.IPv4Address(match.group(1))
            if not any(address in network for network in RFC1918):
                raise RuntimeError("runtime phone address is not a usable private IPv4")
            return str(address)
    raise RuntimeError("runtime network environment has no phone bind address")


def status(url: str) -> int:
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def main() -> int:
    main_addresses = listening_addresses(8000)
    if main_addresses != {"127.0.0.1"}:
        print(
            f"FAIL: main port 8000 is not loopback-only: {sorted(main_addresses)}", file=sys.stderr
        )
        return 1
    if status("http://127.0.0.1:8000/api/v1/readiness") != 200:
        print("FAIL: main readiness is unavailable", file=sys.stderr)
        return 1
    address = runtime_address(Path("/run/muse/network.env"))
    if address is None:
        print("WARN: no private address is available; restricted listener is correctly optional")
        return 0
    phone_addresses = listening_addresses(8787)
    if phone_addresses != {address}:
        print(
            f"FAIL: phone port 8787 is not bound only to {address}: {sorted(phone_addresses)}",
            file=sys.stderr,
        )
        return 1
    base = f"http://{address}:8787"
    if status(base + "/listener-status") != 200:
        print("FAIL: restricted listener is not ready", file=sys.stderr)
        return 1
    for path in (
        "/api/v1/health",
        "/api/v1/readiness",
        "/api/v1/settings",
        "/api/v1/clothing-items",
        "/api/v1/outfits",
        "/api/docs",
        "/api/openapi.json",
    ):
        if status(base + path) != 404:
            print(f"FAIL: restricted listener exposed {path}", file=sys.stderr)
            return 1
    print("PASS: main API is loopback-only and phone listener remains restricted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
