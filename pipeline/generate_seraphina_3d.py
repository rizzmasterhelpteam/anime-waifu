"""
100% Original Stylized 3D Seraphina Starter Rig Generator (Headless Blender 5.2.2 LTS)
Builds a semi-chibi (~3.8-head) rigged GLB model matching assets/sprites/idle.png,
with VRM-compatible Humanoid bone names, hair/skirt physics chains, blink & expression
shape keys, clean vertex weights, and a TeaCupMount bone + teacup prop.
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector, Euler

OUTPUT_GLB = os.environ.get(
    "SERAPHINA_OUT_GLB",
    r"c:\extensions\anime wifu\assets\models\seraphina_starter.glb",
)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_linear(rgba):
    r, g, b, a = rgba
    return (r ** 2.2, g ** 2.2, b ** 2.2, a)


def make_toon_mat(name, rgba, roughness=0.55, metallic=0.0, emission=None, double_sided=False):
    mat = bpy.data.materials.new(name=name)
    if hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    mat.use_backface_culling = not double_sided
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = srgb_to_linear(rgba)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.28 if metallic == 0 else 0.75
        if emission is not None and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = srgb_to_linear(emission)
            bsdf.inputs["Emission Strength"].default_value = 0.16
    return mat


def set_smooth(obj):
    if obj.type != "MESH":
        return
    for poly in obj.data.polygons:
        poly.use_smooth = True


def assign_single_group(obj, bone_name):
    vg = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
    verts = [v.index for v in obj.data.vertices]
    if verts:
        vg.add(verts, 1.0, "REPLACE")


def assign_gradient_groups(obj, axis_idx, stops):
    """Assign smooth linear weights across z or y stops: [(coord, {bone: weight}), ...]."""
    mesh = obj.data
    vgs = {}
    for _, wmap in stops:
        for bname in wmap:
            if bname not in vgs:
                vgs[bname] = obj.vertex_groups.get(bname) or obj.vertex_groups.new(name=bname)

    for v in mesh.vertices:
        val = (obj.matrix_world @ v.co)[axis_idx]
        if val <= stops[0][0]:
            weights = stops[0][1]
        elif val >= stops[-1][0]:
            weights = stops[-1][1]
        else:
            weights = stops[-1][1]
            for i in range(len(stops) - 1):
                c0, w0 = stops[i]
                c1, w1 = stops[i + 1]
                if c0 <= val <= c1:
                    t = (val - c0) / max(1e-6, (c1 - c0))
                    keys = set(w0.keys()) | set(w1.keys())
                    weights = {k: w0.get(k, 0.0) * (1.0 - t) + w1.get(k, 0.0) * t for k in keys}
                    break
        for bname, w in weights.items():
            if w > 0.001:
                vgs[bname].add([v.index], min(1.0, max(0.0, w)), "REPLACE")


def add_uv_sphere(name, loc, scale, segs=24, rings=16, mat=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        obj.data.materials.append(mat)
    set_smooth(obj)
    return obj


def add_tapered_limb(name, p0, p1, r0, r1, segs=16, rings=6, mat=None):
    v0 = Vector(p0)
    v1 = Vector(p1)
    direction = v1 - v0
    length = direction.length
    bm = bmesh.new()
    for ri in range(rings + 1):
        t = ri / rings
        z = t * length
        rad = r0 * (1.0 - t) + r1 * t
        verts = []
        for si in range(segs):
            ang = 2.0 * math.pi * si / segs
            verts.append(bm.verts.new((rad * math.cos(ang), rad * math.sin(ang), z)))
        if ri > 0:
            prev_ring = bm.verts[-2 * segs : -segs]
            for si in range(segs):
                sn = (si + 1) % segs
                bm.faces.new((prev_ring[si], prev_ring[sn], verts[sn], verts[si]))
    bm.verts.ensure_lookup_table()
    # Cap ends
    bm.faces.new(list(reversed(bm.verts[:segs])))
    bm.faces.new(list(bm.verts[-segs:]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = v0
    if length > 1e-6:
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = direction.normalized().to_track_quat("Z", "Y")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    if mat:
        obj.data.materials.append(mat)
    set_smooth(obj)
    return obj


def add_hair_lock(name, pts_widths, curve_offset_y=0.0, mat=None):
    """Build a sculpted double-sided ribbon/teardrop hair strand from control points [(Vector, width, thickness)]."""
    bm = bmesh.new()
    rings = []
    segs = 8
    for idx, (pt, rx, ry) in enumerate(pts_widths):
        if idx < len(pts_widths) - 1:
            tang = (pts_widths[idx + 1][0] - pt).normalized()
        else:
            tang = (pt - pts_widths[idx - 1][0]).normalized()
        up = Vector((0, 1, 0))
        if abs(tang.dot(up)) > 0.92:
            up = Vector((1, 0, 0))
        side = tang.cross(up).normalized()
        fwd = side.cross(tang).normalized()
        ring = []
        for s in range(segs):
            a = 2.0 * math.pi * s / segs
            offset = side * (math.cos(a) * rx) + fwd * (math.sin(a) * ry + curve_offset_y)
            ring.append(bm.verts.new(pt + offset))
        rings.append(ring)

    for r_idx in range(len(rings) - 1):
        r0 = rings[r_idx]
        r1 = rings[r_idx + 1]
        for s in range(segs):
            sn = (s + 1) % segs
            bm.faces.new((r0[s], r0[sn], r1[sn], r1[s]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(list(rings[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    set_smooth(obj)
    return obj


def build_armature():
    """Standard VRM-style Y-up / Blender Z-up humanoid armature (total height ~1.28m for 3.8-head chibi)."""
    arm_data = bpy.data.armatures.new("SeraphinaArmature")
    arm_obj = bpy.data.objects.new("Armature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(name, head, tail, parent=None, connect=False, roll=0.0):
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        b.roll = roll
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    # Core spine (Z is UP in Blender -> exports clean Y-UP in glTF!)
    # Positive X is character LEFT side (+X left, -Y front face toward viewer!)
    bone("hips", (0, 0, 0.52), (0, 0, 0.60))
    bone("spine", (0, 0, 0.60), (0, 0, 0.72), "hips", True)
    bone("chest", (0, 0, 0.72), (0, 0, 0.85), "spine", True)
    bone("neck", (0, 0, 0.85), (0, 0, 0.91), "chest", True)
    bone("head", (0, 0, 0.91), (0, 0, 1.24), "neck", True)

    # Eyes (placed symmetrically on front -Y side of chibi head)
    bone("leftEye", (0.068, -0.145, 1.045), (0.068, -0.195, 1.045), "head")
    bone("rightEye", (-0.068, -0.145, 1.045), (-0.068, -0.195, 1.045), "head")

    # Arms (A-pose relaxed down ~28 deg)
    bone("leftShoulder", (0.03, 0, 0.81), (0.09, 0, 0.805), "chest")
    bone("leftUpperArm", (0.09, 0, 0.805), (0.185, 0, 0.67), "leftShoulder", True)
    bone("leftLowerArm", (0.185, 0, 0.67), (0.25, -0.025, 0.535), "leftUpperArm", True)
    bone("leftHand", (0.25, -0.025, 0.535), (0.275, -0.035, 0.475), "leftLowerArm", True)

    bone("rightShoulder", (-0.03, 0, 0.81), (-0.09, 0, 0.805), "chest")
    bone("rightUpperArm", (-0.09, 0, 0.805), (-0.185, 0, 0.67), "rightShoulder", True)
    bone("rightLowerArm", (-0.185, 0, 0.67), (-0.25, -0.025, 0.535), "rightUpperArm", True)
    bone("rightHand", (-0.25, -0.025, 0.535), (-0.275, -0.035, 0.475), "rightLowerArm", True)

    # Prop mount for teacup on right hand
    bone("teaCupMount", (-0.265, -0.045, 0.505), (-0.265, -0.045, 0.565), "rightHand")

    # Legs (character left is +X, character right is -X)
    bone("leftUpperLeg", (0.055, 0, 0.50), (0.052, 0, 0.28), "hips")
    bone("leftLowerLeg", (0.052, 0, 0.28), (0.048, 0.01, 0.075), "leftUpperLeg", True)
    bone("leftFoot", (0.048, 0.01, 0.075), (0.048, -0.065, 0.01), "leftLowerLeg", True)

    bone("rightUpperLeg", (-0.055, 0, 0.50), (-0.052, 0, 0.28), "hips")
    bone("rightLowerLeg", (-0.052, 0, 0.28), (-0.048, 0.01, 0.075), "rightUpperLeg", True)
    bone("rightFoot", (-0.048, 0.01, 0.075), (-0.048, -0.065, 0.01), "rightLowerLeg", True)

    # Hair physics chains
    bone("HairBack1", (0, 0.145, 0.96), (0, 0.17, 0.72), "head")
    bone("HairBack2", (0, 0.17, 0.72), (0, 0.185, 0.44), "HairBack1", True)
    bone("HairLeft1", (0.145, 0.02, 0.96), (0.17, 0.03, 0.72), "head")
    bone("HairLeft2", (0.17, 0.03, 0.72), (0.19, 0.04, 0.48), "HairLeft1", True)
    bone("HairRight1", (-0.145, 0.02, 0.96), (-0.17, 0.03, 0.72), "head")
    bone("HairRight2", (-0.17, 0.03, 0.72), (-0.19, 0.04, 0.48), "HairRight1", True)

    # Skirt physics bones
    bone("SkirtFront", (0, -0.06, 0.49), (0, -0.08, 0.20), "hips")
    bone("SkirtBack", (0, 0.07, 0.49), (0, 0.10, 0.16), "hips")

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def build_dress_skirt_with_slit(mat_navy, mat_burgundy, mat_gold):
    """Build Seraphina's navy gown skirt with burgundy side panels, gold trim, and high +X left-leg slit."""
    meshes = []

    # Main skirt shell (wraps around with open front-left +X leg slit below z=0.45)
    bm = bmesh.new()
    z_levels = [0.56, 0.50, 0.42, 0.31, 0.19, 0.09]
    rx_levels = [0.082, 0.096, 0.106, 0.116, 0.132, 0.152]
    ry_levels = [0.064, 0.076, 0.086, 0.098, 0.114, 0.136]
    segs = 28

    # Character faces -Y. Character left leg is +X -> angle around +45 deg from front (-Y) is atan2(x, -y)
    # In polar coords around Z where a=0 is +X, front (-Y) is a=-pi/2 (270 deg), front-left (+X,-Y) is -58 deg
    rings = []
    for zi, z in enumerate(z_levels):
        # Slit opens progressively on front-left (+X, -Y) below z=0.44
        slit_half = max(0.0, (0.44 - z) / 0.35) * 0.46
        slit_center = -math.pi * 0.34  # front-left thigh slit matching idle.png!
        a_start = slit_center + slit_half
        a_end = slit_center + 2.0 * math.pi - slit_half
        ring = []
        for s in range(segs):
            t = s / (segs - 1)
            a = a_start + t * (a_end - a_start)
            x = rx_levels[zi] * math.cos(a)
            y = ry_levels[zi] * math.sin(a)
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)

    for zi in range(len(rings) - 1):
        r0 = rings[zi]
        r1 = rings[zi + 1]
        for s in range(segs - 1):
            bm.faces.new((r0[s], r0[s + 1], r1[s + 1], r1[s]))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Add solidify thickness so burgundy inside lining & navy outside look crisp in 3D
    mesh = bpy.data.meshes.new("Dress_Skirt")
    bm.to_mesh(mesh)
    bm.free()

    skirt_obj = bpy.data.objects.new("Dress_Skirt", mesh)
    bpy.context.collection.objects.link(skirt_obj)
    skirt_obj.data.materials.append(mat_navy)     # idx 0 outside
    skirt_obj.data.materials.append(mat_burgundy) # idx 1 burgundy side/lining
    set_smooth(skirt_obj)

    # Color side panels burgundy on outside + solidify inner burgundy shell
    solid = skirt_obj.modifiers.new("Solidify", "SOLIDIFY")
    solid.thickness = 0.006
    solid.offset = -1.0
    solid.material_offset = 1
    solid.material_offset_rim = 1
    bpy.context.view_layer.objects.active = skirt_obj
    bpy.ops.object.modifier_apply(modifier="Solidify")

    # Assign outer burgundy side panels around |x| large on sides
    for p in skirt_obj.data.polygons:
        c = p.center
        if abs(c.x) > 0.072 and c.z > 0.25 and p.material_index == 0 and c.y > -0.05:
            p.material_index = 1

    meshes.append(skirt_obj)

    # Gold bottom hem & slit trim tube accent
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.148,
        minor_radius=0.0055,
        major_segments=36,
        minor_segments=8,
        location=(0, 0.005, 0.095),
    )
    hem = bpy.context.active_object
    hem.name = "Dress_GoldHem"
    hem.scale = (1.02, 0.90, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    hem.data.materials.append(mat_gold)
    set_smooth(hem)
    meshes.append(hem)

    return meshes


def build_teacup_prop(mat_porcelain, mat_tea, mat_gold):
    """Build small 3D porcelain teacup + saucer + handle matching tea pose."""
    parts = []
    # Cup body
    cup = add_tapered_limb("Tea_Cup", (-0.265, -0.055, 0.505), (-0.265, -0.055, 0.555), 0.022, 0.032, segs=18, rings=4, mat=mat_porcelain)
    parts.append(cup)
    # Tea liquid inside
    tea = add_tapered_limb("Tea_Liquid", (-0.265, -0.055, 0.542), (-0.265, -0.055, 0.548), 0.026, 0.028, segs=16, rings=1, mat=mat_tea)
    parts.append(tea)
    # Saucer
    saucer = add_tapered_limb("Tea_Saucer", (-0.265, -0.055, 0.497), (-0.265, -0.055, 0.506), 0.024, 0.044, segs=18, rings=2, mat=mat_porcelain)
    parts.append(saucer)
    # Gold rim ring
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.031,
        minor_radius=0.0022,
        major_segments=20,
        minor_segments=6,
        location=(-0.265, -0.055, 0.554),
    )
    rim = bpy.context.active_object
    rim.name = "Tea_GoldRim"
    rim.data.materials.append(mat_gold)
    set_smooth(rim)
    parts.append(rim)
    return parts


