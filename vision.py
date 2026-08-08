"""
cark looks at things

Pulls the pictures out of a mention and gets them into a shape the model can see.
Video cannot be sent, so cark gets the thumbnail, which is genuinely how a cat
watches television anyway: one frame, briefly, then away.

Seeing an image is not the same as describing it. cark looks at a photo of your
new car and reports that there is a bird behind it. The prompt work for that lives
in cark.py, this file only does the fetching.
"""

import os
import io
import base64
import logging

import requests

log = logging.getLogger("vision")

# only twitter's own media hosts. these urls come from strangers.
ALLOWED_HOSTS = ("pbs.twimg.com", "video.twimg.com", "ton.twimg.com")

MAX_BYTES = int(os.getenv("CARK_IMG_MAX_BYTES", str(6 * 1024 * 1024)))
MAX_EDGE = int(os.getenv("CARK_IMG_MAX_EDGE", "900"))
MAX_IMAGES = int(os.getenv("CARK_IMG_MAX", "2"))


def media_from_mention(tweet, media_by_key):
    """Returns [{url, kind, alt}] for a mention. Videos give their thumbnail."""
    keys = ((getattr(tweet, "attachments", None) or {}).get("media_keys")) or []
    out = []
    for k in keys:
        m = media_by_key.get(str(k))
        if not m:
            continue
        kind = getattr(m, "type", "") or ""
        url = None
        if kind == "photo":
            url = getattr(m, "url", None)
        elif kind in ("video", "animated_gif"):
            url = getattr(m, "preview_image_url", None)
        if url:
            out.append({"url": url, "kind": kind,
                        "alt": getattr(m, "alt_text", None)})
    return out[:MAX_IMAGES]


def fetch_image(url):
    """Download, shrink, return (base64, media_type). None if anything is off."""
    try:
        host = url.split("/")[2].lower()
    except Exception:
        return None
    if not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
        log.warning("refusing media from %s", host)
        return None

    try:
        r = requests.get(url, timeout=12, stream=True)
        r.raise_for_status()
        raw = b""
        for chunk in r.iter_content(64 * 1024):
            raw += chunk
            if len(raw) > MAX_BYTES:
                log.warning("image too large, skipping")
                return None
    except Exception as e:
        log.warning("image fetch failed: %s", e)
        return None

    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        img = img.convert("RGB")
        if max(img.size) > MAX_EDGE:
            ratio = MAX_EDGE / max(img.size)
            img = img.resize((int(img.width * ratio), int(img.height * ratio)))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=82)
        return base64.b64encode(buf.getvalue()).decode(), "image/jpeg"
    except ImportError:
        # no pillow, send it as it came and hope it is a jpeg or png
        kind = "image/png" if raw[:4] == b"\x89PNG" else "image/jpeg"
        if len(raw) > 4 * 1024 * 1024:
            return None
        return base64.b64encode(raw).decode(), kind
    except Exception as e:
        log.warning("image decode failed: %s", e)
        return None


def look(media):
    """Turn media descriptors into anthropic image blocks."""
    blocks, kinds = [], []
    for m in media[:MAX_IMAGES]:
        got = fetch_image(m["url"])
        if not got:
            continue
        b64, mime = got
        blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": mime, "data": b64},
        })
        kinds.append(m["kind"])
    if blocks:
        log.info("cark is looking at %d %s", len(blocks),
                 "thing" if len(blocks) == 1 else "things")
    return blocks, kinds
