# Seraphina — Your Quick 5-Minute VRoid Studio Checklist

All **100% original textures, color palette, turnaround sheet, Blender optimizer, and 60 FPS Three.js/VRM extension code** are already built!

Everything ready for you:
- **Installer (official Pixiv v2.3.0, SHA256 verified):** `C:\Users\rv941\Downloads\VRoidStudio-v2.3.0-win.exe`
- **3-View Turnaround Reference Sheet:** `c:\extensions\anime wifu\seraphina-kit\seraphina_turnaround_sheet.jpg`
- **Custom Violet Iris Texture (PNG):** `c:\extensions\anime wifu\seraphina-kit\seraphina_iris_violet.png`
- **Exact Hex Color Palette Card:** `c:\extensions\anime wifu\seraphina-kit\seraphina_color_palette.png`
- **VRM Size/FPS Optimizer Script:** `c:\extensions\anime wifu\pipeline\optimize_vrm.py`

---

## Your Steps in VRoid Studio (~5–10 minutes, zero coding)

1. **Install & Open VRoid Studio**
   - Double-click `C:\Users\rv941\Downloads\VRoidStudio-v2.3.0-win.exe` (installation needs no account to create & export a `.vrm`).
   - Click **Create New** → choose **Feminine** base.
   - Keep **`seraphina_turnaround_sheet.jpg`** and **`seraphina_color_palette.png`** open beside it.

2. **Chibi-Anime Body & Face Sliders**
   - **Body → Overall:** Lower height / enlarge head scale slightly (`Head Size` up, `Leg Length` / `Body Proportions` compact) until she matches the ~3.5–4 head semi-chibi silhouette in the turnaround sheet.
   - **Face → Eye Set & Edit Texture:** Choose large rounded anime eyes, click **Iris → Edit Texture → Import**, and pick **`seraphina_iris_violet.png`**.
   - **Face → Skin / Blush / Eyebrow:** Use `#FDE7DF` skin, `#F3A3A8` cheek blush, `#3C2747` brows/lashes.

3. **Silver-Lavender Hair + Physics (`VRMSpringBone`)**
   - Pick **Overall Hair** + **Front Hair** (left-parted swept bangs) + **Back Hair** (long layered locks past waist), tint Base `#D8D2EC` and Shade `#A59BC4`.
   - Under **Hair → Bounce (Hair Physics)** tab, make sure Bone Groups are enabled on the long back & side hair locks so Three.js swings them live at 60 FPS!

4. **Navy + Burgundy + Gold Gown & Stockings**
   - **Outfit → One-Piece Dress → Long Dress (or Custom)** → set main fabric to **`#1F263E`** (Navy), inner lining/side panels to **`#691E35`** (Burgundy), add **`#D8B356`** gold trim / slit border (optionally use alpha erase on the front-left thigh seam to mirror the high slit!).
   - **Accessories:** Small silver earrings + gold pendant necklace (`#D8B356` / `#9D6BFF`).
   - **Legs & Shoes:** Tights/stockings tinted **`#322A32`** (sheer dark) + dark heels **`#242238`**.

5. **Export & Load Into Extension**
   - Top-right **Share icon → Export as VRM** (either **VRM 1.0** or **VRM 0.x** — both work!). Save anywhere, e.g. `seraphina_raw.vrm`.
   - *(Optional compression to shrink 30MB → ~4MB cleanly while keeping 100% of VRM physics & expressions):*
     ```powershell
     python "c:\extensions\anime wifu\pipeline\optimize_vrm.py" "seraphina_raw.vrm" "c:\extensions\anime wifu\assets\models\seraphina.vrm"
     ```
   - Or open the **Seraphina Chrome Extension popup → Companion tab → `Load .VRM`** and select your `.vrm` directly!

