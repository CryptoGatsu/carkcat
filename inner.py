"""
cark's inner life

Two things that accumulate.

FIXATIONS. A cat gets stuck on one thing for days. There is something behind the
fridge. It does not stop being behind the fridge because a week passed. A fixation
runs 2 to 8 days, leaks into everything cark says, and then either resolves
anticlimactically or is simply dropped without explanation, which is what actually
happens.

BELIEFS. Opinions cark forms from conversations and then keeps. Somebody mentions
a boat, cark decides boats are bad, and three weeks later cark still thinks that.
Beliefs fade if nothing brings them up, strengthen when they do, and cark is
allowed to contradict its own without noticing.
"""

import os
import re
import json
import random
import logging
from datetime import datetime, timezone, timedelta

log = logging.getLogger("inner")

FIXATION_MIN_DAYS = float(os.getenv("CARK_FIXATION_MIN_DAYS", "2"))
FIXATION_MAX_DAYS = float(os.getenv("CARK_FIXATION_MAX_DAYS", "8"))
RESOLVE_CHANCE = float(os.getenv("CARK_FIXATION_RESOLVE", "0.35"))
BELIEF_MAX = int(os.getenv("CARK_BELIEF_MAX", "60"))
BELIEF_FADE_DAYS = float(os.getenv("CARK_BELIEF_FADE_DAYS", "45"))

# Seeds, so this works on day one without waiting for the model. Every one is a
# thing a cat could genuinely fix on: unexplained, low stakes, unresolvable.
FIXATION_SEEDS = [
    "there is something behind the fridge",
    "the door on the left has never once been opened",
    "one of the floorboards makes a different sound than the others",
    "somebody moved the chair about four inches and said nothing",
    "a new bird has started sitting closer than the other birds",
    "there is a noise in the wall between two and four",
    "the bag from last week is still there and nobody has dealt with it",
    "the water tastes different since tuesday",
    "there is a smell in the hallway that is not mine",
    "the second shelf is warmer than the first shelf and it should not be",
    "a car parks outside at the same time and nobody gets out",
    "something touched my tail and there was nothing there",
    "the reflection in the dark window is doing it slightly late",
    "there is a room i have not been in",
]

RESOLUTIONS = [
    "it was nothing",
    "it stopped and i dont know why",
    "someone moved it back and pretended they hadnt",
    "it was a bag the whole time",
    "i got behind there. there was dust and a bottle cap",
    "it was me",
]


# ------------------------------------------------------------------ storage


def ensure(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS fixations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT, started_at TEXT, ends_at TEXT,
        status TEXT DEFAULT 'active', resolution TEXT, mentions INTEGER DEFAULT 0)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS beliefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT UNIQUE, verdict TEXT, why TEXT,
        formed_at TEXT, touched_at TEXT, strength REAL DEFAULT 1.0,
        from_who TEXT)""")
    conn.commit()


# ------------------------------------------------------------------ fixations


def current_fixation(conn):
    row = conn.execute(
        "SELECT id, subject, started_at, ends_at, mentions FROM fixations "
        "WHERE status = 'active' ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        return None
    fid, subject, started, ends, mentions = row
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(started)).days
    except Exception:
        age = 0
    return {"id": fid, "subject": subject, "days": age, "mentions": mentions,
            "ends_at": ends}


def end_fixation(conn, fid, resolved):
    if resolved:
        res = random.choice(RESOLUTIONS)
        conn.execute("UPDATE fixations SET status='resolved', resolution=? WHERE id=?",
                     (res, fid))
        log.info("fixation resolved: %s", res)
        return res
    conn.execute("UPDATE fixations SET status='abandoned' WHERE id=?", (fid,))
    log.info("fixation dropped without explanation")
    return None


def start_fixation(conn, ai=None, recent_events=None):
    """Pick something to get stuck on. Asks the model when it can, so fixations
    grow out of what has actually been happening, and falls back to the seeds."""
    used = {r[0] for r in conn.execute("SELECT subject FROM fixations").fetchall()}
    subject = None

    if ai and recent_events:
        try:
            resp = ai.messages.create(
                model=os.getenv("CARK_MODEL_ORIGINAL", "claude-opus-5"),
                max_tokens=150, temperature=1.0,
                system="you are cark, a cat. output one line and nothing else.",
                messages=[{"role": "user", "content":
                    "recently:\n" + "\n".join(f"- {e}" for e in recent_events[:8]) +
                    "\n\npick one small physical thing in your house to become "
                    "completely fixed on for the next several days. it must be "
                    "concrete, low stakes, and impossible to actually settle. no "
                    "people, no feelings, no questions. lowercase, under 14 words.\n"
                    "like: there is something behind the fridge\n"
                    "output the thing only."}])
            cand = "".join(b.text for b in resp.content if b.type == "text").strip()
            cand = cand.strip('"').strip().lower()
            if 8 < len(cand) < 110 and cand not in used and "?" not in cand:
                subject = cand
        except Exception as e:
            log.warning("could not invent a fixation: %s", e)

    if not subject:
        fresh = [f for f in FIXATION_SEEDS if f not in used] or FIXATION_SEEDS
        subject = random.choice(fresh)

    days = random.uniform(FIXATION_MIN_DAYS, FIXATION_MAX_DAYS)
    now = datetime.now(timezone.utc)
    conn.execute(
        "INSERT INTO fixations (subject, started_at, ends_at) VALUES (?,?,?)",
        (subject, now.isoformat(), (now + timedelta(days=days)).isoformat()))
    conn.commit()
    log.info("cark is now fixed on: %s (%.1f days)", subject, days)
    return subject


def tick_fixation(conn, ai=None, recent_events=None):
    """Expire what is over, start something if there is nothing. Returns the
    active fixation and whatever just ended."""
    ensure(conn)
    ended = None
    cur = current_fixation(conn)

    if cur:
        try:
            over = datetime.now(timezone.utc) > datetime.fromisoformat(cur["ends_at"])
        except Exception:
            over = False
        if over:
            resolved = random.random() < RESOLVE_CHANCE
            ended = {"subject": cur["subject"],
                     "resolution": end_fixation(conn, cur["id"], resolved)}
            cur = None

    if not cur:
        start_fixation(conn, ai, recent_events)
        cur = current_fixation(conn)

    return cur, ended


def note_fixation_mention(conn, fid):
    conn.execute("UPDATE fixations SET mentions = mentions + 1 WHERE id = ?", (fid,))
    conn.commit()


# ------------------------------------------------------------------ beliefs

BELIEF_SYSTEM = """you are cark, a cat. you are reading something a person said to
you and deciding whether you have formed a lasting opinion about a THING in it.

