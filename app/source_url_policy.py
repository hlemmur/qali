from __future__ import annotations

from collections.abc import Iterable, Set
from ipaddress import IPv6Address, ip_address
from urllib.parse import urlsplit, urlunsplit


class SourceUrlPolicy:
    def __init__(self, *, allowed_origins: Set[str]) -> None:
        self._allowed_origins = {
            origin.rstrip("/").casefold() for origin in allowed_origins
        }

    def validate(
        self,
        value: str,
        *,
        resolved_addresses: Iterable[str] = (),
    ) -> str:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        if parsed.scheme.casefold() != "https" or hostname is None:
            raise ValueError("source URL must use HTTPS")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("source URL must not contain credentials")
        normalized_hostname = hostname.rstrip(".").casefold()
        is_ipv6 = False
        try:
            address = ip_address(normalized_hostname)
        except ValueError:
            if normalized_hostname == "metadata.google.internal":
                raise ValueError("source URL host must be public") from None
        else:
            if not address.is_global:
                raise ValueError("source URL host must be public")
            is_ipv6 = isinstance(address, IPv6Address)
        for resolved_address in resolved_addresses:
            try:
                address = ip_address(resolved_address)
            except ValueError:
                raise ValueError("resolved source address must be public") from None
            if not address.is_global:
                raise ValueError("resolved source address must be public")
        netloc = normalized_hostname
        if is_ipv6:
            netloc = f"[{netloc}]"
        if parsed.port is not None:
            netloc = f"{netloc}:{parsed.port}"
        origin = f"https://{netloc}"
        if origin not in self._allowed_origins:
            raise ValueError("source URL origin is not approved")
        return urlunsplit(("https", netloc, parsed.path, parsed.query, ""))


__all__ = ["SourceUrlPolicy"]
