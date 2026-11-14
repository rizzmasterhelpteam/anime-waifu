from pathlib import Path
import sys,zipfile,copy,io,math,hashlib
import numpy as np
from PIL import Image
P=Path(__file__).resolve().parents[1];W=P/'work';f=P/'assets/models/seraphina.vrm'
sys.path.insert(0,str(P/'pipeline'))
from style_crimson_lolita_vrm import parse_vrm,pack_vrm,get_accessor_np,set_accessor_np,append_accessor
import argparse
parser=argparse.ArgumentParser(description='Build the repaired adult Seraphina gown and rounded silhouette.')
parser.add_argument('--source-archive',required=True,type=Path,help='Pre-styling adult archive with entry seraphina.vrm')
backup=parser.parse_args().source_archive
with zipfile.ZipFile(backup) as z:g,b,extra=parse_vrm(z.read('seraphina.vrm'))
s=[bytearray(b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]) for v in g['bufferViews']]
from repair_meshes import refine_torso,add_body_shell
refine_torso(g,s)

def shape(v):
    v=np.asarray(v,dtype=float);out=v.copy();x,y,z=v[:,0],v[:,1],v[:,2]
    front=np.clip((z-.012)/.060,0,1);torso=(abs(x)<.17)
    bust=np.exp(-((y-.900)/.075)**2)*np.exp(-((abs(x)-.047)/.080)**2)*front*torso
    out[:,0]*=1+.22*bust-.045*np.exp(-((y-.790)/.053)**2)*torso+.035*np.exp(-((y-.650)/.065)**2)*torso
    out[:,1]+=.006*bust
    out[:,2]+=.032*bust
    # Blend the old low-poly apex toward a broad, rounded two-lobe contour.
    q=1-((np.abs(out[:,0])-.050)/.080)**2-((out[:,1]-.900)/.080)**2
    dome=(np.sqrt(np.maximum(q,0)+.04)-.2)/(math.sqrt(1.04)-.2)
    target=.052+.110*dome
    blend=.75*bust
    out[:,2]=out[:,2]*(1-blend)+target*blend
    return out

seen=set();original_positions={}
for mi,mesh in enumerate(g['meshes']):
    if mi in [0,2]:continue
    for p in mesh['primitives']:
        ai=p['attributes']['POSITION']
        if ai in seen:continue
        seen.add(ai);v=get_accessor_np(g,s,ai);original_positions[ai]=v.copy();set_accessor_np(g,s,ai,shape(v))
        ni=p['attributes'].get('NORMAL')
        if ni is not None:
            eps=1e-4;jac=np.stack([(shape(v+np.eye(3)[k]*eps)-shape(v-np.eye(3)[k]*eps))/(2*eps) for k in range(3)],axis=-1)
            n=get_accessor_np(g,s,ni);n=np.einsum('nji,nj->ni',np.linalg.inv(jac),n);n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-8);set_accessor_np(g,s,ni,n)

skin=copy.deepcopy(g['materials'][21]);skin['name']='Seraphina_UpperChestSkin';skin['doubleSided']=True
skin['extensions']['VRMC_materials_mtoon']['outlineWidthFactor']=.00025
skinid=len(g['materials']);g['materials'].append(skin)
gold=copy.deepcopy(next(m for m in g['materials'] if m.get('name')=='Match_AntiqueGold'))
gold['name']='Seraphina_FlashGold';gold['pbrMetallicRoughness']['baseColorFactor']=[.78,.53,.20,1];gold['pbrMetallicRoughness']['metallicFactor']=.8;gold['pbrMetallicRoughness']['roughnessFactor']=.20
gold['extensions']['VRMC_materials_mtoon']['shadeColorFactor']=[.48,.29,.08];goldid=len(g['materials']);g['materials'].append(gold)

def vertex(p,i,attrs):
    return {k:attrs[k][i].copy() for k in ['p','n','uv','j','w']}
