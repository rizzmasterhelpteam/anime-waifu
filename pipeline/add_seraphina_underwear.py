"""Fit opaque black briefs to Seraphina's existing skinned pelvis surface."""
import argparse
import copy
from pathlib import Path
import numpy as np
from style_crimson_lolita_vrm import parse_vrm, pack_vrm, get_accessor_np, append_accessor

ROOT = Path(__file__).resolve().parents[1]
NAME = 'Seraphina_BlackBriefs'


def build(document, slices):
    if any(mesh.get('name') == NAME for mesh in document['meshes']):
        raise ValueError('Briefs are already fitted; use an unmodified source to rebuild')
    positions, normals, joints, weights, faces, bands = [], [], [], [], [], []
    surface, source_positions, source_joints, source_weights = [], [], [], []
    for mesh in document['meshes']:
        for primitive in mesh['primitives']:
            material = document['materials'][primitive['material']]['name']
            if 'Body_00_SKIN' not in material and mesh.get('name') != 'Repair_ContinuousTorso':
                continue
            attrs = primitive['attributes']
            p = get_accessor_np(document, slices, attrs['POSITION'])
            j = get_accessor_np(document, slices, attrs['JOINTS_0'])
            w = get_accessor_np(document, slices, attrs['WEIGHTS_0']).astype(float)
            accessor = document['accessors'][attrs['WEIGHTS_0']]
            if accessor.get('normalized'):
                w /= 255 if accessor['componentType'] == 5121 else 65535
            tri = get_accessor_np(document, slices, primitive['indices']).reshape(-1, 3)
            chosen = tri[(p[tri, 1].max(axis=1) >= .595) & (p[tri, 1].min(axis=1) <= .712)]
            surface.extend(p[chosen])
            selected = np.unique(chosen)
            source_positions.extend(p[selected]);source_joints.extend(j[selected]);source_weights.extend(w[selected])
    surface = np.array(surface)
    source_positions, source_joints, source_weights = map(np.array, [source_positions, source_joints, source_weights])
    def fitted_radius(y, theta):
        direction = np.array([np.sin(theta), np.cos(theta)])
        center = np.array([0, .005])
        intersections = []
        for a, b in [(0, 1), (1, 2), (2, 0)]:
            edge_a, edge_b = surface[:, a], surface[:, b]
            crosses = ((edge_a[:, 1] <= y) & (edge_b[:, 1] > y)) | ((edge_b[:, 1] <= y) & (edge_a[:, 1] > y))
            factor = (y-edge_a[crosses, 1])/(edge_b[crosses, 1]-edge_a[crosses, 1])
            points = edge_a[crosses]+factor[:, None]*(edge_b[crosses]-edge_a[crosses])
            # Keep triangle IDs so its two plane intersections form one segment.
            intersections.extend(zip(np.flatnonzero(crosses), points[:, [0, 2]]))
        by_triangle = {}
        for triangle, point in intersections:
            by_triangle.setdefault(triangle, []).append(point)
        segments = np.array([points[:2] for points in by_triangle.values() if len(points) >= 2])
        if len(segments):
            a, edge = segments[:, 0]-center, segments[:, 1]-segments[:, 0]
            determinant = direction[0]*edge[:, 1]-direction[1]*edge[:, 0]
            valid = abs(determinant) > 1e-9
            safe = np.where(valid, determinant, 1)
            distance = (a[:, 0]*edge[:, 1]-a[:, 1]*edge[:, 0])/safe
            u = (a[:, 0]*direction[1]-a[:, 1]*direction[0])/safe
            candidates = distance[valid & (u >= 0) & (u <= 1) & (distance > .005) & (distance < .18)]
            if len(candidates):
                return candidates.max()+.0018
        # Across the space between the legs, continue the cloth into its gusset.
        rx = np.interp(y, [.615, .635, .66, .69, .71], [.126, .133, .133, .122, .110])
        rz = np.interp(y, [.615, .65, .71], [.071, .081, .080])
        return 1/np.sqrt((direction[0]/rx)**2+(direction[1]/rz)**2)+.0018
    def append(point):
        nearest = np.argsort(np.linalg.norm(source_positions-point, axis=1))[:3]
        factors = 1/np.maximum(np.linalg.norm(source_positions[nearest]-point, axis=1), .001)
        factors /= factors.sum()
        influences = {}
        for vertex, factor in zip(nearest, factors):
            for joint, weight in zip(source_joints[vertex], source_weights[vertex]):
                influences[int(joint)] = influences.get(int(joint), 0)+float(weight*factor)
        pairs = sorted(influences.items(), key=lambda item: -item[1])[:4]
        jj, ww = np.zeros(4, np.uint16), np.zeros(4)
        for slot, (joint, weight) in enumerate(pairs):
            jj[slot], ww[slot] = joint, weight
        positions.append(point);joints.append(jj);weights.append(ww/ww.sum())
    segments, panel_rows, band_rows = 64, 20, 3
    for row in range(panel_rows+band_rows+1):
        for column in range(segments):
            theta = column/segments*np.pi*2
            bottom = .615+.072*abs(np.sin(theta))**1.05
            y = bottom+(.702-bottom)*row/panel_rows if row <= panel_rows else .702+.008*(row-panel_rows)/band_rows
            radius = fitted_radius(y, theta)
            append(np.array([radius*np.sin(theta), y, .005+radius*np.cos(theta)]))
            if row:
                previous = (column-1) % segments
                a, b = (row-1)*segments+previous, (row-1)*segments+column
                c, d = row*segments+previous, row*segments+column
                faces.extend([[a, c, b], [b, c, d]])
                bands.extend([int(row > panel_rows)]*2)
    # Sew the front and rear lower arcs together with a continuous gusset.
    # Its edges remain the leg openings; the central underside has no hole.
    gusset_start, gusset_columns, gusset_rows = len(positions), 8, 20
    for row in range(gusset_rows+1):
        t = row/gusset_rows
        for column in range(gusset_columns+1):
            angle_index = column-gusset_columns//2
            front = positions[angle_index % segments]
            back = positions[(segments//2-angle_index) % segments]
            point = front*(1-t)+back*t
            point = point.copy();point[1] -= .004*np.sin(t*np.pi)
            append(point)
            if row and column:
                a = gusset_start+(row-1)*(gusset_columns+1)+column-1
                b, c, d = a+1, a+gusset_columns+1, a+gusset_columns+2
                faces.extend([[a, c, b], [b, c, d]]);bands.extend([0, 0])
    points = np.array(positions)
    normals = np.zeros_like(points)
    for a, b, c in faces:
        normal = np.cross(points[b]-points[a], points[c]-points[a])
        normals[a] += normal;normals[b] += normal;normals[c] += normal
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8)
    source_count = len(surface)
    materials = []
    template = next(m for m in document['materials'] if m['name'] == 'Repair_ContinuousSkin')
    for suffix, color in [('Panel', [.009, .011, .016, 1]), ('Waistband', [.023, .026, .034, 1])]:
        material = copy.deepcopy(template)
        material['name'] = NAME+'_'+suffix
        material['pbrMetallicRoughness'] = {'baseColorFactor': color, 'metallicFactor': 0, 'roughnessFactor': .95}
        material['alphaMode'], material['doubleSided'] = 'OPAQUE', True
        material.pop('alphaCutoff', None)
        toon = material['extensions']['VRMC_materials_mtoon']
        toon.update(shadeColorFactor=[.006, .007, .01], matcapFactor=[0, 0, 0], outlineWidthFactor=0, transparentWithZWrite=False)
        materials.append(len(document['materials']))
        document['materials'].append(material)
    attributes = {}
    for name, values, component, kind in [('POSITION', positions, 5126, 'VEC3'), ('NORMAL', normals, 5126, 'VEC3'),
                                           ('JOINTS_0', joints, 5123, 'VEC4'), ('WEIGHTS_0', weights, 5126, 'VEC4')]:
        attributes[name] = append_accessor(document, slices, np.array(values, dtype=np.uint16 if component == 5123 else np.float32), component, kind, 34962)
    primitives = []
    for band in [0, 1]:
        selected = np.array(faces, np.uint32)[np.array(bands) == band]
        primitives.append({'attributes': attributes.copy(), 'material': materials[band],
                           'indices': append_accessor(document, slices, selected.reshape(-1, 1), 5125, 'SCALAR', 34963)})
    mesh_index = len(document['meshes'])
    document['meshes'].append({'name': NAME, 'primitives': primitives})
    document['scenes'][0]['nodes'].append(len(document['nodes']))
    document['nodes'].append({'name': NAME, 'mesh': mesh_index, 'skin': 1})
    document['asset'].setdefault('extras', {})['underwear'] = {
        'mesh': NAME, 'style': 'black triangle briefs with full gusset and waistband',
        'opaque': True, 'skinned': True, 'sourceTriangles': source_count}
    return len(positions), len(faces)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, default=ROOT/'assets/models/seraphina.vrm')
    parser.add_argument('--output', type=Path, default=ROOT/'assets/models/seraphina.vrm')
    args = parser.parse_args()
    original = args.input.read_bytes()
    backup = ROOT/'work/seraphina-before-underwear.vrm'
    if not backup.exists():
        backup.write_bytes(original)
    document, binary, extra = parse_vrm(original)
    slices = [bytearray(binary[v.get('byteOffset', 0):v.get('byteOffset', 0)+v['byteLength']]) for v in document['bufferViews']]
    print('Fitted briefs (vertices, triangles):', build(document, slices))
    output = bytearray()
    for view, data in zip(document['bufferViews'], slices):
        while len(output) % 4:
            output.append(0)
        view['byteOffset'], view['byteLength'] = len(output), len(data)
        output.extend(data)
    document['buffers'][0]['byteLength'] = len(output)
    args.output.write_bytes(pack_vrm(document, bytes(output), extra))
