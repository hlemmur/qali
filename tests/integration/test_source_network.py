import socket
import ssl
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from aiohttp import web
from aiohttp.client_exceptions import ClientConnectorCertificateError
from aiohttp.test_utils import TestServer
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from app.source_network import (
    AiohttpBoundSourceTransport,
    ApprovedAddressResolver,
    SystemSourceResolver,
)


class _AddressLookup:
    def __init__(self, results: list[tuple[Any, ...]]) -> None:
        self._results = results

    async def __call__(self, hostname: str, port: int) -> list[tuple[Any, ...]]:
        return self._results.copy()


def _create_tls_contexts(tmp_path: Path) -> tuple[ssl.SSLContext, ssl.SSLContext]:
    now = datetime.now(UTC)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Qali test CA")])
    ca_certificate = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    server_name = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, "docs.example.test")]
    )
    server_certificate = (
        x509.CertificateBuilder()
        .subject_name(server_name)
        .issuer_name(ca_name)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName("docs.example.test")]),
            critical=False,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(server_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    ca_path = tmp_path / "ca.pem"
    certificate_path = tmp_path / "server.pem"
    key_path = tmp_path / "server-key.pem"
    ca_path.write_bytes(ca_certificate.public_bytes(serialization.Encoding.PEM))
    certificate_path.write_bytes(
        server_certificate.public_bytes(serialization.Encoding.PEM)
    )
    key_path.write_bytes(
        server_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(certificate_path, key_path)
    client_context = ssl.create_default_context(cafile=str(ca_path))
    return server_context, client_context


@pytest.mark.asyncio
async def test_system_resolver_returns_unique_numeric_addresses() -> None:
    resolver = SystemSourceResolver(
        lookup=_AddressLookup(
            [
                (
                    socket.AF_INET,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    "",
                    ("93.184.216.34", 443),
                ),
                (
                    socket.AF_INET6,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    "",
                    ("2606:2800:220:1:248:1893:25c8:1946", 443, 0, 0),
                ),
                (
                    socket.AF_INET,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    "",
                    ("93.184.216.34", 443),
                ),
            ]
        )
    )

    addresses = await resolver.resolve("docs.example.test", 443)

    assert addresses == [
        "93.184.216.34",
        "2606:2800:220:1:248:1893:25c8:1946",
    ]


@pytest.mark.asyncio
async def test_approved_address_resolver_returns_only_pinned_addresses() -> None:
    resolver = ApprovedAddressResolver(
        hostname="docs.example.test",
        addresses=(
            "93.184.216.34",
            "2606:2800:220:1:248:1893:25c8:1946",
        ),
    )

    results = await resolver.resolve("docs.example.test", 443, socket.AF_UNSPEC)

    assert [(result["host"], result["family"]) for result in results] == [
        ("93.184.216.34", socket.AF_INET),
        ("2606:2800:220:1:248:1893:25c8:1946", socket.AF_INET6),
    ]


@pytest.mark.asyncio
async def test_transport_fetches_https_hostname_through_pinned_address(
    tmp_path: Path,
) -> None:
    server_context, client_context = _create_tls_contexts(tmp_path)

    async def project_guide(request: web.Request) -> web.Response:
        assert request.host.startswith("docs.example.test:")
        return web.Response(text="Project guide", content_type="text/plain")

    application = web.Application()
    application.router.add_get("/guide", project_guide)
    server = TestServer(application, scheme="https", host="127.0.0.1")
    await server.start_server(ssl=server_context)
    try:
        transport = AiohttpBoundSourceTransport(
            ssl_context=client_context,
            timeout_seconds=2,
        )

        response = await transport.get(
            f"https://docs.example.test:{server.port}/guide",
            approved_addresses=("127.0.0.1",),
            max_bytes=1024,
        )

        assert response.status_code == 200
        assert response.headers["Content-Type"].startswith("text/plain")
        assert response.body == b"Project guide"
    finally:
        await server.close()


@pytest.mark.asyncio
async def test_transport_rejects_certificate_for_different_hostname(
    tmp_path: Path,
) -> None:
    server_context, client_context = _create_tls_contexts(tmp_path)

    async def project_guide(_request: web.Request) -> web.Response:
        return web.Response(text="Project guide", content_type="text/plain")

    application = web.Application()
    application.router.add_get("/guide", project_guide)
    server = TestServer(application, scheme="https", host="127.0.0.1")
    await server.start_server(ssl=server_context)
    try:
        transport = AiohttpBoundSourceTransport(
            ssl_context=client_context,
            timeout_seconds=2,
        )

        with pytest.raises(ClientConnectorCertificateError):
            await transport.get(
                f"https://other.example.test:{server.port}/guide",
                approved_addresses=("127.0.0.1",),
                max_bytes=1024,
            )
    finally:
        await server.close()


@pytest.mark.asyncio
async def test_transport_does_not_follow_redirects(tmp_path: Path) -> None:
    server_context, client_context = _create_tls_contexts(tmp_path)
    target_requests = 0

    async def redirect(_request: web.Request) -> web.Response:
        raise web.HTTPFound(location="/target")

    async def target(_request: web.Request) -> web.Response:
        nonlocal target_requests
        target_requests += 1
        return web.Response(text="must not be fetched")

    application = web.Application()
    application.router.add_get("/redirect", redirect)
    application.router.add_get("/target", target)
    server = TestServer(application, scheme="https", host="127.0.0.1")
    await server.start_server(ssl=server_context)
    try:
        transport = AiohttpBoundSourceTransport(
            ssl_context=client_context,
            timeout_seconds=2,
        )

        response = await transport.get(
            f"https://docs.example.test:{server.port}/redirect",
            approved_addresses=("127.0.0.1",),
            max_bytes=1024,
        )

        assert response.status_code == 302
        assert response.headers["Location"] == "/target"
        assert target_requests == 0
    finally:
        await server.close()


@pytest.mark.asyncio
async def test_transport_rejects_streamed_body_over_byte_limit(tmp_path: Path) -> None:
    server_context, client_context = _create_tls_contexts(tmp_path)

    async def oversized(_request: web.Request) -> web.Response:
        return web.Response(body=b"x" * 2048, content_type="text/plain")

    application = web.Application()
    application.router.add_get("/oversized", oversized)
    server = TestServer(application, scheme="https", host="127.0.0.1")
    await server.start_server(ssl=server_context)
    try:
        transport = AiohttpBoundSourceTransport(
            ssl_context=client_context,
            timeout_seconds=2,
        )

        with pytest.raises(ValueError, match="byte limit"):
            await transport.get(
                f"https://docs.example.test:{server.port}/oversized",
                approved_addresses=("127.0.0.1",),
                max_bytes=128,
            )
    finally:
        await server.close()