def lerp(a,b,t):
    o={k:a[k]+(b[k]-a[k])*t for k in ['p','n','uv']};d={}
    for v,fac in [(a,1-t),(b,t)]:
        for j,w in zip(v['j'],v['w']):d[int(j)]=d.get(int(j),0)+float(w)*fac
    items=sorted(d.items(),key=lambda x:-x[1])[:4];o['j']=np.zeros(4,np.uint16);o['w']=np.zeros(4)
    for k,(j,w) in enumerate(items):o['j'][k]=j;o['w'][k]=w
    o['w']/=max(o['w'].sum(),1e-9);return o
def split(poly,field):
    yes=[];no=[];edge=[]
    for i,a in enumerate(poly):
        bb=poly[(i+1)%len(poly)];da,db=field(a['p']),field(bb['p']);(yes if da>=0 else no).append(a)
        if (da>=0)!=(db>=0):
            v=lerp(a,bb,da/(da-db));yes.append(v);no.append(v);edge.append(v)
    return yes,no,edge
def tris(poly):return [[poly[0],poly[i],poly[i+1]] for i in range(1,len(poly)-1)] if len(poly)>2 else []
def neck(p):
    x,y,z=p;front=np.clip((z+.02)/.08,0,1)
    cutoff=(.923+.032*np.exp(-((abs(x)-.050)/.037)**2))*front+.945*(1-front)
    return y-cutoff
planes=[lambda p:.66-p[1],lambda p:p[0]+.0025-.075*p[1],lambda p:.1125-.075*p[1]-p[0],lambda p:p[2]-.018]
def slit(poly):
    keep=[];inside=poly;edges=[]
    for k,plane in enumerate(planes):
        yes,no,edge=split(inside,plane) if inside else ([],[],[])
        keep.extend(tris(no));inside=yes
        if k in [1,2] and len(edge)==2:edges.append(edge)
    return keep,inside,edges
def build_primitive(triangles,material):
    for tri in triangles:
        face=np.cross(tri[1]['p']-tri[0]['p'],tri[2]['p']-tri[0]['p'])
        if np.dot(face,tri[0]['n']+tri[1]['n']+tri[2]['n'])<0:tri[1],tri[2]=tri[2],tri[1]
    flat=[v for t in triangles for v in t];attrs={}
    for key,name,typ,shape_ in [('p','POSITION',5126,'VEC3'),('n','NORMAL',5126,'VEC3'),('uv','TEXCOORD_0',5126,'VEC2'),('j','JOINTS_0',5123,'VEC4'),('w','WEIGHTS_0',5126,'VEC4')]:
        a=np.array([v[key] for v in flat],np.uint16 if key=='j' else np.float32)
        if key=='n':a/=np.maximum(np.linalg.norm(a,axis=1,keepdims=True),1e-8)
        attrs[name]=append_accessor(g,s,a,typ,shape_,34962)
    idx=append_accessor(g,s,np.arange(len(flat),dtype=np.uint32).reshape(-1,1),5125,'SCALAR',34963)
    return {'attributes':attrs,'indices':idx,'material':material}

