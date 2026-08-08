"""
cark grows on buys and shrinks on sells

Polls the dexscreener pair, diffs the trade counts since last look, and turns
the difference into experience. The level is global: the bot owns it and the
site renders it, so everybody is looking at the same cat.

Sells cost less than buys pay, otherwise a healthy two sided market would grind
cark down to nothing just from normal trading.
"""

import os
import time
import json
import logging
from datetime import datetime, timezone

import requests

log = logging.getLogger("chain")

PAIR = os.getenv("CARK_PAIR", "vtogs4xulm59uu6wqwda2pgecxj7rsfkpkqgbakvjwb")
CHAIN = os.getenv("CARK_CHAIN", "solana")
POLL_EVERY_SEC = int(os.getenv("CARK_CHAIN_POLL_SEC", "25"))

XP_PER_BUY = float(os.getenv("CARK_XP_BUY", "12"))
XP_PER_SELL = float(os.getenv("CARK_XP_SELL", "-9"))

PAIR_URL = "https://api.dexscreener.com/latest/dex/pairs/{}/{}"

# cats do not have ranks, they have sizes
SIZES = [
    (0,  "kitten"),
    (2,  "small cat"),
    (4,  "cat"),
    (7,  "confident cat"),
    (10, "large cat"),
    (14, "very large cat"),
    (18, "enormous cat"),
    (23, "a lot of cat"),
    (28, "too much cat"),
    (34, "cat beyond reason"),
]


def size_name(level):
    name = SIZES[0][1]
    for floor, n in SIZES:
        if level >= floor:
            name = n
    return name


def level_for(xp):
    """Returns (level, xp_into_level, xp_needed_for_next)."""
    xp = max(0.0, xp)
    lvl, need, acc = 0, 100.0, 0.0
    while xp >= acc + need and lvl < 99:
        acc += need
        lvl += 1
        need *= 1.25
    return lvl, xp - acc, need


# ------------------------------------------------------------------ market


def poll_pair():
    try:
        r = requests.get(PAIR_URL.format(CHAIN, PAIR), timeout=12)
        r.raise_for_status()
        data = r.json() or {}
    except Exception as e:
        log.warning("pair poll failed: %s", e)
        return None

    pair = data.get("pair")
    if not pair:
        pairs = data.get("pairs") or []
        pair = pairs[0] if pairs else None
    if not pair:
        return None

    tx = pair.get("txns") or {}
    h24 = tx.get("h24") or {}
    return {
        "buys_24": int(h24.get("buys") or 0),
        "sells_24": int(h24.get("sells") or 0),
        "buys_5m": int((tx.get("m5") or {}).get("buys") or 0),
        "sells_5m": int((tx.get("m5") or {}).get("sells") or 0),
        "price": float(pair.get("priceUsd") or 0),
        "change_5m": float((pair.get("priceChange") or {}).get("m5") or 0),
        "change_24": float((pair.get("priceChange") or {}).get("h24") or 0),
        "liquidity": float((pair.get("liquidity") or {}).get("usd") or 0),
    }


def xp_for_level(level):
    """Total xp needed to sit at the start of a given level."""
    step, acc = 100.0, 0.0
    for _ in range(int(level)):
        acc += step
        step *= 1.25
    return acc


# ------------------------------------------------------------------ growth


def _get(conn, k, d=None):
    r = conn.execute("SELECT value FROM state WHERE key = ?", (k,)).fetchone()
    return r[0] if r else d


