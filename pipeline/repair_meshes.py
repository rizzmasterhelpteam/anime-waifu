from pathlib import Path
import sys,zipfile,copy,math
import numpy as np
P=Path(__file__).resolve().parents[1];W=P/'work';sys.path.insert(0,str(P/'pipeline'))
from style_crimson_lolita_vrm import parse_vrm,pack_vrm,get_accessor_np,set_accessor_np,append_accessor

def refine_torso(g,s):
    groups={}
    for prim in g['meshes'][1]['primitives']:
        key=tuple(prim['attributes'][k] for k in ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'])
        groups.setdefault(key,[]).append(prim)
    for key,prims in groups.items():
        arrays=[get_accessor_np(g,s,ai) for ai in key]
        if len(arrays[0])<100:continue
        pos,norm,uv,joints,weights=arrays;joints=joints.astype(np.uint16);weights=weights.astype(float)
        wa=g['accessors'][key[4]]
        if wa.get('normalized'):weights/=255 if wa['componentType']==5121 else 65535
        faces=[get_accessor_np(g,s,p['indices']).flatten().reshape(-1,3).astype(int) for p in prims]
        for iteration in range(2):
            edges=set()
            for tri in faces:
                centers=pos[tri].mean(axis=1);chosen=tri[(centers[:,1]>.80)&(centers[:,1]<1.015)&(abs(centers[:,0])<.19)&(centers[:,2]>-.045)]
                for a,b,c in chosen:
                    for x,y in [(a,b),(b,c),(c,a)]:edges.add(tuple(sorted((int(x),int(y)))))
            if not edges:break
            vp=list(pos);vn=list(norm);vt=list(uv);vj=list(joints);vw=list(weights);mid={}
            for a,b in sorted(edges):
                mid[(a,b)]=len(vp);vp.append((pos[a]+pos[b])*.5);n=norm[a]+norm[b];vn.append(n/max(np.linalg.norm(n),1e-8));vt.append((uv[a]+uv[b])*.5)
                d={}
                for idx in [a,b]:
                    for j,w in zip(joints[idx],weights[idx]):d[int(j)]=d.get(int(j),0)+float(w)*.5
                items=sorted(d.items(),key=lambda x:-x[1])[:4];ja=np.zeros(4,np.uint16);ww=np.zeros(4)
                for i,(j,w) in enumerate(items):ja[i]=j;ww[i]=w
                ww/=max(ww.sum(),1e-8);vj.append(ja);vw.append(ww)
            nf=[]
            for tri in faces:
                out=[]
                for aa,bb,cc in tri:
                    a,b,c=int(aa),int(bb),int(cc);ab=mid.get(tuple(sorted((a,b))));bc=mid.get(tuple(sorted((b,c))));ca=mid.get(tuple(sorted((c,a))))
                    bits=(ab is not None)+(bc is not None)+(ca is not None)
                    if bits==0:out.append([a,b,c])
                    elif bits==3:out.extend([[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])
                    elif bits==1:
                        if ab is not None:out.extend([[a,ab,c],[ab,b,c]])
                        elif bc is not None:out.extend([[b,bc,a],[bc,c,a]])
                        else:out.extend([[c,ca,b],[ca,a,b]])
                    else:
                        if ab is not None and bc is not None:out.extend([[b,bc,ab],[a,ab,c],[ab,bc,c]])
                        elif bc is not None and ca is not None:out.extend([[c,ca,bc],[b,bc,a],[bc,ca,a]])
                        else:out.extend([[a,ab,ca],[c,ca,b],[ca,ab,b]])
                nf.append(np.array(out,int))
            pos=np.array(vp);norm=np.array(vn);uv=np.array(vt);joints=np.array(vj,np.uint16);weights=np.array(vw);faces=nf
        attrs={}
        for name,a,ct,typ in [('POSITION',pos,5126,'VEC3'),('NORMAL',norm,5126,'VEC3'),('TEXCOORD_0',uv,5126,'VEC2'),('JOINTS_0',joints,5123,'VEC4'),('WEIGHTS_0',weights,5126,'VEC4')]:attrs[name]=append_accessor(g,s,a.astype(np.uint16 if ct==5123 else np.float32),ct,typ,34962)
        for prim,tri in zip(prims,faces):prim['attributes']=attrs.copy();prim['indices']=append_accessor(g,s,tri.flatten().astype(np.uint32).reshape(-1,1),5125,'SCALAR',34963)

def matrix(n):
    x,y,z,w=n.get('rotation',[0,0,0,1]);r=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
    m=np.eye(4);m[:3,:3]=r@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m

def add_body_shell(g,s,deform=None):
    names={n.get('name'):i for i,n in enumerate(g['nodes'])};bones=g['extensions']['VRMC_vrm']['humanoid']['humanBones'];skin=g['skins'][1]
    parent={c:i for i,n in enumerate(g['nodes']) for c in n.get('children',[])};world={}
    def wm(i):
        if i not in world:world[i]=(wm(parent[i]) if i in parent else np.eye(4))@matrix(g['nodes'][i])
        return world[i]
    for i in range(len(g['nodes'])):wm(i)
    keys=['hips','spine','chest','upperChest','neck'];joint=[skin['joints'].index(bones[k]['node']) for k in keys];ys=[world[bones[k]['node']][1,3] for k in keys]
    base=copy.deepcopy(next(m for m in g['materials'] if m.get('name')=='Evening_ShoulderSkin'))
    base['name']='Repair_ContinuousSkin';base['alphaMode']='OPAQUE';base['doubleSided']=True;base.pop('alphaCutoff',None)
    base['extensions']['VRMC_materials_mtoon']['outlineWidthFactor']=.00018
    material=len(g['materials']);g['materials'].append(base)
    # Replace masked skin with a solid, consistent skin material; eye and hair cutouts remain intact.
    for m in g['materials']:
        n=m.get('name','')
        if 'Body_00_SKIN'in n:
            m['pbrMetallicRoughness']=copy.deepcopy(base['pbrMetallicRoughness']);m['extensions']=copy.deepcopy(base['extensions']);m['alphaMode']='OPAQUE';m['doubleSided']=True;m.pop('emissiveTexture',None);m.pop('normalTexture',None);m['emissiveFactor']=[0,0,0]
        if 'CLOTH'in n or n.startswith(('Match_','Seraphina_UpperChestSkin','Seraphina_FlashGold')):
            m['alphaMode']='OPAQUE';m['doubleSided']=True;m['pbrMetallicRoughness']['baseColorFactor']=m['pbrMetallicRoughness'].get('baseColorFactor',[1,1,1,1]);m['pbrMetallicRoughness']['baseColorFactor'][3]=1
        if 'Tops_01_CLOTH_02'in n:
            toon=m.get('extensions',{}).get('VRMC_materials_mtoon',{});toon['shadingToonyFactor']=.45;toon['giEqualizationFactor']=.9;toon['matcapFactor']=[.10,.10,.12];toon['outlineWidthFactor']=.0003
    v=[];normal=[];j=[];w=[];idx=[];segments=64
    profile=[(.635,.116,.050,.000),(.70,.107,.055,.000),(.77,.077,.061,.002),(.82,.074,.067,.002),(.87,.088,.082,.002),(.905,.096,.102,.000),(.94,.098,.061,-.002),(.98,.102,.038,-.008),(1.012,.062,.028,-.015),(1.045,.025,.023,-.019)]
    for row,(y,rx,rz,cz) in enumerate(profile):
        for i in range(segments+1):
            th=i*math.tau/segments;co=math.cos(th);point=np.array([rx*math.sin(th),y,cz+rz*co*(1 if co>=0 else .62)]);v.append(point);nn=np.array([math.sin(th)/rx,0,co/rz]);normal.append(nn/np.linalg.norm(nn))
            k=max(0,min(3,np.searchsorted(ys,y)-1));t=np.clip((y-ys[k])/max(ys[k+1]-ys[k],1e-8),0,1);jj=np.array([joint[k],joint[k+1],0,0],np.uint16);ww=np.array([1-t,t,0,0],float)
            side='L' if point[0]>=0 else 'R';bust=names.get(f'J_Sec_{side}_Bust2')
            influence=np.exp(-((y-.905)/.060)**2)*np.clip((point[2]-.02)/.07,0,1)*.65
            if bust is not None and influence>.01:jj[2]=skin['joints'].index(bust);ww[:2]*=1-influence;ww[2]=influence
            j.append(jj);w.append(ww)
            if row and i:
                a=(row-1)*(segments+1)+i-1;b=a+1;c=row*(segments+1)+i-1;d=c+1;idx.extend([a,b,c,b,d,c])
    # Close the upper and lower loops so no interior holes can show through the clothing.
    for row in [0,len(profile)-1]:
        center=len(v);y,rx,rz,cz=profile[row];v.append([0,y,cz]);normal.append([0,-1 if row==0 else 1,0]);j.append(np.array([joint[0] if row==0 else joint[-1],0,0,0],np.uint16));w.append([1,0,0,0])
        for i in range(segments):idx.extend([center,row*(segments+1)+i+(1 if row==0 else 0),row*(segments+1)+i+(0 if row==0 else 1)])
    # Rounded shoulder bridges close the small deltoid/armpit gaps exposed by cut-away sleeves.
    for side in ['left','right']:
        arm=bones[side+'UpperArm']['node'];center=world[arm][:3,3].copy();center[0]-=np.sign(center[0])*.010
        offset=len(v);lat=10;lon=20
        for row in range(lat+1):
            ph=math.pi*row/lat
            for col in range(lon+1):
                th=math.tau*col/lon;v.append(center+np.array([.037*math.sin(ph)*math.cos(th),.033*math.cos(ph),.032*math.sin(ph)*math.sin(th)]));normal.append([0,1,0]);j.append(np.array([skin['joints'].index(bones['upperChest']['node']),skin['joints'].index(arm),0,0],np.uint16));w.append([.5,.5,0,0])
                if row and col:
                    a=offset+(row-1)*(lon+1)+col-1;b=a+1;c=offset+row*(lon+1)+col-1;d=c+1;idx.extend([a,c,b,b,c,d])
    pos=np.array(v,np.float32)
    if deform is not None:pos=deform(pos).astype(np.float32)
    # Compute surface normals from the closed, smooth ring mesh.
    ind=np.array(idx,np.uint32).reshape(-1,3);n=np.zeros_like(pos)
    for a,b,c in ind:
        nn=np.cross(pos[b]-pos[a],pos[c]-pos[a]);n[a]+=nn;n[b]+=nn;n[c]+=nn
    n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-8)
    attrs={}
    for name,arr,ct,typ in [('POSITION',pos,5126,'VEC3'),('NORMAL',n,5126,'VEC3'),('JOINTS_0',np.array(j,np.uint16),5123,'VEC4'),('WEIGHTS_0',np.array(w,np.float32),5126,'VEC4')]:attrs[name]=append_accessor(g,s,arr,ct,typ,34962)
    ai=append_accessor(g,s,ind.flatten().reshape(-1,1),5125,'SCALAR',34963);mi=len(g['meshes']);g['meshes'].append({'name':'Repair_ContinuousTorso','primitives':[{'attributes':attrs,'indices':ai,'material':material}]})
    ni=len(g['nodes']);g['nodes'].append({'name':'Repair_ContinuousTorso','mesh':mi,'skin':1});g['scenes'][0]['nodes'].append(ni)
