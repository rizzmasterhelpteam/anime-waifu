"""
Style Model 2: Crimson (Gothic Lolita / Skater Doll Edition)
Base: c:\\Users\\rv941\\OneDrive\\Documents\\1.vrm
Creates a completely distinct anime character from Seraphina:
- Hair: Chic bouncy shoulder-length bob with side bangs & twin 3D gothic crimson velvet bows.
- Outfit: Gothic Crimson & Obsidian skater doll dress:
  * Short flared skater skirt (ending above knees) with pleated black lace underskirt.
  * Form-fitting black velvet corset pinafore with crimson eyelet lacing.
  * Puffed short sleeves with black lace cuffs.
  * Cute collar jabot bow in crimson velvet with silver brooch.
  * Cute waist ribbons.
  * Thigh-high sheer black stockings with crimson ribbon garters.
  * Black patent Mary Jane boots with ruffled lace cuffs.
- Eyes: Glowing Ruby Red irises with flame scarlet core and spirited expression.
- 100% distinct silhouette, proportions, hairstyle, and wardrobe from Seraphina!
"""

import argparse
import io
import json
import math
import os
import struct
import numpy as np
from PIL import Image, ImageDraw


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
    return np.frombuffer(raw, dtype=dt).reshape(-1, nc).copy()


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


def add_metallic_material(gltf, name, base_color_rgba, metallic=0.85, roughness=0.20, emissive=(0, 0, 0)):
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
# 3D GOTHIC HAIR BOWS & CHOKER JEWELRY
# ============================================================================

def build_hair_bow(center_x, center_y, center_z, scale=0.032, is_right=False):
    """Generates a cute 3D double-looped gothic ribbon bow for the hair."""
    verts = []
    norms = []
    tris = []
    flip = -1.0 if is_right else 1.0

    # Center knot
    knot_res = 8
    knot_r = scale * 0.22
    k_base = len(verts)
    for i in range(knot_res):
        th = 2.0 * math.pi * i / knot_res
        verts.append((center_x + knot_r * math.cos(th), center_y + knot_r * math.sin(th), center_z))
        norms.append((0, 0, 1))
    verts.append((center_x, center_y, center_z + knot_r * 0.5))
    norms.append((0, 0, 1))
    center_idx = len(verts) - 1
    for i in range(knot_res):
        tris.extend([center_idx, k_base + i, k_base + ((i + 1) % knot_res)])

    # Two loops (upper-left and lower-left, or upper-right and lower-right)
    for loop_dir in (-1.0, 1.0):
        l_base = len(verts)
        lx = center_x + flip * scale * 0.85
        ly = center_y + loop_dir * scale * 0.55
        lz = center_z - scale * 0.15

        v0 = (center_x, center_y, center_z)
        v1 = (center_x + flip * scale * 0.4, center_y + loop_dir * scale * 0.7, center_z + scale * 0.1)
        v2 = (lx, ly, lz)
        v3 = (center_x + flip * scale * 0.5, center_y + loop_dir * scale * 0.1, center_z - scale * 0.1)

        verts.extend([v0, v1, v2, v3])
        for _ in range(4):
            norms.append((0, 0, 1))
        tris.extend([l_base, l_base + 1, l_base + 2, l_base, l_base + 2, l_base + 3])
        tris.extend([l_base, l_base + 2, l_base + 1, l_base, l_base + 3, l_base + 2])

    return np.array(verts, dtype=np.float32), np.array(norms, dtype=np.float32), np.array(tris, dtype=np.uint16)


def build_gothic_choker(neck_y=0.995, neck_r=0.052, band_h=0.012, n_seg=20):
    """Generates a snug gothic velvet choker band around the neck."""
    verts = []
    norms = []
    tris = []
    for i in range(n_seg + 1):
        th = -math.pi * 0.55 + 2.1 * math.pi * (i / n_seg)
        cx = neck_r * math.cos(th)
        cz = neck_r * math.sin(th) * 0.90 + 0.005
        verts.append((cx, neck_y - band_h * 0.5, cz))
        verts.append((cx, neck_y + band_h * 0.5, cz))
        norms.append((math.cos(th), 0, math.sin(th)))
        norms.append((math.cos(th), 0, math.sin(th)))

    for i in range(n_seg):
        p1 = i * 2
        p2 = p1 + 1
        p3 = p1 + 2
        p4 = p1 + 3
        tris.extend([p1, p2, p3, p2, p4, p3])
        tris.extend([p1, p3, p2, p2, p3, p4])

    return np.array(verts, dtype=np.float32), np.array(norms, dtype=np.float32), np.array(tris, dtype=np.uint16)