def _set(conn, k, v):
    conn.execute("INSERT INTO state (key, value) VALUES (?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, str(v)))
    conn.commit()


def update_level(conn):
    """Poll, diff, award. Returns the payload if anything moved, else None."""
    m = poll_pair()
    if not m:
        return None

    prev_b = _get(conn, "chain_buys")
    prev_s = _get(conn, "chain_sells")

    # first look just records where we are, no free levels from history
    if prev_b is None or prev_s is None:
        _set(conn, "chain_buys", m["buys_24"])
        _set(conn, "chain_sells", m["sells_24"])
        log.info("chain watch started at %d buys / %d sells",
                 m["buys_24"], m["sells_24"])
        return payload(conn, m, 0, 0)

    # the 24h window rolls, so a drop means old trades aged out, not new ones
    new_buys = max(0, m["buys_24"] - int(prev_b))
    new_sells = max(0, m["sells_24"] - int(prev_s))
    _set(conn, "chain_buys", m["buys_24"])
    _set(conn, "chain_sells", m["sells_24"])

    if not (new_buys or new_sells):
        return payload(conn, m, 0, 0)

    xp = float(_get(conn, "chain_xp", 0))
    before, _, _ = level_for(xp)

    xp = max(0.0, xp + new_buys * XP_PER_BUY + new_sells * XP_PER_SELL)
    _set(conn, "chain_xp", xp)

    after, _, _ = level_for(xp)
    peak = int(_get(conn, "chain_peak", 0))
    if after > peak:
        _set(conn, "chain_peak", after)

    if after > before:
        log.info("cark levelled up to %d, %s", after, size_name(after))
        _set(conn, "chain_event", "up")
        _set(conn, "chain_event_at", time.time())
    elif after < before:
        log.info("cark dropped to level %d", after)
        _set(conn, "chain_event", "down")
        _set(conn, "chain_event_at", time.time())

    return payload(conn, m, new_buys, new_sells)


def payload(conn, m, new_buys, new_sells):
    xp = float(_get(conn, "chain_xp", 0))
    level, into, need = level_for(xp)

    # how cark feels about the last little while, not the last trade
    lean = _get(conn, "chain_lean", "0")
    lean = float(lean) * 0.7 + (new_buys - new_sells)
    _set(conn, "chain_lean", round(lean, 3))

    if lean > 1.5:
        feel = "happy"
    elif lean < -1.5:
        feel = "sad"
    else:
        feel = "fine"

    event, event_at = _get(conn, "chain_event"), float(_get(conn, "chain_event_at", 0))
    if event and time.time() - event_at > 300:
        event = None

    return {
        "level": level,
        "size": size_name(level),
        "xp": round(xp),
        "into": round(into),
        "need": round(need),
        "progress": round(into / need, 3) if need else 0,
        "peak": int(_get(conn, "chain_peak", 0)),
        "feel": feel,
        "lean": round(lean, 2),
        "new_buys": new_buys,
        "new_sells": new_sells,
        "buys_24": m["buys_24"],
        "sells_24": m["sells_24"],
        "event": event,
        "updated": datetime.now(timezone.utc).isoformat(),
    }


def seed_from_history(conn, weight=0.25):
    """A token that has been trading a while should not be a kitten.

    Grants xp from the 24h trade counts already on the pair, scaled down, so cark
    starts at a size that matches how the token has actually been doing rather
    than at zero. Only takes effect once.
    """
    if _get(conn, "chain_seeded"):
        return None
    m = poll_pair()
    if not m:
        return None

    net = m["buys_24"] * XP_PER_BUY + m["sells_24"] * XP_PER_SELL
    xp = max(0.0, net * weight)
    _set(conn, "chain_xp", xp)
    _set(conn, "chain_buys", m["buys_24"])
    _set(conn, "chain_sells", m["sells_24"])
    _set(conn, "chain_seeded", 1)
    lvl, _, _ = level_for(xp)
    _set(conn, "chain_peak", lvl)
    log.info("seeded from 24h history: %d buys, %d sells -> level %d (%s)",
             m["buys_24"], m["sells_24"], lvl, size_name(lvl))
    return payload(conn, m, 0, 0)


def set_level(conn, level):
    """Put cark at a specific level by hand."""
    xp = xp_for_level(level)
    _set(conn, "chain_xp", xp)
    _set(conn, "chain_peak", max(int(_get(conn, "chain_peak", 0)), int(level)))
    _set(conn, "chain_seeded", 1)
    log.info("cark set to level %d (%s)", level, size_name(level))
    return current(conn)


def diagnose(conn):
    """Why is it zero."""
    out = {"pair": PAIR, "chain": CHAIN}
    m = poll_pair()
    out["pair_reachable"] = m is not None
    if m:
        out["buys_24"] = m["buys_24"]
        out["sells_24"] = m["sells_24"]
        out["liquidity"] = m["liquidity"]
    out["seeded"] = bool(_get(conn, "chain_seeded"))
    out["baseline_buys"] = _get(conn, "chain_buys")
    out["xp"] = float(_get(conn, "chain_xp", 0))
    out["level"] = level_for(out["xp"])[0]
    return out


def current(conn):
    """The payload without polling, for the cli and for cark's own prompts."""
    xp = float(_get(conn, "chain_xp", 0))
    level, into, need = level_for(xp)
    return {
        "level": level, "size": size_name(level), "xp": round(xp),
        "into": round(into), "need": round(need),
        "progress": round(into / need, 3) if need else 0,
        "peak": int(_get(conn, "chain_peak", 0)),
        "feel": {"1": "happy", "-1": "sad"}.get(
            "1" if float(_get(conn, "chain_lean", 0)) > 1.5
            else "-1" if float(_get(conn, "chain_lean", 0)) < -1.5 else "0", "fine"),
    }
