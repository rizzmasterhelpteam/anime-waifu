r"""
Blender 5.x Anatomical Body Refiner & Cycles AO Baker for Seraphina VRM.

Runs inside `blender.exe -b -P blender_refine_body.py -- <input.npz> <output.npz>`:
1. Loads sculpted glTF `Body_00_SKIN` (+ dress & face meshes for occlusion baking).
2. Unifies VRoid's 4 disconnected body skin islands (Lower Body, Upper Chest/Neck,
   Left Arm, Right Arm) by bridging Waist (`y=0.80`) -> Ribcage/Bust/Cleavage/Back
   -> Upper Chest (`y=0.95..1.01`) while opening Left/Right anatomical armholes
   and smoothly bridging both deltoids directly into Arm Roots (removing orphan 3-vert
   bust artifacts).
3. Relaxes sculpted bust/waist/hips/glutes/shoulders via `bmesh.ops.smooth_vert`
   and enforces strictly outward winding & shared continuous normals.
4. Solves harmonic bone weights (`Spine`, `Chest`, `UpperChest`, `Shoulder`, `UpperArm`)
   and continuous anatomical skin UVs.
5. Bakes 3D Ambient Occlusion in Blender Cycles directly onto `Body_00_SKIN` &
   `Face_00_SKIN`.
"""
import json
import math
import sys
import numpy as np
import bpy
import bmesh
from mathutils import Vector


def parse_args():
    argv = sys.argv
    idx = argv.index("--") if "--" in argv else -1
    if idx < 0 or len(argv) < idx + 3:
        raise RuntimeError("Usage: blender -b -P blender_refine_body.py -- <in.npz> <out.npz>")
    return argv[idx + 1], argv[idx + 2]


def find_boundary_components(bm):
    """Return list of ordered boundary vertex lists (simple closed rings where possible)."""
    adj = {}
    for e in bm.edges:
        if e.is_boundary:
            v0, v1 = e.verts[0], e.verts[1]
            adj.setdefault(v0, []).append(v1)
            adj.setdefault(v1, []).append(v0)
    seen = set()
    comps = []
    for v in list(adj.keys()):
        if v in seen:
            continue
        ring = []
        cur = v
        prev = None
        while cur is not None and cur not in seen:
            seen.add(cur)
            ring.append(cur)
            nxts = [n for n in adj[cur] if n != prev and n not in seen]
            if not nxts:
                break
            prev, cur = cur, nxts[0]
        comps.append(ring)
    return comps


def cyclic_slice(ring, start_idx, end_idx):
    n = len(ring)
    out = []
    cur = start_idx % n
    end_idx = end_idx % n
    while True:
        out.append(ring[cur])
        if cur == end_idx:
            break
        cur = (cur + 1) % n
        if len(out) > n + 2:
            break
    return out


def orient_ring_ccw_y(ring):
    """Orient closed ring +Z (front) -> +X (left) -> -Z (back) -> -X (right)."""
    angs = [math.atan2(v.co.x, v.co.z) for v in ring]
    tot = 0.0
    for i in range(len(angs)):
        da = (angs[(i + 1) % len(angs)] - angs[i] + math.pi) % (2.0 * math.pi) - math.pi
        tot += da
    if tot < 0:
        ring = list(reversed(ring))
    return ring


def stitch_two_chains_tri_strip(bm, chain_a, chain_b):
    n0, n1 = len(chain_a), len(chain_b)
    if n0 < 2 or n1 < 2:
        return []
    faces = []
    i, j = 0, 0
    while i < n0 - 1 or j < n1 - 1:
        if i == n0 - 1:
            tri = (chain_a[i], chain_b[j + 1], chain_b[j])
            j += 1
        elif j == n1 - 1:
            tri = (chain_a[i], chain_a[i + 1], chain_b[j])
            i += 1
        else:
            d_i = (chain_a[i + 1].co - chain_b[j].co).length
            d_j = (chain_a[i].co - chain_b[j + 1].co).length
            if (i + 1) / float(n0 - 1) <= (j + 1) / float(n1 - 1) + 0.08 and d_i <= d_j * 1.35:
                tri = (chain_a[i], chain_a[i + 1], chain_b[j])
                i += 1
            else:
                tri = (chain_a[i], chain_b[j + 1], chain_b[j])
                j += 1
        if len({tri[0], tri[1], tri[2]}) == 3:
            try:
                faces.append(bm.faces.new(tri))
            except ValueError:
                pass
    return faces


