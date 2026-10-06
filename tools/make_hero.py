"""Generate the Home banner layers: a dithered pixel-art coast with a lighthouse, in four lights.

Writes data/hero/<phase>/{sky,sky2,clouds,beam,fg}.png at native pixel size (480x118); the
app scales them up with nearest-neighbour filtering. Layers, back to front:
  sky     gradient, sun or moon, stars (sky2: the same with stars twinkled)
  clouds  transparent, horizontally tileable so they can drift and wrap
  beam    transparent, the lighthouse beam (dusk and night only)
  fg      transparent above the land: hills, headland, lighthouse, water, fade into the page
PIL only and deterministic: rerunning produces the same files.
"""

import math
import random
from pathlib import Path

from PIL import Image

W, H = 480, 118
HORIZON = 78
BG = (23, 24, 27)  # page background the banner fades into
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
OUT = Path(__file__).resolve().parent.parent / "data" / "hero"

PHASES = {
    "night": dict(
        sky=[(9, 16, 40), (20, 38, 82), (40, 66, 120), (64, 92, 142)],
        clouds=[(56, 78, 122), (98, 120, 160), (150, 168, 198), (196, 208, 226)], density=0.52,
        land=((11, 17, 30), (18, 27, 44)), trees=((13, 30, 36), (20, 44, 46)), hills=(17, 27, 52),
        water=((22, 36, 70), (10, 16, 32)), dash=(58, 86, 140), stars=0.006, lamp=True, beam=0.55,
        body=("moon", (402, 16), 5, (232, 232, 214))),
    "dawn": dict(
        sky=[(28, 32, 78), (98, 72, 138), (222, 128, 128), (250, 186, 130)],
        clouds=[(110, 80, 130), (196, 120, 140), (240, 170, 150), (255, 214, 180)], density=0.53,
        land=((34, 30, 58), (48, 40, 72)), trees=((40, 40, 66), (56, 50, 80)), hills=(70, 58, 100),
        water=((150, 110, 140), (40, 34, 70)), dash=(240, 180, 150), stars=0.0015, lamp=False, beam=0,
        body=("sun", (390, HORIZON - 17), 9, (255, 214, 140))),
    "day": dict(
        sky=[(52, 110, 200), (92, 150, 225), (150, 195, 240), (196, 224, 248)],
        clouds=[(176, 192, 214), (214, 226, 240), (240, 246, 252), (255, 255, 255)], density=0.56,
        land=((40, 84, 52), (52, 104, 62)), trees=((30, 70, 42), (44, 92, 52)), hills=(92, 128, 150),
        water=((46, 108, 170), (24, 64, 112)), dash=(150, 200, 240), stars=0, lamp=False, beam=0,
        body=("sun", (420, 18), 7, (255, 240, 170))),
    "dusk": dict(
        sky=[(26, 24, 70), (90, 52, 110), (214, 98, 92), (248, 160, 90)],
        clouds=[(70, 50, 96), (150, 80, 110), (226, 120, 96), (250, 178, 110)], density=0.53,
        land=((26, 20, 44), (36, 28, 56)), trees=((32, 26, 52), (46, 36, 64)), hills=(58, 40, 80),
        water=((120, 70, 100), (30, 22, 50)), dash=(246, 160, 110), stars=0.002, lamp=True, beam=0.35,
        body=("sun", (300, HORIZON - 15), 10, (255, 180, 100))),
}
LAMP_X, PEAK_REACH = 96, 120


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def ramp(stops, t):
    t = min(max(t, 0), 1) * (len(stops) - 1)
    i = min(int(t), len(stops) - 2)
    return lerp(stops[i], stops[i + 1], t - i)


def dither(x, y, t):
    return t * 16 > BAYER[y % 4][x % 4] + 0.5


def noise(rng, octaves, tile=False):
    """Smooth value noise in 0..1. With tile=True it repeats every W pixels horizontally."""
    acc = [0.0] * (W * H)
    total = 0
    for (w, h), weight in octaves:
        small = Image.frombytes("L", (w, h), bytes(rng.randrange(256) for _ in range(w * h)))
        if tile:  # resample three copies side by side and keep the middle: seamless at the wrap
            wide = Image.new("L", (w * 3, h))
            for i in range(3):
                wide.paste(small, (i * w, 0))
            big = wide.resize((W * 3, H), Image.BICUBIC).crop((W, 0, 2 * W, H)).getdata()
        else:
            big = small.resize((W, H), Image.BICUBIC).getdata()
        for i, v in enumerate(big):
            acc[i] += v / 255 * weight
        total += weight
    return [v / total for v in acc]


def headland_tops(ridge):
    tops = {}
    for x in range(0, LAMP_X + PEAK_REACH):
        t = abs(x - LAMP_X) / PEAK_REACH if x > LAMP_X else abs(x - LAMP_X) / (LAMP_X + 40)
        tops[x] = HORIZON - int(24 * (math.cos(min(t, 1) * math.pi) + 1) / 2 + ridge[x] * 3)
    return tops


