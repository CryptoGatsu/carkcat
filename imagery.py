"""
Image prompt construction for cark.

The style anchor never changes. Only the scene line does. That is the entire
reason the output stays consistent across hundreds of generations, so resist the
urge to "improve" the anchor per image.
"""

import random

STYLE_ANCHOR = """Minimalist chalk-line drawing on a pure solid black background (#000000).
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
texture, gradients, realistic fur, cute anime styling, watermarks, or text."""

BODY_SUFFIX = """

Full body cat drawn in the same single white chalk line, same proportions and
face, seen from the side or three quarters. The cat is small within the frame."""

# scene lines per post mode. keep each to one or two sentences and at most two
# objects. more than that and the chalk line goes thin and detailed, which kills
# the whole look.
SCENES = {
    "introspection": [
        "The cat sitting alone facing away from the viewer, seen from behind, with one single long horizontal white line far behind it as a horizon. Nothing else in the frame.",
        "The cat sitting very small in the exact center of a completely empty black frame, enormous negative space on all sides.",
        "The cat lying flat on its side on a single horizontal line, staring at nothing.",
    ],
    "territory": [
        "The cat sitting on top of a simple chalk-outline chair drawn in the same white line. The chair is drawn with as few lines as possible.",
        "The cat sitting at the edge of a single long white line that runs across the frame, refusing to cross it. Nothing on the other side.",
        "The cat sitting on a simple rectangle representing a shelf, high in the frame, with empty black below it.",
    ],
    "longing": [
        "The cat sitting and facing a large simple rectangle representing a window. A tiny bird outline sits outside the rectangle. The cat is small, the window is large.",
        "The cat sitting small in the bottom corner of a large simple rectangle representing an open doorway. The rectangle is empty black inside.",
        "The cat with one paw raised against a large empty rectangle, not touching it.",
    ],
    "distracted": [
        "The cat sitting and looking up at a single small moth drawn as two tiny curved lines above it. A short dotted line traces from the cat to the moth.",
        "The cat sitting beside a simple chalk-outline cup that has tipped over onto its side.",
        "The cat curled up inside a simple oval chalk basin drawn with two lines.",
    ],
    "non_sequitur": [
        "The cat sitting inside a simple chalk-outline cardboard box, only its head and ears visible over the rim.",
        "The cat standing in profile with an exaggeratedly long tail that curls in a loose spiral across the frame.",
        "The cat sitting on a small square of white line on the floor, as if in a patch of light.",
    ],
    "noise_only": [
        "The cat face alone with three small curved sound lines radiating from the side of its mouth, indicating a noise. No text.",
        "The cat face drawn very small in the center of a large empty black frame, lots of negative space around it.",
    ],
    "fact": [
        "The cat face with a thin dotted chalk line pointing from one ear out to a small empty circle, like a blank diagram label. The circle stays empty, no text.",
        "The cat face turned three quarters to the left, one ear in profile.",
    ],
    "fact_late": [
        "The cat curled into a tight circle, tail wrapped around itself, eyes drawn as two closed curved lines.",
        "The cat face alone, centered, exactly as described.",
    ],
}

# modes whose scenes are face only and should skip the full body suffix
FACE_ONLY = {"noise_only", "fact", "fact_late"}


def build_image_prompt(mode, scene=None):
    """Style anchor plus one scene line. Returns (prompt, scene_used)."""
    options = SCENES.get(mode) or SCENES["introspection"]
    scene = scene or random.choice(options)
    prompt = STYLE_ANCHOR
    if mode not in FACE_ONLY:
        prompt += BODY_SUFFIX
    return f"{prompt}\n\nScene: {scene}", scene
