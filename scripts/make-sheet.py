"""Composite artboard screenshots into labelled contact sheets for review."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SHEET_DIR = Path("shots/sheet")
OUT_DIR = Path("shots")
COL_W = 380


def load_font(size: int, bold: bool = False):
    for path in (
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def sheet(files: list[Path], title: str, out_name: str, cols: int = 4) -> None:
    if not files:
        print(f"skip {out_name}: no files")
        return
    thumbs = []
    for f in files:
        im = Image.open(f).convert("RGB")
        ratio = COL_W / im.width
        thumbs.append((f.stem, im.resize((COL_W, int(im.height * ratio)), Image.LANCZOS)))

    gap = 18
    label_h = 26
    rows = (len(thumbs) + cols - 1) // cols
    cell_h = max(t[1].height for t in thumbs) + label_h + gap
    width = cols * (COL_W + gap) + gap
    height = rows * cell_h + gap + 54

    canvas = Image.new("RGB", (width, height), (18, 16, 15))
    draw = ImageDraw.Draw(canvas)
    draw.text((gap + 4, 16), title, fill=(240, 234, 224), font=load_font(22, bold=True))

    for idx, (name, im) in enumerate(thumbs):
        r, c = divmod(idx, cols)
        x = gap + c * (COL_W + gap)
        y = 54 + gap + r * cell_h
        canvas.paste(im, (x, y))
        draw.text((x + 2, y + im.height + 6), name, fill=(150, 141, 128), font=load_font(14))

    out = OUT_DIR / out_name
    canvas.save(out)
    print(f"wrote {out} ({canvas.width}x{canvas.height})")


def main() -> None:
    all_files = sorted(SHEET_DIR.glob("*.png"))

    sheet(
        [f for f in all_files if f.name.startswith("theme-") and "cover" in f.name],
        "Desel — 8 visual systems (cover)",
        "sheet-themes-cover.png",
        cols=4,
    )
    sheet(
        [f for f in all_files if f.name.startswith("theme-") and "media" in f.name],
        "Desel — 8 visual systems (media slide)",
        "sheet-themes-media.png",
        cols=4,
    )
    sheet(
        [f for f in all_files if f.name.startswith("kind-")],
        "Desel — 9 slide templates (Vault Dark)",
        "sheet-kinds.png",
        cols=5,
    )
    sheet(
        [f for f in all_files if f.name.startswith("press-")],
        "Desel — same templates (Editorial Press)",
        "sheet-press.png",
        cols=5,
    )


if __name__ == "__main__":
    main()
