"""Check opaque fitted coverage and valid skinning in the shipped VRM."""
from pathlib import Path
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'pipeline'))
from style_crimson_lolita_vrm import parse_vrm, get_accessor_np

document, binary, _ = parse_vrm((ROOT/'assets/models/seraphina.vrm').read_bytes())
slices = [binary[v.get('byteOffset', 0):v.get('byteOffset', 0)+v['byteLength']] for v in document['bufferViews']]
mesh_index = next(i for i, mesh in enumerate(document['meshes']) if mesh.get('name') == 'Seraphina_BlackBriefs')
node = next(n for n in document['nodes'] if n.get('mesh') == mesh_index)
skin = document['skins'][node['skin']]
triangles = []
for primitive in document['meshes'][mesh_index]['primitives']:
    material = document['materials'][primitive['material']]
    assert material['alphaMode'] == 'OPAQUE' and material['doubleSided']
    color = material['pbrMetallicRoughness']['baseColorFactor']
    assert color[3] == 1 and max(color[:3]) < .05
    assert 'baseColorTexture' not in material['pbrMetallicRoughness']
    attrs = primitive['attributes']
    positions = get_accessor_np(document, slices, attrs['POSITION'])
    joints = get_accessor_np(document, slices, attrs['JOINTS_0'])
    weights = get_accessor_np(document, slices, attrs['WEIGHTS_0'])
    assert np.isfinite(positions).all() and np.isfinite(weights).all()
    assert joints.max() < len(skin['joints']) and np.allclose(weights.sum(axis=1), 1, atol=1e-5)
    indices = get_accessor_np(document, slices, primitive['indices']).reshape(-1, 3)
    assert indices.max() < len(positions)
    triangles.extend(positions[indices])
triangles = np.array(triangles)
# A grid of rays from underneath must all encounter actual opaque fabric,
# including the rear-central gap that a surface-only copy would leave open.
projected = triangles[:, :, [0, 2]]
origin = projected[:, 0]
u, v = projected[:, 1]-origin, projected[:, 2]-origin
det = u[:, 0]*v[:, 1]-u[:, 1]*v[:, 0]
valid = abs(det) > 1e-10
safe = np.where(valid, det, 1)
tested = 0
for x in np.linspace(-.025, .025, 11):
    for z in np.linspace(-.045, .045, 15):
        delta = np.array([x, z])-origin
        a = (delta[:, 0]*v[:, 1]-delta[:, 1]*v[:, 0])/safe
        b = (u[:, 0]*delta[:, 1]-u[:, 1]*delta[:, 0])/safe
        hits = valid & (a >= -1e-5) & (b >= -1e-5) & (a+b <= 1+1e-5)
        assert hits.any(), f'Uncovered underside at {x}, {z}'
        tested += 1
assert len(triangles) < 4000, 'Keep the hidden garment lightweight'
print(f'Underwear coverage passed: {tested} underside rays, opaque black fabric, normalized skin weights, {len(triangles)} triangles.')
