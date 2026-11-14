"""Close cut shoulder joins and small skin openings without changing the outfit silhouette."""
from pathlib import Path
import argparse,sys,zipfile,copy
from collections import Counter,defaultdict
import numpy as np
P=Path(__file__).resolve().parents[1];sys.path.insert(0,str(P/'pipeline'))
from style_crimson_lolita_vrm import parse_vrm,pack_vrm,get_accessor_np,set_accessor_np,append_accessor
from repair_meshes import matrix

def repair(g,s):
    if any(m.get('name')=='Repair_ShoulderJoins' for m in g['meshes']):raise ValueError('Already repaired; use the pre-repair archive')
    nodes={};coords=[];joints=[];weights=[];edges=Counter()
    for p in g['meshes'][1]['primitives']:
        name=g['materials'][p['material']]['name']
        if 'Skin' not in name and 'SKIN' not in name:continue
        a=p['attributes'];v=get_accessor_np(g,s,a['POSITION']);js=get_accessor_np(g,s,a['JOINTS_0']);ws=get_accessor_np(g,s,a['WEIGHTS_0']);tri=get_accessor_np(g,s,p['indices']).reshape(-1,3);ids={}
        for i in np.unique(tri):
            key=tuple(np.round(v[i],5));idx=nodes.get(key)
            if idx is None:idx=len(coords);coords.append(v[i]);joints.append(js[i]);weights.append(ws[i]);nodes[key]=idx
            ids[i]=idx
        for t in tri:
            for x,y in [(t[0],t[1]),(t[1],t[2]),(t[2],t[0])]:
                a,b=ids[x],ids[y]
                if a!=b:edges[tuple(sorted((a,b)))]+=1
    adj=defaultdict(set)
    for (a,b),count in edges.items():
        if count==1:adj[a].add(b);adj[b].add(a)
    loops=[];seen=set()
    for start in adj:
        if start in seen:continue
        loop=[];cur=start;prev=None
        while cur not in seen:
            seen.add(cur);loop.append(cur);nxt=[n for n in adj[cur] if n!=prev]
            if not nxt:break
            prev,cur=cur,nxt[0]
        if cur==start and all(len(adj[i])==2 for i in loop):loops.append(loop)
    bones=g['extensions']['VRMC_vrm']['humanoid']['humanBones'];skin=g['skins'][1]
    parent={c:i for i,n in enumerate(g['nodes']) for c in n.get('children',[])};world={}
    def wm(i):
        if i not in world:world[i]=(wm(parent[i]) if i in parent else np.eye(4))@matrix(g['nodes'][i])
        return world[i]
    pos=[];jj=[];ww=[];tris=[];bridges=0;caps=0
    def add(v,j,w):
        i=len(pos);pos.append(v);jj.append(j);ww.append(w);return i
    def blend(j1,w1,j2,w2,t):
        d=defaultdict(float)
        for j,w in zip(j1,w1):d[int(j)]+=(1-t)*float(w)
        for j,w in zip(j2,w2):d[int(j)]+=t*float(w)
        pairs=sorted(d.items(),key=lambda p:-p[1])[:4];js=np.zeros(4,np.uint16);ws=np.zeros(4)
        for i,(j,w) in enumerate(pairs):js[i]=j;ws[i]=w
        return js,ws/max(ws.sum(),1e-8)
    for loop in loops:
        v=np.array([coords[i] for i in loop]);center=v.mean(axis=0);extent=np.ptp(v,axis=0);n=len(loop)
        shoulder=.13<abs(center[0])<.19 and .91<center[1]<1.01 and extent[0]<.025 and .035<extent[1]<.075
        if shoulder:
            side='left' if center[0]>0 else 'right';arm=bones[side+'UpperArm']['node'];chest=bones['upperChest']['node'];root=wm(arm)[:3,3]
            # Start exactly at the original cut loop, including its original skin weights.
            outer=[add(coords[i],joints[i],weights[i]) for i in loop];previous=outer
            for t in [.25,.5,.75,1]:
                anchor=root.copy();anchor[0]-=np.sign(center[0])*.018
                c=center*(1-t)+anchor*t;ring=[]
                targetJ=np.array([skin['joints'].index(arm),skin['joints'].index(chest),0,0],np.uint16);targetW=np.array([.40,.60,0,0])
                for i,vi in enumerate(v):
                    d=vi-center;d[0]=0;d[1:]*=1+.14*np.sin(np.pi*t)
                    j,w=blend(joints[loop[i]],weights[loop[i]],targetJ,targetW,t)
                    ring.append(add(c+d,j,w))
                for i in range(n):
                    k=(i+1)%n;tris.extend([[previous[i],previous[k],ring[i]],[previous[k],ring[k],ring[i]]])
                previous=ring
            ci=add(anchor,targetJ,targetW)
            for i in range(n):tris.append([previous[i],previous[(i+1)%n],ci])
            bridges+=1
        elif extent.max()<.071 and len(loop)<=60:
            # Cap only small cut skin openings; retain the neck/head and costume openings.
            ring=[add(coords[i],joints[i],weights[i]) for i in loop];d=defaultdict(float)
            for i in loop:
                for j,w in zip(joints[i],weights[i]):d[int(j)]+=float(w)/n
            pairs=sorted(d.items(),key=lambda p:-p[1])[:4];js=np.zeros(4,np.uint16);ws=np.zeros(4)
            for i,(j,w) in enumerate(pairs):js[i]=j;ws[i]=w
            ci=add(center,js,ws/max(ws.sum(),1e-8))
            for i in range(n):tris.append([ring[i],ring[(i+1)%n],ci])
            caps+=1
    assert bridges==2,(bridges,caps)
    v=np.array(pos,np.float32);ind=np.array(tris,np.uint32);norm=np.zeros_like(v)
    for a,b,c in ind:
        nn=np.cross(v[b]-v[a],v[c]-v[a]);norm[a]+=nn;norm[b]+=nn;norm[c]+=nn
    norm/=np.maximum(np.linalg.norm(norm,axis=1,keepdims=True),1e-8)
    attrs={}
    for k,a,ct,typ in [('POSITION',v,5126,'VEC3'),('NORMAL',norm,5126,'VEC3'),('JOINTS_0',np.array(jj,np.uint16),5123,'VEC4'),('WEIGHTS_0',np.array(ww,np.float32),5126,'VEC4')]:attrs[k]=append_accessor(g,s,a,ct,typ,34962)
    mat=copy.deepcopy(next(m for m in g['materials'] if m['name']=='Repair_ContinuousSkin'));mat['name']='Repair_JoinSkin';mat['doubleSided']=True;mat['extensions']['VRMC_materials_mtoon']['outlineWidthFactor']=0
    mid=len(g['materials']);g['materials'].append(mat);mi=len(g['meshes']);g['meshes'].append({'name':'Repair_ShoulderJoins','primitives':[{'attributes':attrs,'material':mid,'indices':append_accessor(g,s,ind.flatten().reshape(-1,1),5125,'SCALAR',34963)}]})
    ni=len(g['nodes']);g['nodes'].append({'name':'Repair_ShoulderJoins','mesh':mi,'skin':1});g['scenes'][0]['nodes'].append(ni)
    for m in g['materials']:
        name=m['name']
        if any(k in name for k in ['Skin','SKIN','Stockings','Boot','CLOTH','Hair','HAIR']):m['doubleSided']=True
        if ('Skin' in name or 'SKIN' in name) and not m.get('pbrMetallicRoughness',{}).get('baseColorTexture'):
            m['alphaMode']='OPAQUE';m.pop('alphaCutoff',None)
    # The original covered arm surface includes bulky costume-shaped skin. Keep
    # the separately skinned hands, but remove this hidden surface inside sleeves.
    is_coat=any(m['name']=='Crimson_HandSkin' for m in g['materials'])
    if is_coat:
        removed=0
        for pr in g['meshes'][1]['primitives']:
            name=g['materials'][pr['material']]['name']
            if name!='Evening_ShoulderSkin' and 'Body_00_SKIN' not in name:continue
            v=get_accessor_np(g,s,pr['attributes']['POSITION']);tri=get_accessor_np(g,s,pr['indices']).reshape(-1,3);c=v[tri].mean(axis=1)
            covered=((abs(c[:,0])>.125)&(abs(c[:,0])<.395)&(c[:,1]>.88)&(c[:,1]<1.10))|((abs(c[:,0])<.135)&(c[:,1]>.40)&(c[:,1]<.995))
            removed+=int(covered.sum());new=tri[~covered].flatten().reshape(-1,1)
            pr['indices']=append_accessor(g,s,new.astype(np.uint32),5125,'SCALAR',34963)
        print('Removed covered costume-shaped arm triangles',removed)
    # Keep the outer coat clear of the waistcoat at the upper back as the torso bends.
    for mesh in g['meshes']:
        if mesh.get('name')!='ReferenceMatched_Wardrobe':continue
        for pr in mesh['primitives']:
            if is_coat and g['materials'][pr['material']]['name']=='Match_Waistcoat':
                v=get_accessor_np(g,s,pr['attributes']['POSITION']);tri=get_accessor_np(g,s,pr['indices']).reshape(-1,3);c=v[tri].mean(axis=1)
                hidden=(c[:,1]>.70)&(c[:,1]<1.01)&(abs(c[:,0])<.15)&((c[:,2]<.04)|(abs(c[:,0])>.085))
                pr['indices']=append_accessor(g,s,tri[~hidden].astype(np.uint32).flatten().reshape(-1,1),5125,'SCALAR',34963)
            if g['materials'][pr['material']]['name']!='Match_Burgundy':continue
            ai=pr['attributes']['POSITION'];p=get_accessor_np(g,s,ai);back=(p[:,2]<-.025)&(p[:,1]>.80)&(p[:,1]<1.015)&(abs(p[:,0])<.115)
            p[back,2]-=.014*np.exp(-((p[back,1]-.93)/.09)**2);set_accessor_np(g,s,ai,p)
    g['asset'].setdefault('extras',{})['surfaceRepair']={'shoulderBridges':bridges,'smallSkinCaps':caps,'preserveAdultProportions':True}
    return bridges,caps

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-archive',type=Path,required=True);args=parser.parse_args()
    for name in ['seraphina','companion_alt']:
        with zipfile.ZipFile(args.source_archive) as z:g,b,e=parse_vrm(z.read(name))
        s=[bytearray(b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]) for v in g['bufferViews']];print(name,repair(g,s))
        out=bytearray()
        for i,bv in enumerate(g['bufferViews']):
            while len(out)%4:out.append(0)
            bv['byteOffset']=len(out);bv['byteLength']=len(s[i]);out.extend(s[i])
        g['buffers'][0]['byteLength']=len(out);(P/f'assets/models/{name}.vrm').write_bytes(pack_vrm(g,bytes(out),e))
