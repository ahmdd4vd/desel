import glob, os
from PIL import Image, ImageStat
root = os.path.join(os.path.expanduser("~"), "Pictures", "Desel")
files = [f for f in glob.glob(os.path.join(root, "**", "*"), recursive=True) if os.path.isfile(f)]
for f in sorted(files):
    rel = os.path.relpath(f, root)
    if f.lower().endswith(".png"):
        im = Image.open(f).convert("RGB")
        st = ImageStat.Stat(im)
        print(f"{rel:46s} {im.size[0]}x{im.size[1]}  sd={[round(x,1) for x in st.stddev]}")
    else:
        print(f"{rel:46s} {os.path.getsize(f)} bytes")
cap = [f for f in files if f.lower().endswith(".txt")]
if cap:
    print("--- caption ---")
    print(open(cap[0], encoding="utf-8", errors="replace").read().strip())
