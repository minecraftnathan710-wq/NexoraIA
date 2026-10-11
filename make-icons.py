# Gera os ícones originais do NEXORA AI (esfera holográfica) em vários tamanhos.
from PIL import Image, ImageDraw, ImageFilter
import math

def make(size, maskable=False):
    S = size * 2
    img = Image.new("RGBA", (S, S), (5, 7, 13, 255))
    px = img.load()
    cx = cy = S / 2
    r = S * (0.26 if maskable else 0.34)
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - cx, y - cy)
            if d < r:
                t = d / r
                lx, ly = (x - cx + r * 0.35) / r, (y - cy + r * 0.35) / r
                l = max(0, 1 - math.hypot(lx, ly) * 0.9)
                c = (int(0 + 139 * t + 120 * l), int(229 * (1 - t) + 92 * t + 40 * l), int(255 * (1 - t) + 246 * t))
                px[x, y] = (min(c[0], 255), min(c[1], 255), min(c[2], 255), 255)
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for i, col in enumerate([(0, 229, 255, 200), (139, 92, 246, 200)]):
        rr = r * (1.25 + 0.18 * i)
        g.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=col, width=max(2, S // 90))
    glow = glow.filter(ImageFilter.GaussianBlur(S / 160))
    img = Image.alpha_composite(img, glow)
    return img.resize((size, size), Image.LANCZOS)

for s in (72, 96, 128, 144, 152, 180, 192, 384, 512):
    make(s).save(f"public/icons/icon-{s}.png")
make(512, True).save("public/icons/maskable-512.png")
make(192, True).save("public/icons/maskable-192.png")
make(32).save("public/icons/favicon-32.png")
print("ok")