def subdivide_strip_into_rings(bm, chain_a, chain_b, num_rings=3, arch_fn=None, n_cols_min=14):
    if len(chain_a) < 2 or len(chain_b) < 2:
        return [chain_a, chain_b], [], []
    n_cols = max(len(chain_a), len(chain_b), n_cols_min)

    def sample_pos(chain, t):
        pos = t * (len(chain) - 1)
        idx0 = min(len(chain) - 1, max(0, int(math.floor(pos))))
        idx1 = min(len(chain) - 1, idx0 + 1)
        f = pos - idx0
        return chain[idx0].co * (1.0 - f) + chain[idx1].co * f

    rows = [chain_a]
    new_verts = []
    for r in range(1, num_rings + 1):
        s = r / float(num_rings + 1)
        row = []
        for c in range(n_cols):
            u = c / float(n_cols - 1)
            p = sample_pos(chain_a, u) * (1.0 - s) + sample_pos(chain_b, u) * s
            if arch_fn is not None:
                p = arch_fn(p, s, u)
            v = bm.verts.new(p)
            row.append(v)
            new_verts.append(v)
        rows.append(row)
    rows.append(chain_b)

    new_faces = []
    for r in range(len(rows) - 1):
        new_faces.extend(stitch_two_chains_tri_strip(bm, rows[r], rows[r + 1]))
    return rows, new_verts, new_faces


def enforce_radial_outward(faces, axis_fn):
    for f in faces:
        if not f.is_valid:
            continue
        f.normal_update()
        cen = f.calc_center_median()
        ref = axis_fn(cen)
        if f.normal.dot(cen - ref) < 0.0:
            f.normal_flip()


def bridge_two_closed_loops_hermite(bm, loop_inner, loop_outer, num_rings=5):
    if len(loop_inner) < 3 or len(loop_outer) < 3:
        return [], []

    # Preserve EXACT cyclic adjacency of `loop_inner` & `loop_outer` — only rotate/flip order, NEVER re-sort!
    ca = np.mean([v.co[:] for v in loop_inner], axis=0)
    cb = np.mean([v.co[:] for v in loop_outer], axis=0)

    def prep_loop(lp, center):
        start = int(np.argmax([v.co.y - center[1] for v in lp]))
        rot = lp[start:] + lp[:start]
        area2 = 0.0
        for i in range(len(rot)):
            v0, v1 = rot[i].co, rot[(i + 1) % len(rot)].co
            area2 += (v0.y - center[1]) * (v1.z - center[2]) - (v0.z - center[2]) * (v1.y - center[1])
        if area2 < 0:
            rot = [rot[0]] + list(reversed(rot[1:]))
        return rot

    la = prep_loop(loop_inner, ca)
    lb = prep_loop(loop_outer, cb)

    best_shift = 0
    best_cost = 1e18
    for sh in range(len(lb)):
        cost = 0.0
        for k in range(len(la)):
            t = k / float(len(la))
            j = int(round(t * len(lb) + sh)) % len(lb)
            cost += (la[k].co - lb[j].co).length_squared
        if cost < best_cost:
            best_cost = cost
            best_shift = sh
    lb = lb[best_shift:] + lb[:best_shift]

    n_cols = max(len(la), len(lb), 18)

    def sample_closed(lp, t):
        pos = (t % 1.0) * len(lp)
        i0 = int(math.floor(pos)) % len(lp)
        i1 = (i0 + 1) % len(lp)
        f = pos - math.floor(pos)
        return lp[i0].co * (1.0 - f) + lp[i1].co * f

    rows = [la + [la[0]]]
    new_verts = []
    for r in range(1, num_rings + 1):
        s = r / float(num_rings + 1)
        row = []
        for c in range(n_cols):
            u = c / float(n_cols)
            pa = sample_closed(la, u)
            pb = sample_closed(lb, u)
            p = pa * (1.0 - s) + pb * s
            # Soft rounded feminine deltoid curve
            mid = math.sin(s * math.pi)
            y_mid = ca[1] * (1.0 - s) + cb[1] * s
            if p.y > y_mid - 0.01:
                p.y += 0.008 * mid
            p.z += 0.004 * mid * (1.0 if p.z >= 0 else -0.6)
            v = bm.verts.new(p)
            row.append(v)
            new_verts.append(v)
        row.append(row[0])
        rows.append(row)
    rows.append(lb + [lb[0]])

    new_faces = []
    for r in range(len(rows) - 1):
        new_faces.extend(stitch_two_chains_tri_strip(bm, rows[r], rows[r + 1]))

    enforce_radial_outward(
        new_faces,
        lambda c: Vector((
            c.x,
            ca[1] * (1.0 - np.clip((c.x - ca[0]) / max(1e-4, cb[0] - ca[0]), 0.0, 1.0))
            + cb[1] * np.clip((c.x - ca[0]) / max(1e-4, cb[0] - ca[0]), 0.0, 1.0),
            ca[2] * (1.0 - np.clip((c.x - ca[0]) / max(1e-4, cb[0] - ca[0]), 0.0, 1.0))
            + cb[2] * np.clip((c.x - ca[0]) / max(1e-4, cb[0] - ca[0]), 0.0, 1.0),
        )),
    )
    return new_verts, new_faces