only real, concrete nouns. objects, animals, places, kinds of weather, kinds of
food. never people, never abstract ideas, never the person you are talking to,
never coins or money or markets.

most of the time the answer is no. cats do not have opinions about most things.
only answer yes if something in there is genuinely object shaped and a cat could
plausibly have a lasting feeling about it.

output strict json only:
{"formed": false}
or
{"formed": true, "subject": "boats", "verdict": "bad", "why": "one flat clause, lowercase, under 12 words"}

verdict must be one of: good, bad, suspicious, mine, boring."""


def maybe_form_belief(conn, ai, text, who="someone"):
    """Look at what somebody said and see if cark now thinks something."""
    ensure(conn)
    if not text or len(text) < 12:
        return None
    try:
        resp = ai.messages.create(
            model=os.getenv("CARK_MODEL_REPLY", "claude-sonnet-5"),
            max_tokens=200, temperature=0.7,
            system=BELIEF_SYSTEM,
            messages=[{"role": "user", "content": text[:600]}])
        raw = "".join(b.text for b in resp.content if b.type == "text").strip()
        raw = re.sub(r"^```(json)?|```$", "", raw, flags=re.M).strip()
        out = json.loads(raw)
    except Exception:
        return None

    if not out.get("formed"):
        return None
    subject = (out.get("subject") or "").strip().lower()[:60]
    verdict = (out.get("verdict") or "").strip().lower()
    if not subject or verdict not in ("good", "bad", "suspicious", "mine", "boring"):
        return None

    now = datetime.now(timezone.utc).isoformat()
    existing = conn.execute(
        "SELECT verdict, strength FROM beliefs WHERE subject = ?", (subject,)).fetchone()

    if existing:
        # cark is allowed to change its mind, and does not acknowledge doing so
        if existing[0] != verdict and random.random() < 0.3:
            conn.execute("UPDATE beliefs SET verdict=?, why=?, touched_at=?, "
                         "strength=1.0 WHERE subject=?",
                         (verdict, out.get("why", "")[:120], now, subject))
            log.info("cark changed its mind: %s is now %s", subject, verdict)
        else:
            conn.execute("UPDATE beliefs SET touched_at=?, strength=MIN(strength+0.4,3) "
                         "WHERE subject=?", (now, subject))
        conn.commit()
        return None

    conn.execute(
        "INSERT OR IGNORE INTO beliefs (subject, verdict, why, formed_at, touched_at, "
        "from_who) VALUES (?,?,?,?,?,?)",
        (subject, verdict, (out.get("why") or "")[:120], now, now, who))
    conn.commit()
    log.info("cark decided %s are %s", subject, verdict)

    # keep the set small, drop the faintest
    n = conn.execute("SELECT COUNT(*) FROM beliefs").fetchone()[0]
    if n > BELIEF_MAX:
        conn.execute("DELETE FROM beliefs WHERE id IN (SELECT id FROM beliefs "
                     "ORDER BY strength ASC, touched_at ASC LIMIT ?)", (n - BELIEF_MAX,))
        conn.commit()
    return {"subject": subject, "verdict": verdict}


def relevant_beliefs(conn, text, limit=3):
    """Anything cark already thinks that bears on what was just said."""
    ensure(conn)
    rows = conn.execute(
        "SELECT subject, verdict, why FROM beliefs ORDER BY strength DESC").fetchall()
    if not rows:
        return []
    low = (text or "").lower()
    hits = [r for r in rows
            if r[0] in low or any(w in low for w in r[0].split() if len(w) > 3)]
    return [{"subject": r[0], "verdict": r[1], "why": r[2]} for r in hits[:limit]]


def strongest_beliefs(conn, limit=5):
    ensure(conn)
    rows = conn.execute(
        "SELECT subject, verdict, why, strength FROM beliefs "
        "ORDER BY strength DESC, touched_at DESC LIMIT ?", (limit,)).fetchall()
    return [{"subject": r[0], "verdict": r[1], "why": r[2], "strength": r[3]}
            for r in rows]


def fade_beliefs(conn):
    """Opinions nobody has brought up in a long time get quieter."""
    ensure(conn)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=BELIEF_FADE_DAYS)).isoformat()
    conn.execute("UPDATE beliefs SET strength = strength * 0.75 WHERE touched_at < ?",
                 (cutoff,))
    conn.execute("DELETE FROM beliefs WHERE strength < 0.2")
    conn.commit()
