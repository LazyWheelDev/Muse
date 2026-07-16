import fcntl
import ipaddress
import platform
import socket
import struct
from dataclasses import dataclass

from muse_backend.config import Settings
from muse_backend.domain.exceptions import MuseError

_EXCLUDED_INTERFACE_PREFIXES = (
    "br-",
    "docker",
    "tap",
    "tailscale",
    "tun",
    "utun",
    "veth",
    "virbr",
    "vmnet",
    "wg",
)


@dataclass(frozen=True, slots=True)
class LanEndpoint:
    primary_host: str
    fallback_ipv4: str | None
    port: int

    def session_urls(self, raw_token: str) -> tuple[str, str | None]:
        fragment = f"#token={raw_token}"
        primary = f"http://{self.primary_host}:{self.port}/u/{fragment}"
        fallback = (
            f"http://{self.fallback_ipv4}:{self.port}/u/{fragment}"
            if self.fallback_ipv4 is not None and self.fallback_ipv4 != self.primary_host
            else None
        )
        return primary, fallback


def _usable_lan_address(value: str) -> ipaddress.IPv4Address | None:
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        return None
    if (
        not address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or address.is_reserved
    ):
        return None
    return address


def _interface_addresses() -> list[tuple[str, ipaddress.IPv4Address]]:
    if platform.system() != "Linux":
        return []
    results: list[tuple[str, ipaddress.IPv4Address]] = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as handle:
        for _, name in socket.if_nameindex():
            lowered = name.lower()
            if lowered.startswith(_EXCLUDED_INTERFACE_PREFIXES):
                continue
            try:
                encoded_name = name.encode("ascii")[:15]
                payload = struct.pack("256s", encoded_name)
                response = fcntl.ioctl(handle.fileno(), 0x8915, payload)
                candidate = socket.inet_ntoa(response[20:24])
            except (OSError, UnicodeEncodeError):
                continue
            address = _usable_lan_address(candidate)
            if address is not None:
                results.append((name, address))
    return results


def discover_lan_ipv4() -> str | None:
    candidates = _interface_addresses()
    priority_prefixes = ("eth", "en", "wlan", "wl")
    if candidates:
        candidates.sort(
            key=lambda item: (
                next(
                    (
                        index
                        for index, prefix in enumerate(priority_prefixes)
                        if item[0].startswith(prefix)
                    ),
                    len(priority_prefixes),
                ),
                item[0],
                int(item[1]),
            )
        )
        return str(candidates[0][1])

    fallback: set[ipaddress.IPv4Address] = set()
    try:
        for result in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = _usable_lan_address(str(result[4][0]))
            if address is not None:
                fallback.add(address)
    except OSError:
        pass
    return str(min(fallback, key=int)) if fallback else None


def discover_lan_interface() -> tuple[str | None, str | None]:
    candidates = _interface_addresses()
    priority_prefixes = ("eth", "en", "wlan", "wl")
    if not candidates:
        return None, discover_lan_ipv4()
    candidates.sort(
        key=lambda item: (
            next(
                (
                    index
                    for index, prefix in enumerate(priority_prefixes)
                    if item[0].startswith(prefix)
                ),
                len(priority_prefixes),
            ),
            item[0],
            int(item[1]),
        )
    )
    name, address = candidates[0]
    return name[:32], str(address)


def resolve_lan_endpoint(settings: Settings) -> LanEndpoint:
    discovered = discover_lan_ipv4()
    configured_ipv4 = (
        str(settings.phone_upload_advertised_ipv4)
        if settings.phone_upload_advertised_ipv4 is not None
        else None
    )
    bind_host = str(settings.phone_upload_bind_host)
    direct_ipv4 = configured_ipv4 or _usable_lan_address(bind_host)
    direct_text = (
        str(direct_ipv4)
        if direct_ipv4 is not None
        else bind_host
        if settings.phone_upload_bind_host.is_loopback
        else discovered
    )
    primary_host = settings.phone_upload_advertised_host or direct_text
    if primary_host is None:
        if settings.phone_upload_bind_host.is_loopback:
            primary_host = bind_host
        else:
            raise MuseError(
                status_code=503,
                code="phone_upload_network_unavailable",
                message="Muse could not find a usable local-network address.",
            )
    return LanEndpoint(
        primary_host=primary_host,
        fallback_ipv4=(
            direct_text
            if settings.phone_upload_advertised_host is not None
            and direct_text != settings.phone_upload_advertised_host
            else None
        ),
        port=settings.phone_upload_port,
    )
