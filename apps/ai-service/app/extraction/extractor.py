from __future__ import annotations

from dataclasses import dataclass

from app.extraction import formats
from app.extraction import pdf as pdf_extractor

_TEXT_CONTENT_TYPES = {
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
}
_DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_PPTX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
_XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_PDF_CONTENT_TYPE = "application/pdf"

_GENERIC_CONTENT_TYPES = {"", "application/octet-stream", "application/unknown"}

_EXTENSION_CONTENT_TYPES = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".docx": _DOCX_CONTENT_TYPE,
    ".pptx": _PPTX_CONTENT_TYPE,
    ".xlsx": _XLSX_CONTENT_TYPE,
    ".pdf": _PDF_CONTENT_TYPE,
}


class UnsupportedFileTypeError(Exception):
    """Raised when the supplied bytes cannot be mapped to a supported extractor."""

    def __init__(self, content_type: str) -> None:
        self.content_type = content_type
        super().__init__(f"Unsupported file type: {content_type}")


class ExtractionFailedError(Exception):
    """Raised when a supported file type could not be extracted."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class ExtractionResult:
    text: str
    engine: str


def extract_text(
    *, content_type: str, data: bytes, filename: str | None = None
) -> ExtractionResult:
    normalized = _normalize_content_type(content_type)
    if normalized in _GENERIC_CONTENT_TYPES:
        normalized = _infer_from_filename(filename) or normalized

    if normalized in _TEXT_CONTENT_TYPES:
        return ExtractionResult(text=formats.extract_plain_text(data), engine="utf-8")
    if normalized == _DOCX_CONTENT_TYPE:
        return ExtractionResult(text=formats.extract_docx_text(data), engine="python-docx")
    if normalized == _PPTX_CONTENT_TYPE:
        return ExtractionResult(text=formats.extract_pptx_text(data), engine="stdlib-zip-xml")
    if normalized == _XLSX_CONTENT_TYPE:
        return ExtractionResult(text=formats.extract_xlsx_text(data), engine="openpyxl")
    if normalized == _PDF_CONTENT_TYPE:
        try:
            text = pdf_extractor.extract_pdf_text(data)
        except Exception as exc:
            raise ExtractionFailedError(str(exc)) from exc
        return ExtractionResult(text=text, engine="pymupdf")
    raise UnsupportedFileTypeError(normalized or content_type)


def _normalize_content_type(content_type: str) -> str:
    return content_type.strip().lower().split(";", 1)[0]


def _infer_from_filename(filename: str | None) -> str | None:
    if not filename:
        return None
    lower = filename.lower()
    for extension, content_type in _EXTENSION_CONTENT_TYPES.items():
        if lower.endswith(extension):
            return content_type
    return None