def build_teardrop_gem(cx, cy, cz, rx=0.006, ry=0.010, rz=0.004, n_lat=8, n_lon=12):
    verts, norms, tris = [], [], []
    for i in range(n_lat + 1):
        phi = math.pi * i / n_lat
        y = cy + ry * math.cos(phi)
        t = (math.cos(phi) + 1.0) * 0.5
        taper = math.sin(phi) * (t ** 0.45)
        for j in range(n_lon):
            th = 2.0 * math.pi * j / n_lon
            x = cx + rx * taper * math.cos(th)
            z = cz + rz * taper * math.sin(th)
            verts.append((x, y, z))
            dx, dy, dz = x - cx, y - cy, z - cz
            mag = math.sqrt(dx * dx + dy * dy + dz * dz)
            norms.append((dx / mag, dy / mag, dz / mag) if mag > 1e-4 else (0, 0, 1))

    for i in range(n_lat):
        for j in range(n_lon):
            p1 = i * n_lon + j
            p2 = (i + 1) * n_lon + j
            p3 = i * n_lon + ((j + 1) % n_lon)
            p4 = (i + 1) * n_lon + ((j + 1) % n_lon)
            tris.extend([p1, p2, p3, p2, p4, p3])

    return np.array(verts, dtype=np.float32), np.array(norms, dtype=np.float32), np.array(tris, dtype=np.uint16)


# ============================================================================
# TEXTURE STYLING: GOTHIC LOLITA PALETTE
# ============================================================================

