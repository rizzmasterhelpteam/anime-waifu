from pathlib import Path
import sys,zipfile,math
import numpy as np
P=Path(__file__).resolve().parents[1];W=P/'work'
sys.path.insert(0,str(P/'pipeline'))
from style_crimson_lolita_vrm import parse_vrm,pack_vrm,get_accessor_np,set_accessor_np
def matrix(n):
    if 'matrix' in n:return np.array(n['matrix']).reshape(4,4).T
    x,y,z,w=n.get('rotation',[0,0,0,1]);r=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
    m=np.eye(4);m[:3,:3]=r@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m

import argparse
args=argparse.ArgumentParser(description='Rebuild reference-matched character assets from a source archive.')
args.add_argument('--source-archive',required=True,type=Path)
backup=args.parse_args().source_archive
if not backup.is_file():raise FileNotFoundError(backup)
for name in ['seraphina','companion_alt']:
    with zipfile.ZipFile(backup) as z:g,b,extra=parse_vrm(z.read(name))
    slices=[bytearray(b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]) for v in g['bufferViews']]
    parents={c:i for i,n in enumerate(g['nodes']) for c in n.get('children',[])};world={}
    def wm(i):
        if i not in world:world[i]=(wm(parents[i]) if i in parents else np.eye(4))@matrix(g['nodes'][i])
        return world[i]
    for i in range(len(g['nodes'])):wm(i)
    bones=g['extensions']['VRMC_vrm']['humanoid']['humanBones'];head=bones['head']['node'];anchor=world[head][:3,3]
    headnodes=set()
    def descend(i):
        headnodes.add(i)
        for c in g['nodes'][i].get('children',[]):descend(c)
    descend(head)
    body_scale=np.array([.90,.60,.90]);head_scale=1.78 if name=='seraphina' else 1.87
    target_anchor=anchor*body_scale
    def warp(v,weight=0,hair=False):
        v=np.asarray(v);body=v*body_scale
        big=(v-anchor)*head_scale+target_anchor
        if hair:
            # Keep the long hairstyle at waist length while enlarging the upper hair with the head.
            below=v[...,1]<anchor[1]
            big[...,1]=np.where(below,target_anchor[1]+(v[...,1]-anchor[1])*1.05,big[...,1])
        return body*(1-np.asarray(weight)[...,None])+big*np.asarray(weight)[...,None]
    # Rebuild every bone's rest translation first, preserving the original rest orientations.
    target={}
    for i,n in enumerate(g['nodes']):
        m=world[i].copy();ishead=i in headnodes;hair='Hair' in n.get('name','')
        m[:3,3]=warp(m[:3,3],float(ishead),hair);target[i]=m
    for i,n in enumerate(g['nodes']):
        local=np.linalg.inv(target[parents[i]])@target[i] if i in parents else target[i]
        if 'matrix' in n:n['matrix']=local.T.reshape(-1).tolist()
        elif 'translation' in n or np.linalg.norm(local[:3,3])>1e-9:n['translation']=local[:3,3].tolist()
    meshskins={n['mesh']:n['skin'] for n in g['nodes'] if 'mesh'in n and 'skin'in n}
    seen=set();morphseen=set()
    # Remove the template's small braid links; both 2D references use swept, loose bangs.
    for mesh in g['meshes']:
        if 'hair' not in mesh.get('name','').lower():continue
        for prim in mesh['primitives']:
            pos=get_accessor_np(g,slices,prim['attributes']['POSITION']);ai=prim['indices'];tri=get_accessor_np(g,slices,ai).flatten().reshape(-1,3)
            parent=np.arange(len(pos))
            def root(x):
                while parent[x]!=x:parent[x]=parent[parent[x]];x=parent[x]
                return x
            for a,bb,c in tri:
                ra,rb,rc=root(a),root(bb),root(c);parent[rb]=ra;parent[rc]=ra
            labels=np.array([root(i) for i in range(len(pos))]);tl=labels[tri[:,0]];remove=[]
            for k,count in zip(*np.unique(tl,return_counts=True)):
                if count>32:continue
                pts=pos[np.unique(tri[tl==k])];lo=pts.min(0);hi=pts.max(0)
                if lo[0]>.005 and hi[0]<.100 and lo[1]>1.125 and hi[1]<1.25 and lo[2]>.02 and hi[2]<.09:remove.append(k)
            tri=tri[~np.isin(tl,remove)];set_accessor_np(g,slices,ai,tri.reshape(-1,1));g['accessors'][ai]['count']=tri.size
    for mi,mesh in enumerate(g['meshes']):
        if mi not in meshskins:continue
        skin=g['skins'][meshskins[mi]];sj=skin['joints'];is_hair='hair' in mesh.get('name','').lower()
        for p in mesh['primitives']:
            attrs=p['attributes'];ai=attrs['POSITION']
            if ai in seen:continue
            seen.add(ai);pos=get_accessor_np(g,slices,ai)
            if is_hair:
                sweep=(pos[:,2]>.055)&(pos[:,1]>1.12)&(abs(pos[:,0])<.105)
                pos[sweep,1]+=.030*np.clip((pos[sweep,0]+.10)/.20,0,1)*np.clip((1.235-pos[sweep,1])/.09,0,1)
            original=pos.copy()
            joints=get_accessor_np(g,slices,attrs['JOINTS_0']).astype(int);weights=get_accessor_np(g,slices,attrs['WEIGHTS_0']).astype(float)
            if g['accessors'][attrs['WEIGHTS_0']].get('normalized'):
                weights/=255 if g['accessors'][attrs['WEIGHTS_0']]['componentType']==5121 else 65535
            weights/=np.maximum(weights.sum(axis=1,keepdims=True),1e-8)
            mask=np.isin(np.array(sj)[joints],list(headnodes));headweight=(weights*mask).sum(axis=1)
            pos=warp(pos,headweight,is_hair)
            material=g['materials'][p.get('material',0)].get('name','')
            if material in ['Match_AntiqueGold','Match_Ruby','Match_Amethyst']:
                pendant=(headweight<.05)&(original[:,1]>.94)&(original[:,1]<1.02)&(abs(original[:,0])<.03)&(original[:,2]>.08)
                center=np.array([0,.968,.103]) if name=='seraphina' else np.array([0,.991,.116])
                center=warp(center,0)
                pos[pendant]=center+(pos[pendant]-center)*1.35
                pos[pendant,1]-=.005
                pos[pendant,2]+=.012
            set_accessor_np(g,slices,ai,pos)
            scale=body_scale[None,:]*(1-headweight[:,None])+head_scale*headweight[:,None]
            if is_hair:scale[original[:,1]<anchor[1],1]=(1-headweight[original[:,1]<anchor[1]])*.60+headweight[original[:,1]<anchor[1]]*1.05
            if 'NORMAL'in attrs:
                ni=attrs['NORMAL'];norm=get_accessor_np(g,slices,ni)/scale;norm/=np.maximum(np.linalg.norm(norm,axis=1,keepdims=True),1e-8);set_accessor_np(g,slices,ni,norm)
            for morph in p.get('targets',[]):
                for key,idx in morph.items():
                    if idx in morphseen:continue
                    morphseen.add(idx);delta=get_accessor_np(g,slices,idx)
                    if key=='POSITION':delta*=scale
                    elif key=='NORMAL':delta/=scale
                    set_accessor_np(g,slices,idx,delta)
    # New inverse bind matrices make the new proportions the true rest pose of each rig.
    for skin in g['skins']:
        ai=skin.get('inverseBindMatrices')
        if ai is not None:
            matrices=np.array([np.linalg.inv(target[j]).T.reshape(-1) for j in skin['joints']],np.float32)
            set_accessor_np(g,slices,ai,matrices)
    spring=g.get('extensions',{}).get('VRMC_springBone',{})
    for c in spring.get('colliders',[]):
        i=c['node'];ish=i in headnodes;hair='Hair'in g['nodes'][i].get('name','')
        for shape in c.get('shape',{}).values():
            for key in ['offset','tail']:
                if key in shape:
                    wp=(world[i]@np.array([*shape[key],1]))[:3];new=warp(wp,float(ish),hair)
                    shape[key]=(np.linalg.inv(target[i])@np.array([*new,1]))[:3].tolist()
            if 'radius'in shape:shape['radius']*=head_scale if ish else .9
    for s in spring.get('springs',[]):
        for j in s.get('joints',[]):
            if 'hitRadius'in j:j['hitRadius']*=1.35 if j['node'] in headnodes else .8
    look=g['extensions']['VRMC_vrm'].get('lookAt',{})
    if 'offsetFromHeadBone'in look:look['offsetFromHeadBone']=(np.array(look['offsetFromHeadBone'])*head_scale).tolist()
    out=bytearray()
    for i,v in enumerate(g['bufferViews']):
        while len(out)%4:out.append(0)
        v['byteOffset']=len(out);v['byteLength']=len(slices[i]);out.extend(slices[i])
    g['buffers'][0]['byteLength']=len(out)
    g.setdefault('asset',{}).setdefault('extras',{})['characterStyle']='chibi-reference'
    g['asset']['extras']['characterId']=name
    (P/f'assets/models/{name}.vrm').write_bytes(pack_vrm(g,bytes(out),extra))
    print('Chibi rig rebuilt:',name,'head scale',head_scale,'body height scale',body_scale[1])
