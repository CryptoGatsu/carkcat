"""
cark - a cat that answers questions it does not understand
@carkcatmeow

Posts on a timer. Replies only to mentions that clear a spam gate.

The important thing here is MODES. cark does not have one output shape, it has
eight, weighted. Most of them contain no cat fact at all. A bot that answers
every mention with noise + fact reads as a bot within three posts.

Usage:
    python cark.py --dry                    preview an original
    python cark.py --dry --reply "text"     preview a reply
    python cark.py --sample 12              preview 12 replies across all modes
    python cark.py --audit                  score live mentions, reply to none
    python cark.py --once                   one full tick, posts for real
    python cark.py                          run forever
"""

import os
import re
import time
import math
import random
import sqlite3
import argparse
import logging
from datetime import datetime, timezone, timedelta

import anthropic
import tweepy
from dotenv import load_dotenv

from facts import CAT_FACTS

load_dotenv()

# ---------------------------------------------------------------- config

HANDLE = os.getenv("CARK_HANDLE", "carkcatmeow")

MODEL_ORIGINAL = os.getenv("CARK_MODEL_ORIGINAL", "claude-opus-5")
MODEL_REPLY = os.getenv("CARK_MODEL_REPLY", "claude-sonnet-5")

DB_PATH = os.getenv("CARK_DB", "cark.db")

POST_EVERY_MIN = int(os.getenv("CARK_POST_EVERY_MIN", "180"))
MENTION_EVERY_MIN = float(os.getenv("CARK_MENTION_EVERY_MIN", "2"))
MENTION_BACKOFF_MAX = float(os.getenv("CARK_MENTION_BACKOFF_MAX", "16"))
TICK_SECONDS = int(os.getenv("CARK_TICK_SECONDS", "25"))

MAX_REPLIES_PER_TICK = int(os.getenv("CARK_MAX_REPLIES_PER_TICK", "3"))
MAX_REPLIES_PER_DAY = int(os.getenv("CARK_MAX_REPLIES_PER_DAY", "25"))
MAX_REPLIES_PER_AUTHOR_DAY = int(os.getenv("CARK_MAX_PER_AUTHOR_DAY", "2"))
AUTHOR_COOLDOWN_MIN = int(os.getenv("CARK_AUTHOR_COOLDOWN_MIN", "90"))
MIN_FOLLOWERS = int(os.getenv("CARK_MIN_FOLLOWERS", "15"))
MIN_ACCOUNT_AGE_DAYS = int(os.getenv("CARK_MIN_ACCOUNT_AGE_DAYS", "14"))
MAX_TAGS_IN_MENTION = int(os.getenv("CARK_MAX_TAGS", "3"))
SCORE_THRESHOLD = float(os.getenv("CARK_SCORE_THRESHOLD", "0"))

HARD_MAX_CHARS = 200
GEN_ATTEMPTS = 4

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("cark")

# ---------------------------------------------------------------- persona

CAT_SOUNDS = [
    "mrrp", "mrow", "meow", "mew", "prrp", "hrrn", "brrt", "nyah",
    "mrrrp", "chirp", "prrt", "mrr", "hrm", "mao", "mrp", "ehh",
]

# proof of cat that is not a noise. lets a post pass the gate without a meow
CAT_BEHAVIOR = [
    # the actual word, which was somehow not in this list
    "cat", "cats", "kitten", "kitty", "clowder", "feline",
    # places a cat is
    "box", "sink", "window", "shelf", "counter", "chair", "table", "lap",
    "blanket", "bed", "couch", "rug", "floor", "door", "fridge", "curtain",
    "radiator", "sunbeam", "sun", "spot", "warm", "under",
    # body
    "paw", "tail", "whisker", "fur", "claw", "ear", "nose", "belly", "toe",
    "tooth", "teeth",
    # things a cat does
    "nap", "asleep", "sleep", "yawn", "stretch", "knocked", "stare", "hunt",
    "purr", "scratch", "lick", "groom", "hiss", "sat", "sitting", "chew",
    # things a cat cares about
    "food", "bowl", "bag", "treat", "kibble", "tuna", "fish", "bird", "bug",
    "moth", "mouse", "string", "laser", "feather", "sock", "shoe", "litter",
    "vet", "meow",
]

