# Selected object editing

Objek slide exposes visible common HTML objects in the current artboard. Select
an item without hunting through overlapping artwork. The list currently shows
at most100 elements and includes containers and text, not a full DOM tree.
Select parent moves to the immediate container when it is not the slide body.

For positioned elements (absolute/fixed/relative), edit CSS left/top/width/height
in pixels relative to the CSS containing block. Flow layout is not silently
converted into absolute positions. Opacity, z-index and background color are
available. Finish commits the edited HTML through normal autosave/history.
Delete removes the selected subtree. Project undo restores it, including nested
content. Existing inline text/font/image controls remain available.

This is a bounded object inspector, not a Figma-style scene graph. It does not
promise multi-select, grouping, alignment constraints, responsive constraints,
SVG path editing or arbitrary transform decomposition. Rotated/transformed
objects retain their existing transforms; CSS dimensions are not their visual
bounding box. Slide export size and workspace slide position stay separate.

Browser tests cover parent container position, nested text preservation, delete,
project undo and actual inspector pixels. Static preview bootstrap styles are
marked and excluded from durable manual edits to avoid repeated accumulation.
Native desktop end-to-end remains final Windows verification.

Pending style edits are committed to the originating slide before slide/project
context switches; a frame carries its source slide ID rather than reusing the
newly selected slide ID. The local regression suite covers the slide switch race.

Inspector layouts reserve a separate right region on wide canvases and a bounded
scroll region below the artboard on narrow canvases. Below600px the workspace has
Chat & proyek / Canvas tabs rather than squeezing both panels beside each other.
Readiness guards handle an iframe document whose body has not arrived yet.

Positioned axis-aligned objects also support10px button nudges and six parent-relative
alignment actions. Align uses the CSS containing block, not an inferred slide-wide
scene graph. Transformed objects and flow layout are not rewritten. Removing a
right/bottom constraint preserves the computed dimension to avoid changing a
stretched object's size. This is single-object alignment, not multi-select.

## Read-only presentation and visibility

The canvas Presentasi action opens the current visible slides with static,
sandboxed rendering and fits the project's aspect ratio to the available space.
Arrow/Page keys and Space move between slides; Home/End go to the ends, and Escape
returns to the editor. Navigation clamps instead of wrapping. Fullscreen is an
optional browser capability and may be refused; presentation still works without
it. Hidden slides are skipped, and presenting never rewrites the project.

Slide properties include visibility for export and board. Hidden slides remain
editable via the thumbnail rail and show an eye-off badge. Visibility uses ordinary
project history. An all-hidden deck shows guidance and cannot export or present.
This is not a live remote presentation, animation engine, or speaker-notes view.

The object inspector accepts exact font size, letter spacing and line height in
pixels, plus text alignment. These CSS values belong to the selected element.
Children with their own CSS font/line settings retain those overrides; inheritance
is not a promise to rewrite every nested text run. Text content remains unchanged.

Kelola slide is a separate, keyboard-focus-contained dialog with explicit move
up/down, visibility, duplicate, delete and blank-slide actions. It supplements
rather than replaces the thumbnail rail. This makes ordering available without
precise drag or context-menu gestures. Deleting a slide uses project undo;
permanent project/template deletion uses its separate confirmation dialog.

Objek slide also creates basic text or rectangle objects locally, without an
inference call. Each has a fresh ID and dimensions based on the current project
aspect. They are positioned objects, not responsive templates. Insertions use the
normal autosave/history grouping: several rapid inserts may share one history
entry. The text and box start at separate vertical positions, but do not avoid
existing artwork automatically. Use the inspector to move/style them afterward.

Selected editable objects have an Edit teks button as an alternative to precise
iframe double-click. Existing inline editing still owns its frame until committed.
Cari teks slide searches current saved HTML text/title, including hidden slides,
and opens the exact result. It excludes style/script/template text, does not OCR
images, does not replace words, and does not change the project.

