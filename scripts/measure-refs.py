"""Measure the real geometry of the reference carousels.

Detects the media card and the footer band, then reports each as a fraction of
the 1080x1350 canvas — the numbers the design system should reproduce.
"""

from pathlib import Path

import numpy as np
from PIL import Image

REFS = sorted(Path("referensi").glob("*/*.jpg"))


def row_profile(im: Image.Image) -> np.ndarray:
    """Per-row standard deviation: high where content varies, low on flat bg."""
    g = np.asarray(im.convert("L"), dtype=np.float32)
    return g.std(axis=1)


def find_card_band(profile: np.ndarray) -> tuple[int, int]:
    """Largest contiguous run of high-variance rows = the media card."""
    thresh = np.percentile(profile, 62)
    mask = profile > thresh
    best = (0, 0)
    start = None
    for y, on in enumerate(mask):
        if on and start is None:
            start = y
        elif not on and start is not None:
            if y - start > best[1] - best[0]:
                best = (start, y)
            start = None
    if start is not None and len(mask) - start > best[1] - best[0]:
        best = (start, len(mask))
    return best


def main() -> None:
    print(f"{'file':46} {'card top':>9} {'card bot':>9} {'card h':>8} {'tail':>8}")
    print("-" * 88)
    for path in REFS:
        im = Image.open(path)
        w, h = im.size
        prof = row_profile(im)
        top, bot = find_card_band(prof)
        print(
            f"{path.parent.name + '/' + path.name:46} "
            f"{top / h:9.3f} {bot / h:9.3f} {(bot - top) / h:8.3f} "
            f"{1 - bot / h:9.3f}"
        )


if __name__ == "__main__":
    main()