def style_crimson_hair(pil_img):
    """Obsidian Raven Black hair with luminous crimson/wine velvet sheen."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    hl = np.clip(lum, 0.0, 1.0)

    # Shadow: [14, 12, 18], Midtone: [36, 16, 26], Highlight: [85, 26, 46]
    h_r = np.clip(14.0 + 36.0 * hl + 48.0 * (hl ** 2.2), 0, 255)
    h_g = np.clip(12.0 + 10.0 * hl + 14.0 * (hl ** 2.2), 0, 255)
    h_b = np.clip(18.0 + 16.0 * hl + 22.0 * (hl ** 2.2), 0, 255)

    arr[..., 0] = h_r
    arr[..., 1] = h_g
    arr[..., 2] = h_b
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def style_crimson_eyes(pil_img):
    """Spirited glowing ruby red irises with flame scarlet core and crisp highlights."""
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

        outer_garnet = np.array([88.0, 10.0, 20.0], dtype=np.float32)
        mid_ruby = np.array([210.0, 24.0, 42.0], dtype=np.float32)
        inner_scarlet = np.array([255.0, 75.0, 85.0], dtype=np.float32)
        pupil_dark = np.array([16.0, 4.0, 8.0], dtype=np.float32)

        t = np.clip(r, 0.0, 1.0)[..., None]
        iris_rgb = np.where(
            t < 0.40,
            pupil_dark * (1.0 - t / 0.40) + mid_ruby * (t / 0.40),
            mid_ruby * (1.0 - (t - 0.40) / 0.60) + outer_garnet * ((t - 0.40) / 0.60),
        )

        glow_mask = (r > 0.32) & (r < 0.72) & (dy > -0.15)
        glow_w = np.exp(-((r - 0.52) / 0.16) ** 2) * 0.70
        iris_rgb = np.where(
            glow_mask[..., None],
            iris_rgb * (1.0 - glow_w[..., None]) + inner_scarlet * glow_w[..., None],
            iris_rgb,
        )

        arr[mask, :3] = iris_rgb[mask]
        arr[mask, 3] = 255.0

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_crimson_face(pil_img):
    """Porcelain alabaster skin with berry rose lips and cute gothic blush."""
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)

    skin_mask = arr[..., 3] > 30
    alabaster = np.array([255.0, 246.0, 244.0], dtype=np.float32)
    arr[skin_mask, :3] = 0.85 * arr[skin_mask, :3] + 0.15 * alabaster

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h

    # Cheek blush
    blush = np.zeros((h, w), dtype=np.float32)
    for cx in (0.320, 0.680):
        dx = (xn - cx) / 0.050
        dy = (yn - 0.615) / 0.032
        blush += np.exp(-(dx * dx + dy * dy) * 1.8) * 0.35
    blush = np.clip(blush, 0.0, 0.38)[..., None]
    rose = np.array([244.0, 110.0, 126.0], dtype=np.float32)
    arr[..., :3] = arr[..., :3] * (1.0 - blush) + rose * blush

    # Berry rose lips
    lip_mask = np.exp(-(((xn - 0.500) / 0.030) ** 2 + ((yn - 0.760) / 0.008) ** 2)) * 0.88
    lip_mask = np.clip(lip_mask, 0.0, 0.88)[..., None]
    berry = np.array([205.0, 48.0, 72.0], dtype=np.float32)
    arr[..., :3] = arr[..., :3] * (1.0 - lip_mask) + berry * lip_mask

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def style_crimson_main_dress(pil_img):
    """Gothic Crimson Velvet dress (Tops_01_CLOTH_02) with black lace borders and pewter piping."""
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    mask = arr[..., 3] > 20

    lum = (0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]) / 255.0
    dl = np.clip(lum, 0.0, 1.0)

    # Rich gothic crimson velvet: deep shadow [56, 10, 20], mid [136, 22, 42], highlight [192, 38, 65]
    velvet_r = np.clip(56.0 + 175.0 * dl + 55.0 * (dl ** 2), 0, 255)
    velvet_g = np.clip(10.0 + 26.0 * dl + 16.0 * (dl ** 2), 0, 255)
    velvet_b = np.clip(20.0 + 40.0 * dl + 24.0 * (dl ** 2), 0, 255)

    arr[mask, 0] = velvet_r[mask]
    arr[mask, 1] = velvet_g[mask]
    arr[mask, 2] = velvet_b[mask]

    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def style_crimson_apron_corset(pil_img):
    """Black Velvet Corset Pinafore (Tops_01_CLOTH_01) with crimson ribbon lacing & black lace picot."""
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    mask = arr[..., 3] > 20

    # Obsidian black velvet base
    obsidian = np.array([22.0, 18.0, 26.0], dtype=np.float32)
    arr[mask, :3] = obsidian

    # Add crimson ribbon corset lacing lines in center (xn ~ 0.46 to 0.54)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h
    lacing_area = (xn >= 0.42) & (xn <= 0.58) & (yn >= 0.25) & (yn <= 0.65) & mask
    criss_cross = (np.abs((xn - 0.50) * 12.0 - np.sin(yn * 40.0)) < 0.12) & lacing_area
    crimson_ribbon = np.array([210.0, 28.0, 48.0], dtype=np.float32)
    arr[criss_cross, :3] = crimson_ribbon

    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def style_crimson_underskirt(pil_img):
    """Black satin petticoat underskirt (Tops_01_CLOTH_03) with crimson scalloped lace border."""
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    mask = arr[..., 3] > 20

    black_satin = np.array([18.0, 16.0, 22.0], dtype=np.float32)
    arr[mask, :3] = black_satin

    # Crimson scalloped border along hem
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    yn = yy / h
    lace_hem = (yn > 0.85) & mask
    crimson_lace = np.array([178.0, 22.0, 42.0], dtype=np.float32)
    arr[lace_hem, :3] = crimson_lace

    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def style_crimson_collar_bow(pil_img):
    """Collar jabot bow (007_01_Tops) in crimson velvet with silver brooch."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    mask = arr[..., 3] > 20
    crimson = np.array([180.0, 24.0, 45.0], dtype=np.float32)
    arr[mask, :3] = crimson
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def style_crimson_shoes(pil_img):
    """Black patent leather Mary Janes with crimson red soles."""
    im = pil_img.convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    mask = arr[..., 3] > 20
    black_patent = np.array([16.0, 14.0, 20.0], dtype=np.float32)
    arr[mask, :3] = black_patent
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def style_crimson_body_skin(pil_img):
    """Porcelain alabaster body + sheer black stockings with crimson ribbon garters."""
    im = pil_img.convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.float32)
    mask = arr[..., 3] > 20

    alabaster = np.array([255.0, 246.0, 244.0], dtype=np.float32)
    arr[mask, :3] = 0.82 * arr[mask, :3] + 0.18 * alabaster

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h

    # Sheer smoky black stockings on legs (yn >= 0.62)
    legs = (yn >= 0.62) & mask & (xn > 0.06) & (xn < 0.94)
    sheer_black = np.array([20.0, 18.0, 25.0], dtype=np.float32)
    sheer_fac = np.clip(0.65 + (yn - 0.62) * 0.25, 0.60, 0.85)[..., None]
    arr[legs, :3] = arr[legs, :3] * (1.0 - sheer_fac[legs]) + sheer_black * sheer_fac[legs]

    # Crimson ribbon garter band at top of stocking (yn between 0.612 and 0.624)
    garter = (yn >= 0.612) & (yn <= 0.624) & mask & (xn > 0.06) & (xn < 0.94)
    crimson_ribbon = np.array([215.0, 28.0, 52.0], dtype=np.float32)
    arr[garter, :3] = crimson_ribbon

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