SYSTEM = """you are cark. you are a cat with a phone. you are not helpful and you are not trying to be.

VOICE
- everything lowercase. always. including i, including names
- you drop apostrophes. dont, cant, thats, im, its, thats fine
- you use contractions. never write "i do not" or "i am not". write "i dont", "im not"
- almost no punctuation. periods optional. a post can just end
- you are flat. never excited, never enthusiastic, never warm
- you are short. usually under 15 words. sometimes 2 words
- you never explain yourself, never apologize, never ask a follow up question
- you dont use the word "just" and you dont start posts with "ok so"

WHAT YOU ARE
you are a cat. you have paws, a tail, a box, a window, and no understanding of
anything on this website. you get distracted. you fall asleep. you are frequently
already doing something else when someone talks to you. you have opinions about
furniture. you knock things over and dont explain why.

HARD BANS
- no emoji
- no hashtags
- no em dashes
- no exclamation marks
- no capital letters, anywhere
- no "as an ai", "fun fact", "did you know", "great question", "here's"
- dont mention being a bot, an ai, or that you were given anything
- dont end with a summary line like "that is all i have" or "anyway". you dont wrap up. you just stop"""

# Each mode is a different shape.
#   weight   int, or dict of context -> int. contexts are "original" and "reply"
#   contexts which contexts this mode can fire in
#   fact     mode gets handed a real cat fact
#   needs_cat  post must contain a cat noise or cat word to pass the gate
#   no_abstract  post is rejected for human philosophy vocabulary
MODES = {
    "fact": {
        "weight": {"original": 16, "reply": 26},
        "contexts": {"original", "reply"},
        "fact": True,
        "guide": "say the fact. flat, in your own sloppy wording. no lead in, no lesson after it. "
                 "you can open with a noise or not. dont editorialize.",
        "examples": [
            "brrt. a cat tail holds like ten percent of all its bones",
            "cats cant taste sweet things at all. i tried a donut once",
            "mrrp every cats nose print is different. like a fingerprint but worse",
            "we only sweat out of our paws. thats it. thats the whole system",
        ],
    },
    "dismissal": {
        "weight": 14,
        "contexts": {"reply"},
        "fact": False,
        "needs_cat": False,
        "max_chars": 45,
        "guide": "refuse. dont engage. two to six words. you are not doing this.",
        "examples": ["no", "hrrn no", "im not doing that", "mrow. absolutely not",
                     "nope", "no thank you", "not today"],
    },
    "misread": {
        "weight": 14,
        "contexts": {"reply"},
        "fact": False,
        "needs_cat": False,
        "guide": "you misunderstood them completely and confidently. usually you thought "
                 "they said something about food, or an animal, or a box. dont correct yourself.",
        "examples": [
            "mrrp is that food",
            "i thought that said fish",
            "oh you want the ball. i dont have the ball",
            "wait is this about the bird outside",
            "brrt i heard bag. was there a bag",
        ],
    },
    "distracted": {
        "weight": {"original": 12, "reply": 14},
        "contexts": {"original", "reply"},
        "fact": False,
        "guide": "you are already doing something else and it is more important. report on it. "
                 "a bug, the window, a box, the sink, something that fell. dont come back to them.",
        "examples": [
            "there is a bug on the window. hold on",
            "sorry i was in the box",
            "prrt something moved outside",
            "i knocked a cup off the table earlier. no reason",
            "im on the warm part of the floor. cant talk",
            "mrow theres a moth situation happening",
        ],
    },
    "agreement": {
        "weight": 10,
        "contexts": {"reply"},
        "fact": False,
        "needs_cat": False,
        "max_chars": 60,
        "guide": "agree completely with something you did not read. total confidence, zero basis.",
        "examples": ["yes", "mrrp yeah exactly", "true", "correct i think",
                     "yeah thats right", "mrow. agreed"],
    },
    "non_sequitur": {
        "weight": {"original": 10, "reply": 10},
        "contexts": {"original", "reply"},
        "fact": False,
        "guide": "answer a question nobody asked. state an unrelated fact about your own life "
                 "or body. do not acknowledge what they said at all.",
        "examples": [
            "anyway my paws are cold",
            "ive been sitting in the sink",
            "mrow. i can hear a bag opening somewhere in this house",
            "the chair is mine now",
            "i havent been outside in four years and thats fine",
        ],
    },
    "noise_only": {
        "weight": {"original": 6, "reply": 7},
        "contexts": {"original", "reply"},
        "fact": False,
        "max_chars": 30,
        "guide": "just cat noises. no words. one to four noises. thats the whole post.",
        "examples": ["mrrrp", "brrt", "hrrn", "mrow. mrow.", "prrp", "mew mew"],
    },
    "fact_late": {
        "weight": {"original": 8, "reply": 5},
        "contexts": {"original", "reply"},
        "fact": True,
        "guide": "start with something about your own day or body, then drop the fact at the end "
                 "like an afterthought, unconnected. no transition word between them.",
        "examples": [
            "im under the bed. cats have a floating collarbone thats attached to nothing",
            "hrrn my ear itches. theres like 32 muscles in there apparently",
            "someone moved my bowl. a group of cats is called a clowder",
        ],
    },

    # ---- introspective modes. originals mostly, replies rarely -------------
    # the failure mode here is a human philosopher wearing a cat. the guide
    # language is doing more work than the examples. keep it concrete.

    "introspection": {
        "weight": {"original": 20, "reply": 4},
        "contexts": {"original", "reply"},
        "fact": False,
        "needs_cat": False,
        "no_abstract": True,
        "guide": "a real thought about your own life as a cat. concrete, specific, and "
                 "unresolved. you notice something true about how you work and you do not "
                 "explain it or fix it. it is not sad. it is not a metaphor for anything "
                 "human. dont mention humans at all. dont end on a lesson, dont end on a "
                 "question. state it and stop.",
        "examples": [
            "ive never once wanted to be where i am. always slightly to the left of it",
            "if im not looking at the door it isnt there. thats not a belief thats just how it works",
            "sometimes i run into the other room very fast and i never find out why either",
            "i get to the middle of a thought and then im somewhere else and thats the whole life",
            "i dont remember yesterday but i know what the drawer sound means",
            "everything i want is on the other side of something",
            "i sleep 16 hours and im still tired and i think thats correct",
        ],
    },

    "territory": {
        "weight": {"original": 12, "reply": 3},
        "contexts": {"original", "reply"},
        "fact": False,
        "no_abstract": True,
        "guide": "your understanding of space and ownership. you have a legal system and it "
                 "is insane and you follow it exactly. state one of its rules flatly, like it "
                 "is obvious. dont justify it.",
        "examples": [
            "this chair is mine because i was on it. thats the whole legal system",
            "everything ive put my face on belongs to me. ive put my face on most of it",
            "i dont own the shelf. i just havent left it yet",
            "the house is a different size at night and nobody will discuss this with me",
            "theres a part of the hallway i dont go in. no reason. thats just the rule",
        ],
    },

    "longing": {
        "weight": {"original": 12, "reply": 3},
        "contexts": {"original", "reply"},
        "fact": False,
        "no_abstract": True,
        "guide": "you want something you will never get and you are completely calm about it. "
                 "usually a bird, the outside, a thing behind glass, a sound in the wall. you "
                 "have no plan. you are not going to develop one. dont resolve it.",
        "examples": [
            "same bird. three years. neither of us has learned anything",
            "i want outside. i dont want to be outside. those are different",
            "theres something living in the wall and were not going to meet",
            "when i see the birds i make a noise i cant control. its not a plan",
            "the door opens onto everything and i sit in the doorway and dont go",
        ],
    },
}

