#!/usr/bin/env python
"""下载 PDF 渲染所需的中文字体到 config/fonts/。

构建时由 Dockerfile 执行，把文泉驿微米黑（TrueType 集合，开源）下载到
`config/fonts/wqy-microhei.ttc`，供 PdfRenderer 内嵌，保证 PDF 中文不丢字、
不方块。本地开发也可手动执行：

    uv run python scripts/download_fonts.py

下载失败不阻断构建：PdfRenderer 会降级到 reportlab 内置的 CID 字体（STSong-Light），
中文依然可渲染，只是不是真正内嵌。
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

FONT_URL = "https://github.com/anthonyfok/fonts-wqy-microhei/raw/master/wqy-microhei.ttc"
TARGET = Path(__file__).resolve().parents[1] / "config" / "fonts" / "wqy-microhei.ttc"
MIN_BYTES = 1_000_000  # 合理的最少字节数，避免下载到错误页


def main() -> int:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    if TARGET.exists() and TARGET.stat().st_size >= MIN_BYTES:
        print(f"font already present: {TARGET} ({TARGET.stat().st_size} bytes)")
        return 0
    print(f"downloading font: {FONT_URL}")
    try:
        urllib.request.urlretrieve(FONT_URL, TARGET)
    except Exception as exc:  # noqa: BLE001 - 下载失败不阻断构建
        print(f"font download failed (PDF will fall back to CID font): {exc}", file=sys.stderr)
        return 0
    if TARGET.stat().st_size < MIN_BYTES:
        print("downloaded font looks invalid; removing", file=sys.stderr)
        TARGET.unlink(missing_ok=True)
        return 0
    print(f"font downloaded: {TARGET} ({TARGET.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