def make_sky(p, twinkle):
    img = Image.new("RGBA", (W, H))
    px = img.load()
    star_rng = random.Random(11)  # same stars in both frames; twinkle picks which ones dim
    for y in range(H):
        for x in range(W):
            c = ramp(p["sky"], y / HORIZON) if y < HORIZON else p["sky"][-1]
            if y < 60 and star_rng.random() < p["stars"]:
                bright = (230, 236, 255) if star_rng.random() < 0.7 else (255, 226, 160)
                if not (twinkle and star_rng.random() < 0.35):
                    c = bright if y < 50 else lerp(c, bright, 0.5)
            px[x, y] = c + (255,)
    kind, (cx, cy), r, color = p["body"]
    for y in range(cy - r - 4, cy + r + 5):
        for x in range(cx - r - 4, cx + r + 5):
            if not (0 <= x < W and 0 <= y < HORIZON):
                continue
            d = math.hypot(x - cx, y - cy)
            if d <= r:
                crater = kind == "moon" and (x - cx + y - cy) % 5 == 0
                px[x, y] = (lerp(color, (180, 180, 170), 0.5) if crater else color) + (255,)
            elif d <= r + 4 and dither(x, y, 0.45 * (1 - (d - r) / 4)):
                px[x, y] = lerp(px[x, y][:3], color, 0.5) + (255,)
    return img


def make_clouds(p, rng):
    clouds = noise(rng, [((10, 4), 4), ((24, 8), 2), ((60, 18), 1), ((120, 40), 0.5)], tile=True)
    detail = noise(rng, [((40, 14), 1), ((120, 36), 1)], tile=True)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    for y in range(HORIZON):
        band = 1 - abs(y / HORIZON - 0.42) * 1.6  # clouds thicken mid-sky
        for x in range(W):
            i = y * W + x
            if dither(x, y, (clouds[i] - p["density"] + band * 0.12) * 4):
                px[x, y] = ramp(p["clouds"], detail[i] * 1.3 - 0.15 + (1 - y / HORIZON) * 0.25) + (255,)
    return img


def make_beam(p, lamp_y):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if not p["beam"]:
        return img
    px = img.load()
    for x in range(LAMP_X + 3, LAMP_X + 150):
        spread = (x - LAMP_X) * 0.12
        fade = p["beam"] * (1 - (x - LAMP_X) / 150)
        for y in range(int(lamp_y - spread), int(lamp_y + spread / 2) + 1):
            if 0 <= y < HORIZON and dither(x, y, fade):
                px[x, y] = (255, 222, 150, 190)
    return img


def make_fg(p, rng, ridge, detail, tops):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    for x in range(W):  # far hills on the horizon
        for y in range(int(HORIZON - 4 - ridge[x] * 10), HORIZON):
            px[x, y] = p["hills"] + (255,)
    sun_x = p["body"][1][0]
    for y in range(HORIZON, H):  # water, with the sun's or the lamp's broken reflection
        depth = (y - HORIZON) / (H - HORIZON)
        for x in range(W):
            c = lerp(*p["water"], depth)
            if rng.random() < 0.05 * (1 - depth) and detail[y * W + x] > 0.5:
                c = p["dash"]
            if p["body"][0] == "sun" and abs(x - sun_x) < 10 - depth * 6 and dither(x, y, 0.45 - depth * 0.4):
                c = lerp(c, p["body"][3], 0.7)
            if p["lamp"] and abs(x - LAMP_X) < 6 - depth * 4 and dither(x, y, 0.5 - depth * 0.4):
                c = (240, 196, 110)
            px[x, y] = c + (255,)
    for x, top in tops.items():  # headland
        for y in range(max(top, 0), HORIZON + 1):
            shade = detail[y * W + x] > 0.55 and dither(x, y, 0.35)
            px[x, y] = p["land"][1 if shade else 0] + (255,)
        if abs(x - LAMP_X) > 7 and rng.random() < 0.45:
            for ty in range(top - rng.randrange(2, 7), top):
                px[x, ty] = p["trees"][0 if rng.random() < 0.8 else 1] + (255,)
    lamp_y = tops[LAMP_X] - 20
    for y in range(lamp_y + 3, tops[LAMP_X] + 1):  # striped tower
        half = 1 + (y - lamp_y - 3) // 7
        for x in range(LAMP_X - half, LAMP_X + half + 1):
            px[x, y] = ((214, 206, 190) if ((y - lamp_y - 3) // 4) % 2 == 0 else (164, 70, 64)) + (255,)
    for x in range(LAMP_X - 3, LAMP_X + 4):
        px[x, lamp_y + 2] = (40, 40, 48, 255)
    lamp = (255, 230, 150) if p["lamp"] else (120, 120, 112)
    for dy in range(-2, 2):
        for dx in range(-1, 2):
            px[LAMP_X + dx, lamp_y + dy] = lamp + (255,)
    px[LAMP_X, lamp_y - 3] = (40, 40, 48, 255)
    for y in range(H - 34, H):  # fade into the page
        t = (y - (H - 34)) / 34
        for x in range(W):
            if dither(x, y, t * 1.15):
                px[x, y] = BG + (255,)
    return img, lamp_y


def main():
    for phase, p in PHASES.items():
        rng = random.Random(7)  # same landscape in every light
        ridge = noise(rng, [((14, 1), 3), ((60, 1), 1)])
        detail = noise(rng, [((40, 14), 1), ((120, 36), 1)])
        tops = headland_tops(ridge)
        fg, lamp_y = make_fg(p, random.Random(3), ridge, detail, tops)
        layers = {
            "sky": make_sky(p, twinkle=False),
            "sky2": make_sky(p, twinkle=True),
            "clouds": make_clouds(p, random.Random(5)),
            "beam": make_beam(p, lamp_y),
            "fg": fg,
        }
        (OUT / phase).mkdir(parents=True, exist_ok=True)
        for name, img in layers.items():
            img.save(OUT / phase / f"{name}.png", optimize=True)
        print(phase, "->", OUT / phase)


if __name__ == "__main__":
    main()