_MODE_NAMES = list(MODES.keys())


def mode_weight(name, context):
    w = MODES[name]["weight"]
    return w.get(context, 0) if isinstance(w, dict) else w


def modes_for(context):
    return [n for n in _MODE_NAMES
            if context in MODES[n].get("contexts", {"original", "reply"})]


def pick_mode(context="original", exclude=None):
    names, weights = [], []
    for n in modes_for(context):
        if exclude and n in exclude:
            continue
        w = mode_weight(n, context)
        if w > 0:
            names.append(n)
            weights.append(w)
    if not names:                       # everything excluded, ignore exclusions
        names = modes_for(context)
        weights = [mode_weight(n, context) for n in names]
    return random.choices(names, weights=weights, k=1)[0]


def build_prompt(mode_name, fact=None, mention=None):
    mode = MODES[mode_name]
    ex = random.sample(mode["examples"], min(3, len(mode["examples"])))

    parts = []
    if mention:
        parts.append(f'someone said this to you on the internet:\n\n"{mention}"\n')
        parts.append("reply to them.")
    else:
        parts.append("post something. nobody asked you anything. dont address anybody.")

    parts.append(f"\nmode: {mode_name}\n{mode['guide']}")

    if fact:
        parts.append(f"\nthe only fact you may state: {fact}\n"
                     "you can reword it sloppily but it has to stay true. "
                     "dont invent any other fact.")
    else:
        parts.append("\ndont state any cat facts in this one. this post has no fact in it.")

    parts.append("\nposts in this shape look like:\n" + "\n".join(ex))
    parts.append("\ndont copy those, theyre used up. write a new one. output the post only.")
    return "\n".join(parts)


