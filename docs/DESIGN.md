# Design notes

Why Desel is built this way. Short version: the slide is code, the model is an
art director, and the app is a place to review work rather than a form to fill.

---

## 1. A slide is a document, not a layout tree

Every slide is a complete HTML document (inline `<style>`, no JS, no external
assets) sized exactly to the canvas (1080×1350 / 1080×1080 / 1080×1920).

Consequences, all deliberate:

- **Preview and export cannot drift.** The canvas is an `<iframe srcdoc>`, and
  export rasterises that same `contentDocument.body` with `html-to-image`.
  There is no second renderer to keep in sync.
- **The model gets the whole box.** A layout tree forces every design into the
  same skeleton; raw CSS lets a slide be a poster with overlapping type, a
  halftone photo treatment, a hand-built SVG diagram, or a brutalist grid.
- **Persistence is trivial.** A slide is one string in SQLite.

Hard limits exist because a broken document must never reach export: no
`position:fixed`, no external `<img>`, no JavaScript, Windows system fonts only.

## 2. The model is an agent, not a text generator

A turn is a loop, not a single completion:

```
user message → model streams text and tool calls → tools run → results go back
             → model continues → … until it stops calling tools
```

Tools are chosen so the model can do the job end to end:

| tool | purpose |
| --- | --- |
| `ask_user` | one focused question when the brief is genuinely ambiguous |
| `search_web` / `fetch_url` | verify facts before writing them into a slide |
| `set_deck_meta` | lock the art direction (style guide, palette, caption) |
| `write_slide` / `delete_slide` / `read_deck` | build and inspect the deck |

`write_slide` on an index that already exists **rewrites** that slide in place —
the same call the prompt uses for lint fixes — and only appends when the index is
past the end. `read_deck` without arguments returns the deck summary; with
`index` it returns that slide's full HTML, which is how a revision starts: read
first, change the part that was asked about, keep the visual system.

Every finished turn is also a receipt in the transcript: one bubble per turn with
a collapsed "n langkah" list of the tools used and the result each got back, so
it is visible what the agent actually did rather than just what it claims.
| `save_template` / `load_template` / `list_templates` | reuse a finished system |

Ordering matters and is spelled out in the prompt: research → art direction →
slides one at a time → a short summary. That sequence is what keeps six slides
feeling like one deck instead of six opinions.

## 3. The canvas is a design surface

Slides render in a sandboxed iframe (`allow-same-origin`, no scripts). Because
it is same-origin, the app reads and writes that document directly — no message
bridge, no injected runtime inside the slide:

- **Viewport** — one `translate3d(...) scale(...)` on the page layer. Zoom is
  computed so the point under the cursor stays put: the world point is solved
  from the old transform and re-anchored with the new scale.
- **Chrome** — outlines, labels and pins live in design pixels inside the same
  layer, so they follow zoom and pan for free; pins counter-scale so they stay
  legible at 12% and 400%.
- **Selection** — `elementFromPoint` (via listeners on the slide document) gives
  the real element; a short `tag#id.class > …` path identifies it for comments
  and for the agent.
- **Editing** — double-click makes the element `contenteditable`; on blur the
  document is serialised back to HTML with the editing attributes stripped, then
  saved through the normal deck path, which also snapshots a version.
- **Comments** — stored as a fraction of the artboard plus the element path, so
  a pin survives re-rendering, resizing and rewrites, and the agent receives
  "pin at 34%/18% on `h1 > em`".

## 4. Anti-slop is a written spec, not a vibe

The system prompt names the failure modes explicitly — purple-blue gradients,
emoji decoration, three equal cards, everything centred, uniform 16px radii,
generic soft shadows — and then defines what to do instead:

- a real texture (grain via `feTurbulence`, halftone via dotted
  `radial-gradient`, paper fibre),
- one clearly dominant element per slide,
- asymmetric margins and intentional edge breaks,
- at most three colours plus one accent, identical across the deck.

A negative list alone produces bland work, so each allowed direction
(editorial print, collage, brutalist data, cinematic dark) carries concrete
techniques: drop caps, ghost numerals, torn edges via `clip-path`, a single
directional light, mono labels used as real data.

## 5. References are measured, then described

`referensi/ref1` and `ref2` are real covers. An image model can copy their
pixels but not their logic, so each attachment is reduced on import
(`palette.rs`):

- dominant palette (quantised histogram on a 64×64 thumbnail, near-duplicates
  collapsed),
- mean luminance and 3rd/97th percentile contrast,
- aspect, plus the share of near-paper pixels.

That descriptor goes into the prompt for **every** model. Vision-capable models
additionally receive the images. The instruction is to copy the grammar — type
scale, density, grid logic, texture treatment, colour discipline — never the
text, logo, or artwork.

Measured examples from the shipped references:

```
ref1: 1080×1350, palet #900020 #080808 #c08890 #f0d0b8 #a03040;
      gelap (0.09), kontras sedang (0.39), bidang terang 0%
ref2: 1080×1350, palet #e0a870 #080000 #d06820 #806040 #282020;
      remang (0.23), kontras sedang (0.48), bidang terang 0%
```

A text-only model reading that knows to build a dark, high-saturation,
low-brightness cover without being shown a single pixel.

## 6. Storage is the product

If a project, a comment or an API key disappears on restart, none of the above
matters. Everything is SQLite (`rusqlite`, WAL) in the app data directory:

| table | holds |
| --- | --- |
| `settings` | provider, API key, model, temperature, export dir, toggles |
| `decks` | deck JSON (slides included) |
| `messages` | full chat transcript, including tool calls |
| `templates` | saved decks, as starting points |
| `comments` | pinned review notes with slide id and canvas coordinates |
| `assets` | reference images: base64 payload + measured profile |

Schema upgrades are additive and tested: opening a database created before the
`meta` column existed must keep working, not crash.

## 7. Interface rules

The interface is a harness, not a poster: near-black neutral surfaces, hairline
borders, Inter at 13.5px, one restrained accent used only for state, and 8–12px
radii. The artboard is the only loud thing on screen.

- **Three columns, one job each**: conversation (left), canvas + sequence
  (middle), inspection (right).
- **Nothing is hidden behind a hover-only affordance** except destructive thumb
  actions.
- **Review is spatial**: a comment pins to an x/y on a specific slide, because
  "move this up" is not a paragraph of prose.
- **Motion is small**: 160–180ms transitions on state change, no entrance
  animations on content, no layout shift while streaming.
- **Measured, not eyeballed**: contrast ≥ 4.5 for body text, zero clipped text,
  zero horizontal overflow at 1024–1440px.

## 8. What is intentionally out of scope

- Real-time collaboration.
- Animation in slides — export is a still image, so motion would be a lie.
- Bundling fonts per project — slides must render identically offline, so only
  system fonts are allowed.
