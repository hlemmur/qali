from __future__ import annotations

import hashlib
from html.parser import HTMLParser
from io import BytesIO

from pydantic import BaseModel, ConfigDict, Field
from pypdf import PdfReader

from app.raw_source_repository import RawSourceSnapshot


class KnowledgeSourceText(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    source_id: str = Field(min_length=1, max_length=128)
    content_type: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=500_000)


class SourceTextExtractionError(ValueError):
    def __init__(self) -> None:
        super().__init__("source text extraction failed")


class SourceTextExtractor:
    def __init__(
        self,
        *,
        max_input_bytes: int = 5_000_000,
        max_output_characters: int = 100_000,
        max_pdf_pages: int = 50,
        max_pdf_page_stream_bytes: int = 2_000_000,
    ) -> None:
        if not 1 <= max_input_bytes <= 20_000_000:
            raise ValueError("max_input_bytes must be between 1 and 20000000")
        if not 1 <= max_output_characters <= 500_000:
            raise ValueError("max_output_characters must be between 1 and 500000")
        if not 1 <= max_pdf_pages <= 100:
            raise ValueError("max_pdf_pages must be between 1 and 100")
        if not 1 <= max_pdf_page_stream_bytes <= 10_000_000:
            raise ValueError("max_pdf_page_stream_bytes must be between 1 and 10000000")
        self._max_input_bytes = max_input_bytes
        self._max_output_characters = max_output_characters
        self._max_pdf_pages = max_pdf_pages
        self._max_pdf_page_stream_bytes = max_pdf_page_stream_bytes

    def extract(self, snapshot: RawSourceSnapshot) -> KnowledgeSourceText:
        content = snapshot.content
        artifact = snapshot.artifact
        if hashlib.sha256(content).hexdigest() != artifact.sha256:
            raise SourceTextExtractionError
        return self.extract_content(
            source_id=artifact.source_id,
            content_type=artifact.content_type,
            content=content,
        )

    def extract_content(
        self,
        *,
        source_id: str,
        content_type: str,
        content: bytes,
    ) -> KnowledgeSourceText:
        if len(content) > self._max_input_bytes:
            raise SourceTextExtractionError
        try:
            if content_type in {"text/plain", "text/markdown"}:
                extracted = content.decode("utf-8", errors="strict")
            elif content_type == "text/html":
                parser = _VisibleTextParser()
                parser.feed(content.decode("utf-8", errors="strict"))
                parser.close()
                extracted = " ".join(parser.fragments)
            elif content_type == "application/pdf":
                extracted = self._extract_pdf(content)
            else:
                raise SourceTextExtractionError
        except SourceTextExtractionError:
            raise
        except Exception:
            raise SourceTextExtractionError from None
        normalized = " ".join(extracted.split())
        if not normalized or len(normalized) > self._max_output_characters:
            raise SourceTextExtractionError
        return KnowledgeSourceText(
            source_id=source_id,
            content_type=content_type,
            text=normalized,
        )

    def _extract_pdf(self, content: bytes) -> str:
        reader = PdfReader(BytesIO(content), strict=True)
        if reader.is_encrypted or len(reader.pages) > self._max_pdf_pages:
            raise SourceTextExtractionError
        page_text: list[str] = []
        for page in reader.pages:
            page_content = page.get_contents()
            if (
                page_content is not None
                and len(page_content.get_data()) > self._max_pdf_page_stream_bytes
            ):
                raise SourceTextExtractionError
            page_text.append(page.extract_text() or "")
        return " ".join(page_text)


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.fragments: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        del attrs
        if tag.casefold() in {"script", "style", "template", "noscript"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if (
            tag.casefold() in {"script", "style", "template", "noscript"}
            and self._ignored_depth
        ):
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.fragments.append(data)


__all__ = [
    "KnowledgeSourceText",
    "SourceTextExtractionError",
    "SourceTextExtractor",
]
