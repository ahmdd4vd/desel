"""Generate the Desel app icon (1024x1024 source PNG).

Mark concept: a stack of three offset carousel slides on a warm-charcoal tile,
with a single acid-lime accent bar — a design-tool silhouette that still reads
at 32px.
"""

from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# --- Tile -----------------------------------------------------------------
TILE = (16, 16, S - 16, S - 16)
RADIUS = 224
d.rounded_rectangle(TILE, radius=RADIUS, fill=(22, 20, 18, 255))

# Subtle inner hairline so the tile has an edge on dark backgrounds.
d.rounded_rectangle(
    (TILE[0] + 6, TILE[1] + 6, TILE[2] - 6, TILE[3] - 6),
    radius=RADIUS - 6,
    outline=(58, 53, 47, 255),
    width=4,
)

CREAM = (242, 236, 224, 255)
DIM = (150, 141, 128, 255)
LIME = (198, 245, 78, 255)

# --- Slide stack ----------------------------------------------------------
# Three cards, offset diagonally, the front one carrying the accent bar.
card_w, card_h = 420, 520
front_x, front_y = 268, 232
gap = 62

for i, alpha in ((2, 70), (1, 120)):
    ox, oy = front_x - gap * i, front_y + gap * i
    d.rounded_rectangle(
        (ox, oy, ox + card_w, oy + card_h),
        radius=48,
        fill=(242, 236, 224, alpha),
    )

# Front card
d.rounded_rectangle(
    (front_x, front_y, front_x + card_w, front_y + card_h),
    radius=48,
    fill=CREAM,
)

# Accent bar (the "current slide" indicator)
bar_x, bar_y = front_x + 56, front_y + 72
d.rounded_rectangle((bar_x, bar_y, bar_x + 132, bar_y + 26), radius=13, fill=LIME)

# Type lines on the card
line_x = front_x + 56
y = front_y + 168
widths = [308, 268, 308, 196]
heights = [46, 46, 46, 46]
for idx, w in enumerate(widths):
    color = (26, 23, 20, 255) if idx < 2 else DIM
    d.rounded_rectangle((line_x, y, line_x + w, y + heights[idx]), radius=23, fill=color)
    y += heights[idx] + 34

# Dot row at the bottom of the card
dot_y = front_y + card_h - 76
for i in range(4):
    cx = front_x + 60 + i * 40
    fill = (26, 23, 20, 255) if i == 0 else (26, 23, 20, 70)
    d.ellipse((cx, dot_y, cx + 22, dot_y + 22), fill=fill)

img.save("app-icon.png")
print("wrote app-icon.png", img.size)