def main():
    clear_scene()
    os.makedirs(os.path.dirname(OUTPUT_GLB), exist_ok=True)

    # Zero-copyright procedural materials matched to assets/sprites/idle.png
    mat_skin = make_toon_mat("Skin", (0.99, 0.90, 0.87, 1.0), roughness=0.68)
    mat_blush = make_toon_mat("Blush", (0.96, 0.62, 0.66, 1.0), roughness=0.75)
    mat_hair = make_toon_mat("Hair_SilverLavender", (0.85, 0.82, 0.94, 1.0), roughness=0.42)
    mat_sclera = make_toon_mat("Eye_Sclera", (0.99, 0.99, 1.0, 1.0), roughness=0.25)
    mat_iris = make_toon_mat("Eye_Violet", (0.48, 0.29, 0.89, 1.0), roughness=0.18, emission=(0.45, 0.25, 0.9, 1.0))
    mat_pupil = make_toon_mat("Eye_Pupil", (0.14, 0.07, 0.28, 1.0), roughness=0.15)
    mat_spec = make_toon_mat("Eye_Highlight", (1.0, 1.0, 1.0, 1.0), roughness=0.05, emission=(1.0, 1.0, 1.0, 1.0))
    mat_lash = make_toon_mat("Eyelash_Brow", (0.24, 0.15, 0.30, 1.0), roughness=0.5)
    mat_navy = make_toon_mat("Dress_Navy", (0.12, 0.15, 0.25, 1.0), roughness=0.55, double_sided=True)
    mat_burgundy = make_toon_mat("Dress_Burgundy", (0.42, 0.11, 0.22, 1.0), roughness=0.58, double_sided=True)
    mat_gold = make_toon_mat("Gold_Trim", (0.86, 0.70, 0.33, 1.0), roughness=0.28, metallic=0.82)
    mat_gem = make_toon_mat("Gem_Violet", (0.62, 0.42, 1.0, 1.0), roughness=0.12, metallic=0.1, emission=(0.5, 0.3, 0.95, 1.0))
    mat_stocking = make_toon_mat("Stockings", (0.23, 0.19, 0.23, 1.0), roughness=0.62)
    mat_shoe = make_toon_mat("Shoes_Dark", (0.13, 0.12, 0.20, 1.0), roughness=0.35)
    mat_silver = make_toon_mat("Earring_Silver", (0.88, 0.90, 0.96, 1.0), roughness=0.2, metallic=0.9)
    mat_porcelain = make_toon_mat("Tea_Porcelain", (0.98, 0.97, 0.95, 1.0), roughness=0.2)
    mat_tea = make_toon_mat("Tea_Liquid", (0.62, 0.36, 0.15, 1.0), roughness=0.15)

    arm = build_armature()
    rigged_parts = []

    def attach(obj, bone_name=None, gradient_axis=None, stops=None):
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        if stops is not None and gradient_axis is not None:
            assign_gradient_groups(obj, gradient_axis, stops)
        elif bone_name:
            assign_single_group(obj, bone_name)
        obj.parent = arm
        rigged_parts.append(obj)

    # --- HEAD + BLINK/EXPRESSION SHAPE KEYS ---
    head = add_uv_sphere("Head_Mesh", (0, -0.01, 1.075), (0.165, 0.152, 0.158), segs=32, rings=22, mat=mat_skin)
    attach(head, "head")

    # Neck & Torso
    neck = add_tapered_limb("Neck", (0, 0, 0.84), (0, -0.005, 0.95), 0.036, 0.032, segs=16, rings=3, mat=mat_skin)
    attach(neck, None, 2, [(0.84, {"chest": 1.0}), (0.89, {"neck": 0.7, "chest": 0.3}), (0.95, {"head": 0.7, "neck": 0.3})])

    # Dress Bodice (Navy upper torso + chest curve + smooth merge into skirt waist)
    torso = add_tapered_limb("Dress_Bodice", (0, 0, 0.50), (0, 0, 0.82), 0.095, 0.088, segs=24, rings=8, mat=mat_navy)
    # Pinch waist slightly around z=0.63..0.69 & round bust
    for v in torso.data.vertices:
        z = v.co.z
        if 0.56 <= z <= 0.74:
            waist_k = 1.0 - 0.19 * math.exp(-((z - 0.65) / 0.055) ** 2)
            v.co.x *= waist_k
            v.co.y *= waist_k
        if 0.70 <= z <= 0.80 and v.co.y < -0.01:
            bust_k = math.exp(-((z - 0.75) / 0.040) ** 2)
            v.co.y -= 0.032 * bust_k
    attach(torso, None, 2, [
        (0.50, {"hips": 1.0}),
        (0.60, {"hips": 0.4, "spine": 0.6}),
        (0.71, {"spine": 0.45, "chest": 0.55}),
        (0.84, {"chest": 1.0}),
    ])

    # Chest / shoulders upper skin collar area
    collar_skin = add_tapered_limb("UpperChest_Skin", (0, 0, 0.79), (0, 0, 0.865), 0.070, 0.052, segs=20, rings=3, mat=mat_skin)
    collar_skin.scale = (1.12, 0.78, 1.0)
    bpy.context.view_layer.objects.active = collar_skin
    bpy.ops.object.transform_apply(scale=True)
    attach(collar_skin, "chest")

    # Necklace chain + purple gem resting cleanly on front collarbone
    bpy.ops.mesh.primitive_torus_add(major_radius=0.056, minor_radius=0.0028, major_segments=24, minor_segments=6, location=(0, -0.018, 0.842))
    chain = bpy.context.active_object
    chain.name = "Necklace_Chain"
    chain.rotation_euler = (math.radians(24), 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    chain.data.materials.append(mat_gold)
    set_smooth(chain)
    attach(chain, "chest")

    gem = add_uv_sphere("Necklace_Gem", (0, -0.074, 0.818), (0.009, 0.007, 0.012), segs=14, rings=10, mat=mat_gem)
    attach(gem, "chest")

    # Dress Skirt + gold hem
    skirt_parts = build_dress_skirt_with_slit(mat_navy, mat_burgundy, mat_gold)
    for sp in skirt_parts:
        attach(sp, None, 2, [
            (0.09, {"SkirtFront": 0.6, "hips": 0.4}),
            (0.32, {"SkirtFront": 0.35, "hips": 0.65}),
            (0.54, {"hips": 1.0}),
        ])

    # --- FACE FEATURES (Eyes on leftEye/rightEye bones so 3D lookAt moves pupils smoothly!) ---
    for side, sgn, bname in [("Left", 1, "leftEye"), ("Right", -1, "rightEye")]:
        ex = sgn * 0.068
        scl = add_uv_sphere(f"{side}Eye_Sclera", (ex, -0.145, 1.052), (0.036, 0.020, 0.036), segs=20, rings=14, mat=mat_sclera)
        attach(scl, bname)
        iris = add_uv_sphere(f"{side}Eye_Iris", (ex, -0.159, 1.050), (0.024, 0.014, 0.028), segs=20, rings=14, mat=mat_iris)
        attach(iris, bname)
        pup = add_uv_sphere(f"{side}Eye_Pupil", (ex, -0.168, 1.050), (0.011, 0.010, 0.013), segs=16, rings=10, mat=mat_pupil)
        attach(pup, bname)
        hi1 = add_uv_sphere(f"{side}Eye_Hi1", (ex - 0.008, -0.172, 1.061), (0.006, 0.005, 0.006), segs=12, rings=8, mat=mat_spec)
        attach(hi1, bname)
        hi2 = add_uv_sphere(f"{side}Eye_Hi2", (ex + 0.008, -0.171, 1.041), (0.0035, 0.003, 0.0035), segs=10, rings=6, mat=mat_spec)
        attach(hi2, bname)

        # Upper eyelash arch & brow on head bone
        lash = add_hair_lock(
            f"{side}Eyelash",
            [
                (Vector((ex - sgn * 0.034, -0.156, 1.072)), 0.005, 0.005),
                (Vector((ex, -0.168, 1.084)), 0.006, 0.006),
                (Vector((ex + sgn * 0.038, -0.150, 1.078)), 0.005, 0.005),
            ],
            mat=mat_lash,
        )
        attach(lash, "head")

        brow = add_hair_lock(
            f"{side}Eyebrow",
            [
                (Vector((ex - sgn * 0.025, -0.156, 1.106)), 0.0035, 0.003),
                (Vector((ex + sgn * 0.025, -0.150, 1.112)), 0.003, 0.003),
            ],
            mat=mat_lash,
        )
        attach(brow, "head")

        # Cheek blush & earrings
        blush = add_uv_sphere(f"{side}Cheek_Blush", (sgn * 0.095, -0.132, 1.010), (0.022, 0.010, 0.011), segs=12, rings=8, mat=mat_blush)
        attach(blush, "head")
        ear = add_uv_sphere(f"{side}Ear", (sgn * 0.162, -0.005, 1.035), (0.018, 0.022, 0.028), segs=12, rings=8, mat=mat_skin)
        attach(ear, "head")
        earring = add_uv_sphere(f"{side}Earring", (sgn * 0.168, -0.008, 0.992), (0.007, 0.007, 0.014), segs=10, rings=8, mat=mat_silver)
        attach(earring, "head")

    # Cute anime Eyelid Blink Flap (tucked cleanly inside head at rest, sweeps forward+down on blink!)
    eyelid_left = add_uv_sphere("Eyelids", (0, -0.055, 1.095), (0.118, 0.025, 0.002), segs=24, rings=8, mat=mat_skin)
    eyelid_left.shape_key_add(name="Basis", from_mix=False)
    sk_blink = eyelid_left.shape_key_add(name="blink", from_mix=False)
    for idx, v in enumerate(eyelid_left.data.vertices):
        co = v.co.copy()
        if co.z < 1.095:
            co.z -= 0.076
        co.y -= 0.110
        sk_blink.data[idx].co = co
    attach(eyelid_left, "head")

    # Fine delicate smile curve with `aa` / `happy` shape keys for AI voice lip-sync & expressions!
    mouth = add_hair_lock(
        "Mouth",
        [
            (Vector((-0.016, -0.156, 0.990)), 0.0012, 0.0012),
            (Vector((0.0, -0.160, 0.986)), 0.0015, 0.0012),
            (Vector((0.016, -0.156, 0.990)), 0.0012, 0.0012),
        ],
        mat=mat_lash,
    )
    mouth.shape_key_add(name="Basis", from_mix=False)
    sk_aa = mouth.shape_key_add(name="aa", from_mix=False)
    sk_happy = mouth.shape_key_add(name="happy", from_mix=False)
    for idx, v in enumerate(mouth.data.vertices):
        co = v.co
        sk_aa.data[idx].co = Vector((co.x * 1.15, co.y, co.z - (0.014 if co.z < 0.988 else -0.004)))
        sk_happy.data[idx].co = Vector((co.x * 1.25, co.y, co.z + abs(co.x) * 0.35))
    attach(mouth, "head")

    # --- HAIR (Crown + Swept Bangs parted cleanly to expose both eyes + Long Flowing Locks) ---
    crown = add_uv_sphere("Hair_Crown", (0, 0.008, 1.115), (0.176, 0.168, 0.152), segs=28, rings=18, mat=mat_hair)
    attach(crown, "head")

    # Front swept bangs parted smoothly left->right above the eyes
    bangs_specs = [
        [(0.04, -0.08, 1.24), (0.01, -0.155, 1.19), (-0.025, -0.174, 1.12), (-0.04, -0.165, 1.075)],
        [(0.06, -0.06, 1.23), (0.075, -0.145, 1.18), (0.095, -0.155, 1.11), (0.115, -0.135, 1.045)],
        [(-0.04, -0.08, 1.23), (-0.095, -0.14, 1.16), (-0.135, -0.138, 1.07), (-0.148, -0.105, 0.97)],
        [(0.08, -0.06, 1.22), (0.138, -0.115, 1.14), (0.158, -0.105, 1.04), (0.162, -0.075, 0.94)],
    ]
    for bi, pts in enumerate(bangs_specs):
        pw = [
            (Vector(pts[0]), 0.036, 0.018),
            (Vector(pts[1]), 0.034, 0.016),
            (Vector(pts[2]), 0.024, 0.012),
            (Vector(pts[3]), 0.006, 0.005),
        ]
        attach(add_hair_lock(f"Hair_Bang_{bi}", pw, mat=mat_hair), "head")

    # Long flowing Back & Side hair locks bound to Hair Physics chains!
    back_specs = [
        (0.0, 0.145, 0.095, "HairBack"),
        (0.085, 0.13, 0.075, "HairBack"),
        (-0.085, 0.13, 0.075, "HairBack"),
    ]
    for idx, (hx, hy, rw, bprefix) in enumerate(back_specs):
        pw = [
            (Vector((hx, hy * 0.65, 1.16)), rw * 0.9, 0.032),
            (Vector((hx * 1.1, hy, 0.96)), rw, 0.034),
            (Vector((hx * 1.22, hy + 0.035, 0.72)), rw * 0.95, 0.028),
            (Vector((hx * 1.38, hy + 0.055, 0.48)), rw * 0.65, 0.018),
            (Vector((hx * 1.55, hy + 0.06, 0.33)), 0.008, 0.006),
        ]
        lock = add_hair_lock(f"Hair_BackLock_{idx}", pw, mat=mat_hair)
        attach(lock, None, 2, [
            (0.35, {f"{bprefix}2": 1.0}),
            (0.68, {f"{bprefix}1": 0.65, f"{bprefix}2": 0.35}),
            (0.92, {"head": 0.85, f"{bprefix}1": 0.15}),
            (1.16, {"head": 1.0}),
        ])

    for sgn, bprefix in [(1, "HairLeft"), (-1, "HairRight")]:
        for sub_idx, (dy, dx, bot_z) in enumerate([(-0.02, 0.165, 0.42), (0.06, 0.155, 0.38)]):
            pw = [
                (Vector((sgn * 0.145, dy, 1.08)), 0.045, 0.026),
                (Vector((sgn * (dx + 0.01), dy + 0.01, 0.90)), 0.044, 0.024),
                (Vector((sgn * (dx + 0.03), dy + 0.02, 0.68)), 0.036, 0.020),
                (Vector((sgn * (dx + 0.055), dy + 0.025, bot_z)), 0.007, 0.006),
            ]
            lock = add_hair_lock(f"Hair_{bprefix}_{sub_idx}", pw, mat=mat_hair)
            attach(lock, None, 2, [
                (0.40, {f"{bprefix}2": 1.0}),
                (0.72, {f"{bprefix}1": 0.7, f"{bprefix}2": 0.3}),
                (0.96, {"head": 0.9, f"{bprefix}1": 0.1}),
            ])

    # --- ARMS & HANDS ---
    for side, sgn in [("left", 1), ("right", -1)]:
        cap_sleeve = add_uv_sphere(f"{side}Sleeve", (sgn * 0.095, 0, 0.805), (0.036, 0.034, 0.034), segs=16, rings=12, mat=mat_navy)
        attach(cap_sleeve, f"{side}UpperArm")

        upper_arm = add_tapered_limb(f"{side}UpperArmMesh", (sgn * 0.09, 0, 0.805), (sgn * 0.185, 0, 0.67), 0.028, 0.023, mat=mat_skin)
        attach(upper_arm, f"{side}UpperArm")

        lower_arm = add_tapered_limb(f"{side}LowerArmMesh", (sgn * 0.185, 0, 0.67), (sgn * 0.25, -0.025, 0.535), 0.022, 0.017, mat=mat_skin)
        attach(lower_arm, f"{side}LowerArm")

        hand = add_uv_sphere(f"{side}HandMesh", (sgn * 0.262, -0.03, 0.505), (0.018, 0.014, 0.032), segs=14, rings=10, mat=mat_skin)
        attach(hand, f"{side}Hand")

    # --- LEGS (Sheer dark stockings + strappy dark heels, seamlessly seated into shoes) ---
    for side, sgn in [("left", 1), ("right", -1)]:
        x_hip = sgn * 0.055
        x_knee = sgn * 0.052
        x_ankle = sgn * 0.048
        thigh = add_tapered_limb(f"{side}ThighMesh", (x_hip, 0, 0.50), (x_knee, 0, 0.28), 0.046, 0.032, mat=mat_stocking)
        attach(thigh, f"{side}UpperLeg")

        calf = add_tapered_limb(f"{side}CalfMesh", (x_knee, 0, 0.28), (x_ankle, 0.006, 0.032), 0.032, 0.018, mat=mat_stocking)
        attach(calf, f"{side}LowerLeg")

        shoe_base = add_uv_sphere(f"{side}ShoeMesh", (x_ankle, -0.022, 0.024), (0.025, 0.050, 0.022), segs=16, rings=10, mat=mat_shoe)
        attach(shoe_base, f"{side}Foot")
        heel = add_tapered_limb(f"{side}HeelStiletto", (x_ankle, 0.014, 0.002), (x_ankle, 0.012, 0.032), 0.006, 0.009, segs=10, rings=2, mat=mat_shoe)
        attach(heel, f"{side}Foot")

    # --- HANDHELD 3D TEACUP PROP (attached to teaCupMount so visible in Tea pose!) ---
    for tpart in build_teacup_prop(mat_porcelain, mat_tea, mat_gold):
        attach(tpart, "teaCupMount")

    # Select armature + all rigged meshes and export clean glTF Binary (.glb)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for rp in rigged_parts:
        rp.select_set(True)
    bpy.context.view_layer.objects.active = arm

    bpy.ops.export_scene.gltf(
        filepath=OUTPUT_GLB,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_morph=True,
        export_materials="EXPORT",
    )
    tri_count = sum(len(o.data.polygons) for o in rigged_parts if o.type == "MESH")
    print(f"SERAPHINA_STARTER_GLB_OK path={OUTPUT_GLB} tris={tri_count} bytes={os.path.getsize(OUTPUT_GLB)}")


if __name__ == "__main__":
    main()
