"""Composite the real-media renders into a review sheet."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC = Path("shots/real")
OUT = Path("shots")


def font(size: int, bold: bool = False):
    for p in (
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def sheet(files: list[Path], title: str, out_name: str, cols: int = 5, col_w: int = 340) -> None:
    if not files:
        print(f"skip {out_name}")
        return
    thumbs = []
    for f in files:
        im = Image.open(f).convert("RGB")
        ratio = col_w / im.width
        thumbs.append((f.stem, im.resize((col_w, int(im.height * ratio)), Image.LANCZOS)))

    gap, label_h = 16, 24
    rows = (len(thumbs) + cols - 1) // cols
    cell_h = max(t[1].height for t in thumbs) + label_h + gap
    W = cols * (col_w + gap) + gap
    H = rows * cell_h + gap + 50

    canvas = Image.new("RGB", (W, H), (18, 16, 15))
    d = ImageDraw.Draw(canvas)
    d.text((gap + 4, 14), title, fill=(240, 234, 224), font=font(21, bold=True))

    for i, (name, im) in enumerate(thumbs):
        r, c = divmod(i, cols)
        x = gap + c * (col_w + gap)
        y = 50 + gap + r * cell_h
        canvas.paste(im, (x, y))
        d.text((x + 2, y + im.height + 5), name, fill=(150, 141, 128), font=font(13))

    path = OUT / out_name
    canvas.save(path)
    print(f"wrote {path} ({canvas.width}x{canvas.height})")


def main() -> None:
    files = sorted(SRC.glob("*.png"))
    sheet(
        [f for f in files if f.name.startswith("vault-")],
        "Desel — full carousel with real screenshots (Vault Dark)",
        "sheet-real-carousel.png",
        cols=5,
    )
    sheet(
        [f for f in files if f.name.startswith("theme-") and "media" in f.name],
        "Desel — media template across visual systems",
        "sheet-real-themes.png",
        cols=6,
        col_w=300,
    )
    sheet(
        [f for f in files if f.name.startswith("theme-") and "cover" in f.name],
        "Desel — cover across visual systems",
        "sheet-real-covers.png",
        cols=6,
        col_w=300,
    )


if __name__ == "__main__":
    main()
