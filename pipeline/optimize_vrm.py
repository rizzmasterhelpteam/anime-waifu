r"""
Headless VRoid .VRM Optimizer & Inspector for Seraphina Chrome Extension.
Preserves 100% of VRM extensions (Humanoid, Expressions/Visemes, SpringBone physics, MToon materials)
while resizing oversized embedded 2K/4K PNG/JPEG textures cleanly (e.g., to 1024px max),
dramatically cutting file size (often 35MB -> 3-6MB) for instant 60 FPS extension loading.

Usage:
  python "c:\extensions\anime wifu\pipeline\optimize_vrm.py" "seraphina_raw.vrm" "c:\extensions\anime wifu\assets\models\seraphina.vrm" --max-tex 1024
"""
import argparse
import io
import json
import os
import struct
import sys
from PIL import Image


def parse_glb_chunks(raw_bytes):
    if raw_bytes[:4] != b"glTF":
        raise ValueError("Not a valid GLB/VRM binary file (missing glTF header).")
    version, total_len = struct.unpack("<II", raw_bytes[4:12])
    if version != 2:
        raise ValueError(f"Unsupported glTF version: {version}")
    offset = 12
    json_bytes = None
    bin_bytes = b""
    extra_chunks = []
    while offset < len(raw_bytes):
        chunk_len, chunk_type = struct.unpack("<I4s", raw_bytes[offset : offset + 8])
        chunk_data = raw_bytes[offset + 8 : offset + 8 + chunk_len]
        offset += 8 + chunk_len
        if chunk_type == b"JSON" and json_bytes is None:
            json_bytes = chunk_data
        elif chunk_type == b"BIN\x00":
            bin_bytes = chunk_data
        else:
            extra_chunks.append((chunk_type, chunk_data))
    return json.loads(json_bytes.decode("utf-8")), bin_bytes, extra_chunks


def pack_glb(gltf_json, bin_bytes, extra_chunks):
    json_raw = json.dumps(gltf_json, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    while len(json_raw) % 4 != 0:
        json_raw += b" "
    bin_raw = bytearray(bin_bytes)
    while len(bin_raw) % 4 != 0:
        bin_raw.append(0)

    chunks = [(b"JSON", json_raw), (b"BIN\x00", bytes(bin_raw))]
    for ctype, cdata in extra_chunks:
        padded = bytearray(cdata)
        while len(padded) % 4 != 0:
            padded.append(0)
        chunks.append((ctype, bytes(padded)))

    total_len = 12 + sum(8 + len(d) for _, d in chunks)
    out = bytearray(struct.pack("<4sII", b"glTF", 2, total_len))
    for ctype, cdata in chunks:
        out.extend(struct.pack("<I4s", len(cdata), ctype))
        out.extend(cdata)
    return bytes(out)


def optimize_vrm(input_path, output_path, max_tex=1024):
    raw = open(input_path, "rb").read()
    gltf, bin_bytes, extra_chunks = parse_glb_chunks(raw)

    buffer_views = gltf.get("bufferViews", [])
    images = gltf.get("images", [])

    # Extract each bufferView slice so we can safely replace downscaled image payloads and rebuild buffer 0
    slices = []
    for bv in buffer_views:
        start = bv.get("byteOffset", 0)
        length = bv.get("byteLength", 0)
        slices.append(bytearray(bin_bytes[start : start + length]))

    resized_count = 0
    for img_idx, img_def in enumerate(images):
        bv_idx = img_def.get("bufferView")
        if bv_idx is None or bv_idx >= len(slices):
            continue
        orig_bytes = bytes(slices[bv_idx])
        mime = img_def.get("mimeType", "image/png").lower()
        try:
            pil_img = Image.open(io.BytesIO(orig_bytes))
            w, h = pil_img.size
            if max(w, h) > max_tex:
                scale = max_tex / float(max(w, h))
                nw, nh = max(64, int(round(w * scale))), max(64, int(round(h * scale)))
                pil_img = pil_img.resize((nw, nh), Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                if "jpeg" in mime or "jpg" in mime:
                    pil_img.convert("RGB").save(buf, format="JPEG", quality=90, optimize=True)
                else:
                    pil_img.save(buf, format="PNG", optimize=True)
                new_bytes = buf.getvalue()
                if len(new_bytes) < len(orig_bytes):
                    slices[bv_idx] = bytearray(new_bytes)
                    resized_count += 1
        except Exception as exc:
            print(f"[warn] image {img_idx} skipped: {exc}")

    # Rebuild contiguous BIN chunk aligned to 4 bytes per bufferView
    new_bin = bytearray()
    for bv_idx, bv in enumerate(buffer_views):
        while len(new_bin) % 4 != 0:
            new_bin.append(0)
        bv["byteOffset"] = len(new_bin)
        bv["byteLength"] = len(slices[bv_idx])
        new_bin.extend(slices[bv_idx])

    if gltf.get("buffers"):
        gltf["buffers"][0]["byteLength"] = len(new_bin)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    packed = pack_glb(gltf, bytes(new_bin), extra_chunks)
    with open(output_path, "wb") as f:
        f.write(packed)

    vrm_ver = "VRM 1.0" if "VRMC_vrm" in gltf.get("extensions", {}) else (
        "VRM 0.x" if "VRM" in gltf.get("extensions", {}) else "GLB"
    )
    print(
        f"OPTIMIZE_VRM_OK format={vrm_ver} images_resized={resized_count}/{len(images)} "
        f"in_mb={len(raw)/1048576:.2f} out_mb={len(packed)/1048576:.2f} out={output_path}"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="Input .vrm or .glb path")
    ap.add_argument("output", help="Output optimized .vrm or .glb path")
    ap.add_argument("--max-tex", type=int, default=1024, help="Max texture dimension (default 1024)")
    args = ap.parse_args()
    optimize_vrm(args.input, args.output, args.max_tex)


if __name__ == "__main__":
    main()
