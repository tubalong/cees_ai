"""文档图片块的取图工具：下载字节并读出像素尺寸。

PDF / DOCX / PPTX 三个渲染器共用同一段逻辑，避免各自实现一套下载与降级策略：

- 只接受 `http(s)` 与 `data:` 位置；其它协议（`file:` 等）直接视为不可用，
  防止把渲染请求变成读取服务端任意文件。
- 任何失败（网络、状态码、非图片字节、超出体积上限）都返回 `None`，
  由渲染器降级为占位说明，绝不让一张图打断整份文档的生成。
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from io import BytesIO

import httpx
from PIL import Image

# 单张图片体积上限。文档里嵌入的图通常远小于此值，超出多半是误传大文件。
MAX_IMAGE_BYTES = 20 * 1024 * 1024
_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class LoadedImage:
    content: bytes
    width: int
    height: int

    @property
    def aspect_ratio(self) -> float:
        """宽高比；尺寸异常时退化为 1.0，避免除零把布局算崩。"""
        return self.width / self.height if self.height > 0 else 1.0


def load_image(url: str, *, max_bytes: int = MAX_IMAGE_BYTES) -> LoadedImage | None:
    content = read_image_bytes(url, max_bytes=max_bytes)
    if not content:
        return None
    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
    except Exception:
        return None
    if width <= 0 or height <= 0:
        return None
    return LoadedImage(content=content, width=int(width), height=int(height))


def read_image_bytes(url: str, *, max_bytes: int = MAX_IMAGE_BYTES) -> bytes:
    if url.startswith("data:"):
        return _decode_data_url(url, max_bytes=max_bytes)
    if not url.lower().startswith(("http://", "https://")):
        return b""
    try:
        response = httpx.get(url, timeout=_TIMEOUT_SECONDS, follow_redirects=True)
        response.raise_for_status()
    except Exception:
        return b""
    content = response.content
    return content if 0 < len(content) <= max_bytes else b""


def _decode_data_url(url: str, *, max_bytes: int) -> bytes:
    header, separator, payload = url.partition(",")
    if not separator or ";base64" not in header:
        return b""
    try:
        content = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return b""
    return content if 0 < len(content) <= max_bytes else b""