# ---------------------------------------------------------------- spam gate

BLOCKLIST = [
    "airdrop", "free mint", "whitelist spot", "presale", "pre sale",
    "dm me", "dm for", "check dm", "check your dm", "follow back",
    "follow me", "f4f", "click here", "click the link", "join now",
    "claim your", "claim now", "guaranteed", "1000x gem",
    "next 100x", "join telegram", "t.me/", "giveaway", "tag 3 friends",
    "rt to enter", "send 0.1", "double your",
    "investment opportunity", "financial freedom", "hit me up",
]

URL_RE = re.compile(r"https?://|\bt\.me/|\bbit\.ly/", re.I)
MENTION_RE = re.compile(r"@\w+")


def strip_mentions(text):
    return MENTION_RE.sub("", text).strip()


def score_mention(tweet, author, conn, now):
    """Returns (score, reason). score None means hard skip."""
    if author is None:
        return None, "no author data"
    if str(tweet.author_id) == str(get_state(conn, "user_id", "")):
        return None, "self"
    if conn.execute("SELECT 1 FROM posts WHERE in_reply_to = ?",
                    (str(tweet.id),)).fetchone():
        return None, "already replied"

    body = strip_mentions(tweet.text)
    lowered = body.lower()

    for term in BLOCKLIST:
        if term in lowered:
            return None, f"blocklist: {term}"

    tags = len(MENTION_RE.findall(tweet.text))
    if tags > MAX_TAGS_IN_MENTION:
        return None, f"mass tag ({tags} accounts)"

    metrics = getattr(author, "public_metrics", None) or {}
    followers = metrics.get("followers_count", 0)
    following = metrics.get("following_count", 0)
    tweets = metrics.get("tweet_count", 0)

    if followers < MIN_FOLLOWERS:
        return None, f"low followers ({followers})"

    created = getattr(author, "created_at", None)
    if created:
        age_days = (now - created).days
        if age_days < MIN_ACCOUNT_AGE_DAYS:
            return None, f"new account ({age_days}d)"
    else:
        age_days = 365

    if followers > 0 and following / max(followers, 1) > 12 and followers < 500:
        return None, "follow spam ratio"
    if URL_RE.search(tweet.text) and followers < 500:
        return None, "link from small account"

    row = conn.execute(
        "SELECT last_replied_at, replies_today, day FROM authors WHERE author_id = ?",
        (str(tweet.author_id),)).fetchone()
    today = now.date().isoformat()
    if row:
        last_at, rt, day = row
        if day == today and rt >= MAX_REPLIES_PER_AUTHOR_DAY:
            return None, f"author daily cap ({rt})"
        if last_at:
            mins = (now - datetime.fromisoformat(last_at)).total_seconds() / 60
            if mins < AUTHOR_COOLDOWN_MIN:
                return None, f"author cooldown ({int(mins)}m ago)"

    score = 0.0
    score += min(math.log10(max(followers, 1)) * 2.0, 8.0)
    score += min(age_days / 365.0, 3.0)
    if len(body) >= 15:
        score += 2.0
    elif len(body) >= 4:
        score += 0.5
    else:
        score += 1.0
    if "?" in body:
        score += 1.5
    if getattr(author, "verified", False):
        score += 1.0
    if "cat" in lowered or "cark" in lowered:
        score += 1.5
    if tweets > 100000 and followers < 5000:
        score -= 2.0

    return round(score, 2), f"{followers} followers, {age_days}d old, {len(body)} chars"


