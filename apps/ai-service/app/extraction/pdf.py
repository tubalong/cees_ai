from __future__ import annotations

import pymupdf


def extract_pdf_text(data: bytes) -> str:
    """Extract text from a PDF using PyMuPDF.

    PyMuPDF resolves ToUnicode CMaps and CID fonts, so text-bearing PDFs are
    decoded correctly. Scanned or image-only PDFs yield no text; OCR is a
    later extraction layer.
    """
    document = pymupdf.open(stream=data, filetype="pdf")
    try:
        return "".join(page.get_text() for page in document).strip()
    finally:
        document.close()
