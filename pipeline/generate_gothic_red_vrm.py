"""
Generate Model 2: Gothic Red Companion (companion_alt.vrm)
Base: c:\\Users\\rv941\\OneDrive\\Documents\\1.vrm
- Keeps cute standard anime face/head/body proportions (no mature 25yo chin/jaw/bust elongation).
- Removes maid apron, puff sleeve underside, back bow, neck jabot, wrist cuffs, calf bows.
- Stretches skirt smoothly down to ankle floor gown with high thigh slit.
- Gothic Red full styling:
  * Obsidian Raven Black hair with deep wine/burgundy velvet sheen.
  * Glowing Ruby Red irises with flame scarlet core and faceted specular highlights.
  * Dramatic Gothic eyeline, dark lush lashes, dark arched brows.
  * Fair porcelain alabaster skin with berry rose lips & delicate blush.
  * Gothic Crimson Velvet gown with black Victorian lace borders and pewter/antique silver filigree seams.
  * Obsidian black satin underskirt lining with crimson lace border.
  * Triangle black silk panties with crimson lace trim and sheer smoky black stockings with lace garters.
  * 3D Antique Silver & Blood Ruby Teardrop Pendant and Earrings.
"""

import argparse, io, json, math, os, struct
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def get_accessor_np(gltf, slices, acc_idx):
    acc = gltf["accessors"][acc_idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    count = acc["count"]
    comp_type = acc["componentType"]
    type_str = acc["type"]

    elem_counts = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    n_elems = elem_counts[type_str]

    type_map = {
        5120: np.int8,
        5121: np.uint8,
        5122: np.int16,
        5123: np.uint16,
        5125: np.uint32,
        5126: np.float32,
    }
    dt = type_map[comp_type]
    raw = bytes(slices[acc["bufferView"]][acc.get("byteOffset", 0) : acc.get("byteOffset", 0) + count * n_elems * dt().itemsize])
    arr = np.frombuffer(raw, dtype=dt)
    if n_elems > 1:
        arr = arr.reshape((count, n_elems))
    return arr.copy()


def set_accessor_np(gltf, slices, acc_idx, arr):
    acc = gltf["accessors"][acc_idx]
    bv_idx = acc["bufferView"]
    arr_b = arr.tobytes()
    offset = acc.get("byteOffset", 0)
    slices[bv_idx][offset : offset + len(arr_b)] = arr_b
    if acc["type"] == "VEC3" and arr.dtype == np.float32:
        acc["min"] = [float(x) for x in arr.min(axis=0)]
        acc["max"] = [float(x) for x in arr.max(axis=0)]


def append_accessor(gltf, slices, arr, comp_type, type_str, target=34962):
    arr_b = arr.tobytes()
    pad = (4 - (len(arr_b) % 4)) % 4
    if pad:
        arr_b += b"\x00" * pad
    bv_idx = len(gltf["bufferViews"])
    gltf["bufferViews"].append({
        "buffer": 0,
        "byteOffset": 0,
        "byteLength": len(arr_b),
        "target": target,
    })
    slices.append(bytearray(arr_b))

    acc_idx = len(gltf["accessors"])
    acc_def = {
        "bufferView": bv_idx,
        "byteOffset": 0,
        "componentType": comp_type,
        "count": len(arr) if type_str != "SCALAR" else arr.size,
        "type": type_str,
    }
    if type_str == "VEC3" and arr.dtype == np.float32:
        acc_def["min"] = [float(x) for x in arr.min(axis=0)]
        acc_def["max"] = [float(x) for x in arr.max(axis=0)]
    gltf["accessors"].append(acc_def)
    return acc_idx


def encode_png(img, max_dim=2048):
    if max(img.size) > max_dim:
        scale = max_dim / float(max(img.size))
        img = img.resize((int(round(img.width * scale)), int(round(img.height * scale))), Image.Resampling.LANCZOS)
    bio = io.BytesIO()
    img.save(bio, format="PNG", optimize=True)
    return bio.getvalue()


def append_texture_image(gltf, slices, png_bytes, name):
    pad = (4 - (len(png_bytes) % 4)) % 4
    if pad:
        png_bytes += b"\x00" * pad
    bv_idx = len(gltf["bufferViews"])
    gltf["bufferViews"].append({
        "buffer": 0,
        "byteOffset": 0,
        "byteLength": len(png_bytes),
    })
    slices.append(bytearray(png_bytes))

    img_idx = len(gltf["images"])
    gltf["images"].append({
        "name": name,
        "mimeType": "image/png",
        "bufferView": bv_idx,
    })
    tex_idx = len(gltf["textures"])
    gltf["textures"].append({"sampler": 0, "source": img_idx})
    return tex_idx


def add_metallic_material(gltf, name, base_color_rgba, metallic=0.85, roughness=0.18, emissive=(0, 0, 0)):
    mat = {
        "name": name,
        "pbrMetallicRoughness": {
            "baseColorFactor": list(base_color_rgba),
            "metallicFactor": float(metallic),
            "roughnessFactor": float(roughness),
        },
        "emissiveFactor": list(emissive),
        "doubleSided": True,
    }
    gltf.setdefault("materials", []).append(mat)
    return len(gltf["materials"]) - 1


# --- TEXTURE STYLING: GOTHIC RED PALETTE ---

def style_hair_gothic_black(pil_img):
    """Obsidian Raven Black hair with rich crimson/wine velvet sheen (#121118 with #481222 sheen)."""
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

    # Gradient mapping:
    # Deep shadow: Obsidian Black [14, 13, 18]
    # Midtone: Dark Burgundy Charcoal [34, 18, 28]
    # Highlight / rim: Rich Gothic Wine Velvet [72, 22, 38]
    # Specular shine: Crimson Satin [120, 34, 56]
    shadow_col = np.array([14.0, 13.0, 18.0], dtype=np.float32)
    mid_col = np.array([38.0, 20.0, 30.0], dtype=np.float32)
    sheen_col = np.array([78.0, 26.0, 42.0], dtype=np.float32)
    spec_col = np.array([135.0, 42.0, 68.0], dtype=np.float32)

    lum_3d = lum[..., None]
    # Smooth piece-wise blend
    t1 = np.clip(lum_3d / 0.45, 0.0, 1.0)
    t2 = np.clip((lum_3d - 0.45) / 0.35, 0.0, 1.0)
    t3 = np.clip((lum_3d - 0.80) / 0.20, 0.0, 1.0)

    col = (1.0 - t1) * shadow_col + t1 * ((1.0 - t2) * mid_col + t2 * ((1.0 - t3) * sheen_col + t3 * spec_col))

    # Retain alpha
    out = np.dstack([np.clip(col, 0, 255), a]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def style_eye_ruby(pil_img):
    """Glowing Ruby Red irises: glowing scarlet core, deep wine pupil shadow, starry specular highlights."""
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

    # Gothic Ruby Red gradient
    # Deep wine/obsidian shadow [48, 8, 18]
    # Rich blood ruby mid [185, 24, 52]
    # Glowing scarlet flame [255, 45, 80]
    # Crystalline highlight [255, 180, 205]
    shadow_c = np.array([48.0, 8.0, 18.0], dtype=np.float32)
    mid_c = np.array([195.0, 28.0, 56.0], dtype=np.float32)
    flame_c = np.array([255.0, 55.0, 92.0], dtype=np.float32)
    high_c = np.array([255.0, 200.0, 220.0], dtype=np.float32)

    lum_3d = lum[..., None]
    t1 = np.clip(lum_3d / 0.40, 0.0, 1.0)
    t2 = np.clip((lum_3d - 0.40) / 0.40, 0.0, 1.0)
    t3 = np.clip((lum_3d - 0.80) / 0.20, 0.0, 1.0)

    col = (1.0 - t1) * shadow_c + t1 * ((1.0 - t2) * mid_c + t2 * ((1.0 - t3) * flame_c + t3 * high_c))
    out = np.dstack([np.clip(col, 0, 255), a]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def style_eyeline_gothic(pil_img):
    """Dramatic Gothic obsidian eyeliner with subtle crimson edge."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    a = arr[..., 3]
    # Pitch black with crimson-tinted feathering
    arr[..., 0] = 20.0
    arr[..., 1] = 12.0
    arr[..., 2] = 16.0
    arr[..., 3] = a
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_eyebrow_gothic(pil_img):
    """Refined dark obsidian-burgundy arched brows."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    arr[..., 0] = 30.0
    arr[..., 1] = 18.0
    arr[..., 2] = 24.0
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_face_gothic(pil_img):
    """Luminous alabaster porcelain anime skin, deep berry-rose lips, soft peach-rose blush, beauty mark."""
    im = pil_img.convert("RGBA")
    if max(im.size) < 2048:
        im = im.resize((2048, 2048), Image.Resampling.BICUBIC)
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h

    # Porcelain tone: luminous alabaster [255, 246, 242]
    porcelain = np.array([255.0, 246.0, 242.0], dtype=np.float32)
    # Natural skin tone blend (preserves original facial feature geometry)
    skin_mask = arr[..., 3] > 30
    arr[skin_mask, :3] = 0.72 * arr[skin_mask, :3] + 0.28 * porcelain

    # 1. Soft Rose-Peach cheek blush
    for cx in (0.355, 0.645):
        dist = ((xn - cx) / 0.062) ** 2 + ((yn - 0.505) / 0.042) ** 2
        blush = np.exp(-dist * 1.8) * 0.38
        arr[..., 0] += blush * 42.0
        arr[..., 1] -= blush * 14.0
        arr[..., 2] -= blush * 8.0

    # 2. Deep Berry-Rose gloss lips (yn ~ 0.760)
    dx_lip = (xn - 0.500) / 0.065
    dy_lip = (yn - 0.762) / 0.024
    lip_core = np.exp(-(dx_lip ** 2 + dy_lip ** 2) * 2.2)
    berry_col = np.array([178.0, 48.0, 74.0], dtype=np.float32)
    gloss_c = np.array([255.0, 185.0, 205.0], dtype=np.float32)
    arr[..., :3] = np.where(lip_core[..., None] > 0.05,
                            (1.0 - lip_core[..., None]) * arr[..., :3] + lip_core[..., None] * berry_col,
                            arr[..., :3])
    # Lip gloss shine highlight
    gloss_m = np.exp(-(((xn - 0.495) / 0.020) ** 2 + ((yn - 0.768) / 0.008) ** 2) * 3.5)
    arr[..., :3] = np.where(gloss_m[..., None] > 0.15,
                            (1.0 - gloss_m[..., None] * 0.7) * arr[..., :3] + gloss_m[..., None] * 0.7 * gloss_c,
                            arr[..., :3])

    # 3. Gothic beauty mark on left cheek (xn ~ 0.382, yn ~ 0.548)
    bm_dist = ((xn - 0.382) / 0.0038) ** 2 + ((yn - 0.548) / 0.0038) ** 2
    bm_mask = np.exp(-bm_dist * 4.0)
    arr[..., :3] = np.where(bm_mask[..., None] > 0.12,
                            (1.0 - bm_mask[..., None]) * arr[..., :3] + bm_mask[..., None] * np.array([25.0, 15.0, 20.0]),
                            arr[..., :3])

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_gothic_body_stockings(pil_img):
    """Porcelain alabaster skin with Gothic black silk triangle panties (crimson lace) & sheer black stockings with garters."""
    im = pil_img.convert("RGBA")
    if max(im.size) < 2048:
        im = im.resize((2048, 2048), Image.Resampling.LANCZOS)
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h

    # Porcelain skin
    porcelain = np.array([255.0, 246.0, 242.0], dtype=np.float32)
    skin_mask = arr[..., 3] > 30
    arr[skin_mask, :3] = 0.75 * arr[skin_mask, :3] + 0.25 * porcelain

    # 1. Modesty Triangle Bikini Panties in Obsidian Black Silk with Crimson Lace Border
    # In VRoid body UV map, pelvis center is at xn ~ 0.50, yn ~ 0.44 to 0.56
    dx_p = np.abs(xn - 0.500)
    panties_top_y = 0.448
    panties_bot_y = 0.565
    t_crotch = np.clip((yn - panties_top_y) / max(1e-4, panties_bot_y - panties_top_y), 0.0, 1.0)
    # Triangle taper
    panties_half_w = 0.115 * (1.0 - 0.72 * (t_crotch ** 0.85))
    is_panties_silk = (yn >= panties_top_y) & (yn <= panties_bot_y) & (dx_p <= panties_half_w) & skin_mask
    is_crimson_lace = (yn >= panties_top_y) & (yn <= panties_bot_y) & (dx_p > panties_half_w - 0.009) & (dx_p <= panties_half_w + 0.004) & skin_mask

    black_silk = np.array([16.0, 15.0, 20.0], dtype=np.float32)
    crimson_lace = np.array([170.0, 24.0, 48.0], dtype=np.float32)

    arr[is_panties_silk, :3] = black_silk
    arr[is_crimson_lace, :3] = crimson_lace

    # Waistband lace
    is_waist_lace = (yn >= panties_top_y - 0.006) & (yn <= panties_top_y + 0.004) & (dx_p <= 0.120) & skin_mask
    arr[is_waist_lace, :3] = crimson_lace

    # 2. Sheer Smoky Black Thigh-High Stockings (yn >= 0.620)
    stocking_mask = (yn >= 0.620) & skin_mask & (xn > 0.08) & (xn < 0.92)
    stocking_black = np.array([18.0, 16.0, 22.0], dtype=np.float32)
    # 65% sheer smoky density
    arr[stocking_mask, :3] = 0.35 * arr[stocking_mask, :3] + 0.65 * stocking_black

    # Stocking top black scalloped lace garter band (yn ~ 0.615 - 0.628)
    garter_band = (yn >= 0.614) & (yn <= 0.626) & skin_mask & (xn > 0.08) & (xn < 0.92)
    arr[garter_band, :3] = np.array([12.0, 10.0, 14.0], dtype=np.float32)
    garter_crimson_piping = (yn >= 0.612) & (yn <= 0.616) & skin_mask & (xn > 0.08) & (xn < 0.92)
    arr[garter_crimson_piping, :3] = crimson_lace

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_gothic_dress(pil_img):
    """Gothic Crimson Velvet evening gown with black Victorian lace borders and pewter filigree seams."""
    im = pil_img.convert("RGBA")
    if max(im.size) < 2048:
        im = im.resize((2048, 2048), Image.Resampling.LANCZOS)
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h

    # Velvet base: Gothic Crimson [106, 16, 32] at waist/bust grading to Deep Wine [62, 8, 20] at hem
    velvet_top = np.array([112.0, 18.0, 36.0], dtype=np.float32)
    velvet_bot = np.array([58.0, 8.0, 18.0], dtype=np.float32)
    t_y = np.clip(yn, 0.0, 1.0)[..., None]
    velvet_rgb = (1.0 - t_y) * velvet_top + t_y * velvet_bot

    # Subtle velvet sheen texture
    grain = 1.0 + 0.06 * np.sin(xn * 400.0) * np.cos(yn * 400.0)
    velvet_rgb *= grain[..., None]

    alpha = arr[..., 3].copy()

    # 1. Sweetheart plunge V-neckline
    dx_c = np.abs(xn - 0.500)
    sweet_y = 0.168 + 0.062 * (dx_c / 0.115) ** 1.35
    in_sweet_front = (dx_c < 0.115) & (yn < sweet_y) & (yn >= 0.095)
    alpha = np.where(in_sweet_front, 0.0, alpha)

    # 2. High front-left thigh slit (xn ~ 0.578, yn >= 0.618 to 0.928)
    slit_t = np.clip((yn - 0.618) / 0.310, 0.0, 1.0)
    slit_c = 0.578 + 0.015 * slit_t
    slit_w = 0.002 + 0.052 * (slit_t ** 0.82)
    dist_slit = np.abs(xn - slit_c)
    in_slit = (yn >= 0.618) & (yn <= 0.928) & (dist_slit < slit_w)
    alpha = np.where(in_slit, 0.0, alpha)

    out_rgb = velvet_rgb.copy()

    # 3. Victorian Black Lace Borders & Pewter Piping
    pewter_col = np.array([182.0, 186.0, 194.0], dtype=np.float32)
    black_lace_col = np.array([16.0, 14.0, 18.0], dtype=np.float32)

    # Sweetheart neckline black lace border + pewter piping
    sweet_lace = (dx_c < 0.118) & (yn >= sweet_y) & (yn < sweet_y + 0.014)
    sweet_pewter = (dx_c < 0.116) & (yn >= sweet_y) & (yn < sweet_y + 0.004)

    # Slit black lace border + pewter piping
    slit_lace = (yn >= 0.614) & (yn <= 0.928) & (dist_slit >= slit_w) & (dist_slit < slit_w + 0.012)
    slit_pewter = (yn >= 0.614) & (yn <= 0.928) & (dist_slit >= slit_w) & (dist_slit < slit_w + 0.0035)

    # Hem black lace scallop & pewter scroll
    hem_lace = (yn >= 0.912) & (yn <= 0.928) & (alpha > 10)
    hem_pewter = (yn >= 0.922) & (yn <= 0.927) & (alpha > 10)

    # Corset center ribbon lacing down bodice (dx_c < 0.025, yn between 0.24 and 0.44)
    in_corset_panel = (dx_c < 0.024) & (yn >= 0.240) & (yn <= 0.435)
    # Cross laces
    corset_zig = np.abs(np.sin((yn - 0.240) * 110.0))
    is_cross_lace = in_corset_panel & (np.abs(dx_c / 0.024 - corset_zig) < 0.18)
    is_corset_pewter_eyelet = in_corset_panel & (dx_c > 0.020) & (np.abs(np.sin((yn - 0.240) * 55.0)) > 0.85)

    # Combine overlays
    out_rgb = np.where(sweet_lace[..., None], black_lace_col, out_rgb)
    out_rgb = np.where(sweet_pewter[..., None], pewter_col, out_rgb)
    out_rgb = np.where(slit_lace[..., None], black_lace_col, out_rgb)
    out_rgb = np.where(slit_pewter[..., None], pewter_col, out_rgb)
    out_rgb = np.where(hem_lace[..., None], black_lace_col, out_rgb)
    out_rgb = np.where(hem_pewter[..., None], pewter_col, out_rgb)
    out_rgb = np.where(in_corset_panel[..., None], np.array([22.0, 16.0, 20.0]), out_rgb)
    out_rgb = np.where(is_cross_lace[..., None], black_lace_col, out_rgb)
    out_rgb = np.where(is_corset_pewter_eyelet[..., None], pewter_col, out_rgb)

    return Image.fromarray(np.dstack([np.clip(out_rgb, 0, 255), alpha]).astype(np.uint8), "RGBA")


def style_gothic_underskirt(pil_img):
    """Obsidian black silk underskirt lining with crimson lace edge."""
    im = pil_img.convert("RGBA")
    if max(im.size) < 2048:
        im = im.resize((2048, 2048), Image.Resampling.LANCZOS)
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h

    # Obsidian black silk base
    black_silk = np.array([18.0, 16.0, 22.0], dtype=np.float32)
    crimson_lace = np.array([170.0, 24.0, 48.0], dtype=np.float32)

    alpha = arr[..., 3].copy()
    slit_t = np.clip((yn - 0.618) / 0.310, 0.0, 1.0)
    slit_center = 0.578 + 0.015 * slit_t
    slit_half = 0.002 + 0.044 * (slit_t ** 0.82)
    in_slit = (yn >= 0.618) & (np.abs(xn - slit_center) < slit_half)
    alpha = np.where((yn < 0.535) | in_slit | (yn > 0.932), 0.0, alpha)

    out_rgb = np.full((h, w, 3), black_silk, dtype=np.float32)
    # Crimson lace scallop at the hem (yn >= 0.910)
    is_crimson_hem = (yn >= 0.910) & (yn <= 0.932) & (alpha > 10)
    out_rgb = np.where(is_crimson_hem[..., None], crimson_lace, out_rgb)

    return Image.fromarray(np.dstack([np.clip(out_rgb, 0, 255), alpha]).astype(np.uint8), "RGBA")


def style_shoes_gothic(pil_img):
    """Obsidian black patent leather pumps with crimson red sole."""
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    yn = yy / h

    # Upper calf laces transparent (keeps sleek stiletto)
    alpha = arr[..., 3]
    alpha = np.where(yn < 0.28, 0.0, alpha)

    # Black patent leather
    out_rgb = np.array([14.0, 13.0, 18.0], dtype=np.float32)
    # Crimson sole accent (yn > 0.88)
    sole_mask = yn > 0.88
    rgb = np.where(sole_mask[..., None], np.array([165.0, 22.0, 42.0]), out_rgb)

    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8), "RGBA")


# --- 3D JEWELRY GEOMETRY BUILDERS ---

def build_uv_sphere_or_teardrop(cx, cy, cz, rx, ry, rz, n_lat=8, n_lon=12, teardrop=False):
    verts, norms, tris = [], [], []
    for i in range(n_lat + 1):
        th = math.pi * i / float(n_lat)
        sin_th = math.sin(th)
        cos_th = math.cos(th)
        t_tear = (1.0 - cos_th) * 0.5 if teardrop else 0.5
        rad_fac = (0.35 + 0.65 * t_tear) if teardrop else 1.0
        for j in range(n_lon):
            ph = 2.0 * math.pi * j / float(n_lon)
            x = cx + rx * rad_fac * sin_th * math.cos(ph)
            y = cy + ry * cos_th
            z = cz + rz * rad_fac * sin_th * math.sin(ph)
            verts.append((x, y, z))
            dx, dy, dz = (x - cx) / max(1e-4, rx), (y - cy) / max(1e-4, ry), (z - cz) / max(1e-4, rz)
            mag = math.sqrt(dx * dx + dy * dy + dz * dz)
            norms.append((dx / mag, dy / mag, dz / mag) if mag > 1e-4 else (0, 1, 0))

    for i in range(n_lat):
        for j in range(n_lon):
            p1 = i * n_lon + j
            p2 = p1 + n_lon
            p3 = i * n_lon + ((j + 1) % n_lon)
            p4 = p2 - j + ((j + 1) % n_lon)
            tris.extend([p1, p2, p3, p3, p2, p4])
    return (
        np.array(verts, dtype=np.float32),
        np.array(norms, dtype=np.float32),
        np.array(tris, dtype=np.uint16),
    )


def build_gothic_choker_chain():
    """Gothic choker necklace chain with subtle front dip towards cleavage."""
    n_seg = 32
    ring_res = 6
    r_tube = 0.0016
    verts, norms, tris = [], [], []
    ring_centers = []
    for i in range(n_seg):
        t = i / float(n_seg - 1)
        ang = -math.pi * 0.55 + t * math.pi * 1.10
        rx = 0.048 * math.sin(ang)
        dip = 0.012 * math.cos(ang) ** 2
        ry = 0.082 - dip
        rz = 0.046 * math.cos(ang) + 0.038
        ring_centers.append((rx, ry, rz))

    for ci, (cx, cy, cz) in enumerate(ring_centers):
        for k in range(ring_res):
            phi = 2.0 * math.pi * k / float(ring_res)
            vx = cx + r_tube * math.cos(phi)
            vy = cy + r_tube * math.sin(phi) * 0.5
            vz = cz + r_tube * math.sin(phi)
            verts.append((vx, vy, vz))
            dx, dy, dz = vx - cx, vy - cy, vz - cz
            mag = math.sqrt(dx * dx + dy * dy + dz * dz)
            norms.append((dx / mag, dy / mag, dz / mag) if mag > 1e-4 else (0, 0, 1))

    for i in range(n_seg - 1):
        for k in range(ring_res):
            p1 = i * ring_res + k
            p2 = (i + 1) * ring_res + k
            p3 = i * ring_res + ((k + 1) % ring_res)
            p4 = (i + 1) * ring_res + ((k + 1) % ring_res)
            tris.extend([p1, p2, p3, p3, p2, p4])

    return (
        np.array(verts, dtype=np.float32),
        np.array(norms, dtype=np.float32),
        np.array(tris, dtype=np.uint16),
    )


def attach_gothic_jewelry_nodes(gltf, slices):
    """Attach Antique Silver + Blood Ruby Teardrop Chandelier Earrings and Choker Pendant."""
    silver_mat = add_metallic_material(gltf, "Gothic_Pewter", [0.82, 0.85, 0.90, 1.0], metallic=0.90, roughness=0.18, emissive=(0.04, 0.04, 0.05))
    ruby_mat = add_metallic_material(gltf, "Gothic_BloodRuby", [0.85, 0.08, 0.18, 1.0], metallic=0.15, roughness=0.08, emissive=(0.45, 0.04, 0.09))

    def add_child_mesh(target_names, node_name, parts):
        prims = []
        for vp, vn, ti, mat_idx in parts:
            pa = append_accessor(gltf, slices, vp, 5126, "VEC3", 34962)
            na = append_accessor(gltf, slices, vn, 5126, "VEC3", 34962)
            ia = append_accessor(gltf, slices, ti, 5123, "SCALAR", 34963)
            prims.append({"attributes": {"POSITION": pa, "NORMAL": na}, "indices": ia, "material": mat_idx})
        mesh_idx = len(gltf["meshes"])
        gltf["meshes"].append({"name": node_name, "primitives": prims})
        node_idx = len(gltf["nodes"])
        gltf["nodes"].append({"name": node_name, "mesh": mesh_idx})
        for n in gltf["nodes"]:
            if n.get("name") in target_names:
                n.setdefault("children", []).append(node_idx)
                break

    # 1. Antique Silver + Blood Ruby Teardrop Earrings on J_Bip_C_Head
    ear_parts = []
    for sx in (-1.0, 1.0):
        ex = sx * 0.088
        vp1, vn1, ti1 = build_uv_sphere_or_teardrop(ex, 0.038, 0.007, 0.0032, 0.0032, 0.0032, 6, 8, False)
        vp2, vn2, ti2 = build_uv_sphere_or_teardrop(ex, 0.020, 0.011, 0.0055, 0.0110, 0.0045, 8, 12, True)
        ear_parts.append((vp1, vn1, ti1, silver_mat))
        ear_parts.append((vp2, vn2, ti2, ruby_mat))
    add_child_mesh(("J_Bip_C_Head", "Head"), "Gothic_Earrings", ear_parts)

    # 2. Pewter Choker Chain + Blood Ruby Teardrop Pendant on J_Bip_C_UpperChest
    cp, cn, ci = build_gothic_choker_chain()
    bp, bn, bi = build_uv_sphere_or_teardrop(0.0, 0.070, 0.084, 0.0090, 0.0120, 0.0048, 8, 12, False)
    gp, gn, gi = build_uv_sphere_or_teardrop(0.0, 0.070, 0.087, 0.0068, 0.0100, 0.0046, 8, 12, True)
    add_child_mesh(("J_Bip_C_UpperChest", "UpperChest"), "Gothic_Pendant", [
        (cp, cn, ci, silver_mat),
        (bp, bn, bi, silver_mat),
        (gp, gn, gi, ruby_mat),
    ])


def sculpt_gothic_geometry(gltf, slices):
    """
    Remove maid clutter pieces and stretch skirt to floor gown.
    CRITICAL: Keep standard cute anime proportions (NO adult head/chin/bust size changes).
    Preserves 100% of unit vertex normals.
    """
    body = next(m for m in gltf["meshes"] if "Body" in m.get("name", ""))
    prims = body["primitives"]

    # Dynamically detect outer dress vs underskirt by triangle count
    main_dress_mat_name = None
    underskirt_mat_name = None
    for pr in prims:
        midx = pr.get("material")
        if midx is None:
            continue
        mname = gltf["materials"][midx]["name"]
        idx_count = gltf["accessors"][pr["indices"]]["count"]
        if "Tops_01_CLOTH" in mname:
            if idx_count > 2500:
                main_dress_mat_name = mname
            elif 600 < idx_count < 2500:
                underskirt_mat_name = mname

    keep_prims = []
    pos = None
    for pr in prims:
        mname = gltf["materials"][pr["material"]]["name"]
        if any(k in mname for k in ("Tops_01_CLOTH_01", "007_01_Tops", "002_01_Tops", "Shoes_01_CLOTH_02")):
            continue
        keep_prims.append(pr)
        if pos is None:
            pos = get_accessor_np(gltf, slices, pr["attributes"]["POSITION"])

    skirt_outer_v = None
    skirt_inner_v = None
    for pr in keep_prims:
        mname = gltf["materials"][pr["material"]]["name"]
        idx = get_accessor_np(gltf, slices, pr["indices"])
        u_idx = np.unique(idx)
        if mname == underskirt_mat_name:
            skirt_inner_v = u_idx
        elif mname == main_dress_mat_name:
            skirt_outer_v = u_idx
            uv_all = get_accessor_np(gltf, slices, pr["attributes"]["TEXCOORD_0"])
            tris = idx.reshape(-1, 3)
            tri_uv = uv_all[tris].mean(axis=1)
            tri_pos = pos[tris].mean(axis=1)
            # Remove underarm puff sleeve pieces
            is_sleeve_tri = ((tri_uv[:, 0] < 0.258) | (tri_uv[:, 0] > 0.742)) & (tri_uv[:, 1] < 0.318)
            drop_sleeve_tri = is_sleeve_tri & (tri_pos[:, 1] < 0.905)
            set_accessor_np(gltf, slices, pr["indices"], tris[~drop_sleeve_tri].reshape(-1).astype(idx.dtype))

    # Stretch skirt to floor gown
    def stretch_skirt(v_indices, waist_y=0.778, new_hem_y=0.048, inset=1.0):
        if v_indices is None:
            return
        y = pos[v_indices, 1]
        vi = v_indices[y < waist_y]
        sy = pos[vi, 1]
        s = np.clip((waist_y - sy) / max(1e-4, waist_y - 0.415), 0.0, 1.0)
        pos[vi, 1] = waist_y - (waist_y - new_hem_y) * (s ** 1.04)
        nodes_s = np.array([0.0, 0.15, 0.35, 0.55, 0.75, 1.00])
        nodes_rx = np.array([1.03, 1.06, 0.96, 0.82, 0.88, 1.15]) * inset
        nodes_rz = np.array([1.03, 1.07, 0.98, 0.84, 0.90, 1.20]) * inset
        scale_x = np.interp(s, nodes_s, nodes_rx)
        scale_z = np.interp(s, nodes_s, nodes_rz)
        pos[vi, 0] *= scale_x
        pos[vi, 2] *= scale_z

    stretch_skirt(skirt_outer_v, waist_y=0.778, new_hem_y=0.048, inset=1.0)
    stretch_skirt(skirt_inner_v, waist_y=0.778, new_hem_y=0.052, inset=0.985)

    # Clean normal textures from tops so MToon renders smooth fabric
    for pr in keep_prims:
        mat = gltf["materials"][pr["material"]]
        if "Tops_01_CLOTH" in mat.get("name", "") and "normalTexture" in mat:
            del mat["normalTexture"]

    body["primitives"] = keep_prims
    first_pos_acc = keep_prims[0]["attributes"]["POSITION"]
    first_norm_acc = keep_prims[0]["attributes"]["NORMAL"]
    set_accessor_np(gltf, slices, first_pos_acc, pos)

    # Preserves 100% of face vertex normals and cute base face geometry intact!
    return main_dress_mat_name, underskirt_mat_name


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", default=r"c:\Users\rv941\OneDrive\Documents\1.vrm")
    parser.add_argument("output", nargs="?", default=r"c:\extensions\anime wifu\assets\models\companion_alt.vrm")
    parser.add_argument("--max_tex", type=int, default=2048)
    args = parser.parse_args()

    print(f"Reading base VRM: {args.input}")
    with open(args.input, "rb") as f:
        data = f.read()

    magic, ver, length = struct.unpack_from("<4sII", data, 0)
    json_len, json_type = struct.unpack_from("<II", data, 12)
    json_bytes = data[20 : 20 + json_len]
    gltf = json.loads(json_bytes.decode("utf-8"))

    bin_hdr_offset = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", data, bin_hdr_offset)
    bin_bytes = data[bin_hdr_offset + 8 : bin_hdr_offset + 8 + bin_len]

    bvs = gltf["bufferViews"]
    images = gltf.get("images", [])
    slices = [
        bytearray(bin_bytes[bv.get("byteOffset", 0) : bv.get("byteOffset", 0) + bv.get("byteLength", 0)])
        for bv in bvs
    ]

    def load_img_by_idx(img_idx):
        return Image.open(io.BytesIO(bytes(slices[images[img_idx]["bufferView"]])))

    def save_img_by_idx(img_idx, new_bytes):
        slices[images[img_idx]["bufferView"]] = bytearray(new_bytes)

    mat_img_map = {}
    for mat in gltf.get("materials", []):
        name = mat.get("name", "")
        tex = (mat.get("pbrMetallicRoughness") or {}).get("baseColorTexture", {}).get("index")
        if tex is not None:
            mat_img_map[name] = (mat, gltf["textures"][tex]["source"])

    # Geometry sculpt (removes maid pieces, floor evening gown, keeps cute base proportions)
    main_dress_mat_name, underskirt_mat_name = sculpt_gothic_geometry(gltf, slices)

    # Attach Gothic Blood Ruby Jewelry
    attach_gothic_jewelry_nodes(gltf, slices)

    # Apply Gothic Red Palette across all materials
    edited_imgs = set()
    for mname, (mat, img_idx) in mat_img_map.items():
        mtoon = (mat.get("extensions") or {}).get("VRMC_materials_mtoon")

        if "Body_00_SKIN" in mname:
            body_pil = style_gothic_body_stockings(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(body_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.94, 0.70, 0.65]
                mtoon["shadingToonyFactor"] = 0.35
                mtoon["shadingShiftFactor"] = -0.05
        elif "Face_00_SKIN" in mname:
            face_pil = style_face_gothic(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(face_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.94, 0.70, 0.65]
                mtoon["shadingToonyFactor"] = 0.35
                mtoon["shadingShiftFactor"] = -0.05
        elif "EyeIris" in mname:
            iris_pil = style_eye_ruby(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(iris_pil, args.max_tex))
            edited_imgs.add(img_idx)
        elif "FaceEyeline" in mname or "FaceEyelash" in mname:
            el_pil = style_eyeline_gothic(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(el_pil, args.max_tex))
            edited_imgs.add(img_idx)
        elif "FaceBrow" in mname:
            brow_pil = style_eyebrow_gothic(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(brow_pil, args.max_tex))
            edited_imgs.add(img_idx)
        elif "Hair_00_HAIR" in mname or "HairBack_00_HAIR" in mname:
            h_pil = style_hair_gothic_black(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(h_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.28, 0.12, 0.18]
                mtoon["shadingToonyFactor"] = 0.85
        elif "Shoes_01_CLOTH_01" in mname:
            sh_pil = style_shoes_gothic(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(sh_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.45, 0.10, 0.15]
        elif mname == main_dress_mat_name:
            dress_pil = style_gothic_dress(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(dress_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.42, 0.08, 0.14]
                mtoon["shadingToonyFactor"] = 0.65
        elif mname == underskirt_mat_name:
            under_pil = style_gothic_underskirt(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(under_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.25, 0.10, 0.14]

    # Re-pack and align glTF binary buffer
    new_bin = bytearray()
    for bv_idx, bv in enumerate(gltf["bufferViews"]):
        s = slices[bv_idx]
        pad = (4 - (len(new_bin) % 4)) % 4
        if pad:
            new_bin.extend(b"\x00" * pad)
        bv["byteOffset"] = len(new_bin)
        bv["byteLength"] = len(s)
        new_bin.extend(s)

    gltf["buffers"][0]["byteLength"] = len(new_bin)
    new_json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    pad_j = (4 - (len(new_json_bytes) % 4)) % 4
    if pad_j:
        new_json_bytes += b" " * pad_j

    pad_b = (4 - (len(new_bin) % 4)) % 4
    if pad_b:
        new_bin.extend(b"\x00" * pad_b)

    total_len = 12 + 8 + len(new_json_bytes) + 8 + len(new_bin)
    out_dir = os.path.dirname(args.output)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(args.output, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<II", len(new_json_bytes), 0x4E4F534A))
        f.write(new_json_bytes)
        f.write(struct.pack("<II", len(new_bin), 0x004E4942))
        f.write(new_bin)

    mb = os.path.getsize(args.output) / (1024 * 1024)
    print(f"GOTHIC_RED_VRM_OK output={args.output} ({mb:.2f} MB)")


if __name__ == "__main__":
    main()

