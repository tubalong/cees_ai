from __future__ import annotations

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

_SOF_MARKERS = frozenset(
    {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
)


def image_dimensions(data: bytes) -> tuple[int, int] | None:
    """Return ``(width, height)`` parsed from PNG, JPEG, or WebP bytes.

    Returns ``None`` when the bytes are not a recognised image or the
    dimensions cannot be parsed safely.
    """
    if data.startswith(_PNG_SIGNATURE):
        return _png_dimensions(data)
    if data.startswith(b"\xff\xd8"):
        return _jpeg_dimensions(data)
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return _webp_dimensions(data)
    return None


def _png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24:
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    length = len(data)
    i = 2
    while i + 3 < length:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        while marker == 0xFF and i + 2 < length:
            i += 1
            marker = data[i + 1]
        if marker == 0xFF:
            return None
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        if marker in _SOF_MARKERS:
            if i + 9 > length:
                return None
            height = int.from_bytes(data[i + 5 : i + 7], "big")
            width = int.from_bytes(data[i + 7 : i + 9], "big")
            return width, height
        if i + 4 > length:
            return None
        segment_length = int.from_bytes(data[i + 2 : i + 4], "big")
        if segment_length < 2:
            return None
        i += 2 + segment_length
    return None


def _webp_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 30:
        return None
    chunk = data[12:16]
    if chunk == b"VP8X":
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height
    if chunk == b"VP8 ":
        width = data[26] | ((data[27] & 0x3F) << 8)
        height = data[28] | ((data[29] & 0x3F) << 8)
        return width, height
    if chunk == b"VP8L":
        if data[20] != 0x2F:
            return None
        bits = int.from_bytes(data[21:25], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height
    return None
