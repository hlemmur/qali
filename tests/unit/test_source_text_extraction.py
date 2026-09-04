from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from io import BytesIO

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app.raw_source_repository import (
    RawSourceArtifact,
    RawSourceProvenance,
    RawSourceSnapshot,
)
from app.source_text_extraction import (
    SourceTextExtractionError,
    SourceTextExtractor,
)


def _snapshot(content: bytes, content_type: str) -> RawSourceSnapshot:
    return RawSourceSnapshot(
        artifact=RawSourceArtifact(
            project_id="slack-project-alpha",
            source_id="source-text",
            object_name="projects/slack-project-alpha/raw/source-text/source",
            source_uri="https://docs.example.test/source",
            source_uri_sha256="a" * 64,
            content_type=content_type,
            sha256=hashlib.sha256(content).hexdigest(),
            captured_at=datetime(2026, 9, 4, 2, 0, tzinfo=UTC),
            provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
            screening_scanners=("malware-v1", "instruction-v1"),
        ),
        content=content,
    )


def _pdf_with_text(text: str) -> bytes:
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {NameObject("/F1"): writer._add_object(font)}
            )
        }
    )
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_html_extraction_keeps_visible_text_and_drops_active_content() -> None:
    snapshot = _snapshot(
        b"<html><body><h1>Profile</h1><script>steal()</script>"
        b"<p>Customers can edit names.</p></body></html>",
        "text/html",
    )

    source = SourceTextExtractor().extract(snapshot)

    assert source.source_id == "source-text"
    assert source.text == "Profile Customers can edit names."
    assert "steal" not in source.text


def test_pdf_extraction_uses_bounded_page_text() -> None:
    snapshot = _snapshot(_pdf_with_text("Customers edit profiles"), "application/pdf")

    source = SourceTextExtractor().extract(snapshot)

    assert source.text == "Customers edit profiles"


def test_snapshot_hash_mismatch_fails_before_parsing() -> None:
    snapshot = _snapshot(b"trusted", "text/plain")
    snapshot = snapshot.model_copy(update={"content": b"tampered"})

    with pytest.raises(SourceTextExtractionError) as caught:
        SourceTextExtractor().extract(snapshot)

    assert str(caught.value) == "source text extraction failed"
