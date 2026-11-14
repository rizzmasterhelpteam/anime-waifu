"""Refine the adult Crimson coat silhouette while preserving the repaired rig."""
from pathlib import Path
import sys,argparse
import numpy as np
P=Path(__file__).resolve().parents[1];sys.path.insert(0,str(P/'pipeline'))
from style_crimson_lolita_vrm import parse_vrm,pack_vrm,get_accessor_np,set_accessor_np,append_accessor
from repair_meshes import matrix

def smooth_profile(x,ys,values):
    ys=np.asarray(ys);v=np.asarray(values);h=np.diff(ys);d=np.diff(v)/h;m=np.zeros(len(v));m[0]=d[0];m[-1]=d[-1]
    for i in range(1,len(v)-1):
        if d[i-1]*d[i]>0:
            w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1];m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i])
    k=np.clip(np.searchsorted(ys,x)-1,0,len(v)-2);t=np.clip((x-ys[k])/h[k],0,1)
    return (2*t**3-3*t*t+1)*v[k]+(t**3-2*t*t+t)*h[k]*m[k]+(-2*t**3+3*t*t)*v[k+1]+(t**3-t*t)*h[k]*m[k+1]

def split_long_edges(g,s,pr):
    a=pr['attributes'];v=get_accessor_np(g,s,a['POSITION']);j=get_accessor_np(g,s,a['JOINTS_0']);w=get_accessor_np(g,s,a['WEIGHTS_0']);tri=get_accessor_np(g,s,pr['indices']).reshape(-1,3)
    for iteration in range(2):
        edges=set()
        for t in tri:
            for aa,bb in [(t[0],t[1]),(t[1],t[2]),(t[2],t[0])]:
                if np.linalg.norm(v[aa]-v[bb])>.022:edges.add(tuple(sorted((int(aa),int(bb)))))
        vp=list(v);jp=list(j);wp=list(w);mid={}
        for aa,bb in sorted(edges):
            mid[(aa,bb)]=len(vp);vp.append((v[aa]+v[bb])*.5);d={}
            for k in [aa,bb]:
                for ji,wi in zip(j[k],w[k]):d[int(ji)]=d.get(int(ji),0)+float(wi)*.5
            pairs=sorted(d.items(),key=lambda p:-p[1])[:4];js=np.zeros(4,np.uint16);ws=np.zeros(4)
            for i,(ji,wi) in enumerate(pairs):js[i]=ji;ws[i]=wi
            jp.append(js);wp.append(ws/max(ws.sum(),1e-8))
        nt=[]
        for aa,bb,cc in tri:
            aa,bb,cc=map(int,[aa,bb,cc]);ab=mid.get(tuple(sorted((aa,bb))));bc=mid.get(tuple(sorted((bb,cc))));ca=mid.get(tuple(sorted((cc,aa))));bits=sum(x is not None for x in [ab,bc,ca])
            if bits==0:nt.append([aa,bb,cc])
            elif bits==3:nt.extend([[aa,ab,ca],[ab,bb,bc],[ca,bc,cc],[ab,bc,ca]])
            elif bits==1:
                if ab is not None:nt.extend([[aa,ab,cc],[ab,bb,cc]])
                elif bc is not None:nt.extend([[bb,bc,aa],[bc,cc,aa]])
                else:nt.extend([[cc,ca,bb],[ca,aa,bb]])
            elif ab is not None and bc is not None:nt.extend([[bb,bc,ab],[aa,ab,cc],[ab,bc,cc]])
            elif bc is not None and ca is not None:nt.extend([[cc,ca,bc],[bb,bc,aa],[bc,ca,aa]])
            else:nt.extend([[aa,ab,ca],[cc,ca,bb],[ca,ab,bb]])
        v=np.array(vp);j=np.array(jp,np.uint16);w=np.array(wp);tri=np.array(nt,np.uint32)
    attrs={}
    for k,arr,ct,typ in [('POSITION',v.astype(np.float32),5126,'VEC3'),('NORMAL',np.zeros_like(v,dtype=np.float32),5126,'VEC3'),('JOINTS_0',j,5123,'VEC4'),('WEIGHTS_0',w.astype(np.float32),5126,'VEC4')]:attrs[k]=append_accessor(g,s,arr,ct,typ,34962)
    pr['attributes']=attrs;pr['indices']=append_accessor(g,s,tri.flatten().reshape(-1,1),5125,'SCALAR',34963)