def build_refined_body(data):
    pos = data["body_pos"].astype(np.float32).copy()
    norms = data["body_norm"].astype(np.float32).copy()
    uvs = data["body_uv"].astype(np.float32).copy()
    joints = data["body_joints"].astype(np.uint16).copy()
    weights = data["body_weights"].astype(np.float32).copy()
    skin_tris = data["skin_tris"].astype(np.int32).reshape(-1, 3)
    slots = json.loads(str(data["skin_slots_json"]))

    bm = bmesh.new()
    u_orig = np.unique(skin_tris)
    orig_to_bm = {}
    for vi in u_orig:
        orig_to_bm[int(vi)] = bm.verts.new(tuple(pos[int(vi)]))
    for a, b, c in skin_tris:
        try:
            bm.faces.new((orig_to_bm[int(a)], orig_to_bm[int(b)], orig_to_bm[int(c)]))
        except ValueError:
            pass

    bm.verts.ensure_lookup_table()
    bucket_map = {}
    for vi in u_orig:
        v = orig_to_bm[int(vi)]
        key = (round(float(v.co.x) * 2000), round(float(v.co.y) * 2000), round(float(v.co.z) * 2000))
        bucket_map.setdefault(key, []).append(int(vi))

    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1.2e-4)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    orig_pts = pos[u_orig]
    bm_to_origs = {}
    for v in bm.verts:
        k = (round(float(v.co.x) * 2000), round(float(v.co.y) * 2000), round(float(v.co.z) * 2000))
        cands = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    cands.extend(bucket_map.get((k[0] + dx, k[1] + dy, k[2] + dz), ()))
        if not cands:
            d2 = np.sum((orig_pts - np.array(v.co[:], dtype=np.float32)) ** 2, axis=1)
            cands = [int(u_orig[int(np.argmin(d2))])]
        pco = np.array(v.co[:], dtype=np.float32)
        exact = [ci for ci in cands if float(np.linalg.norm(pos[ci] - pco)) < 2.2e-4]
        bm_to_origs[v] = exact if exact else [cands[0]]

    # 1. Remove tiny orphan 3-vert bust tip islands (`y ~ 0.90`) from `skin_tris`
    orphan_origs = set()
    orphan_bverts = []
    seen_iso = set()
    for v in bm.verts:
        if v in seen_iso:
            continue
        comp = []
        q = [v]
        seen_iso.add(v)
        while q:
            c = q.pop()
            comp.append(c)
            for e in c.link_edges:
                n = e.other_vert(c)
                if n not in seen_iso:
                    seen_iso.add(n)
                    q.append(n)
        if len(comp) == 3 and 0.85 <= comp[0].co.y <= 0.95:
            for bv in comp:
                orphan_bverts.append(bv)
                orphan_origs.update(bm_to_origs.get(bv, ()))
    if orphan_origs:
        keep_mask = np.array([not any(int(v) in orphan_origs for v in t) for t in skin_tris], dtype=bool)
        skin_tris = skin_tris[keep_mask]
        bmesh.ops.delete(bm, geom=orphan_bverts, context="VERTS")
        for bv in orphan_bverts:
            bm_to_origs.pop(bv, None)

    bm.edges.ensure_lookup_table()
    bm.verts.ensure_lookup_table()

    # 2. Gentle smoothing on lower sculpted hips/glutes (`y in 0.645..0.795`)
    glute_smooth_verts = [
        v for v in bm.verts
        if 0.645 <= v.co.y <= 0.795 and abs(v.co.x) < 0.145 and not v.is_boundary
    ]
    if glute_smooth_verts:
        for _ in range(2):
            bmesh.ops.smooth_vert(bm, verts=glute_smooth_verts, factor=0.22, use_axis_x=True, use_axis_y=True, use_axis_z=True)

    # 3. Identify the 4 anatomical loops connecting Island 1, 2, 3, 4:
    #    - `loop_waist`: Comp len=24 (`y=0.80..0.81`) -> top of Island 1
    #    - `loop_chest`: Comp len=32 (`y=0.94..1.02`) -> bottom of Island 2
    #    - `loop_arm_l`: Comp len=12 (`x > +0.13`) -> Island 3 root
    #    - `loop_arm_r`: Comp len=12 (`x < -0.13`) -> Island 4 root
    comps = find_boundary_components(bm)
    loop_waist = None
    loop_chest = None
    loop_arm_l = None
    loop_arm_r = None
    for c in comps:
        ys = [v.co.y for v in c]
        xs = [v.co.x for v in c]
        if 18 <= len(c) <= 28 and max(ys) < 0.85 and min(ys) > 0.76:
            loop_waist = c
        elif 28 <= len(c) <= 38 and max(ys) < 1.03 and min(ys) > 0.90:
            loop_chest = c
        elif 8 <= len(c) <= 18 and min(xs) > 0.13 and min(ys) > 0.92:
            loop_arm_l = c
        elif 8 <= len(c) <= 18 and max(xs) < -0.13 and min(ys) > 0.92:
            loop_arm_r = c

    bridged_verts = []
    bridged_faces = []

    if loop_waist and loop_chest and loop_arm_l and loop_arm_r:
        lw = orient_ring_ccw_y(loop_waist)
        lc = orient_ring_ccw_y(loop_chest)

        # Rotate both closed rings cleanly to start at Front-Right (-x, +z) -> Front-Left (+x, +z)
        # Check exact 4 corners on `lc` (Upper Chest rim): FR, FL, BL, BR
        c_fr = int(np.argmin([v.co.x - 0.85 * v.co.z for v in lc]))
        c_fl = int(np.argmax([v.co.x + 0.85 * v.co.z for v in lc]))
        c_bl = int(np.argmax([v.co.x - 0.85 * v.co.z for v in lc]))
        c_br = int(np.argmin([v.co.x + 0.85 * v.co.z for v in lc]))

        # Matching corners on `lw` (Waist rim)
        w_fr = int(np.argmin([v.co.x - 0.85 * v.co.z for v in lw]))
        w_fl = int(np.argmax([v.co.x + 0.85 * v.co.z for v in lw]))
        w_bl = int(np.argmax([v.co.x - 0.85 * v.co.z for v in lw]))
        w_br = int(np.argmin([v.co.x + 0.85 * v.co.z for v in lw]))

        # Align waist `lw` starting at `w_fr` (cyclically closed)
        lw_rot = lw[w_fr:] + lw[:w_fr]

        # Step A: Build smooth sculpted 360-deg lower torso cylinder from `lw_rot` (Waist y=0.805)
        # up to an anatomical armpit-level ring (`ring_armpit`, y ~ 0.925..0.945) matching sculpted bust!
        n_ring = 32
        def sample_lw(u):
            pos_f = (u % 1.0) * len(lw_rot)
            i0 = int(math.floor(pos_f)) % len(lw_rot)
            i1 = (i0 + 1) % len(lw_rot)
            f = pos_f - math.floor(pos_f)
            return lw_rot[i0].co * (1.0 - f) + lw_rot[i1].co * f

        # Compute exact corresponding upper reference perimeter (`lc` rotated to `c_fr`) so torso blends naturally
        lc_rot = lc[c_fr:] + lc[:c_fr]
        def sample_lc(u):
            pos_f = (u % 1.0) * len(lc_rot)
            i0 = int(math.floor(pos_f)) % len(lc_rot)
            i1 = (i0 + 1) % len(lc_rot)
            f = pos_f - math.floor(pos_f)
            return lc_rot[i0].co * (1.0 - f) + lc_rot[i1].co * f

        torso_rows = [lw_rot + [lw_rot[0]]]
        n_mid_rings = 4  # y goes 0.805 -> 0.835 -> 0.870 -> 0.905 -> 0.935 (underarm rim)
        s_levels = [0.22, 0.45, 0.68, 0.86]
        for s in s_levels:
            row = []
            for k in range(n_ring):
                u = k / float(n_ring)
                pw = sample_lw(u)
                pc = sample_lc(u)
                # Interpolate torso profile linearly + anatomical hourglass waist-to-bust sculpting!
                p = pw * (1.0 - s) + pc * s
                # Front-side-back smoothing + soft curvy waist + full voluptuous sculpted bust at y ~ 0.91!
                waist_t = math.exp(-((p.y - 0.808) / 0.038) ** 2)
                p.x *= 1.0 - waist_t * 0.015
                p.z *= 1.0 + waist_t * 0.038

                bust_y = math.exp(-((p.y - 0.910) / 0.048) ** 2)
                if p.z > 0.0:
                    front_fac = min(1.0, max(0.0, (p.z - 0.010) / 0.055))
                    # Soft twin breast mounds (`x = +-0.038`) & gentle center sternum cleavage dip!
                    mound = math.exp(-(((abs(p.x) - 0.038) / 0.028) ** 2))
                    cleav = math.exp(-((p.x / 0.016) ** 2))
                    p.z += bust_y * front_fac * (0.062 + 0.014 * mound - 0.016 * cleav)
                    p.x *= 1.0 + bust_y * front_fac * 0.145
                else:
                    # Slight natural rib/shoulder-blade expansion on back
                    p.z -= bust_y * min(1.0, max(0.0, (-p.z - 0.010) / 0.040)) * 0.006
                v = bm.verts.new(p)
                row.append(v)
                bridged_verts.append(v)
            row.append(row[0])
            torso_rows.append(row)

        torso_faces = []
        for r in range(len(torso_rows) - 1):
            torso_faces.extend(stitch_two_chains_tri_strip(bm, torso_rows[r], torso_rows[r + 1]))
        enforce_radial_outward(torso_faces, lambda c: Vector((0.0, c.y, 0.0)))
        bridged_faces.extend(torso_faces)

        # `ring_top` is `torso_rows[-1][:-1]` (`len = 32`, starting at FR angle matching `c_fr`!).
        # Find exact matching corner indices on `ring_top` corresponding to `c_fr`, `c_fl`, `c_bl`, `c_br`!
        rt = torso_rows[-1][:-1]
        r_fr = int(np.argmin([(v.co - lc[c_fr].co).length_squared for v in rt]))
        r_fl = int(np.argmin([(v.co - lc[c_fl].co).length_squared for v in rt]))
        r_bl = int(np.argmin([(v.co - lc[c_bl].co).length_squared for v in rt]))
        r_br = int(np.argmin([(v.co - lc[c_br].co).length_squared for v in rt]))

        # Step B: Connect Front Bust (`rt[r_fr..r_fl]` -> `lc[c_fr..c_fl]`) & Back (`rt[r_bl..r_br]` -> `lc[c_bl..c_br]`)
        # Leaving ONLY Left Armhole (`r_fl..r_bl` + `c_fl..c_bl`) & Right Armhole (`r_br..r_fr` + `c_br..c_fr`) open!
        chain_rt_front = cyclic_slice(rt, r_fr, r_fl)
        chain_lc_front = cyclic_slice(lc, c_fr, c_fl)
        _, fv, ff = subdivide_strip_into_rings(bm, chain_rt_front, chain_lc_front, num_rings=1, n_cols_min=8)
        enforce_radial_outward(ff, lambda c: Vector((0.0, c.y, 0.0)))
        bridged_verts.extend(fv)
        bridged_faces.extend(ff)

        chain_rt_back = cyclic_slice(rt, r_bl, r_br)
        chain_lc_back = cyclic_slice(lc, c_bl, c_br)
        _, bv, bf = subdivide_strip_into_rings(bm, chain_rt_back, chain_lc_back, num_rings=2, n_cols_min=8)
        enforce_radial_outward(bf, lambda c: Vector((0.0, c.y, 0.0)))
        bridged_verts.extend(bv)
        bridged_faces.extend(bf)

        bm.edges.ensure_lookup_table()
        bm.verts.ensure_lookup_table()

        # Step C: Now ONLY the Left Armhole loop (+x), Right Armhole loop (-x), Arm_L, and Arm_R exist!
        rem_comps = find_boundary_components(bm)
        arm_l_set = set(loop_arm_l)
        arm_r_set = set(loop_arm_r)
        socket_l = None
        socket_r = None
        for c in rem_comps:
            cset = set(c)
            if cset & arm_l_set or cset & arm_r_set:
                continue
            ys = [v.co.y for v in c]
            xs = [v.co.x for v in c]
            if min(ys) >= 0.89 and max(ys) <= 1.06:
                if min(xs) > 0.01:
                    if socket_l is None or len(c) > len(socket_l):
                        socket_l = c
                elif max(xs) < -0.01:
                    if socket_r is None or len(c) > len(socket_r):
                        socket_r = c

        for side_socket, side_arm in ((socket_l, loop_arm_l), (socket_r, loop_arm_r)):
            if not side_socket or not side_arm:
                continue
            sv, sf = bridge_two_closed_loops_hermite(bm, side_socket, side_arm, num_rings=5)
            bridged_verts.extend(sv)
            bridged_faces.extend(sf)

    # 4. Run multi-pass Blender smoothing across newly bridged torso/bust/shoulders + 1-ring boundary
    bridged_set = set(bridged_verts)
    ring1 = set(bridged_set)
    for v in bridged_verts:
        if v.is_valid:
            for e in v.link_edges:
                ov = e.other_vert(v)
                if ov not in bridged_set and ov.co.y < 1.03:
                    ring1.add(ov)
    smooth_targets = [v for v in ring1 if v.is_valid and not v.is_boundary]
    for _ in range(5):
        if smooth_targets:
            bmesh.ops.smooth_vert(bm, verts=smooth_targets, factor=0.42, use_axis_x=True, use_axis_y=True, use_axis_z=True)

    bm.faces.ensure_lookup_table()
    bm.normal_update()

    # 5. Harmonic interpolation of Bone Weights (`Spine`, `Chest`, `UpperChest`, `Shoulder`, `UpperArm`) & UVs
    uv_val = {}
    w_val = {}
    slot_order = [
        slots["hips"],
        slots["spine"],
        slots["chest"],
        slots["upperChest"],
        slots["l_sh"],
        slots["l_arm"],
        slots["r_sh"],
        slots["r_arm"],
    ]
    n_slots = len(slot_order)
    for v in bm.verts:
        if v in bm_to_origs:
            oi = bm_to_origs[v][0]
            uv_val[v] = uvs[oi].copy()
            wvec = np.zeros(n_slots, dtype=np.float32)
            for jslot, jw in zip(joints[oi], weights[oi]):
                if int(jslot) in slot_order:
                    wvec[slot_order.index(int(jslot))] += float(jw)
                else:
                    wvec[2] += float(jw)  # fallback to Chest
            s = float(wvec.sum())
            w_val[v] = (wvec / s) if s > 1e-6 else np.eye(n_slots, dtype=np.float32)[2]
        else:
            uv_val[v] = np.array([0.50, 0.20], dtype=np.float32)
            w_val[v] = np.eye(n_slots, dtype=np.float32)[2]

    free_verts = [v for v in bm.verts if v not in bm_to_origs]
    for _ in range(42):
        for v in free_verts:
            nbrs = [e.other_vert(v) for e in v.link_edges]
            if nbrs:
                avg_w = np.mean([w_val[n] for n in nbrs], axis=0)
                s = float(avg_w.sum())
                w_val[v] = avg_w / s if s > 1e-6 else w_val[v]

    # Map newly bridged torso/bust/shoulder skin vertices into clean dedicated zone (`u in [0.34..0.66], v in [0.21..0.37]`)
    # so they never overlap Island 2 collarbone/neck UVs (`v in 0.06..0.18`).
    for v in free_verts:
        px, py, pz = float(v.co.x), float(v.co.y), float(v.co.z)
        if pz >= -0.005:
            u_s = 0.50 + max(-0.08, min(0.08, px * 0.45))
        else:
            u_s = (0.64 - min(0.05, abs(px) * 0.25)) if px >= 0 else (0.36 + min(0.05, abs(px) * 0.25))
        v_s = float(np.clip(0.215 + (1.010 - py) * 0.80, 0.210, 0.370))
        uv_val[v] = np.array([u_s, v_s], dtype=np.float32)

    for v, olist in bm_to_origs.items():
        nvec = np.array(v.normal[:], dtype=np.float32)
        nlen = float(np.linalg.norm(nvec))
        nvec = nvec / nlen if nlen > 1e-6 else norms[olist[0]]
        co_arr = np.array(v.co[:], dtype=np.float32)
        for oi in olist:
            if 0.640 <= float(pos[oi, 1]) <= 1.030:
                pos[oi] = co_arr
                norms[oi] = nvec

    new_pos_list, new_norm_list, new_uv_list, new_j_list, new_w_list = [], [], [], [], []
    free_to_new_idx = {}
    base_count = len(pos)

    for v in free_verts:
        idx_out = base_count + len(new_pos_list)
        free_to_new_idx[v] = idx_out
        new_pos_list.append(np.array(v.co[:], dtype=np.float32))
        nv = np.array(v.normal[:], dtype=np.float32)
        nl = float(np.linalg.norm(nv))
        new_norm_list.append(nv / nl if nl > 1e-6 else np.array([0.0, 0.3, 0.95], dtype=np.float32))
        new_uv_list.append(uv_val[v])

        wvec = w_val[v]
        top4 = np.argsort(-wvec)[:4]
        j4 = np.array([slot_order[k] for k in top4], dtype=np.uint16)
        w4 = np.array([wvec[k] for k in top4], dtype=np.float32)
        ws = float(w4.sum())
        w4 = (w4 / ws) if ws > 1e-6 else np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32)
        new_j_list.append(j4)
        new_w_list.append(w4)

    seam_dup_map = {}

    def get_tri_vert_idx(bv):
        if bv in free_to_new_idx:
            return free_to_new_idx[bv]
        oi = bm_to_origs[bv][0]
        u0, v0 = float(uvs[oi, 0]), float(uvs[oi, 1])
        if 0.24 <= u0 <= 0.76 and 0.10 <= v0 <= 0.42:
            return oi
        if bv in seam_dup_map:
            return seam_dup_map[bv]
        px, py, pz = float(bv.co.x), float(bv.co.y), float(bv.co.z)
        u_clean = (0.50 + max(-0.08, min(0.08, px * 0.45))) if pz >= -0.005 else ((0.64 - min(0.05, abs(px) * 0.25)) if px >= 0 else (0.36 + min(0.05, abs(px) * 0.25)))
        v_clean = float(np.clip(0.215 + (1.010 - py) * 0.80, 0.210, 0.370))
        idx_out = base_count + len(new_pos_list)
        seam_dup_map[bv] = idx_out
        new_pos_list.append(pos[oi].copy())
        new_norm_list.append(norms[oi].copy())
        new_uv_list.append(np.array([u_clean, v_clean], dtype=np.float32))
        new_j_list.append(joints[oi].copy())
        new_w_list.append(weights[oi].copy())
        return idx_out

    new_face_set = set(f for f in bm.faces if f in bridged_faces or any(v not in bm_to_origs for v in f.verts))
    new_tris = []
    for f in bm.faces:
        if f in new_face_set:
            vs = [get_tri_vert_idx(v) for v in f.verts]
            for k in range(1, len(vs) - 1):
                if len({vs[0], vs[k], vs[k + 1]}) == 3:
                    new_tris.append([vs[0], vs[k], vs[k + 1]])

    remaining_b = sum(1 for e in bm.edges if e.is_boundary)
    bm.free()

    if new_pos_list:
        pos = np.vstack([pos, np.stack(new_pos_list, axis=0)])
        norms = np.vstack([norms, np.stack(new_norm_list, axis=0)])
        uvs = np.vstack([uvs, np.stack(new_uv_list, axis=0)])
        joints = np.vstack([joints, np.stack(new_j_list, axis=0)])
        weights = np.vstack([weights, np.stack(new_w_list, axis=0)])

    merged_skin_tris = np.vstack([skin_tris, np.array(new_tris, dtype=np.int32)]) if new_tris else skin_tris
    return pos, norms, uvs, joints, weights, merged_skin_tris, len(new_pos_list), len(new_tris), remaining_b


