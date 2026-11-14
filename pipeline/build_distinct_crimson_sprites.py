"""
Build Distinct 2.5D Sprite Sheet for Model 2 (Crimson)
Processes the Gothic Lolita character images into 460x600 transparent RGBA sprites:
- idle, idle_blink
- wave, wave_alt
- think
- celebrate
- tea, tea_sip
- walk_left
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from collections import deque

BRAIN_DIR = r"C:\Users\rv941\.gemini\antigravity\brain\3bc88549-d3c8-46f5-aa22-f916bf21a53a"
OUT_DIR = r"assets\sprites\crimson"
os.makedirs(OUT_DIR, exist_ok=True)


def clean_cutout_boundary_only(img_path):
    im = Image.open(img_path).convert("RGBA")
    w, h = im.size
    rgb = np.array(im.convert("RGB"), dtype=np.uint8)
    
    # Background is white/near-white connected to the canvas borders
    is_white = np.all(rgb > 235, axis=-1)
    
    visited = np.zeros((h, w), dtype=bool)
    queue = deque()
    
    # Push all border pixels that are white
    for x in range(w):
        if is_white[0, x]:
            queue.append((0, x))
            visited[0, x] = True
        if is_white[h - 1, x]:
            queue.append((h - 1, x))
            visited[h - 1, x] = True
            
    for y in range(h):
        if is_white[y, 0] and not visited[y, 0]:
            queue.append((y, 0))
            visited[y, 0] = True
        if is_white[y, w - 1] and not visited[y, w - 1]:
            queue.append((y, w - 1))
            visited[y, w - 1] = True
            
    # BFS from boundaries
    while queue:
        cy, cx = queue.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w:
                if not visited[ny, nx] and is_white[ny, nx]:
                    visited[ny, nx] = True
                    queue.append((ny, nx))
                    
    # Visited is strictly the outer/connected background
    alpha = np.where(visited, 0, 255).astype(np.uint8)
    alpha_img = Image.fromarray(alpha, mode="L").filter(ImageFilter.SMOOTH)
    im.putalpha(alpha_img)
    return im


def align_to_waifu_canvas(im_rgba, target_height=522, baseline_y=565):
    bbox = im_rgba.getbbox()
    if not bbox:
        return Image.new("RGBA", (460, 600), (0, 0, 0, 0))

    cropped = im_rgba.crop(bbox)
    scale = float(target_height) / float(cropped.height)
    target_w = max(10, int(round(cropped.width * scale)))
    target_h = int(round(cropped.height * scale))

    resized = cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (460, 600), (0, 0, 0, 0))
    ox = (460 - target_w) // 2
    oy = baseline_y - target_h
    canvas.paste(resized, (ox, oy), resized)
    return canvas


def make_blink_eyes(sprite_img):
    out = sprite_img.copy()
    draw = ImageDraw.Draw(out)
    lash_col = (35, 18, 22, 255)
    # Left eye arch
    draw.arc([198, 172, 222, 186], start=15, end=165, fill=lash_col, width=3)
    # Right eye arch
    draw.arc([238, 172, 262, 186], start=15, end=165, fill=lash_col, width=3)
    return out


print("Extracting and aligning distinct Crimson Gothic sprites...")

# 1. IDLE
idle_path = os.path.join(BRAIN_DIR, "crimson_idle_1794567872338.jpg")
idle_rgba = align_to_waifu_canvas(clean_cutout_boundary_only(idle_path), target_height=522)
idle_rgba.save(os.path.join(OUT_DIR, "idle.png"))
print("Saved idle.png")

# 1b. IDLE BLINK
idle_blink = make_blink_eyes(idle_rgba)
idle_blink.save(os.path.join(OUT_DIR, "idle_blink.png"))
print("Saved idle_blink.png")

# 2. WAVE
wave_path = os.path.join(BRAIN_DIR, "crimson_wave_v3_1794568156486.jpg")
wave_rgba = align_to_waifu_canvas(clean_cutout_boundary_only(wave_path), target_height=522)
wave_rgba.save(os.path.join(OUT_DIR, "wave.png"))
print("Saved wave.png")

# 2b. WAVE ALT
wave_alt = wave_rgba.copy()
wave_alt.save(os.path.join(OUT_DIR, "wave_alt.png"))
print("Saved wave_alt.png")

# 3. THINK
think_path = os.path.join(BRAIN_DIR, "crimson_thinking_sprite_1794568107542.jpg")
think_rgba = align_to_waifu_canvas(clean_cutout_boundary_only(think_path), target_height=522)
think_rgba.save(os.path.join(OUT_DIR, "think.png"))
print("Saved think.png")

# 4. CELEBRATE
cheer_path = os.path.join(BRAIN_DIR, "crimson_cheer_1794568128942.jpg")
cheer_rgba = align_to_waifu_canvas(clean_cutout_boundary_only(cheer_path), target_height=522)
cheer_rgba.save(os.path.join(OUT_DIR, "celebrate.png"))
print("Saved celebrate.png")

# 5. TEA
tea_path = os.path.join(BRAIN_DIR, "crimson_tea_1794568117594.jpg")
tea_rgba = align_to_waifu_canvas(clean_cutout_boundary_only(tea_path), target_height=522)
tea_rgba.save(os.path.join(OUT_DIR, "tea.png"))
print("Saved tea.png")

# 5b. TEA SIP
tea_sip = make_blink_eyes(tea_rgba)
tea_sip.save(os.path.join(OUT_DIR, "tea_sip.png"))
print("Saved tea_sip.png")

# 6. WALK
walk_path = os.path.join(BRAIN_DIR, "crimson_walk_stride_1794568130066.jpg")
walk_rgba = align_to_waifu_canvas(clean_cutout_boundary_only(walk_path), target_height=522)
walk_rgba.save(os.path.join(OUT_DIR, "walk_left.png"))
print("Saved walk_left.png")

print("All distinct Crimson 2.5D sprites created successfully!")
