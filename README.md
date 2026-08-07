# cark site

Single page. Three sections: ask cark, cat mind, token.

## files

```
index.html        the page
cat3d.js          the three.js cark in the bother section
api/ask.js        serverless function, holds the anthropic key
cark.png          hero logo, 760px png fallback
cark.webp         hero logo, 44kb, what actually loads
icon.png          favicon and apple touch icon
og.png            1200x630 social card
thoughts.json     written by the bot, optional
```

Everything sits at the repo root, not in `public/`. Vercel serves a plain static
site from the root, so an asset in `public/` would resolve to `/public/cark.webp`
and 404 against the `/cark.webp` the page asks for.

## deploy

```
vercel
```

Then in Vercel project settings, Environment Variables, add:

```
ANTHROPIC_API_KEY=sk-ant-...
CARK_MODEL=claude-sonnet-5      (optional)
```

The key lives on the server only. Never put it in `index.html`, the browser can
read everything in there.

## the cat mind section

Reads `/thoughts.json`. If that file is missing the page falls back to five
embedded seed thoughts, so the section is never empty on a fresh deploy.

To wire it to the real chain, have the bot export into this repo:

```powershell
python cark.py --export-thoughts C:\path\to\cark-site\thoughts.json
```

Or set `CARK_THOUGHTS_JSON` in the bot's `.env` and it writes the file every time
it has a new thought. Commit and redeploy, or point both at the same volume if the
bot runs on the same box as the site.

## rate limiting

`api/ask.js` has none. It caps question length at 280 characters and that is it.
A single motivated person can run up your Anthropic bill.

Before this gets any traffic, add per-IP limiting with `@vercel/kv`, the same
pattern as the RobinScan public API. Roughly:

```js
const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
const key = `ask:${ip}:${Math.floor(Date.now() / 60000)}`;
const n = await kv.incr(key);
if (n === 1) await kv.expire(key, 60);
if (n > 6) return res.status(429).json({ error: "too many questions. wait a minute." });
```

## design notes

Palette is the avatar and nothing else: `#000000`, chalk `#f2f0ec`, blush `#f2a7c3`.
No third color anywhere.

The cat is drawn in inline SVG rather than shipped as a PNG, so it stays sharp at
any size and the chalk texture comes from an SVG filter (`feTurbulence` displacement
plus a gaussian bloom) instead of a bitmap. Same filter is available to anything
else you draw on the page.

Type pairs `Newsreader` for cark's actual words against `Space Mono` for every label,
count, and address. The contrast is deliberate: a stupid cat, but its thoughts are
set like literature.

The layout is mostly empty. Sections are `22vh` apart and the measure is capped at
33rem. That emptiness is the design, matching the scene prompts where the cat sits
very small in a large black frame. If you add sections, keep the space.

## bother the cat

A real three.js cat, built in `cat3d.js`. three r128 from cdnjs, matching the
version used across the other builds.

**How the chalk look survives in 3D.** The logo is a white line around a black
shape, which in 3D is an inverted hull. `part()` draws every piece three times:
flat black fill, then the same geometry scaled up with `side: THREE.BackSide` so
only the rim shows as white, then a third transparent additive shell for the chalk
bloom. That means no post processing pass, no EffectComposer, no extra CDN files.
The cheeks are the only color in the scene, additive pink, exactly like the logo.

Everything is primitives: spheres, cones, cylinders, one torus. No loaders, no
model files, nothing to host. The tail is five segments parented in a chain, each
rotating slightly behind the last, which is why it sways instead of swinging as
one rigid piece.

**States**, driven from `index.html`:

| call | what happens |
|---|---|
| `pet()` | high frequency body vibration, cheeks brighten |
| `feed()` | bowl scales in, head dips and chews |
| `play()` | glowing dot orbits, head tracks it, then a pounce hop |
| `sleep()` | rolls onto its side after 24 seconds idle |

Breathing runs underneath all of them, always.

**Interaction.** Drag to spin the cat, and it drifts back to facing forward when
you let go. Rotation is hand rolled because `OrbitControls` is not bundled in
r128 and pulling in the examples folder for one feature is not worth the request.
A drag never registers as a tap, so turning the cat around does not pet it.

**Fallbacks.** No WebGL, or `prefers-reduced-motion` set, and the section falls
back to the flat PNG with the old CSS purr. `init()` returns false and the page
adds `.fallback` to the pen. Rendering also pauses via IntersectionObserver when
the section scrolls out of view, so the canvas costs nothing while someone is
reading the cat mind entries.

**Copy** lives in `LINES` in `index.html`, ordered by patience remaining, so the
first pet gets `prrp` and the sixth gets `im going to bite you in a minute`. Index
0 is the friendliest and the last entry is what it says forever after. State is in
memory only, so a reload resets it.

## ambient meows

46 on desktop, 26 on mobile, positioned randomly at 2 to 6 percent opacity with
staggered drift. Generated in JS rather than hardcoded so no two loads are the
same. The layer is `position:fixed` with `contain:strict` and `pointer-events:none`,
so it never intercepts a click and never triggers layout on scroll.

Turn the density down in the `meows` function if it reads as busy on your display.