def bake_cycles_ao(pos, uvs, skin_tris, dress_tris, face_pos, face_uvs, face_tris):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.cycles.bake_type = "AO"
    scene.render.bake.margin = 20
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.use_clear = False

    def make_mesh_obj(name, verts_np, tris_np, uv_np=None):
        u_idx, inv = np.unique(tris_np.reshape(-1), return_inverse=True)
        local_tris = inv.reshape(-1, 3)
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(map(float, verts_np[i])) for i in u_idx], [], [tuple(map(int, t)) for t in local_tris])
        if uv_np is not None:
            uv_layer = me.uv_layers.new(name="UVMap")
            for poly in me.polygons:
                for li in poly.loop_indices:
                    vi = u_idx[me.loops[li].vertex_index]
                    uv_layer.data[li].uv = (float(uv_np[vi, 0]), 1.0 - float(uv_np[vi, 1]))
        me.update()
        obj = bpy.data.objects.new(name, me)
        scene.collection.objects.link(obj)
        return obj

    body_obj = make_mesh_obj("BakeBody", pos, skin_tris, uvs)
    if len(dress_tris):
        make_mesh_obj("OcclDress", pos, dress_tris, None)
    face_obj = make_mesh_obj("BakeFace", face_pos, face_tris, face_uvs) if len(face_tris) else None

    ao_res = 1024
    def bake_obj_ao(obj, img_name):
        img = bpy.data.images.new(img_name, width=ao_res, height=ao_res, alpha=False)
        img.pixels.foreach_set([1.0] * (ao_res * ao_res * 4))
        mat = bpy.data.materials.new(img_name + "_Mat")
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.links.new(diff.outputs["BSDF"], out.inputs["Surface"])
        tex.select = True
        nt.nodes.active = tex
        obj.data.materials.append(mat)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        scene.world = bpy.data.worlds.new("AOWorld")
        scene.world.light_settings.distance = 0.045
        bpy.ops.object.bake(type="AO")
        px = np.array(img.pixels[:], dtype=np.float32).reshape(ao_res, ao_res, 4)
        px = np.flipud(px)[..., 0]
        return np.clip(px, 0.60, 1.0).astype(np.float32)

    body_ao = bake_obj_ao(body_obj, "BodyAO")
    face_ao = bake_obj_ao(face_obj, "FaceAO") if face_obj is not None else np.ones((ao_res, ao_res), dtype=np.float32)
    return body_ao, face_ao


def main():
    in_path, out_path = parse_args()
    data = np.load(in_path, allow_pickle=True)
    pos, norms, uvs, joints, weights, merged_tris, n_new_v, n_new_t, rem_b = build_refined_body(data)
    body_ao, face_ao = bake_cycles_ao(
        pos,
        uvs,
        merged_tris,
        data["dress_tris"].astype(np.int32).reshape(-1, 3),
        data["face_pos"].astype(np.float32),
        data["face_uv"].astype(np.float32),
        data["face_tris"].astype(np.int32).reshape(-1, 3),
    )
    np.savez_compressed(
        out_path,
        body_pos=pos,
        body_norm=norms,
        body_uv=uvs,
        body_joints=joints,
        body_weights=weights,
        skin_tris=merged_tris.reshape(-1),
        body_ao=body_ao,
        face_ao=face_ao,
        stats=np.array([n_new_v, n_new_t, rem_b], dtype=np.int32),
    )
    print(f"BLENDER_REFINE_OK new_verts={n_new_v} new_tris={n_new_t} remaining_boundary_edges={rem_b}")


if __name__ == "__main__":
    main()
