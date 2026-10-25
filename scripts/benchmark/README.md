# Rendered design benchmark gate (offline)

```
node scripts/benchmark/run.mjs
node scripts/benchmark/run.mjs --project /path/deck.desel.json --evidence /path/evidence.json --out /path/results --strict
node scripts/acceptance/local/design-benchmark-test.mjs
```

Without a project, uses the shipped hand-written sample as a negative control.
This is NOT a new autonomous generation. Without evidence, cover/body/closer
roles follow sample order for triage only; a real comparison should assign roles.
A one-slide cover, or a deck without a closer, is allowed. No fixed slide count.
`--strict` exits nonzero for structural failures. Omitting it still writes the
honest failed result for inspection. External requests are blocked: inline or
embedded project assets are required, and the gate never executes slide JS.
`asset:ID` references are resolved from the project file's embedded asset list.

Evidence example (user/reviewer supplied, not model-authored self-approval):

```json
{
  "slides": {
    "slide-id": {
      "role": "body",
      "mediaKind": "product-screenshot",
      "sourceUrl": "https://official-source.example/screenshot",
      "reviewed": true
    }
  },
  "referenceSetAvailable": false,
  "claimsReviewed": false,
  "rightsReviewed": false
}
```

## Rules and limits

The user's recorded rules ask for an illustration-led focal cover, real product
screenshots with roomy explanatory text on body slides and a suitable closer.
Text-only product carousels and a big serif title with a pasted screenshot were
rejected. The approved RustDesk deck and the original 44 reference images are
not included in this source archive. Recorded preferences locate the bar but
cannot replace those pixels.

Measured on the rendered document: visible text count, loaded/broken images,
large SVG boxes, clipped union of media boxes, geometry overlap/overflow. A
12% media-box floor is an explicitly local triage heuristic, NOT a measured
reference ratio or a user-approved threshold. CSS-only art/background images
are not recognized as artwork by this conservative gate and need manual review.
Box area is not actual perceptual salience. Small icons, transparent/hidden
media, stacked duplicate boxes and off-canvas portions cannot inflate coverage.
The gate cannot determine that a raster is a real product screenshot, that an
illustration is relevant, or that an image has usage permission. An unrelated
flat raster can pass the structural check; regression tests deliberately prove
that it still cannot produce a quality approval.

No aggregate premium score is reported. Even clean structural results retain
`qualityApproval: unverified` and `parity: unverified`. Inspect the actual pixels
for focal point, crop, hierarchy, legibility, meaningful cover/body rhythm and
reference match. Verify copy against primary sources and asset rights separately.
A referenceSetAvailable flag is context only, never image-comparison evidence.
Real provider-generated quality, reference parity and Windows font fidelity
remain unverified. Add the originals later and review the saved output alongside
them; do not mark this complete based on mechanical clearance.

## Current negative control

The shipped four-slide typography sample has zero substantial media coverage.
It gets five failures (cover lacks focal media, both body slides lack media and
loaded screenshots), even though geometry is clear. This sample is an editing
and typography example, not the approved product-carousel benchmark. The result
shows why “no overlaps” and an attractive sample cannot prove autonomous premium
product-carousel output.

The benchmark runner is developer-only and is not wired into export approval.
It does not change the app's existing export blockers, or silently refuse a
legitimate text-led project outside this particular product-carousel benchmark.

Current render revision markers must match the exact slide id/aspect/HTML. A
stale or unmarked document fails instead of measuring earlier pixels. This
marker confirms the local render input, not that a model inspected the pixels.
Transparent pixels in an otherwise loaded image and empty large SVG boxes can
still fool box-area coverage. Manual pixel inspection is required; opacity and
visibility checks alone do not establish meaningful visual content.
