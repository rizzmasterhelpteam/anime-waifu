import os
from PIL import Image, ImageDraw, ImageFont

BRAIN_DIR = r"C:\Users\rv941\.gemini\antigravity\brain\3bc88549-d3c8-46f5-aa22-f916bf21a53a"

# Load 2D Sprites
s_2d = Image.open(r"assets\sprites\idle.png").convert("RGBA")
c_2d = Image.open(r"assets\sprites\crimson\idle.png").convert("RGBA")

# Load 3D Renders
s_3d = Image.open(r"pipeline\rendered_seraphina_face.png").convert("RGBA")
c_3d = Image.open(os.path.join(BRAIN_DIR, "companion_alt_rendered.png")).convert("RGBA")

# Create a clean presentation board: 1200 x 800 with dark aesthetic background
board = Image.new("RGBA", (1200, 800), (18, 20, 28, 255))
draw = ImageDraw.Draw(board)

# Draw Title Header
# Let's crop 3D renders nicely
# Seraphina 3D crop
s_3d_crop = s_3d.crop((120, 0, 680, 750)).resize((280, 480), Image.Resampling.LANCZOS)
c_3d_crop = c_3d.crop((120, 0, 680, 750)).resize((280, 480), Image.Resampling.LANCZOS)

s_2d_scaled = s_2d.resize((280, 480), Image.Resampling.LANCZOS)
c_2d_scaled = c_2d.resize((280, 480), Image.Resampling.LANCZOS)

# Layout:
# Col 1: Seraphina 2.5D (x=40, y=140)
# Col 2: Seraphina 3D   (x=320, y=140)
# Col 3: Crimson 2.5D   (x=620, y=140)
# Col 4: Crimson 3D     (x=900, y=140)

# Card backgrounds
draw.rounded_rectangle([30, 80, 590, 760], radius=16, fill=(28, 30, 42, 255), outline=(70, 80, 120, 255), width=2)
draw.rounded_rectangle([610, 80, 1170, 760], radius=16, fill=(38, 24, 28, 255), outline=(140, 50, 60, 255), width=2)

# Paste characters
board.paste(s_2d_scaled, (40, 140), s_2d_scaled)
board.paste(s_3d_crop, (310, 140), s_3d_crop)

board.paste(c_2d_scaled, (620, 140), c_2d_scaled)
board.paste(c_3d_crop, (890, 140), c_3d_crop)

out_path = os.path.join(BRAIN_DIR, "dual_characters_distinct_showcase.png")
board.save(out_path)
print("Saved showcase:", out_path)

