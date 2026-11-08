"""Draw a circular white cornea highlight on the model texture."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
TEXTURE = ROOT / 'public/model/basecolor-drawstrings.webp'
CENTERS = ((75, 3990), (3095, 1990))
RADIUS = 6

image = Image.open(TEXTURE).convert('RGB')
draw = ImageDraw.Draw(image)
for center in CENTERS:
    left = center[0] - RADIUS
    top = center[1] - RADIUS
    right = center[0] + RADIUS
    bottom = center[1] + RADIUS
    draw.ellipse((left, top, right, bottom), fill=(255, 255, 255))
image.save(TEXTURE, 'WEBP', lossless=True, quality=100, method=4)
print(f'Drew white circles at {CENTERS} with radius {RADIUS}px in {TEXTURE.name}.')
