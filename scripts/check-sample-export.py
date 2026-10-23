import glob, os
from PIL import Image, ImageStat
root = os.path.join(os.path.expanduser("~"), "Pictures", "Desel", "editorial-print-contoh")
files = sorted(f for f in glob.glob(os.path.join(root, "*")) if os.path.isfile(f))
print("dir:", os.path.basename(root), "files:", len(files))
for f in files:
    if f.lower().endswith(".png"):
        im = Image.open(f).convert("RGB")
        sd = ImageStat.Stat(im).stddev
        print(f"{os.path.basename(f):34s} {im.size[0]}x{im.size[1]} sd={[round(x,1) for x in sd]}")
    else:
        print(f"{os.path.basename(f):34s} {os.path.getsize(f)} bytes")
