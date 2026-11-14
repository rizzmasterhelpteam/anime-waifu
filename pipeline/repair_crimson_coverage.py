from pathlib import Path
import sys,zipfile,argparse
import numpy as np
P=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(P/'pipeline'))
from style_crimson_lolita_vrm import parse_vrm,pack_vrm,get_accessor_np,set_accessor_np
from repair_meshes import add_body_shell
parser=argparse.ArgumentParser(description='Repair the adult Crimson coat fit and continuous body coverage.')
parser.add_argument('--source-archive',required=True,type=Path,help='Pre-repair archive containing companion_alt')
args=parser.parse_args()
with zipfile.ZipFile(args.source_archive) as z:g,b,e=parse_vrm(z.read('companion_alt'))
sl=[bytearray(b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]) for v in g['bufferViews']]
skin_points=[];skin_joints=[];skin_weights=[];skin_normals=[]
for pr in g['meshes'][1]['primitives']:
    mat=g['materials'][pr.get('material',0)].get('name','')
    if 'SKIN'not in mat and 'Skin'not in mat:continue
    a=pr['attributes'];v=get_accessor_np(g,sl,a['POSITION']);ids=np.unique(get_accessor_np(g,sl,pr['indices']));ids=ids[(abs(v[ids,0])>.12)&(v[ids,1]>.87)&(v[ids,1]<1.08)]
    skin_points.extend(v[ids]);skin_joints.extend(get_accessor_np(g,sl,a['JOINTS_0'])[ids]);skin_weights.extend(get_accessor_np(g,sl,a['WEIGHTS_0'])[ids]);skin_normals.extend(get_accessor_np(g,sl,a['NORMAL'])[ids])
skin_points=np.array(skin_points);skin_joints=np.array(skin_joints);skin_weights=np.array(skin_weights);skin_normals=np.array(skin_normals)
for mesh in g['meshes']:
    if mesh.get('name')!='ReferenceMatched_Wardrobe':continue
    for pr in mesh['primitives']:
        label=g['materials'][pr.get('material',0)].get('name','')
        if not any(k in label for k in ['Burgundy','Waistcoat','Lapel','AntiqueGold']):continue
        a=pr['attributes'];v=get_accessor_np(g,sl,a['POSITION']);idx=get_accessor_np(g,sl,pr['indices']).flatten().reshape(-1,3);n=np.zeros_like(v)
        sleeve=(abs(v[:,0])>.135)&(v[:,1]>.88)&(v[:,1]<1.06)
        if sleeve.any() and len(skin_points):
            joints=get_accessor_np(g,sl,a['JOINTS_0']);weights=get_accessor_np(g,sl,a['WEIGHTS_0']);original=v.copy()
            for i in np.flatnonzero(sleeve):
                near=np.argmin(((skin_points-original[i])**2).sum(axis=1));center=skin_points[near]
                normal=skin_normals[near];normal=normal/max(np.linalg.norm(normal),1e-8);clearance=np.dot(original[i]-center,normal)
                v[i]+=normal*np.clip(.004-clearance,0,.012)
                joints[i]=skin_joints[near];weights[i]=skin_weights[near]
            set_accessor_np(g,sl,a['POSITION'],v);set_accessor_np(g,sl,a['JOINTS_0'],joints);set_accessor_np(g,sl,a['WEIGHTS_0'],weights)
        back=(v[:,2]<.005)&(v[:,1]>.45)&(v[:,1]<.87)&(abs(v[:,0])<.20)
        v[back,2]-=.028*np.exp(-((v[back,1]-.70)/.14)**2)*np.clip(-v[back,2]/.05,0,1)
        set_accessor_np(g,sl,a['POSITION'],v)
        for aa,bb,cc in idx:
            nn=np.cross(v[bb]-v[aa],v[cc]-v[aa]);n[aa]+=nn;n[bb]+=nn;n[cc]+=nn
        n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-8);set_accessor_np(g,sl,a['NORMAL'],n)
add_body_shell(g,sl)
out=bytearray()
for i,v in enumerate(g['bufferViews']):
    while len(out)%4:out.append(0)
    v['byteOffset']=len(out);v['byteLength']=len(sl[i]);out.extend(sl[i])
g['buffers'][0]['byteLength']=len(out);(P/'assets/models/companion_alt.vrm').write_bytes(pack_vrm(g,bytes(out),e))
print('Crimson coverage and coat fit repaired.')
