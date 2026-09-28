"""Validate native export requests and commit files atomically."""

import json
import os
from pathlib import Path
import re
import tempfile

MAX_EXPORT_BYTES = 32 * 1024 * 1024


def parse_export_message(raw: str) -> dict:
    if len(raw.encode("utf-8")) > MAX_EXPORT_BYTES + 4096:
        raise ValueError("Export request is too large.")
    message = json.loads(raw)
    if (not isinstance(message, dict) or message.get("type") != "nexcode:save-markdown"
            or not isinstance(message.get("requestId"), str)
            or not 0 < len(message["requestId"]) <= 128
            or not isinstance(message.get("content"), str)
            or len(message["content"].encode("utf-8")) > MAX_EXPORT_BYTES):
        raise ValueError("Invalid Markdown export request.")
    name = message.get("fileName")
    if not isinstance(name, str):
        name = "thread.md"
    name = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]', "_", name).strip(" .")[:180] or "thread"
    if not name.lower().endswith(".md"):
        name += ".md"
    return {**message, "fileName": name}


def save_markdown(path: Path, content: str) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".nexcode-export-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
