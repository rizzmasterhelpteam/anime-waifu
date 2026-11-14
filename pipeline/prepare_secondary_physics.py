from pathlib import Path
import sys,zipfile,copy
import numpy as np
P=Path(__file__).resolve().parents[1];W=P/'work'
sys.path.insert(0,str(P/'pipeline'))
from style_crimson_lolita_vrm import parse_vrm,pack_vrm,get_accessor_np,set_accessor_np,append_accessor
import argparse
parser=argparse.ArgumentParser(description='Add secondary motion joints and clothing weights to the adult character models.')
parser.add_argument('--source-archive',required=True,type=Path)
backup=parser.parse_args().source_archive
if not backup.is_file():raise FileNotFoundError(backup)
def matrix(n):
    x,y,z,w=n.get('rotation',[0,0,0,1]);r=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
    m=np.eye(4);m[:3,:3]=r@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m
for name in ['seraphina','companion_alt']:
    with zipfile.ZipFile(backup) as z:g,b,e=parse_vrm(z.read(name))
    slices=[bytearray(b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]) for v in g['bufferViews']]
    parent={c:i for i,n in enumerate(g['nodes']) for c in n.get('children',[])};world={}
    def wm(i):
        if i not in world:world[i]=(wm(parent[i]) if i in parent else np.eye(4))@matrix(g['nodes'][i])
        return world[i]
    for i in range(len(g['nodes'])):wm(i)
    byname={n.get('name'):i for i,n in enumerate(g['nodes'])};bones=g['extensions']['VRMC_vrm']['humanoid']['humanBones'];skin=g['skins'][1];metadata=[];added=[]
    def add_bone(label,key,position,group,side=0,front=0):
        pi=bones[key]['node'];local=(np.linalg.inv(world[pi])@np.array([*position,1]))[:3]
        i=len(g['nodes']);g['nodes'].append({'name':label,'translation':local.tolist()});g['nodes'][pi].setdefault('children',[]).append(i)
        m=world[pi].copy();m[:3,3]=position;world[i]=m;added.append(i)
        metadata.append({'node':i,'group':group,'side':side,'front':front,'link':0})
        return len(skin['joints'])+len(added)-1
    bust={}
    for side,sgn in [('L',1),('R',-1)]:
        for link in [1,2]:
            i=byname.get(f'J_Sec_{side}_Bust{link}')
            if i is not None:
                metadata.append({'node':i,'group':'chest','side':sgn,'link':link-1});
                if link==1:bust[sgn]=(skin['joints'].index(i),world[i][:3,3])
                elif sgn in bust:bust[sgn]=(skin['joints'].index(i),bust[sgn][1])
    ears={sgn:add_bone('Secondary_Earring_'+side,'head',[sgn*.083,world[bones['head']['node']][1,3]+.08,.045],'earring',sgn) for side,sgn in [('L',1),('R',-1)]}
    pendant=add_bone('Secondary_Pendant','upperChest',[0,.995,.090],'pendant') if name=='seraphina' else None
    bow=add_bone('Secondary_Bow','head',[.098,1.204,.091],'bow') if name=='companion_alt' else None
    cloth={(side,front):add_bone(f'Secondary_Cloth_{side}_{front}','hips',[side*.075,.72,front*.035],'cloth',side,front) for side in [-1,1] for front in [-1,1]}
    # Extend all matching skin tables so every shared vertex attribute can reference the new joints.
    for sk in g['skins']:
        matrices=get_accessor_np(g,slices,sk['inverseBindMatrices']);new=np.array([np.linalg.inv(world[i]).T.reshape(-1) for i in added],np.float32)
        sk['joints'].extend(added)
        sk['inverseBindMatrices']=append_accessor(g,slices,np.concatenate([matrices,new]),5126,'MAT4',34962)
        g['bufferViews'][g['accessors'][sk['inverseBindMatrices']]['bufferView']].pop('target',None)
    processed=set();weighted=0
    for mi,mesh in enumerate(g['meshes']):
        if mi==0 or mi==2:continue
        for prim in mesh['primitives']:
            a=prim['attributes']
            if 'JOINTS_0' not in a:continue
            ident=(a['JOINTS_0'],a['WEIGHTS_0'])
            if ident in processed:continue
            processed.add(ident)
            pos=get_accessor_np(g,slices,a['POSITION']);joints=get_accessor_np(g,slices,a['JOINTS_0']).astype(np.uint16);weights=get_accessor_np(g,slices,a['WEIGHTS_0']).astype(float)
            wa=g['accessors'][a['WEIGHTS_0']]
            if wa.get('normalized'):weights/=255 if wa['componentType']==5121 else 65535
            weights/=np.maximum(weights.sum(axis=1,keepdims=True),1e-8)
            material=g['materials'][prim.get('material',0)].get('name','')
            cloth_vertices=np.zeros(len(pos),bool)
            for source_mesh in g['meshes']:
                for source_prim in source_mesh['primitives']:
                    sa=source_prim['attributes']
                    if (sa.get('JOINTS_0'),sa.get('WEIGHTS_0'))!=ident:continue
                    label=g['materials'][source_prim.get('material',0)].get('name','')
                    if (label.startswith('Match_') or 'CLOTH'in label) and not any(t in label for t in ['Boot','Stocking','Shoes']):cloth_vertices[get_accessor_np(g,slices,source_prim['indices']).flatten()]=True
            # Shared body buffers include several materials; geometry position gates isolate each region.
            def mix(k,weight,index):
                weight=float(np.clip(weight,0,.85));d={int(x):float(y)*(1-weight) for x,y in zip(joints[k],weights[k]) if y>0}
                d[index]=d.get(index,0)+weight;items=sorted(d.items(),key=lambda v:-v[1])[:4];total=sum(v for _,v in items)
                joints[k]=0;weights[k]=0
                for q,(ji,ww) in enumerate(items):joints[k,q]=ji;weights[k,q]=ww/total
            for k,v in enumerate(pos):
                x,y,z=v;side=1 if x>=0 else -1
                # Earrings and ribbons receive dedicated hinges; the collar brooch remains attached.
                if material.startswith('Match_') and .065<abs(x)<.105 and 1.04<y<1.20 and .02<z<.07 and any(t in material for t in ['Gold','Silver','Ruby','Amethyst']):
                    joints[k]=[ears[side],0,0,0];weights[k]=[1,0,0,0];continue
                if pendant is not None and material.startswith('Match_') and abs(x)<.06 and .94<y<1.02 and z>.035 and any(t in material for t in ['Gold','Amethyst']):
                    joints[k]=[pendant,0,0,0];weights[k]=[1,0,0,0];continue
                if bow is not None and material=='Match_Ribbon':joints[k]=[bow,0,0,0];weights[k]=[1,0,0,0];continue
                # Give the clothed chest the same mass response as the underlying anatomy.
                if side in bust and .82<y<.99 and z>.025 and abs(x)<.14:
                    ji,center=bust[side];amount=np.exp(-((y-center[1])/.065)**2)*np.exp(-((abs(x)-abs(center[0]))/.065)**2)*np.clip((z-.025)/.055,0,1)*.78
                    if amount>.015:mix(k,amount,ji);weighted+=1
                # Controlled cloth hinges replace the incompatible original skirt spring chains.
                if .035<y<.745 and cloth_vertices[k]:
                    amount=np.clip((.745-y)/.35,0,1)*.72;mix(k,amount,cloth[(side,1 if z>.005 else -1)])
            # Joint arrays may have been byte sized; replace them with portable ushort/float attributes.
            ja=append_accessor(g,slices,joints.astype(np.uint16),5123,'VEC4',34962);ww=append_accessor(g,slices,weights.astype(np.float32),5126,'VEC4',34962)
            processed.add((ja,ww))
            for othermesh in g['meshes']:
                for pr in othermesh['primitives']:
                    if (pr['attributes'].get('JOINTS_0'),pr['attributes'].get('WEIGHTS_0'))==ident:pr['attributes']['JOINTS_0']=ja;pr['attributes']['WEIGHTS_0']=ww
    springs=g.get('extensions',{}).get('VRMC_springBone',{}).get('springs',[])
    if springs:g['extensions']['VRMC_springBone']['springs']=[s for s in springs if 'bust' not in s.get('name','').lower()]
    g.setdefault('asset',{}).setdefault('extras',{})['secondaryMotion']={'version':1,'bones':metadata}
    out=bytearray()
    for i,v in enumerate(g['bufferViews']):
        while len(out)%4:out.append(0)
        v['byteOffset']=len(out);v['byteLength']=len(slices[i]);out.extend(slices[i])
    g['buffers'][0]['byteLength']=len(out);(P/f'assets/models/{name}.vrm').write_bytes(pack_vrm(g,bytes(out),e))
    print(name,':',len(metadata),'secondary bones;',weighted,'chest vertices connected to physics')