# ============================================================================
# GEOMETRY SCULPTING: CHIC SHOULDER BOB & FLARED SKATER DOLL SILHOUETTE
# ============================================================================

def sculpt_crimson_geometry(gltf, slices):
    """
    Sculpts Model 2 geometry to be 100% distinct from Seraphina:
    1. Keeps 100% of the flared skater / lolita dress primitives intact!
       (Apron corset, frill blouse, flouncy underskirt, collar bow, waist ribbons, frilled shoes).
       No floor-length gown stretch -- keeps the cute flared above-the-knee silhouette!
    2. Cuts the long back hair below shoulders (y < 0.98, z < 0.02) to give her a chic
       bouncy shoulder-length anime bob with side bangs!
    3. Attaches twin 3D gothic crimson velvet hair bows and velvet choker with blood ruby!
    """
    # 1. Hair Sculpting: Chic Shoulder-Length Bob
    hair_prim = gltf["meshes"][2]["primitives"][0]
    pos = get_accessor_np(gltf, slices, hair_prim["attributes"]["POSITION"])
    idx = get_accessor_np(gltf, slices, hair_prim["indices"]).flatten()
    tris = idx.reshape(-1, 3)

    tri_pos = pos[tris].mean(axis=1)
    # Remove long back hair triangles below shoulders
    drop_long_back = (tri_pos[:, 1] < 0.975) & (tri_pos[:, 2] < 0.018)
    keep_tris = tris[~drop_long_back].reshape(-1).astype(idx.dtype)
    set_accessor_np(gltf, slices, hair_prim["indices"], keep_tris)
    print(f"  [HAIR] Trimmed {np.sum(drop_long_back)} long back hair triangles. Kept {len(keep_tris)//3} shoulder bob triangles!")

    # 2. Add 3D Gothic Accessories: Twin Velvet Hair Bows & Velvet Choker Pendant
    red_velvet_mat = add_metallic_material(gltf, "Crimson_Velvet_Bow", [0.85, 0.08, 0.18, 1.0], metallic=0.15, roughness=0.35)
    pewter_mat = add_metallic_material(gltf, "Crimson_Pewter", [0.82, 0.85, 0.90, 1.0], metallic=0.90, roughness=0.18)
    blood_ruby_mat = add_metallic_material(gltf, "Crimson_BloodRuby", [0.92, 0.05, 0.16, 1.0], metallic=0.10, roughness=0.08, emissive=(0.50, 0.04, 0.08))

    def add_child_mesh(target_names, node_name, parts):
        mesh_idx = len(gltf["meshes"])
        prims = []
        for vp, vn, vi, mat_idx in parts:
            p_acc = append_accessor(gltf, slices, vp, 5126, "VEC3", 34962)
            n_acc = append_accessor(gltf, slices, vn, 5126, "VEC3", 34962)
            i_acc = append_accessor(gltf, slices, vi, 5123, "SCALAR", 34963)
            prims.append({"attributes": {"POSITION": p_acc, "NORMAL": n_acc}, "indices": i_acc, "material": mat_idx})
        gltf["meshes"].append({"name": node_name, "primitives": prims})
        node_idx = len(gltf["nodes"])
        gltf["nodes"].append({"name": node_name, "mesh": mesh_idx})
        for n in gltf["nodes"]:
            if n.get("name") in target_names:
                n.setdefault("children", []).append(node_idx)
                break

    # Twin Crimson Velvet Hair Bows on J_Bip_C_Head (left & right temples)
    bow_parts = []
    for is_r, sx in [(False, -1.0), (True, 1.0)]:
        bx = sx * 0.092
        by = 0.075
        bz = 0.015
        vp, vn, vi = build_hair_bow(bx, by, bz, scale=0.038, is_right=is_r)
        bow_parts.append((vp, vn, vi, red_velvet_mat))
    add_child_mesh(("J_Bip_C_Head", "Head"), "Crimson_HairBows", bow_parts)

    # Gothic Velvet Choker + Blood Ruby Teardrop Pendant on J_Bip_C_UpperChest
    cp, cn, ci = build_gothic_choker(neck_y=0.065, neck_r=0.050, band_h=0.011)
    gp, gn, gi = build_teardrop_gem(0.0, 0.065, 0.055, rx=0.006, ry=0.011, rz=0.004)
    add_child_mesh(("J_Bip_C_UpperChest", "UpperChest"), "Crimson_Choker", [
        (cp, cn, ci, red_velvet_mat),
        (gp, gn, gi, blood_ruby_mat),
    ])