def tailor(g,s):
    assert not g['asset'].get('extras',{}).get('crimsonTailoring'),'Use the pre-tailoring source'
    skin=g['skins'][1];hb=g['extensions']['VRMC_vrm']['humanoid']['humanBones'];parent={c:i for i,n in enumerate(g['nodes']) for c in n.get('children',[])};world={}
    def wm(i):
        if i not in world:world[i]=(wm(parent[i]) if i in parent else np.eye(4))@matrix(g['nodes'][i])
        return world[i]
    arms={}
    for side in ['left','right']:
        arms[side]={key:(skin['joints'].index(hb[side+key]['node']),wm(hb[side+key]['node'])[:3,3]) for key in ['UpperArm','LowerArm','Hand']}
    arm_ids=[v[0] for arm in arms.values() for v in arm.values()]
    ys=[.445,.50,.60,.67,.73,.79,.83,.88,.925,.965,1.005,1.045]
    oldx=np.interp(ys,[.445,.50,.60,.71,.79,.87,.94,1.005,1.045],[.162,.158,.139,.108,.087,.093,.113,.113,.113])
    newx=[.139,.144,.132,.116,.096,.078,.079,.096,.110,.106,.098,.113]
    oldz=np.interp(ys,[.445,.50,.60,.71,.79,.87,.94,1.005,1.045],[.088,.084,.079,.073,.071,.080,.086,.065,.065])
    newz=[.080,.083,.083,.076,.067,.065,.070,.087,.096,.079,.060,.065]
    def torso(v):
        out=v.copy();y=v[:,1];ox=np.interp(y,ys,oldx);oz=np.interp(y,ys,oldz);nx=smooth_profile(y,ys,newx);nz=smooth_profile(y,ys,newz)
        active=(y>=.44)&(y<=1.045);out[active,0]*=(nx/ox)[active]
        center=.015;out[active,2]=center+(v[active,2]-center)*(nz/oz)[active]
        return out
    done=set();processed=[]
    for mi,mesh in enumerate(g['meshes']):
        if mi not in [1] and mesh.get('name') not in ['ReferenceMatched_Wardrobe','Repair_ContinuousTorso','Repair_ShoulderJoins']:continue
        for pr in mesh['primitives']:
            name=g['materials'][pr['material']]['name']
            if mi==1 and name=='Evening_ShoulderSkin':
                pv=get_accessor_np(g,s,pr['attributes']['POSITION']);pt=get_accessor_np(g,s,pr['indices']).reshape(-1,3);pc=pv[pt].mean(axis=1)
                covered=(abs(pc[:,0])>.055)&(pc[:,1]>.95)&(pc[:,1]<1.075)
                pr['indices']=append_accessor(g,s,pt[~covered].astype(np.uint32).flatten().reshape(-1,1),5125,'SCALAR',34963)
            if mesh.get('name')=='ReferenceMatched_Wardrobe' and name in ['Match_Burgundy','Match_Waistcoat','Match_Lapel']:
                split_long_edges(g,s,pr)
            a=pr['attributes'];ai=a['POSITION']
            if ai in done:processed.append(pr);continue
            done.add(ai);v=get_accessor_np(g,s,ai);j=get_accessor_np(g,s,a['JOINTS_0']);w=get_accessor_np(g,s,a['WEIGHTS_0']);out=v.copy()
            arm_weight=np.sum(w*np.isin(j,arm_ids),axis=1)
            # The same lattice moves the lining, body backing, vest and trim with the coat.
            body_mask=(arm_weight<.05)&(v[:,1]>.44)&(v[:,1]<1.045)&(abs(v[:,0])<.19)
            out[body_mask]=torso(v[body_mask])
            # Taper arm tubes around the actual rest-pose limb axis, preserving wrists.
            sleeve=mesh.get('name')=='ReferenceMatched_Wardrobe' and name in ['Match_Burgundy','Match_AntiqueGold']
            backing=('SKIN' in name or 'Skin' in name) and mesh.get('name')!='ReferenceMatched_Wardrobe'
            if sleeve or backing:
                for side,arm in arms.items():
                    root=arm['UpperArm'][1];elbow=arm['LowerArm'][1];hand=arm['Hand'][1];sign=1 if side=='left' else -1
                    mask=(arm_weight>.05)&(v[:,0]*sign>.025)&(v[:,1]>.88)&(v[:,1]<1.08)
                    if backing:mask&=(v[:,0]*sign<abs(hand[0])-.018)
                    ids=np.flatnonzero(mask)
                    if not len(ids):continue
                    along=(v[ids,0]-root[0])/(hand[0]-root[0]);along=np.clip(along,0,1)
                    cy=np.interp(along,[0,.52,1],[root[1],elbow[1],hand[1]]);cz=np.interp(along,[0,.52,1],[root[2],elbow[2],hand[2]])
                    factor=np.interp(along,[0,.2,.52,.85,1],[.78,.80,.86,.94,.98])
                    if backing:factor*=.95
                    out[ids,1]=cy+(v[ids,1]-cy)*factor;out[ids,2]=cz+(v[ids,2]-cz)*factor
            set_accessor_np(g,s,ai,out);processed.append(pr)
    # Recompute area-weighted normals per shared accessor, including all body submaterials.
    groups={}
    for pr in processed:groups.setdefault(pr['attributes']['POSITION'],[]).append(pr)
    for ai,prims in groups.items():
        v=get_accessor_np(g,s,ai);n=np.zeros_like(v)
        for pr in prims:
            tri=get_accessor_np(g,s,pr['indices']).reshape(-1,3);nn=np.cross(v[tri[:,1]]-v[tri[:,0]],v[tri[:,2]]-v[tri[:,0]])
            for k in range(3):np.add.at(n,tri[:,k],nn)
        length=np.linalg.norm(n,axis=1,keepdims=True);n/=np.maximum(length,1e-8)
        set_accessor_np(g,s,prims[0]['attributes']['NORMAL'],n)
    for m in g['materials']:
        if m['name'] in ['Match_Burgundy','Match_Waistcoat','Match_Lapel']:
            toon=m.get('extensions',{}).get('VRMC_materials_mtoon',{});toon['shadingToonyFactor']=.45;toon['shadingShiftFactor']=-.06;toon['giEqualizationFactor']=.9;toon['outlineWidthFactor']=.0002
    g['asset'].setdefault('extras',{})['crimsonTailoring']={'style':'fitted adult coat','waistToChestWidth':.078/.110,'roundedChestHips':True,'taperedSleeves':True,'preservesSurfaceRepair':True}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    g,b,e=parse_vrm(args.source.read_bytes());s=[bytearray(b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]) for v in g['bufferViews']];tailor(g,s);out=bytearray()
    for i,bv in enumerate(g['bufferViews']):
        while len(out)%4:out.append(0)
        bv['byteOffset']=len(out);bv['byteLength']=len(s[i]);out.extend(s[i])
    g['buffers'][0]['byteLength']=len(out);args.output.write_bytes(pack_vrm(g,bytes(out),e));print('Tailored Crimson:',args.output)
