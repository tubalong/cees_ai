from __future__ import annotations

import struct

from app.images.dimensions import image_dimensions


def _png(width: int, height: int) -> bytes:
    header = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
    return header + struct.pack(">II", width, height)


def _jpeg(width: int, height: int) -> bytes:
    return (
        b"\xff\xd8"
        + b"\xff\xc0"
        + b"\x00\x10"
        + b"\x08"
        + struct.pack(">HH", height, width)
        + b"\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    )


def _webp_lossy(width: int, height: int) -> bytes:
    data = bytearray(b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"VP8 " + b"\x00\x00\x00\x00")
    data += b"\x00" * 6
    data.append(width & 0xFF)
    data.append((width >> 8) & 0x3F)
    data.append(height & 0xFF)
    data.append((height >> 8) & 0x3F)
    data += b"\x00\x00"
    return bytes(data)


def _webp_extended(width: int, height: int) -> bytes:
    data = bytearray(b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"VP8X" + b"\x00\x00\x00\x00")
    data += b"\x00" * 4
    data += (width - 1).to_bytes(3, "little")
    data += (height - 1).to_bytes(3, "little")
    return bytes(data)


def test_png_dimensions() -> None:
    assert image_dimensions(_png(64, 32)) == (64, 32)


def test_jpeg_dimensions() -> None:
    assert image_dimensions(_jpeg(800, 600)) == (800, 600)


def test_webp_lossy_dimensions() -> None:
    assert image_dimensions(_webp_lossy(500, 300)) == (500, 300)


def test_webp_extended_dimensions() -> None:
    assert image_dimensions(_webp_extended(1024, 512)) == (1024, 512)


def test_unknown_bytes_return_none() -> None:
    assert image_dimensions(b"mock-image-bytes") is None
    assert image_dimensions(b"") is None
