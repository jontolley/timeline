# Landing hero photos

Drop three JPGs here to populate the drifting polaroid memory cards on the
landing page. The captions next to each are set in `frontend/src/pages/LandingPage.jsx`.

- `photo-1.jpg` — top-right polaroid (rotated +6°, "a quiet morning")
- `photo-2.jpg` — middle polaroid (rotated -4°, "the trip we almost cancelled")
- `photo-3.jpg` — bottom-right polaroid (rotated +10°, "summer, somewhere")

Recommended dimensions: 600×800 (portrait) or 800×600 (landscape), JPG or PNG.
Anything reasonably sized works — they're rendered as `background-size: cover`
inside the polaroid frame and softly desaturated via CSS.

If a file isn't present, the polaroid still renders with a cream paper
background (no broken image icon) — the hero stays clean.
