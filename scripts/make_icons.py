from PIL import Image
import os

BASE = os.path.join(os.path.dirname(__file__), "..")
SOURCE = os.path.join(BASE, "tag.png")
OUT = os.path.join(BASE, "icons")
os.makedirs(OUT, exist_ok=True)

img = Image.open(SOURCE).convert("RGBA")
alpha = img.split()[-1]
left, top, right, bottom = alpha.getbbox()
cx, cy = (left + right) / 2, (top + bottom) / 2

# Square crop centered on the glyph, sized to the larger content dimension
# plus its natural margin, clamped to the source image bounds.
side = min(img.height, img.width)
half = side / 2
crop_box = (
    round(cx - half), round(cy - half),
    round(cx - half) + side, round(cy - half) + side,
)
# Shift back into bounds if the centered box spilled over an edge.
dx = max(0, -crop_box[0]) - max(0, crop_box[2] - img.width)
dy = max(0, -crop_box[1]) - max(0, crop_box[3] - img.height)
crop_box = (crop_box[0] + dx, crop_box[1] + dy, crop_box[2] + dx, crop_box[3] + dy)

square = img.crop(crop_box)

for size in (16, 32, 48, 128):
    square.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f"icon-{size}.png"))

print("cropped from", crop_box, "-> square size", square.size)
