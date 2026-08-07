# cark image prompts

The avatar style is extremely constrained, which is good news. Constrained styles
stay consistent across generations. The whole trick here is that you never write a
prompt from scratch, you paste the same style anchor every time and only change
the scene line.

## how to use these

1. Start a **new ChatGPT thread** and upload the avatar PNG as the first message
   with: *"This is the exact style. Every image I ask for in this thread must match
   it precisely. Confirm you understand the style before generating anything."*
2. Then paste the **style anchor** plus one **scene line** for each image.
3. Keep generating in that same thread. Style drifts badly across threads.
4. Ask for **1:1** for standalone posts, **16:9** if the image sits above text.

If it starts drifting (adding shading, adding eyes, going grey instead of black),
re-upload the avatar and say *"you've drifted, match this again exactly."* That
works better than adding more words to the prompt.

---

## the style anchor

Paste this before every scene line, unchanged.

```
Minimalist chalk-line drawing on a pure solid black background (#000000).
A single continuous white line with soft, slightly fuzzy dry-chalk edges and a
faint bloom, as if drawn with white pastel on black paper. No fill, no shading,
no gradients, no texture in the background.

The cat: rounded head, two simple triangle ears, a small triangular nose, a small
w-shaped mouth, three long thin whiskers on each side, and two soft pink oval
blush patches on the cheeks. NO EYES ARE DRAWN. Pink is the only color in the
entire image and it appears only on the cheeks.

Flat 2D, centered, no perspective, no depth. Naive and childlike, extremely
simple, very few lines. Everything in the scene is drawn in the same white chalk
line as the cat.

Do not add: eyes, pupils, color, shading, outlines in other colors, background
texture, gradients, realistic fur, cute anime styling, watermarks, or text.
```

---

## face variants

Closest to the avatar, safest for consistency. Good as reply images and profile
rotations.

| use | scene line |
|---|---|
| default | *Just the cat face, centered, exactly as described.* |
| sleeping | *The cat face with both eyes drawn as two simple closed curved lines, sleeping. Everything else identical.* |
| wide | *The cat face with its ears flattened sideways and whiskers pushed forward.* |
| tiny | *The cat face drawn very small in the center of a large empty black frame, lots of negative space around it.* |
| looking away | *The cat face turned three quarters to the left, one ear in profile.* |

The sleeping one is the single exception where eyes get drawn, because closed eyes
are two lines and stay in style.

---

## scene prompts by post mode

These are full body. Add this line to the style anchor first:

```
Full body cat drawn in the same single white chalk line, same proportions and
face, seen from the side or three quarters. The cat is small within the frame.
```

**introspection**
> *The cat sitting alone facing away from the viewer, seen from behind, with one
> single long horizontal white line far behind it as a horizon. Nothing else in
> the frame.*

**territory**
> *The cat sitting on top of a simple chalk-outline chair drawn in the same white
> line. The chair is drawn with as few lines as possible.*

**longing**
> *The cat sitting and facing a large simple rectangle representing a window. A
> tiny bird outline sits outside the rectangle. The cat is small, the window is
> large.*

**distracted**
> *The cat sitting and looking up at a single small moth drawn as two tiny curved
> lines above it. A short dotted line traces from the cat to the moth.*

**non_sequitur**
> *The cat sitting inside a simple chalk-outline cardboard box, only its head and
> ears visible over the rim.*

**noise_only**
> *The cat face alone with three small curved sound lines radiating from the side
> of its mouth, indicating a noise. No text.*

**fact**
> *The cat face with a thin dotted chalk line pointing from one ear out to a small
> empty circle, like a blank diagram label. The circle stays empty, no text.*

**sink / bathroom**
> *The cat curled up inside a simple oval chalk basin drawn with two lines.*

**doorway**
> *The cat sitting small in the bottom corner of a large simple rectangle
> representing an open doorway. The rectangle is empty black inside.*

**sleeping curl**
> *The cat curled into a tight circle, tail wrapped around itself, eyes drawn as
> two closed curved lines.*

**long tail**
> *The cat standing in profile with an exaggeratedly long tail that curls in a
> loose spiral across the frame.*

**the hallway rule**
> *The cat sitting at the edge of a single long white line that runs across the
> frame, refusing to cross it. Nothing on the other side.*

---

## banner / header

```
[style anchor]

Wide 16:9 composition. The cat face small and centered in a vast empty black
frame with enormous negative space on both sides. Three or four tiny scattered
white chalk dots in the emptiness. Nothing else.
```

---

## what breaks it

- **Asking for emotion.** "sad cat", "lonely cat" makes it add eyebrows and
  drooping eyes. Describe the pose instead and let the emptiness do the work.
- **Adding adjectives like "cute" or "adorable."** Pulls it straight toward
  generic kawaii clipart with big eyes.
- **Complex scenes.** More than two objects and the chalk line gets thin and
  detailed, which kills the look. Two objects maximum: cat plus one thing.
- **Saying "black background"** without the hex. Some generations come back dark
  grey. `#000000` matters because it has to match the avatar edge to edge.
- **Generating in a fresh thread each time.** The single biggest cause of drift.

## pairing images with posts

Post modes and scene prompts are named the same on purpose. If you ever want to
automate it, generate 3 to 5 images per mode, drop them in `media/<mode>/`, and
have `post_original` attach a random one from the folder matching the chosen mode.
Tweepy needs the v1.1 API for media upload, which is a separate auth object from
the v2 `Client` you're already using.

Don't attach an image to every post. Text-only is the default voice, and an image
every time makes it look like a content account. One in four or five is plenty.