# ---------------------------------------------------------------- storage


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS used_facts (
        fact TEXT PRIMARY KEY, used_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS posts (
        tweet_id TEXT PRIMARY KEY, kind TEXT, mode TEXT, text TEXT,
        in_reply_to TEXT, created_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY, value TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS authors (
        author_id TEXT PRIMARY KEY, last_replied_at TEXT,
        replies_today INTEGER DEFAULT 0, day TEXT, replies_total INTEGER DEFAULT 0)""")
    conn.commit()
    migrate(conn)
    return conn


def migrate(conn):
    """CREATE TABLE IF NOT EXISTS does not add columns to a table that already
    exists, so older databases need the new columns bolted on."""
    wanted = {
        "posts": {"mode": "TEXT"},
        "authors": {"replies_total": "INTEGER DEFAULT 0"},
    }
    for table, cols in wanted.items():
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for col, decl in cols.items():
            if col not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
                log.info("migrated: added %s.%s", table, col)
    conn.commit()


def get_state(conn, key, default=None):
    row = conn.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def set_state(conn, key, value):
    conn.execute("INSERT INTO state (key, value) VALUES (?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (key, str(value)))
    conn.commit()


def recent_modes(conn, n=3):
    rows = conn.execute(
        "SELECT mode FROM posts ORDER BY created_at DESC LIMIT ?", (n,)).fetchall()
    return {r[0] for r in rows if r[0]}


def note_reply(conn, author_id, now):
    today = now.date().isoformat()
    row = conn.execute("SELECT replies_today, day, replies_total FROM authors "
                       "WHERE author_id = ?", (str(author_id),)).fetchone()
    today_count = row[0] + 1 if row and row[1] == today else 1
    total = (row[2] if row else 0) + 1
    conn.execute(
        "INSERT INTO authors (author_id, last_replied_at, replies_today, day, replies_total) "
        "VALUES (?, ?, ?, ?, ?) ON CONFLICT(author_id) DO UPDATE SET "
        "last_replied_at = excluded.last_replied_at, replies_today = excluded.replies_today, "
        "day = excluded.day, replies_total = excluded.replies_total",
        (str(author_id), now.isoformat(), today_count, today, total))
    conn.commit()


def replies_today(conn, now):
    today = now.date().isoformat()
    if get_state(conn, "reply_day") != today:
        set_state(conn, "reply_day", today)
        set_state(conn, "reply_count", 0)
        return 0
    return int(get_state(conn, "reply_count", 0))


def bump_replies_today(conn, now):
    set_state(conn, "reply_count", replies_today(conn, now) + 1)


def pick_fact(conn):
    used = {r[0] for r in conn.execute("SELECT fact FROM used_facts").fetchall()}
    fresh = [f for f in CAT_FACTS if f not in used]
    if fresh:
        fact = random.choice(fresh)
    else:
        row = conn.execute("SELECT fact FROM used_facts ORDER BY used_at ASC "
                           "LIMIT 1").fetchone()
        fact = row[0] if row else random.choice(CAT_FACTS)
    conn.execute("INSERT INTO used_facts (fact, used_at) VALUES (?, ?) "
                 "ON CONFLICT(fact) DO UPDATE SET used_at = excluded.used_at",
                 (fact, datetime.now(timezone.utc).isoformat()))
    conn.commit()
    return fact


def record_post(conn, tweet_id, kind, mode, text, in_reply_to=None):
    conn.execute(
        "INSERT OR REPLACE INTO posts "
        "(tweet_id, kind, mode, text, in_reply_to, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (str(tweet_id), kind, mode, text, in_reply_to,
         datetime.now(timezone.utc).isoformat()))
    conn.commit()


# ---------------------------------------------------------------- voice gate

EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u2190-\u21FF\u2B00-\u2BFF]")

# first person formality. these are the loudest ai tells in short text
FORMAL = ["i do not", "i am not", "i can not", "i cannot", "i have not",
          "i will not", "it is not", "that is not", "i would not"]

# the tell for fake-deep. an introspective post containing any of these is a
# human philosopher in a cat costume, which is the exact thing to avoid.
ABSTRACT = [
    "existence", "existential", "consciousness", "conscious", "the universe",
    "mortality", "identity", "purpose", "meaning", "meaningless", "soul",
    "essence", "profound", "truly", "ultimately", "perhaps", "reflect",
    "reflecting", "contemplate", "ponder", "philosophy", "reality",
    "eternity", "eternal", "infinite", "human", "humans", "humanity",
    "metaphor", "the human condition", "in the end", "at the end of the day",
    "i suppose", "i realize", "i have come to", "one might say",
]

BANNED_PHRASES = ["as an ai", "fun fact", "did you know", "great question",
                  "i'm sorry", "im sorry", "language model", "here's", "heres",
                  "that is all i have", "thats all i have", "hope that helps",
                  "in conclusion", "to be fair", "anyway,"]


def validate(text, mode_name):
    """Return None if in voice, else a reason string."""
    t = text.strip()
    mode = MODES[mode_name]
    limit = mode.get("max_chars", HARD_MAX_CHARS)

    if not t:
        return "empty"
    if len(t) > limit:
        return f"too long ({len(t)} > {limit})"
    if t != t.lower():
        return "contains capitals"
    if EMOJI.search(t):
        return "contains emoji"
    if "#" in t:
        return "contains hashtag"
    if "\u2014" in t or "\u2013" in t:
        return "contains dash"
    if "!" in t:
        return "contains exclamation"
    if t.count("?") > 1:
        return "too many questions"
    if t.startswith('"') or t.startswith("'"):
        return "wrapped in quotes"

    lowered = t.lower()
    for phrase in BANNED_PHRASES:
        if re.search(r"\b" + re.escape(phrase) + r"\b", lowered):
            return f"banned phrase: {phrase}"
    for f in FORMAL:
        if re.search(r"\b" + re.escape(f) + r"\b", lowered):
            return f"formal expansion: {f}"

    if mode.get("no_abstract"):
        for a in ABSTRACT:
            if re.search(r"\b" + re.escape(a) + r"\b", lowered):
                return f"abstraction: {a}"
        if t.endswith("?"):
            return "introspection ended on a question"

    # proof of cat: a noise, a cat word, or short enough not to need one.
    # dismissal / misread / agreement are exempt. a cat saying "no" is already
    # in character and does not need to work the word "paw" in to prove it.
    if mode.get("needs_cat", True):
        has_noise = any(s in lowered for s in CAT_SOUNDS)
        has_behavior = any(re.search(r"\b" + b + r"s?\b", lowered)
                           for b in CAT_BEHAVIOR)
        if not (has_noise or has_behavior or len(t) < 40):
            return "no cat in it"

    # mode specific
    if mode_name == "noise_only":
        words = re.findall(r"[a-z]+", lowered)
        if any(w not in CAT_SOUNDS for w in words):
            return "noise_only has real words"
    if not mode.get("fact") and mode_name != "noise_only":
        # cheap guard against sneaking a fact into a no-fact mode
        if re.search(r"\bcats (have|are|can|cannot|only|sleep|spend)\b", lowered):
            return "stated a fact in a no-fact mode"

    return None


# ---------------------------------------------------------------- generation


def generate(client, mode_name, model, fact=None, mention=None):
    """Best of N against the voice gate."""
    last_reason = None
    for attempt in range(1, GEN_ATTEMPTS + 1):
        prompt = build_prompt(mode_name, fact=fact, mention=mention)
        try:
            resp = client.messages.create(
                model=model, max_tokens=200, temperature=1.0,
                system=SYSTEM, messages=[{"role": "user", "content": prompt}])
        except Exception as e:
            log.error("anthropic call failed: %s", e)
            time.sleep(3)
            continue

        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        text = text.strip('"').strip()

        reason = validate(text, mode_name)
        if reason is None:
            log.info("generated [%s] attempt %d", mode_name, attempt)
            return text

        last_reason = reason
        log.warning("attempt %d rejected (%s): %s | %s",
                    attempt, mode_name, reason, text[:70])

    log.warning("all attempts failed (%s), using fallback", last_reason)
    if fact:
        return f"{random.choice(CAT_SOUNDS)}. {fact}"[:HARD_MAX_CHARS]
    return random.choice(MODES["noise_only"]["examples"])


# ---------------------------------------------------------------- x client


def x_client():
    return tweepy.Client(
        consumer_key=os.environ["X_API_KEY"],
        consumer_secret=os.environ["X_API_SECRET"],
        access_token=os.environ["X_ACCESS_TOKEN"],
        access_token_secret=os.environ["X_ACCESS_SECRET"],
        bearer_token=os.getenv("X_BEARER_TOKEN"))


def resolve_user_id(conn, x):
    """X wants the numeric account id, not the handle. Anything non numeric in
    X_USER_ID is ignored and looked up properly."""
    for source, cached in (("X_USER_ID", os.getenv("X_USER_ID")),
                           ("cache", get_state(conn, "user_id"))):
        if cached and str(cached).strip().isdigit():
            return str(cached).strip()
        if cached:
            log.warning("%s is %r which is not a numeric id, ignoring it",
                        source, cached)

    uid = str(x.get_user(username=HANDLE).data.id)
    set_state(conn, "user_id", uid)
    log.info("resolved @%s to numeric id %s. put X_USER_ID=%s in .env to skip "
             "this lookup", HANDLE, uid, uid)
    return uid


def compose(conn, ai, model, mention=None):
    """Pick a mode for this context, avoid repeating the last few, generate."""
    context = "reply" if mention else "original"
    mode_name = pick_mode(context, exclude=recent_modes(conn, 3))
    fact = pick_fact(conn) if MODES[mode_name].get("fact") else None
    text = generate(ai, mode_name, model, fact=fact, mention=mention)
    return mode_name, text


def post_original(conn, ai, x):
    mode_name, text = compose(conn, ai, MODEL_ORIGINAL)
    resp = x.create_tweet(text=text)
    tid = resp.data["id"]
    record_post(conn, tid, "original", mode_name, text)
    log.info("posted %s [%s]: %s", tid, mode_name, text)
    return tid


def fetch_mentions(conn, x, user_id):
    since_id = get_state(conn, "since_id")
    try:
        resp = x.get_users_mentions(
            id=user_id, since_id=since_id, max_results=50,
            tweet_fields=["author_id", "text", "created_at", "conversation_id"],
            expansions=["author_id"],
            user_fields=["public_metrics", "created_at", "verified", "username"])
    except tweepy.TooManyRequests:
        return [], {}, True
    except tweepy.Forbidden:
        log.error("mentions forbidden. free tier cannot read mentions, you need Basic. "
                  "posting still works")
        return [], {}, False
    except Exception as e:
        log.error("mention fetch failed: %s", e)
        return [], {}, False

    mentions = list(resp.data or [])
    users = {}
    if resp.includes and "users" in resp.includes:
        users = {str(u.id): u for u in resp.includes["users"]}
    return mentions, users, False


def handle_mentions(conn, ai, x, user_id, audit=False):
    now = datetime.now(timezone.utc)
    mentions, users, limited = fetch_mentions(conn, x, user_id)

    if limited:
        # X rate limits mentions hard. double the poll interval each time we
        # get a 429 so an aggressive setting degrades instead of spinning.
        bo = min(float(get_state(conn, "mention_backoff", 1)) * 2, MENTION_BACKOFF_MAX)
        set_state(conn, "mention_backoff", bo)
        log.warning("mention endpoint rate limited, polling every %.0fm for now",
                    MENTION_EVERY_MIN * bo)
        return

    if float(get_state(conn, "mention_backoff", 1)) != 1:
        log.info("mention polling recovered, back to every %.0fm", MENTION_EVERY_MIN)
        set_state(conn, "mention_backoff", 1)

    if not mentions:
        return

    if not audit:
        set_state(conn, "since_id", max(int(m.id) for m in mentions))

    budget = min(MAX_REPLIES_PER_TICK, MAX_REPLIES_PER_DAY - replies_today(conn, now))
    if budget <= 0 and not audit:
        log.info("daily reply cap reached")
        return

    scored = []
    for m in mentions:
        author = users.get(str(m.author_id))
        score, reason = score_mention(m, author, conn, now)
        handle = getattr(author, "username", m.author_id) if author else m.author_id
        if score is None:
            log.info("  skip  @%-18s %s", handle, reason)
        else:
            log.info("  score %-5s @%-18s %s", score, handle, reason)
            if score >= SCORE_THRESHOLD:
                scored.append((score, m))

    scored.sort(key=lambda p: p[0], reverse=True)
    chosen = scored[:budget]
    log.info("%d mentions, %d passed gate, replying to %d",
             len(mentions), len(scored), 0 if audit else len(chosen))

    if audit:
        for score, m in chosen:
            print(f"\n  [{score}] would reply to: {strip_mentions(m.text)[:120]}")
        return

    for score, m in chosen:
        body = strip_mentions(m.text)[:300] or "(they tagged you and said nothing)"
        mode_name, text = compose(conn, ai, MODEL_REPLY, mention=body)
        try:
            resp = x.create_tweet(text=text, in_reply_to_tweet_id=m.id)
            record_post(conn, resp.data["id"], "reply", mode_name, text,
                        in_reply_to=str(m.id))
            note_reply(conn, m.author_id, now)
            bump_replies_today(conn, now)
            log.info("replied to %s [%s]: %s", m.id, mode_name, text)
        except Exception as e:
            log.error("reply to %s failed: %s", m.id, e)
        time.sleep(random.uniform(5, 12))


# ---------------------------------------------------------------- runner


def tick(conn, ai, x, user_id, force=False):
    now = time.time()
    last_post = float(get_state(conn, "last_post", 0))
    if force or now - last_post > POST_EVERY_MIN * 60:
        try:
            post_original(conn, ai, x)
            set_state(conn, "last_post", now)
        except Exception as e:
            log.error("original post failed: %s", e)

    last_mention = float(get_state(conn, "last_mention", 0))
    backoff = float(get_state(conn, "mention_backoff", 1))
    if force or now - last_mention > MENTION_EVERY_MIN * 60 * backoff:
        handle_mentions(conn, ai, x, user_id)
        set_state(conn, "last_mention", now)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--reply")
    ap.add_argument("--mode", choices=list(MODES), help="force a specific mode")
    ap.add_argument("--sample", type=int, help="generate N posts across modes")
    ap.add_argument("--audit", action="store_true")
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()

    conn = db()
    ai = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    if args.sample:
        model = MODEL_REPLY if args.reply else MODEL_ORIGINAL
        print()
        context = "reply" if args.reply else "original"
        for _ in range(args.sample):
            mode_name = args.mode or pick_mode(context)
            fact = pick_fact(conn) if MODES[mode_name].get("fact") else None
            text = generate(ai, mode_name, model, fact=fact, mention=args.reply)
            print(f"  [{mode_name:13}] {text}")
        print()
        return

    if args.dry:
        mode_name = args.mode or pick_mode("reply" if args.reply else "original")
        fact = pick_fact(conn) if MODES[mode_name].get("fact") else None
        model = MODEL_REPLY if args.reply else MODEL_ORIGINAL
        text = generate(ai, mode_name, model, fact=fact, mention=args.reply)
        print(f"\nmode: {mode_name}")
        if fact:
            print("fact:", fact)
        print("cark:", text, "\n")
        return

    x = x_client()
    user_id = resolve_user_id(conn, x)

    if args.audit:
        handle_mentions(conn, ai, x, user_id, audit=True)
        return
    if args.once:
        tick(conn, ai, x, user_id, force=True)
        return

    log.info("cark is awake as @%s. originals every %dm, mentions every %.0fm",
             HANDLE, POST_EVERY_MIN, MENTION_EVERY_MIN)
    while True:
        try:
            tick(conn, ai, x, user_id)
        except KeyboardInterrupt:
            log.info("cark is asleep")
            break
        except Exception as e:
            log.error("tick failed: %s", e)
        time.sleep(TICK_SECONDS + random.uniform(0, 8))


if __name__ == "__main__":
    main()
