"""Generate data/hero.png: a dithered pixel-art night coast with a lighthouse (PIL only, deterministic)."""

import math
import random
from pathlib import Path

from PIL import Image

W, H, SCALE = 480, 118, 4
HORIZON = 78
BG = (23, 24, 27)  # page background the image fades into
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def ramp(stops, t):
    t = min(max(t, 0), 1) * (len(stops) - 1)
    i = min(int(t), len(stops) - 2)
    return lerp(stops[i], stops[i + 1], t - i)


def noise(rng, octaves):
    """Smooth value noise in 0..1 from upscaled random images."""
    acc = [0.0] * (W * H)
    total = 0
    for (w, h), weight in octaves:
        small = Image.frombytes("L", (w, h), bytes(rng.randrange(256) for _ in range(w * h)))
        big = small.resize((W, H), Image.BICUBIC).getdata()
        for i, v in enumerate(big):
            acc[i] += v / 255 * weight
        total += weight
    return [v / total for v in acc]


def dither(x, y, t):
    return t * 16 > BAYER[y % 4][x % 4] + 0.5


def main():
    rng = random.Random(7)
    clouds = noise(rng, [((10, 4), 4), ((24, 8), 2), ((60, 18), 1), ((150, 40), 0.5)])
    detail = noise(rng, [((40, 14), 1), ((120, 36), 1)])
    ridge = noise(rng, [((14, 1), 3), ((60, 1), 1)])
    sky = [(9, 16, 40), (20, 38, 82), (40, 66, 120), (64, 92, 142)]
    cloud_tones = [(56, 78, 122), (98, 120, 160), (150, 168, 198), (196, 208, 226)]
    img = Image.new("RGB", (W, H))
    px = img.load()

    lamp = (96, 0)  # x only; the water reflection is drawn before the hill
    for y in range(H):
        for x in range(W):
            i = y * W + x
            if y < HORIZON:
                c = ramp(sky, y / HORIZON)
                band = 1 - abs(y / HORIZON - 0.42) * 1.6  # clouds thicken mid-sky
                density = (clouds[i] - 0.52 + band * 0.12) * 4
                if dither(x, y, density):
                    c = ramp(cloud_tones, detail[i] * 1.3 - 0.15 + (1 - y / HORIZON) * 0.25)
                elif y < 56 and rng.random() < 0.006:
                    c = (230, 236, 255) if rng.random() < 0.7 else (255, 226, 160)
                # far hills on the horizon
                if y > HORIZON - 4 - ridge[x] * 10:
                    c = (17, 27, 52)
            else:
                depth = (y - HORIZON) / (H - HORIZON)
                c = lerp((22, 36, 70), (10, 16, 32), depth)
                # broken reflections: short bright dashes, denser near the horizon
                if rng.random() < 0.05 * (1 - depth) and detail[i] > 0.5:
                    c = (58, 86, 140)
                if abs(x - lamp[0]) < 6 - depth * 4 and dither(x, y, 0.5 - depth * 0.4):
                    c = (240, 196, 110)
            px[x, y] = c

    # the headland: a rounded hill tapering into the water, trees on its slopes, lighthouse on the crest
    peak_x, reach = 96, 120
    tops = {}
    for x in range(0, peak_x + reach):
        t = abs(x - peak_x) / reach if x > peak_x else abs(x - peak_x) / (peak_x + 40)
        height = 24 * (math.cos(min(t, 1) * math.pi) + 1) / 2 + ridge[x] * 3
        tops[x] = HORIZON - int(height)
        for y in range(max(tops[x], 0), HORIZON + 1):
            shade = detail[y * W + x] > 0.55 and dither(x, y, 0.35)
            px[x, y] = (18, 27, 44) if shade else (11, 17, 30)
        if abs(x - peak_x) > 7 and rng.random() < 0.45:  # tree tufts on the slopes
            for ty in range(tops[x] - rng.randrange(2, 7), tops[x]):
                px[x, ty] = (13, 30, 36) if rng.random() < 0.8 else (20, 44, 46)
    lamp = (peak_x, tops[peak_x] - 20)
    tower_top, tower_bottom = lamp[1] + 3, tops[peak_x] + 1
    for y in range(tower_top, tower_bottom):
        half = 1 + (y - tower_top) // 7
        for x in range(lamp[0] - half, lamp[0] + half + 1):
            stripe = ((y - tower_top) // 4) % 2
            px[x, y] = (214, 206, 190) if stripe == 0 else (164, 70, 64)
    for x in range(lamp[0] - 3, lamp[0] + 4):  # gallery
        px[x, lamp[1] + 2] = (40, 40, 48)
    for dy in range(-2, 2):
        for dx in range(-1, 2):
            px[lamp[0] + dx, lamp[1] + dy] = (255, 230, 150)
    px[lamp[0], lamp[1] - 3] = (40, 40, 48)  # roof
    tower_x = lamp[0]
    # beam: a dithered wedge fading out to the right
    for x in range(tower_x + 3, tower_x + 150):
        spread = (x - tower_x) * 0.12
        fade = 0.55 * (1 - (x - tower_x) / 150)
        for y in range(int(lamp[1] - spread), int(lamp[1] + spread / 2) + 1):
            if 0 <= y < HORIZON and dither(x, y, fade):
                px[x, y] = lerp(px[x, y], (255, 222, 150), 0.7)

    # fade into the page background
    for y in range(H - 34, H):
        t = (y - (H - 34)) / 34
        for x in range(W):
            if dither(x, y, t * 1.15):
                px[x, y] = BG

    out = Path(__file__).resolve().parent.parent / "data" / "hero.png"
    img.resize((W * SCALE, H * SCALE), Image.NEAREST).save(out, optimize=True)
    print(out)


if __name__ == "__main__":
    main()
