"""Composites every featured Sample's Evidence layers over its page image into
fixtures/loupe/.preview/ (gitignored), to judge how they look and that they register."""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "public", "loupe", "samples")
OUT = os.path.join(ROOT, ".preview")
os.makedirs(OUT, exist_ok=True)
for sid in sorted(os.listdir(SAMPLES)):
    if len(sys.argv) > 1 and sys.argv[1] not in sid:
        continue
    d = os.path.join(SAMPLES, sid)
    for name in sorted(os.listdir(d)):
        if not name.endswith(".png"):
            continue
        page = name.split("-p")[-1].split("-")[0].split(".")[0]
        base = Image.open(os.path.join(d, f"p{page}.jpg")).convert("RGBA")
        layer = Image.open(os.path.join(d, name)).convert("RGBA").resize(base.size, Image.LANCZOS)
        base.alpha_composite(layer)
        base.convert("RGB").save(os.path.join(OUT, f"{sid}--{name[:-4]}.jpg"), quality=85)
print("previews in", OUT)
