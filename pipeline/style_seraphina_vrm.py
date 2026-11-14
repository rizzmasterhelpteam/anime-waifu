"""
Style Seraphina VRM - Royal Navy Evening Gown Edition
Generates Seraphina's tailored, form-fitting bodycon royal gown and luminous anime appearance
from base model 1real.vrm:
- Royal Midnight Navy bodycon evening gown hugging waist, hips, and glutes with zero ballooning.
- Solid midnight navy midriff (sweetheart plunge terminates cleanly at sternum decolletage).
- High front-left thigh slit showing sheer black stocking and leg.
- 100% intact, pristine, beautiful anime face geometry and unit normals from 1real.vrm.
- Luminous ivory-peach skin, amethyst-violet eyes, silver-lavender hair, silver teardrop earrings & gold pendant.
"""

import argparse
import io
import json
import math
import os
import struct
import numpy as np
from PIL import Image


def parse_vrm(raw_bytes):
    magic, ver, length = struct.unpack_from("<4sII", raw_bytes, 0)
    if magic != b"glTF" or ver != 2:
        raise ValueError("Invalid glTF binary header")
    offset = 12
    gltf = None
    bin_bytes = None
    extra_chunks = []
    while offset < length:
        chunk_len, chunk_type = struct.unpack_from("<II", raw_bytes, offset)
        chunk_data = raw_bytes[offset + 8 : offset + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:  # JSON
            gltf = json.loads(chunk_data.decode("utf-8"))
        elif chunk_type == 0x004E4942:  # BIN
            bin_bytes = chunk_data
        else:
            extra_chunks.append((chunk_type.to_bytes(4, "little"), chunk_data))
        offset += 8 + chunk_len
    return gltf, bin_bytes, extra_chunks


def pack_vrm(gltf, bin_bytes, extra):
    j = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    while len(j) % 4 != 0:
        j += b" "
    b = bytearray(bin_bytes)
    while len(b) % 4 != 0:
        b.append(0)
    chunks = [(b"JSON", j), (b"BIN\x00", bytes(b))]
    for ct, cd in extra:
        p = bytearray(cd)
        while len(p) % 4 != 0:
            p.append(0)
        chunks.append((ct, bytes(p)))
    total = 12 + sum(8 + len(d) for _, d in chunks)
    out = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    for ct, cd in chunks:
        out.extend(struct.pack("<I4s", len(cd), ct))
        out.extend(cd)
    return bytes(out)


def encode_png(pil_img, max_dim=2048):
    w, h = pil_img.size
    if max(w, h) > max_dim:
        s = max_dim / float(max(w, h))
        pil_img = pil_img.resize(
            (max(8, int(round(w * s))), max(8, int(round(h * s)))),
            Image.Resampling.LANCZOS,
        )
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def get_accessor_np(gltf, slices, acc_idx):
    a = gltf["accessors"][acc_idx]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a["componentType"]]
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    off = a.get("byteOffset", 0)
    raw = bytes(slices[a["bufferView"]][off : off + a["count"] * nc * np.dtype(dt).itemsize])
    return np.frombuffer(raw, dtype=dt).reshape(-1, nc)


def set_accessor_np(gltf, slices, acc_idx, arr):
    a = gltf["accessors"][acc_idx]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a["componentType"]]
    off = a.get("byteOffset", 0)
    data = arr.astype(dt).tobytes()
    bv = slices[a["bufferView"]]
    bv[off : off + len(data)] = data
    if "min" in a and "max" in a:
        a["min"] = arr.min(axis=0).tolist()
        a["max"] = arr.max(axis=0).tolist()


def append_accessor(gltf, slices, np_arr, component_type, acc_type, target):
    raw_data = np_arr.tobytes()
    bv_idx = len(gltf["bufferViews"])
    gltf["bufferViews"].append({"buffer": 0, "byteOffset": 0, "byteLength": len(raw_data), "target": target})
    slices.append(bytearray(raw_data))

    acc_idx = len(gltf["accessors"])
    acc = {
        "bufferView": bv_idx,
        "byteOffset": 0,
        "componentType": component_type,
        "count": len(np_arr),
        "type": acc_type,
    }
    if acc_type in ("VEC3", "VEC2"):
        acc["min"] = np_arr.min(axis=0).tolist()
        acc["max"] = np_arr.max(axis=0).tolist()
    gltf["accessors"].append(acc)
    return acc_idx