Changing a nonempty project's format now opens a before/after static preview of
the selected slide and requires choosing canvas-size-only explicitly. It does not
scale/reflow existing HTML. Cropped or empty areas are expected risks to review,
not automatic redesign. Cancel/Escape leaves the format unchanged; confirmation
checks the originating project/format and uses ordinary project undo. Empty
projects can change format directly. Every slide still needs review afterward.

Workspace offsets are separate from slide HTML/export. Parsed offsets must be
finite numeric coordinates within a bounded range; malformed metadata falls back
to zero without rewriting project data. Fit-to-screen (0) also clears the manual
workspace offset, so a slide dragged offscreen can be recovered in one action.

Duplikat elemen creates a bounded static subtree copy (at most100elements,4MiB
combined HTML). Fresh IDs and subtree-local ARIA/form/SVG references are remapped;
the current computed style is captured inline so external #id selectors do not
leave the renamed copy unstyled. The source is untouched. Axis-aligned absolute
objects offset20px when numeric positions are available; flow objects remain in
flow. This captures a static appearance, not responsive selector behavior,
pseudo-element content, animation or a reusable component link. Undo uses project
history. Review the result, particularly generated content/SVG CSS cases.
Generated ::before/::after content is rejected before insertion rather than
silently copied without its wording. Use slide duplication for those cases.
Subtrees containing their own style element are rejected. Reference rewriting is
limited to local URL fragments/ID lists, not arbitrary hash-like values such as
hex colors; the regression includes an ID that matches a color token.

Basic shape/image styling includes uniform corner radius, solid border width/color
and selected-image alt text. Setting border width applies border-box sizing so
explicit object dimensions include that border. Per-corner/per-side values become
uniform only when edited. These controls do not rewrite nested content, and use
ordinary project history. They are not SVG path/gradient/shadow editing.

Review seluruh proyek collects current-project notes across visible and hidden
slides, filters open/resolved/all, changes note status and opens the exact slide
and pin. Marking resolved is only a status change, not proof that design was
fixed, and does not submit an agent request. No notes are sent externally.

Salin gaya / Tempel gaya transfers an allowlisted set of basic computed colors,
typography,border/radius and opacity within the current canvas session. It does
not copy URLs,IDs,text,position,dimensions,transforms,images or component behavior.
Text may wrap differently after font changes; inspect the result. Paste uses the
normal pending-style commit and project undo. It is not the system clipboard.

The floating image bar follows the same flow-layout rule as the inspector:
width/height edits never force an image out of document flow, while X/Y inputs
are disabled for static flow images. Empty and out-of-range inputs are ignored.
The regression checks that following text remains in the document, the image
stays static, dimensions persist, and project undo restores its original size.

Direct text editing temporarily decorates the selected text with an editor
outline. Finishing restores its authored inline outline declarations and their
priorities, including partial longhands, before removing editor markers. Text
save and undo are covered separately from style-only selection.

Wheel events over the inspector or form controls keep native scroll/input
behavior instead of zooming artwork. Wheel events over the artboard/background
still zoom the workspace. Real mouse-wheel tests cover desktop and narrow
inspector scrolling without scale changes, plus continued artwork zoom.

The font toolbar identifies the complete primary family rather than matching
prefixes (Arial Black is not Arial). Toolbar +/- refreshes the exact-size
inspector and respects its 8..500px range. Font names describe authored CSS;
installed-font availability can still differ by device.

Canvas keyboard shortcuts do not intercept keys while a select, button, text
input or contenteditable is focused, nor modifier-key combinations. In
particular, Space activates a focused control without arming canvas pan.

In presentation, Space still advances when focus is on the stage, but activates
a focused button normally (including Close). Preview iframes are excluded from
keyboard tab order; slide navigation and controls remain in the dialog.

Exact X/Y edits freeze the current computed width/height before clearing an
opposite right/bottom constraint on absolute/fixed objects. Moving a stretched
object should not silently shrink it. Relative objects remain in their flow;
image toolbar and inspector use the same bounded box-edit path.

Inspector and floating-image X/Y/size fields refresh from actual CSS when a
number edit loses focus, so the other surface does not keep an old coordinate.
Refresh waits until blur rather than interrupting multi-digit typing.
