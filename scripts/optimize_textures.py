"""Create smaller WebP variants from the repaired 4K character texture."""
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/model/basecolor-drawstrings.webp'
SIZES = (2048, 1024)


def main():
    with Image.open(SOURCE) as source:
        if source.size != (4096, 4096):
            raise ValueError(f'Expected a 4096x4096 source texture, got {source.size}')
        source = source.convert('RGB')
        for size in SIZES:
            image = source.resize((size, size), Image.Resampling.LANCZOS)
            destination = ROOT / f'public/model/basecolor-drawstrings-{size}.webp'
            image.save(destination, 'WEBP', quality=88, method=6, lossless=False)
            print(f'{destination.name}: {size}x{size}, {destination.stat().st_size / 1024:.1f} KiB')


if __name__ == '__main__':
    main()
