# cark

[@carkcatmeow](https://x.com/carkcatmeow) - a cat version of gork. speaks in cat noises,
states one true cat fact, understands nothing.

## what it does

- posts an original cat fact every 3 hours
- polls its own mentions, scores each one, and replies only to the best few
- pulls facts from a curated bank of verified facts in `facts.py` so it never hallucinates
- runs every generation through a voice gate (lowercase only, cat noise required, no emoji,
  no hashtags, no em dashes, under 180 chars) and regenerates up to 4 times before falling
  back to a hardcoded line
- opus for originals, sonnet for replies. timing matters more on originals, replies are volume

## replying like gork

Three things make a thread keep going, and the first version of this had all
three wrong.

**It sees what it was tagged under.** Mentions are fetched with
`referenced_tweets` expanded, so when someone tags cark under a photo or a take,
cark replies to the thing everyone is actually looking at rather than to the bare
ping. It is told it cannot see images and should guess wrong about them, which is
most of the bit.

**It remembers the thread.** Every exchange is stored in the `convo` table keyed
by conversation id, both sides. Follow-ups get the prior turns, cark is told not
to repeat itself, and the `callback` mode is excluded entirely when there is
nothing to call back to.

**It is allowed to ask things now.** The system prompt used to say *you never ask
a follow up question*, which was quietly killing the thing this section is about.
It can now ask one short blunt question, but only out of confusion, never to be
helpful and never to farm a reply.

Three reply modes exist purely to leave the door open:

| mode | share | what it does |
|---|---|---|
| `curious` | 14% | one blunt question. *is it warm* / *can you eat it* |
| `wrongly_certain` | 13% | confidently wrong in a way people cannot let stand. *thats a dog* |
| `callback` | 9% | refers to something earlier, gets a detail wrong |

45% of replies now invite another turn, 15% close the door. Facts dropped from
26% to 10% of replies, because a fact is an exit and this section is about not
exiting.

**Someone replying to cark bypasses the cooldown entirely** and gets +6 score.
Dropping a live thread to enforce a rate limit is the one thing that actually
kills engagement.

## reply selectivity

Every mention goes through a hard gate, then a score. Hard skips are silent and cost no tokens.

**Hard skips**

| filter | default |
|---|---|
| blocklist term in text | airdrop, dm me, follow back, presale, giveaway, t.me/, etc |
| tagged more than N accounts | 3 |
| follower count below | 0, off by default |
| account younger than | 1 day |
| following/follower ratio above 12 on a small account | follow-for-follow bots |
| contains a link and under 500 followers | shill posts |
| already replied to that tweet | dedupe |
| same author replied to recently | 4 min, skipped inside a live thread |
| same author already got N replies today | 6 |

**Score** rewards follower count (log scale), account age, actually writing something,
asking a question, and saying "cat" or "cark". It penalizes accounts with huge tweet
counts and no audience. Top scorers get replies, capped at 6 per tick and 80 per day.

A bare `@carkcatmeow` with no text is allowed through at mid priority, since that's the
core gork interaction, it just loses to a real question when budget is tight.

Tune every threshold from `.env`. Edit `BLOCKLIST` in `cark.py` directly. Keep it tight,
a fat blocklist will eat legitimate crypto twitter chatter since that's half the timeline.

## setup

```powershell
pip install -r requirements.txt
```

Copy `env.example.txt` to `.env` and fill it in. The X app needs **Read and Write**
permission and **OAuth 1.0a user context** enabled, then regenerate the access token
after changing permissions or writes will 403.

## try it

```powershell
python cark.py --dry
python cark.py --dry --reply "cark what is bitcoin"
python cark.py --audit     # score real mentions, reply to none
```

`--dry` needs only the Anthropic key. `--audit` is the one to run before going live,
it prints the skip reason or score for every mention so you can tune thresholds without
burning replies.

## run it

```powershell
python cark.py --once     one tick, posts for real
python cark.py            loop forever
```

## deploy (ubuntu 24.04, same pattern as rehvan)

`/etc/systemd/system/cark.service`

```ini
[Unit]
Description=cark
After=network.target

[Service]
Type=simple
User=cark
WorkingDirectory=/opt/cark
EnvironmentFile=/opt/cark/.env
ExecStart=/opt/cark/venv/bin/python /opt/cark/cark.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl enable --now cark
journalctl -u cark -f
```

## reply latency

Mentions are polled every 2 minutes by default, so a reply lands within about
2 to 3 minutes of someone tagging cark. That reads as instant on X.

You cannot go much faster. `get_users_mentions` is one of the tightest endpoints
on the X API and polling harder just gets you 429s. On a 429 cark doubles its own
poll interval each time (2m, 4m, 8m, up to 16x base) and resets to 2m the moment
a request succeeds, so an over-aggressive setting degrades gracefully instead of
hammering a limit it cannot clear.

True realtime needs the filtered stream endpoint, which is Pro tier and a different
architecture. Polling is the right call at this scale.

Note the daily caps still apply. At 2 minute polling cark could theoretically fire
3 replies every 2 minutes, so `CARK_MAX_REPLIES_PER_DAY` (25) and the per author
cooldown are what actually stop it from burning your X write quota in an afternoon.

## images

cark generates its own images with the openai api and attaches them to originals.
Never to replies, since an image on every reply reads as a content account.

Set `OPENAI_API_KEY` to turn it on, leave it blank to turn it off. No other change
needed.

The style anchor and per-mode scene lines live in `imagery.py`. Scenes are keyed to
post modes, so a `longing` post gets the cat facing an empty window and a `territory`
post gets the cat sitting on a chair it has claimed. The anchor never changes between
generations, which is the only reason the style holds.

**Cost control**, in order of how much they matter:

| lever | default | effect |
|---|---|---|
| `CARK_IMAGE_CHANCE` | 0.22 | only this share of originals get an image at all |
| `CARK_IMAGE_REUSE_CHANCE` | 0.45 | reuse an image already on disk instead of generating |
| `CARK_IMAGE_MAX_PER_DAY` | 4 | hard cap on new generations, reuse continues past it |
| `CARK_IMAGE_QUALITY` | medium | `low` is much cheaper and this style barely suffers |

At the defaults and a 3 hour posting cadence, that is roughly 1 or 2 new images a day.
Reuse is the lever that matters most. At this posting rate nobody notices repeats.

Everything is saved to `media/<mode>/` so you build a library over time.

```powershell
python cark.py --image                  one image, random mode
python cark.py --image longing          one image, specific mode
python cark.py --fill-images 3          3 per mode, seeds the whole library
```

Run `--fill-images 3` once before going live. That gives cark about 24 images to
draw from, after which reuse carries most posts and generation is rare.

**Media upload uses the v1.1 API**, which is a different auth object from the v2
`Client` used for posting. It reuses the same four OAuth 1.0a keys, so nothing extra
to configure, but if you see a 403 specifically on upload while text posting works,
that is a tier issue with v1.1 media upload rather than a credentials problem. cark
logs it and posts text only rather than dropping the post.

## the token

cark knows a coin named after it exists. It does not understand it and it never
promotes it.

This is enforced in code, not just prompted. `SHILL` in `cark.py` blocks buy, sell,
price, chart, moon, pump, gem, 100x, market cap, ath, dip and about twenty more,
across every mode. A memecoin mascot that shills is both worse comedy and a
compliance problem, so the gate is unconditional.

The `token` mode is 6% of originals and treats the coin like weather:

> *theres a coin with my face on it. i dont know what a coin is. i cant eat it*
> *someone showed me a red line and a green line for an hour. it moved*

Set `CARK_TOKEN_CA` in `.env` if the address changes.

## cat mind

Every 6 hours cark writes one thought, generated with the previous 6 in context so
the chain reads as a diary rather than a pile of one liners. Stored in the
`thoughts` table, seeded with three opening entries about a window and a bird.

```powershell
python cark.py --think                       write the next one
python cark.py --mind                        print the whole chain
python cark.py --export-thoughts out.json    for the website
```

Set `CARK_THOUGHTS_JSON` to a path and the bot exports automatically on every new
thought. Point it at `cark-site/public/thoughts.json`.

Thoughts are not posted to X. The `introspection` mode already covers that ground
publicly, and the chain is more interesting read all at once.

## api tier warning

`get_users_mentions` is not on the X free tier. Free gets you writes only, so the posting
loop works and the reply loop logs a Forbidden and moves on without crashing. If you want
replies you need Basic.

## tuning the voice

Everything shaping the personality is the `SYSTEM` constant in `cark.py`. The five tone
reference lines at the bottom of it do most of the work, swap those and the whole character
moves. `validate()` is the hard floor, so anything you want structurally guaranteed goes
there, not in the prompt.

Facts live in `facts.py`. Keep them true. Wrong facts delivered stupidly is a worse bit
than right facts delivered stupidly.

## modes (why it stops sounding like a bot)

cark does not have one output shape. Every post picks a weighted mode, and the
last 3 modes used are excluded from the next draw so it cannot repeat itself.

Modes are **context aware**. Originals and replies draw from different pools with
different weights. An original can never roll `dismissal` or `agreement`, because
saying "yeah exactly" to nobody is how a bot behaves.

| mode | original | reply | fact |
|---|---|---|---|
| introspection | 20% | 4% | no |
| fact | 17% | 24% | yes |
| distracted | 12% | 13% | no |
| territory | 12% | 3% | no |
| longing | 12% | 3% | no |
| non_sequitur | 11% | 9% | no |
| fact_late | 9% | 4% | yes |
| noise_only | 6% | 7% | no |
| dismissal | - | 13% | no |
| misread | - | 12% | no |
| agreement | - | 9% | no |

**Roughly a quarter of posts contain a cat fact.** The rest refuse, misunderstand,
get distracted by a bug, or think about the door.

### the introspective modes

`introspection`, `territory`, and `longing` are 45% of unprompted posts. They are
cark alone with its own life.

- **introspection** notices something true about how it works and does not fix it.
  *ive never once wanted to be where i am. always slightly to the left of it*
- **territory** states one rule of its insane private legal system as if obvious.
  *this chair is mine because i was on it. thats the whole legal system*
- **longing** wants something it will never get and is completely calm about it.
  *same bird. three years. neither of us has learned anything*

The failure mode is a human philosopher in a cat costume. `ABSTRACT` in `cark.py`
is the guard: these modes are rejected outright for words like existence,
consciousness, purpose, meaning, perhaps, ultimately, and human. They are also
rejected for ending on a question, because a rhetorical question is how fake-deep
writing signals depth. cark states a thing and stops.

### the rest of the gate

The validator is mode-aware. `noise_only` is rejected for containing real words.
No-fact modes are rejected for sneaking a fact in. `dismissal` caps at 45 chars.
`dismissal`, `misread`, and `agreement` are exempt from the proof-of-cat check,
since a cat saying "no" is already in character.

It also rejects the loudest short-text ai tells: formal first person expansions
("i do not" bounced in favor of "i dont"), summary sign-offs ("that is all i have",
"hope that helps"), and any capital letter anywhere.

### previewing

```powershell
python cark.py --sample 12                          originals
python cark.py --sample 8 --reply "what is bitcoin" replies
python cark.py --dry --mode introspection
python cark.py --dry --mode territory
```

Weights live in the `MODES` dict. Each is either an int or a per-context dict.
If unprompted posts feel too navel-gazing, drop `introspection`. If it reads like
a fact account, drop `fact`.

Thin the `examples` lists if you see cark reusing the same apartment furniture.
Three examples per mode are sampled per call, and the model leans on them harder
than it should.