body=g['meshes'][1];new=[];skintris=[];trim=[]
arm_nodes={g['extensions']['VRMC_vrm']['humanoid']['humanBones'][k]['node'] for k in ['leftUpperArm','rightUpperArm','leftShoulder','rightShoulder']}
arm_joints={i for i,j in enumerate(g['skins'][1]['joints']) if j in arm_nodes}
for p in body['primitives']:
    mat=g['materials'][p['material']]['name']
    main='Tops_01_CLOTH_02' in mat;lining='Tops_01_CLOTH_03' in mat
    if not (main or lining):new.append(p);continue
    a=p['attributes'];arrays={key:get_accessor_np(g,s,a[name]) for key,name in [('p','POSITION'),('n','NORMAL'),('uv','TEXCOORD_0'),('j','JOINTS_0'),('w','WEIGHTS_0')]}
    wa=g['accessors'][a['WEIGHTS_0']]
    if wa.get('normalized'):arrays['w']=arrays['w'].astype(float)/(255 if wa['componentType']==5121 else 65535)
    idx=get_accessor_np(g,s,p['indices']).flatten().reshape(-1,3);cloth=[]
    original=original_positions.get(a['POSITION'],arrays['p'])
    for tri in idx:
        poly=[vertex(p,int(i),arrays) for i in tri];center=arrays['p'][tri].mean(0)
        arm_weight=(arrays['w'][tri]*np.isin(arrays['j'][tri],list(arm_joints))).sum(axis=1).mean()
        if main and original[tri,1].mean()>.88 and (np.max(abs(original[tri,0]))>.135 or arm_weight>.35):continue
        pieces=[poly]
        if main and max(v['p'][1] for v in poly)>.88:
            up,down,edge=split(poly,neck);skintris.extend(tris(up));pieces=[down]
            if len(edge)==2:trim.append(edge)
        for part in pieces:
            if not part:continue
            kept,cut,edges=slit(part);cloth.extend(kept)
            if main and cut:trim.extend(edges)
    if cloth:new.append(build_primitive(cloth,p['material']))
    g['materials'][p['material']]['alphaMode']='OPAQUE'
    g['materials'][p['material']]['pbrMetallicRoughness']['roughnessFactor']=.40
    # Brighten metallic embroidery without changing the navy and burgundy fabric palette.
    tex=g['materials'][p['material']].get('pbrMetallicRoughness',{}).get('baseColorTexture',{}).get('index')
    if tex is not None:
        bi=g['images'][g['textures'][tex]['source']]['bufferView'];im=Image.open(io.BytesIO(s[bi])).convert('RGBA');arr=np.array(im)
        r,gg,bb=arr[:,:,0].astype(float),arr[:,:,1].astype(float),arr[:,:,2].astype(float);mask=(r>gg*1.1)&(gg>bb*1.2)&(r>110)
        arr[mask,:3]=[232,191,111];buf=io.BytesIO();Image.fromarray(arr).save(buf,format='PNG');s[bi]=bytearray(buf.getvalue())
if skintris:new.append(build_primitive(skintris,skinid))
body['primitives']=new
# Thin gold piping follows the actual cut edges and the exact same skin weights.
goldtris=[]
for a,bb in trim:
    if np.linalg.norm(a['p']-bb['p'])<.0005:continue
    tangent=bb['p']-a['p'];tangent/=np.linalg.norm(tangent);normal=a['n']+bb['n'];normal/=max(np.linalg.norm(normal),1e-8)
    cross=np.cross(tangent,normal);cross/=max(np.linalg.norm(cross),1e-8)
    rings=[]
    for v in [a,bb]:
        ring=[]
        for i in range(6):
            n=normal*math.cos(i*math.tau/6)+cross*math.sin(i*math.tau/6);o={k:vv.copy() for k,vv in v.items()};o['p']=v['p']+normal*.0007+n*.0010;o['n']=n;ring.append(o)
        rings.append(ring)
    for i in range(6):
        j=(i+1)%6;goldtris.extend([[rings[0][i],rings[1][i],rings[0][j]],[rings[0][j],rings[1][i],rings[1][j]]])
if goldtris:body['primitives'].append(build_primitive(goldtris,goldid))
add_body_shell(g,s,shape)
g.setdefault('asset',{}).setdefault('extras',{})['adultPresentation']={'age':25,'style':'flashy evening gown','body':'fuller bust and tailored waist','coverage':'sweetheart bodice, open shoulders and high leg slit'}
out=bytearray()
for i,v in enumerate(g['bufferViews']):
    while len(out)%4:out.append(0)
    v['byteOffset']=len(out);v['byteLength']=len(s[i]);out.extend(s[i])
g['buffers'][0]['byteLength']=len(out);f.write_bytes(pack_vrm(g,bytes(out),extra))
print('Seraphina updated:',len(skintris),'upper-chest triangles,',len(goldtris),'trim triangles; full physics rig retained.')