def add_metallic_material(gltf, name, base_color_rgba, metallic=0.85, roughness=0.18, emissive=(0, 0, 0)):
    idx = len(gltf["materials"])
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
    return idx


# ============================================================================
# TEXTURE STYLING
# ============================================================================

def style_eye_iris(pil_img):
    """Regal Seraphina Violet: deep royal amethyst iris with glowing lavender core and crystalline highlights."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    for cx in (w * 0.25, w * 0.75):
        cy = h * 0.50
        dx = (xx - cx) / (w * 0.22)
        dy = (yy - cy) / (h * 0.44)
        r = np.sqrt(dx * dx + dy * dy)
        mask = r < 1.0

        outer_violet = np.array([42.0, 18.0, 68.0], dtype=np.float32)
        mid_amethyst = np.array([124.0, 62.0, 188.0], dtype=np.float32)
        inner_lavender = np.array([218.0, 186.0, 255.0], dtype=np.float32)
        pupil_dark = np.array([18.0, 6.0, 32.0], dtype=np.float32)

        t = np.clip(r, 0.0, 1.0)[..., None]
        iris_rgb = np.where(t < 0.42,
                            pupil_dark * (1.0 - t / 0.42) + mid_amethyst * (t / 0.42),
                            mid_amethyst * (1.0 - (t - 0.42) / 0.58) + outer_violet * ((t - 0.42) / 0.58))

        glow_mask = (r > 0.35) & (r < 0.75) & (dy > -0.15)
        glow_w = np.exp(-((r - 0.55) / 0.15) ** 2) * 0.65
        iris_rgb = np.where(glow_mask[..., None],
                            iris_rgb * (1.0 - glow_w[..., None]) + inner_lavender * glow_w[..., None],
                            iris_rgb)

        arr[mask, :3] = iris_rgb[mask]
        arr[mask, 3] = 255.0

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_eyeline_plum(pil_img):
    """Deep royal plum eyeliner and luscious lashes."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    mask = arr[..., 3] > 30
    plum = np.array([48.0, 22.0, 42.0], dtype=np.float32)
    arr[mask, :3] = 0.85 * arr[mask, :3] + 0.15 * plum
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_eyebrow(pil_img):
    """Refined silver-lavender brows."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    mask = arr[..., 3] > 30
    brow_tone = np.array([142.0, 134.0, 172.0], dtype=np.float32)
    arr[mask, :3] = 0.55 * arr[mask, :3] + 0.45 * brow_tone
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_face_skin(pil_img):
    """
    Luminous ivory-peach anime skin for Seraphina:
    - Delicate rose cheek blush
    - Defined luscious rose lips with cupid's bow & gloss
    - Soft refined nose tip and cute beauty mark
    - Keeps 100% of base face features completely pristine.
    """
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)

    # Tone grade base skin toward warm luminous ivory-peach (#FFF4EB)
    skin_mask = arr[..., 3] > 30
    peach_ivory = np.array([255.0, 244.0, 235.0], dtype=np.float32)
    arr[skin_mask, :3] = 0.82 * arr[skin_mask, :3] + 0.18 * peach_ivory

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h

    # 1. Soft Rose Cheek Blush
    blush = np.zeros((h, w), dtype=np.float32)
    for cx in (0.320, 0.680):
        dx = (xn - cx) / 0.055
        dy = (yn - 0.615) / 0.035
        blush += np.exp(-(dx * dx + dy * dy) * 1.6) * 0.32
    blush = np.clip(blush, 0.0, 0.35)[..., None]
    rose_blush = np.array([242.0, 142.0, 148.0], dtype=np.float32)
    arr[..., :3] = arr[..., :3] * (1.0 - blush) + rose_blush * blush

    # 2. Luscious Defined Lips: cupid's bow + berry rose tone
    p1 = np.exp(-(((xn - 0.485) / 0.014) ** 2 + ((yn - 0.752) / 0.005) ** 2)) * 0.85
    p2 = np.exp(-(((xn - 0.515) / 0.014) ** 2 + ((yn - 0.752) / 0.005) ** 2)) * 0.85
    p_mid = np.exp(-(((xn - 0.500) / 0.010) ** 2 + ((yn - 0.754) / 0.004) ** 2)) * 0.70
    upper_lip = np.clip(p1 + p2 + p_mid, 0.0, 0.85) * (yn <= 0.757)

    lower_lip = np.exp(-(((xn - 0.500) / 0.034) ** 2 + ((yn - 0.764) / 0.007) ** 2)) * 0.85 * (yn >= 0.756)
    lip_mask = np.clip(upper_lip + lower_lip, 0.0, 0.90)[..., None]
    berry_rose = np.array([212.0, 92.0, 114.0], dtype=np.float32)
    arr[..., :3] = arr[..., :3] * (1.0 - lip_mask) + berry_rose * lip_mask

    # 3. Soft Gloss Reflection on lower lip
    gloss = np.exp(-(((xn - 0.500) / 0.010) ** 2 + ((yn - 0.763) / 0.003) ** 2)) * 0.40
    gloss_col = np.array([255.0, 240.0, 244.0], dtype=np.float32)
    arr[..., :3] = arr[..., :3] * (1.0 - gloss[..., None]) + gloss_col * gloss[..., None]

    # 4. Subtle beauty mark beneath left eye (signature Seraphina charm)
    bm_dx = (xn - 0.655) / 0.0035
    bm_dy = (yn - 0.565) / 0.0035
    bm_dist = bm_dx * bm_dx + bm_dy * bm_dy
    bm_mask = np.clip(np.exp(-bm_dist * 2.0), 0.0, 0.85)[..., None]
    bm_col = np.array([48.0, 28.0, 32.0], dtype=np.float32)
    arr[..., :3] = arr[..., :3] * (1.0 - bm_mask) + bm_col * bm_mask

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_body_stockings(pil_img):
    """
    Body skin + sheer black stockings + gold lace garter band:
    - Warm peach-ivory upper body and cleavage shading
    - 20-denier sheer black stockings on legs
    - Metallic gold garter band with scalloped lace picot
    """
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)

    skin_mask = arr[..., 3] > 30
    peach_ivory = np.array([255.0, 244.0, 235.0], dtype=np.float32)
    arr[skin_mask, :3] = 0.80 * arr[skin_mask, :3] + 0.20 * peach_ivory

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h

    # Sheer Black Stockings (legs yn >= 0.618)
    stocking_mask = (yn >= 0.618) & skin_mask & (xn > 0.08) & (xn < 0.92)
    sheer_black = np.array([18.0, 16.0, 22.0], dtype=np.float32)
    sheer_fac = np.clip(0.68 + (yn - 0.618) * 0.25, 0.65, 0.85)[..., None]
    arr[stocking_mask, :3] = arr[stocking_mask, :3] * (1.0 - sheer_fac[stocking_mask]) + sheer_black * sheer_fac[stocking_mask]

    # Metallic Gold Garter Band (yn between 0.612 and 0.622)
    garter_band = (yn >= 0.612) & (yn <= 0.622) & skin_mask & (xn > 0.08) & (xn < 0.92)
    gold_tone = np.array([228.0, 188.0, 92.0], dtype=np.float32)
    arr[garter_band, :3] = gold_tone

    # Scalloped lace edge on top of garter
    scallop = 0.0030 * np.sin(xn * 2.0 * math.pi * 32.0)
    garter_lace = (np.abs(yn - (0.612 + scallop)) < 0.0018) & skin_mask & (xn > 0.08) & (xn < 0.92)
    arr[garter_lace, :3] = np.array([255.0, 220.0, 140.0], dtype=np.float32)

    # Cleavage shading on upper chest (yn around 0.28 to 0.38)
    cleavage_y = (yn >= 0.28) & (yn <= 0.38) & (np.abs(xn - 0.50) < 0.015) & skin_mask
    cleavage_depth = np.exp(-((xn - 0.50) / 0.006) ** 2) * np.exp(-((yn - 0.33) / 0.04) ** 2) * 0.32
    arr[..., :3] = arr[..., :3] * (1.0 - cleavage_depth[..., None]) + np.array([210.0, 140.0, 135.0], dtype=np.float32) * cleavage_depth[..., None]

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_hair_silver_lavender(pil_img):
    """Luminous silver-lavender hair (#EDE9FA -> #AEA2D4) with richer lavender midtones."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    s = np.clip((lum - 0.28) / 0.48, 0.0, 1.0)
    root = np.array([154.0, 144.0, 198.0], dtype=np.float32)
    mid = np.array([216.0, 210.0, 244.0], dtype=np.float32)
    hi = np.array([248.0, 245.0, 255.0], dtype=np.float32)

    low_t = np.clip(s * 2.0, 0.0, 1.0)[..., None]
    hi_t = np.clip((s - 0.5) * 2.0, 0.0, 1.0)[..., None]
    out = root * (1.0 - low_t) + mid * low_t
    out = out * (1.0 - hi_t) + hi * hi_t
    fine = np.clip(0.95 + (lum - lum.mean()) * 0.25, 0.88, 1.08)[..., None]
    arr[..., :3] = np.clip(out * fine, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def style_shoes_navy(pil_img):
    """Midnight navy pumps with metallic gold buckles."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    navy = np.array([20.0, 22.0, 36.0], dtype=np.float32)
    mask = arr[..., 3] > 30
    arr[mask, :3] = 0.75 * arr[mask, :3] + 0.25 * navy
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_underskirt(pil_img):
    """Deep wine-burgundy lining (#4A1224) matching royal evening gown inner drape."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    h, w = arr.shape[:2]
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    shade = np.clip(0.75 + lum * 0.50, 0.65, 1.30)
    burg = np.array([74.0, 18.0, 36.0], dtype=np.float32)
    arr[..., :3] = burg * shade[..., None]
    arr[..., 3] = 255.0
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_main_dress(pil_img):
    """
    Glamorous Midnight Navy & Burgundy Royal Evening Gown:
    - Solid midnight navy cloth across entire midriff and waist (ZERO bare midriff hole!).
    - Sweetheart plunge neckline terminating at V=0.285 (cleavage sternum).
    - Cap sleeves on shoulders (lower armpit underside dropped).
    - Front-left high thigh slit revealing burgundy lining & sheer stocking.
    - Crisp metallic gold filigree embroidery along neckline, seams, slit, and scalloped floor hem.
    """
    im = pil_img.convert("RGBA")
    if max(im.size) > 2048:
        im = im.resize((2048, 2048), Image.Resampling.LANCZOS)
    w, h = im.size
    arr = np.array(im, dtype=np.float32)

    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    smooth_fold = np.where(lum > 0.50, 0.96, np.clip(lum / 0.25, 0.78, 1.18))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h
    in_front_bib = (xn > 0.39) & (xn < 0.61) & (yn > 0.25) & (yn < 0.50)
    shade = np.where(in_front_bib, 0.94 + 0.08 * np.cos((xn - 0.50) * 14.0), smooth_fold)

    # Start fully opaque (255.0) - eliminate all maid apron cutouts!
    alpha = np.full((h, w), 255.0, dtype=np.float32)

    # 1. Cap sleeves on shoulders (yn <= 0.266) - erase lower armpit cuff (yn > 0.266)
    is_sleeve = ((xn < 0.258) | (xn > 0.742)) & (yn < 0.318)
    is_cap_sleeve = is_sleeve & (yn <= 0.266)
    is_lower_sleeve = is_sleeve & (yn > 0.266)
    alpha = np.where(is_lower_sleeve | (yn > 0.932), 0.0, alpha)

    # 2. Base Midnight Navy tone (#171827) across entire gown & cap sleeves
    out_rgb = np.zeros((h, w, 3), dtype=np.float32)
    out_rgb[..., 0] = 24.0 * shade
    out_rgb[..., 1] = 26.0 * shade
    out_rgb[..., 2] = 42.0 * shade

    # 3. Rich Burgundy Wine panels (#54192B) on lateral torso (ribs/waist)
    in_burg_bodice = (yn >= 0.410) & (yn <= 0.535) & (
        ((xn >= 0.310) & (xn <= 0.365)) | ((xn >= 0.635) & (xn <= 0.690))
    )
    burg_col = np.stack([88.0 * shade, 25.0 * shade, 43.0 * shade], axis=-1)
    out_rgb = np.where(in_burg_bodice[..., None], burg_col, out_rgb)

    # 4. Sweetheart plunge V-neckline terminating at sternum (V = 0.285)
    # CRITICAL: Terminates at V=0.285 so midriff and waist (V >= 0.285) remain 100% solid, opaque navy cloth!
    dx_c = np.abs(xn - 0.50)
    sweet_y = 0.285 - 0.110 * np.power(np.clip(dx_c / 0.105, 0.0, 1.0), 1.35)
    in_sweet_front = (dx_c < 0.105) & (yn < sweet_y)
    alpha = np.where(in_sweet_front, 0.0, alpha)

    # 5. High front-left thigh slit (revealing burgundy lining & stocking)
    slit_t = np.clip((yn - 0.618) / 0.310, 0.0, 1.0)
    slit_c = 0.578 + 0.015 * slit_t
    slit_w = 0.002 + 0.052 * (slit_t ** 0.82)
    dist_slit = np.abs(xn - slit_c)
    in_slit = (yn >= 0.618) & (yn <= 0.928) & (dist_slit < slit_w)
    alpha = np.where(in_slit, 0.0, alpha)

    # 6. Ornate Metallic Gold Filigree Embroidery (#E0B85C)
    gold_col = np.array([226.0, 186.0, 92.0], dtype=np.float32)
    sweet_gold = (dx_c < 0.108) & (yn >= sweet_y) & (yn < sweet_y + 0.0052)
    sleeve_gold = is_cap_sleeve & (yn >= 0.258) & (yn <= 0.266) & (alpha > 10)
    seam_bodice_gold = (yn >= 0.410) & (yn <= 0.535) & (
        (np.abs(xn - 0.365) < 0.0036) | (np.abs(xn - 0.635) < 0.0036) |
        (np.abs(xn - 0.310) < 0.0030) | (np.abs(xn - 0.690) < 0.0030)
    )
    slit_gold = (yn >= 0.614) & (yn <= 0.928) & (dist_slit >= slit_w) & (dist_slit < slit_w + 0.0042)
    slit_flourish = (yn >= 0.614) & (yn <= 0.928) & (dist_slit >= slit_w) & (dist_slit < slit_w + 0.0075) & (np.abs(np.sin(yn * 65.0)) > 0.72)
    hem_gold = (yn >= 0.920) & (yn <= 0.928) & (alpha > 10)
    wave1 = 0.0035 * np.sin(xn * 2.0 * math.pi * 14.0)
    wave2 = 0.0020 * np.cos(xn * 2.0 * math.pi * 28.0)
    hem_scroll = (yn >= 0.906) & (yn <= 0.920) & (alpha > 10) & (
        np.abs(yn - (0.913 + wave1 + wave2)) < 0.0022
    )

    is_gold = sweet_gold | sleeve_gold | seam_bodice_gold | slit_gold | slit_flourish | hem_gold | hem_scroll
    out_rgb = np.where(is_gold[..., None], gold_col, out_rgb)
    return Image.fromarray(np.dstack([np.clip(out_rgb, 0, 255), alpha]).astype(np.uint8), "RGBA")


# ============================================================================
# JEWELRY MESH GENERATOR
# ============================================================================

def build_uv_sphere_or_teardrop(cx, cy, cz, rx, ry, rz, n_lat=8, n_lon=12, teardrop=False):
    verts, norms, tris = [], [], []
    for i in range(n_lat + 1):
        theta = math.pi * i / float(n_lat)
        sin_t, cos_t = math.sin(theta), math.cos(theta)
        scale_cone = (1.0 - 0.55 * (cos_t + 1.0) * 0.5) if teardrop else 1.0
        for j in range(n_lon + 1):
            phi = 2.0 * math.pi * j / float(n_lon)
            sin_p, cos_p = math.sin(phi), math.cos(phi)
            vx = cx + rx * sin_t * cos_p * scale_cone
            vy = cy + ry * cos_t
            vz = cz + rz * sin_t * sin_p * scale_cone
            nx = sin_t * cos_p
            ny = cos_t
            nz = sin_t * sin_p
            mag = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            verts.append((vx, vy, vz))
            norms.append((nx / mag, ny / mag, nz / mag))
    for i in range(n_lat):
        for j in range(n_lon):
            a = i * (n_lon + 1) + j
            b = a + 1
            c = (i + 1) * (n_lon + 1) + j
            d = c + 1
            tris.extend([a, c, b, b, c, d])
    return (
        np.array(verts, dtype=np.float32),
        np.array(norms, dtype=np.float32),
        np.array(tris, dtype=np.uint16),
    )


def build_necklace_chain():
    verts, norms, tris = [], [], []
    n_pts = 32
    for i in range(n_pts + 1):
        t = i / float(n_pts)
        angle = -math.pi * 0.75 + math.pi * 1.5 * t
        cx = 0.052 * math.cos(angle)
        cy = 0.088 - 0.024 * math.sin(t * math.pi)
        cz = 0.058 * math.sin(angle) + 0.025
        for j in range(5):
            pa = 2.0 * math.pi * j / 4.0
            rx = 0.0011 * math.cos(pa)
            ry = 0.0011 * math.sin(pa)
            verts.append((cx + rx, cy + ry, cz))
            norms.append((math.cos(pa), math.sin(pa), 0.0))
    for i in range(n_pts):
        for j in range(4):
            a = i * 5 + j
            b = a + 1
            c = (i + 1) * 5 + j
            d = c + 1
            tris.extend([a, c, b, b, c, d])
    return (
        np.array(verts, dtype=np.float32),
        np.array(norms, dtype=np.float32),
        np.array(tris, dtype=np.uint16),
    )


def attach_jewelry_nodes(gltf, slices):
    """Attach 3D silver teardrop earrings on Head bone & 3D gold+amethyst pendant on UpperChest bone."""
    gold_mat = add_metallic_material(gltf, "Seraphina_Gold", [0.95, 0.78, 0.32, 1.0], metallic=0.88, roughness=0.18, emissive=(0.14, 0.10, 0.02))
    silver_mat = add_metallic_material(gltf, "Seraphina_Silver", [0.90, 0.94, 1.0, 1.0], metallic=0.88, roughness=0.14, emissive=(0.24, 0.28, 0.38))
    gem_mat = add_metallic_material(gltf, "Seraphina_Amethyst", [0.64, 0.34, 1.0, 1.0], metallic=0.22, roughness=0.10, emissive=(0.35, 0.12, 0.65))

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

    # 1. Silver Teardrop Chandelier Earrings on J_Bip_C_Head
    ear_parts = []
    for sx in (-1.0, 1.0):
        ex = sx * 0.083
        vp1, vn1, ti1 = build_uv_sphere_or_teardrop(ex, 0.035, 0.007, 0.0030, 0.0030, 0.0030, 6, 8, False)
        vp2, vn2, ti2 = build_uv_sphere_or_teardrop(ex, 0.018, 0.011, 0.0054, 0.0108, 0.0044, 8, 12, True)
        ear_parts.append((vp1, vn1, ti1, silver_mat))
        ear_parts.append((vp2, vn2, ti2, silver_mat))
    add_child_mesh(("J_Bip_C_Head", "Head"), "Seraphina_Earrings", ear_parts)

    # 2. Gold Chain + Amethyst Pendant on J_Bip_C_UpperChest
    cp, cn, ci = build_necklace_chain()
    bp, bn, bi = build_uv_sphere_or_teardrop(0.0, 0.069, 0.084, 0.0092, 0.0125, 0.0048, 8, 12, False)
    gp, gn, gi = build_uv_sphere_or_teardrop(0.0, 0.069, 0.087, 0.0068, 0.0100, 0.0046, 8, 12, True)
    add_child_mesh(("J_Bip_C_UpperChest", "UpperChest"), "Seraphina_Pendant", [
        (cp, cn, ci, gold_mat),
        (bp, bn, bi, gold_mat),
        (gp, gn, gi, gem_mat),
    ])


# ============================================================================
# GEOMETRY SCULPTING (ROYAL BODYCON GOWN)
# ============================================================================

def sculpt_seraphina_geometry(gltf, slices):
    """
    Sculpts the Royal Gown to fit tightly and optimally to the model:
    - Removes maid apron, collar frills, and extra shoe frills.
    - Outer gown (Tops_01_CLOTH_02) & underskirt (Tops_01_CLOTH_03) stretched to floor length.
    - Tailored bodycon sheath silhouette: hugs waist, hips, and glutes closely without balloon flare.
    - Front-left leg slit opens cleanly.
    - Preserves 100% of Face and Body skin geometry from 1real.vrm intact!
    """
    body = next(m for m in gltf["meshes"] if "Body" in m.get("name", ""))
    prims = body["primitives"]

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
            pos = get_accessor_np(gltf, slices, pr["attributes"]["POSITION"]).copy()

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
            # Remove underarm sleeve underside triangles
            is_sleeve_tri = ((tri_uv[:, 0] < 0.258) | (tri_uv[:, 0] > 0.742)) & (tri_uv[:, 1] < 0.318)
            drop_sleeve_tri = is_sleeve_tri & (tri_pos[:, 1] < 0.905)
            set_accessor_np(gltf, slices, pr["indices"], tris[~drop_sleeve_tri].reshape(-1).astype(idx.dtype))

    # Tailored bodycon skirt stretch
    def stretch_skirt(v_indices, waist_y=0.778, new_hem_y=0.048, inset=1.0):
        if v_indices is None:
            return
        y = pos[v_indices, 1]
        vi = v_indices[y < waist_y]
        sy = pos[vi, 1]
        s = np.clip((waist_y - sy) / max(1e-4, waist_y - 0.415), 0.0, 1.0)
        pos[vi, 1] = waist_y - (waist_y - new_hem_y) * (s ** 1.04)

        # Form-fitting bodycon nodes: hugs waist/hips/glutes closely, slender leg sheath, no tent flare
        nodes_s = np.array([0.00, 0.15, 0.30, 0.50, 0.70, 0.85, 1.00])
        nodes_rx = np.array([0.98, 1.00, 0.92, 0.68, 0.50, 0.44, 0.42]) * inset
        nodes_rz = np.array([0.98, 1.02, 0.94, 0.70, 0.52, 0.46, 0.44]) * inset

        scale_x = np.interp(s, nodes_s, nodes_rx)
        scale_z = np.interp(s, nodes_s, nodes_rz)
        pos[vi, 0] *= scale_x
        pos[vi, 2] *= scale_z

    stretch_skirt(skirt_outer_v, waist_y=0.778, new_hem_y=0.048, inset=1.0)
    stretch_skirt(skirt_inner_v, waist_y=0.778, new_hem_y=0.052, inset=0.982)

    # Update body primitives list (without maid apron/frills)
    body["primitives"] = keep_prims
    set_accessor_np(gltf, slices, prims[0]["attributes"]["POSITION"], pos)

    return main_dress_mat_name, underskirt_mat_name


# ============================================================================
# MAIN COMPILATION PIPELINE
# ============================================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", default=r"c:\extensions\anime wifu\assets\models\1real.vrm")
    parser.add_argument("output", nargs="?", default=r"c:\extensions\anime wifu\assets\models\seraphina.vrm")
    parser.add_argument("--max_tex", type=int, default=2048)
    args = parser.parse_args()

    print(f"Reading base VRM: {args.input}")
    with open(args.input, "rb") as f:
        data = f.read()

    gltf, bin_bytes, extra = parse_vrm(data)
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

    # 1. Geometry Sculpting: Tailored Royal Bodycon Evening Gown
    main_dress_mat_name, underskirt_mat_name = sculpt_seraphina_geometry(gltf, slices)

    # 2. Attach Jewelry: Silver Chandelier Earrings & Gold+Amethyst Pendant
    attach_jewelry_nodes(gltf, slices)

    # 3. Apply Seraphina Palette across all materials
    edited_imgs = set()
    for mname, (mat, img_idx) in mat_img_map.items():
        mtoon = (mat.get("extensions") or {}).get("VRMC_materials_mtoon")

        if "Body_00_SKIN" in mname:
            body_pil = style_body_stockings(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(body_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.94, 0.70, 0.65]
                mtoon["shadingToonyFactor"] = 0.35
                mtoon["shadingShiftFactor"] = -0.05
        elif "Face_00_SKIN" in mname:
            # Luminous ivory-peach skin, rose lips, blush, beauty mark
            # Keeps unit normals and material definition intact (zero black face!)
            face_pil = style_face_skin(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(face_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.94, 0.70, 0.65]
                mtoon["shadingToonyFactor"] = 0.35
                mtoon["shadingShiftFactor"] = -0.05
                mtoon["outlineWidthMode"] = "worldCoordinates"
                mtoon["outlineWidthFactor"] = 0.0008
        elif "EyeIris" in mname:
            iris_pil = style_eye_iris(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(iris_pil, args.max_tex))
            edited_imgs.add(img_idx)
        elif "FaceEyeline" in mname or "FaceEyelash" in mname:
            el_pil = style_eyeline_plum(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(el_pil, args.max_tex))
            edited_imgs.add(img_idx)
        elif "FaceBrow" in mname:
            brow_pil = style_eyebrow(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(brow_pil, args.max_tex))
            edited_imgs.add(img_idx)
        elif "Hair_00_HAIR" in mname or "HairBack_00_HAIR" in mname:
            h_pil = style_hair_silver_lavender(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(h_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.80, 0.76, 0.90]
                mtoon["shadingToonyFactor"] = 0.75
        elif "Shoes_01_CLOTH_01" in mname:
            sh_pil = style_shoes_navy(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(sh_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.55, 0.56, 0.72]
        elif mname == main_dress_mat_name:
            dress_pil = style_main_dress(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(dress_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.60, 0.58, 0.72]
        elif mname == underskirt_mat_name:
            under_pil = style_underskirt(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(under_pil, args.max_tex))
            edited_imgs.add(img_idx)
            if mtoon:
                mtoon["shadeColorFactor"] = [0.58, 0.42, 0.50]

    # Re-pack buffer views and binary chunk
    new_bin = bytearray()
    for bv_idx, bv in enumerate(gltf["bufferViews"]):
        while len(new_bin) % 4 != 0:
            new_bin.append(0)
        bv["byteOffset"] = len(new_bin)
        bv["byteLength"] = len(slices[bv_idx])
        new_bin.extend(slices[bv_idx])
    if gltf.get("buffers"):
        gltf["buffers"][0]["byteLength"] = len(new_bin)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    out_bytes = pack_vrm(gltf, bytes(new_bin), extra)
    with open(args.output, "wb") as f:
        f.write(out_bytes)

    print(f"SERAPHINA_ROYAL_GOWN_OK in_mb={len(data)/1048576:.2f} out_mb={len(out_bytes)/1048576:.2f} out={args.output}")


if __name__ == "__main__":
    main()
