"""
Generate 2.5D Sprite Set for Model 2: Crimson (Gothic Red)
Transforms Seraphina's royal navy & silver-lavender 2.5D sprites into Crimson's Gothic palette:
- Obsidian Raven Black hair with deep wine/burgundy velvet sheen
- Glowing Ruby Crimson eyes (radiant vermilion/garnet irises)
- Porcelain Alabaster skin with delicate rose blush
- Gothic Crimson Velvet evening gown with obsidian black trim and antique rose gold embroidery
- Exact 460x600 geometry preserved for seamless 2.5D mesh animation
"""

import os
import sys
import numpy as np
from PIL import Image

SPRITE_NAMES = [
    "idle.png",
    "idle_blink.png",
    "wave.png",
    "wave_alt.png",
    "think.png",
    "celebrate.png",
    "tea.png",
    "tea_sip.png",
    "walk_left.png",
]


def transform_sprite_to_crimson(pil_img):
    arr = np.array(pil_img.convert("RGBA"), dtype=np.float32)
    h, w = arr.shape[:2]
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    opaque = a > 20
    rgb_sum = r + g + b

    # 1. Eyes: violet iris in facial eye box (y: 130..205, x: 160..310)
    is_iris = (
        opaque
        & (yy >= 130)
        & (yy <= 205)
        & (xx >= 160)
        & (xx <= 310)
        & (b > 90)
        & (b - g > 18)
        & (g < 145)
    )

    # 2. Skin: warm peach (R > 150, R >= G, G - B >= 6, R - B >= 12)
    is_skin = (
        opaque
        & (r > 150)
        & (r >= g)
        & (g - b >= 6)
        & (r - b >= 12)
        & (~is_iris)
    )

    # 3. Hair: cool silver-lavender (high sum, B >= 80, G - B < 7, mostly upper body)
    is_hair = (
        opaque
        & (rgb_sum > 360)
        & (b >= 80)
        & (g - b < 7)
        & (~is_skin)
        & (~is_iris)
        & (yy < 490)
    )

    # 4. Gold jewelry & embroidery trim: warm yellow/gold
    is_gold = (
        opaque
        & (r > 160)
        & (g > 130)
        & (b < 140)
        & (r - b > 40)
        & (~is_skin)
    )

    # 5. Navy dress fabric: deep blue/navy tones
    is_navy_fabric = (
        opaque
        & (yy > 230)
        & (rgb_sum < 340)
        & (~is_skin)
        & (~is_hair)
        & (~is_gold)
    )

    # 6. Dress highlights / trim / underlayer
    is_dress_trim = (
        opaque
        & (yy > 230)
        & (~is_navy_fabric)
        & (~is_skin)
        & (~is_hair)
        & (~is_gold)
    )

    out = arr.copy()

    # Hair -> Obsidian Raven Black with Crimson/Wine Velvet Sheen
    if np.any(is_hair):
        h_lum = (0.299 * r[is_hair] + 0.587 * g[is_hair] + 0.114 * b[is_hair]) / 255.0
        hl = np.clip(h_lum, 0.0, 1.0)
        # Deep shadow: [14, 12, 18], Midtone: [36, 16, 26], Highlight: [78, 28, 46]
        out[is_hair, 0] = np.clip(14.0 + 38.0 * hl + 44.0 * (hl ** 2.2), 0, 255)
        out[is_hair, 1] = np.clip(12.0 + 10.0 * hl + 12.0 * (hl ** 2.2), 0, 255)
        out[is_hair, 2] = np.clip(18.0 + 16.0 * hl + 20.0 * (hl ** 2.2), 0, 255)

    # Eyes -> Glowing Ruby Irises
    if np.any(is_iris):
        e_lum = (0.299 * r[is_iris] + 0.587 * g[is_iris] + 0.114 * b[is_iris]) / 255.0
        el = np.clip((e_lum - 0.20) / 0.60, 0.0, 1.0)
        # Deep garnet rim: [95, 12, 22], Core radiant ruby: [238, 30, 52], Highlight: [255, 205, 215]
        out[is_iris, 0] = np.clip(95.0 + 140.0 * el + 30.0 * (el ** 3), 0, 255)
        out[is_iris, 1] = np.clip(12.0 + 30.0 * el + 165.0 * (el ** 4), 0, 255)
        out[is_iris, 2] = np.clip(22.0 + 36.0 * el + 155.0 * (el ** 4), 0, 255)

    # Skin -> Porcelain Alabaster (delicate, luminous, soft rose glow)
    if np.any(is_skin):
        out[is_skin, 0] = np.clip(arr[is_skin, 0] * 1.01, 0, 255)
        out[is_skin, 1] = np.clip(arr[is_skin, 1] * 0.98, 0, 255)
        out[is_skin, 2] = np.clip(arr[is_skin, 2] * 0.98, 0, 255)

    # Navy Fabric -> Gothic Crimson Velvet
    if np.any(is_navy_fabric):
        d_lum = (0.299 * r[is_navy_fabric] + 0.587 * g[is_navy_fabric] + 0.114 * b[is_navy_fabric]) / 255.0
        dl = np.clip(d_lum, 0.0, 1.0)
        # Deep velvet shadow: [52, 8, 16], Mid: [126, 18, 38], Highlight: [186, 36, 62]
        out[is_navy_fabric, 0] = np.clip(52.0 + 175.0 * dl + 60.0 * (dl ** 2), 0, 255)
        out[is_navy_fabric, 1] = np.clip(8.0 + 28.0 * dl + 16.0 * (dl ** 2), 0, 255)
        out[is_navy_fabric, 2] = np.clip(16.0 + 40.0 * dl + 24.0 * (dl ** 2), 0, 255)

    # Gold jewelry & borders -> Antique Rose Gold
    if np.any(is_gold):
        out[is_gold, 0] = np.clip(arr[is_gold, 0] * 1.04, 0, 255)
        out[is_gold, 1] = np.clip(arr[is_gold, 1] * 0.94, 0, 255)
        out[is_gold, 2] = np.clip(arr[is_gold, 2] * 0.96, 0, 255)

    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def main():
    src_dir = os.path.join("assets", "sprites")
    out_dir = os.path.join("assets", "sprites", "crimson")
    os.makedirs(out_dir, exist_ok=True)

    print(f"Generating Crimson 2.5D sprite set into {out_dir}...")
    success = 0
    for name in SPRITE_NAMES:
        src_path = os.path.join(src_dir, name)
        if not os.path.exists(src_path):
            print(f"  [WARN] Source sprite missing: {src_path}")
            continue

        im = Image.open(src_path)
        crimson_im = transform_sprite_to_crimson(im)
        out_path = os.path.join(out_dir, name)
        crimson_im.save(out_path, format="PNG", optimize=True)
        print(f"  [OK] {name:16s} -> {out_path} ({crimson_im.size[0]}x{crimson_im.size[1]})")
        success += 1

    print(f"Generated {success}/{len(SPRITE_NAMES)} Crimson 2.5D sprites successfully!")


if __name__ == "__main__":
    main()