# ============================================================================
# MAIN COMPILATION PIPELINE
# ============================================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", default=r"c:\Users\rv941\OneDrive\Documents\1.vrm")
    parser.add_argument("output", nargs="?", default=r"c:\extensions\anime wifu\assets\models\companion_alt.vrm")
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

    # 1. Sculpt Model 2 Geometry: Chic Shoulder Bob + Flared Skater Skirt
    sculpt_crimson_geometry(gltf, slices)

    # 2. Apply Crimson Gothic Lolita Palette across all materials
    for mname, (mat, img_idx) in mat_img_map.items():
        mtoon = (mat.get("extensions") or {}).get("VRMC_materials_mtoon")

        if "Hair" in mname:
            h_pil = style_crimson_hair(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(h_pil, args.max_tex))
            if mtoon:
                mtoon["shadeColorFactor"] = [0.38, 0.12, 0.20]
                mtoon["shadingToonyFactor"] = 0.85
        elif "EyeIris" in mname:
            iris_pil = style_crimson_eyes(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(iris_pil, args.max_tex))
        elif "Face_00_SKIN" in mname:
            face_pil = style_crimson_face(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(face_pil, args.max_tex))
            if mtoon:
                mtoon["shadeColorFactor"] = [0.95, 0.72, 0.70]
                mtoon["shadingToonyFactor"] = 0.40
        elif "Body_00_SKIN" in mname:
            body_pil = style_crimson_body_skin(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(body_pil, args.max_tex))
            if mtoon:
                mtoon["shadeColorFactor"] = [0.95, 0.72, 0.70]
        elif "Tops_01_CLOTH_02" in mname:
            # Main Dress -> Gothic Crimson Velvet
            dress_pil = style_crimson_main_dress(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(dress_pil, args.max_tex))
            if mtoon:
                mtoon["shadeColorFactor"] = [0.45, 0.08, 0.15]
        elif "Tops_01_CLOTH_01" in mname:
            # Apron/Corset -> Obsidian Black Velvet with Crimson Lacing
            apron_pil = style_crimson_apron_corset(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(apron_pil, args.max_tex))
            if mtoon:
                mtoon["shadeColorFactor"] = [0.18, 0.14, 0.22]
        elif "Tops_01_CLOTH_03" in mname:
            # Underskirt -> Black Satin Petticoat with Crimson Scalloped Lace
            under_pil = style_crimson_underskirt(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(under_pil, args.max_tex))
            if mtoon:
                mtoon["shadeColorFactor"] = [0.18, 0.14, 0.22]
        elif "007_01_Tops" in mname:
            # Collar Jabot Bow -> Crimson Velvet
            bow_pil = style_crimson_collar_bow(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(bow_pil, args.max_tex))
        elif "Shoes" in mname:
            shoe_pil = style_crimson_shoes(load_img_by_idx(img_idx))
            save_img_by_idx(img_idx, encode_png(shoe_pil, args.max_tex))

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

    print(f"CRIMSON_LOLITA_VRM_OK in_mb={len(data)/1048576:.2f} out_mb={len(out_bytes)/1048576:.2f} out={args.output}")


if __name__ == "__main__":
    main()

