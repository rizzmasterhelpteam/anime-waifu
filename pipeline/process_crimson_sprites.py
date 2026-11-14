"""
Process and Align Crimson 2.5D Action Sprites
- Takes raw character illustrations
- Cuts out pure RGBA with antialiased transparent alpha
- Normalizes scale and feet baseline (feet at y=560) to fit 460x600 canvas
- Generates blink and sip variants with closed-eye expressions
- Saves directly to assets/sprites/crimson/*.png
"""

import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def extract_rgba_cutout(img_path, bg_thresh=25):
    im = Image.open(img_path).convert("RGB")
    gray = im.convert("L")
    w, h = im.size
    arr_gray = np.array(gray)

    filled = gray.copy()
    ImageDraw.floodfill(filled, (0, 0), 0, thresh=bg_thresh)
    ImageDraw.floodfill(filled, (w - 1, 0), 0, thresh=bg_thresh)
    ImageDraw.floodfill(filled, (0, h - 1), 0, thresh=bg_thresh)
    ImageDraw.floodfill(filled, (w - 1, h - 1), 0, thresh=bg_thresh)

    arr_filled = np.array(filled)
    is_bg = (arr_filled == 0) & (arr_gray > 215)
    alpha = np.where(is_bg, 0, 255).astype(np.uint8)

    # Soft 1px edge antialiasing
    alpha_img = Image.fromarray(alpha).filter(ImageFilter.SMOOTH)

    im_rgba = im.convert("RGBA")
    im_rgba.putalpha(alpha_img)
    return im_rgba


def fit_to_canvas(im_rgba, target_h=525, baseline_y=560):
    bbox = im_rgba.getbbox()
    if not bbox:
        return Image.new("RGBA", (460, 600), (0, 0, 0, 0))

    cropped = im_rgba.crop(bbox)
    scale = target_h / float(cropped.height)
    target_w = max(10, int(round(cropped.width * scale)))
    target_h_scaled = int(round(cropped.height * scale))
    resized = cropped.resize((target_w, target_h_scaled), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (460, 600), (0, 0, 0, 0))
    ox = (460 - target_w) // 2
    oy = baseline_y - target_h_scaled
    canvas.paste(resized, (ox, oy), resized)
    return canvas


def make_blink_eyes(sprite_canvas, eye_y_center=180):
    """Generates natural closed smiling eyelashes over eyes for blinking."""
    arr = np.array(sprite_canvas.copy())
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]

    # Find eye irises in facial region (y ~ 160..210, x ~ 180..280)
    # Eyelids close down with soft skin tone + dark lash curve
    eye_box = (yy >= 165) & (yy <= 205) & (xx >= 180) & (xx <= 280)
    is_eye = eye_box & (arr[..., 0] > 180) & (arr[..., 1] < 100) & (arr[..., 2] < 100) # ruby eye
    
    # Replace iris with porcelain skin tone
    skin_col = [252, 235, 230, 255]
    arr[is_eye] = skin_col

    # Draw gentle curved lash line
    out_im = Image.fromarray(arr)
    draw = ImageDraw.Draw(out_im)
    lash_col = (42, 24, 28, 255)
    
    # Left eye lash arch
    draw.arc([198, 178, 224, 194], start=10, end=170, fill=lash_col, width=3)
    # Right eye lash arch
    draw.arc([236, 178, 262, 194], start=10, end=170, fill=lash_col, width=3)

    return out_im

