from pathlib import Path
import sys,copy,math,zipfile,io
import numpy as np
from PIL import Image
P=Path(__file__).resolve().parents[1];W=P/'work'
sys.path.insert(0,str(P/'pipeline'))
from style_crimson_lolita_vrm import parse_vrm,pack_vrm,get_accessor_np,set_accessor_np,append_accessor
from style_seraphina_vrm import build_uv_sphere_or_teardrop as gem
import argparse
args=argparse.ArgumentParser(description='Rebuild reference-matched character assets from a source archive.')
args.add_argument('--source-archive',required=True,type=Path)
backup=args.parse_args().source_archive
if not backup.is_file():raise FileNotFoundError(backup)

def matrix(n):
    x,y,z,w=n.get('rotation',[0,0,0,1]);r=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
    m=np.eye(4);m[:3,:3]=r@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m

class Build:
    def __init__(self,name):
        self.name=name
        with zipfile.ZipFile(backup) as z:self.g,self.b,self.extra=parse_vrm(z.read(name))
        self.s=[bytearray(self.b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]) for v in self.g['bufferViews']]
        self.groups={};self.materials={};self.skin=1
        self.joints=self.g['skins'][1]['joints'];self.parents={c:i for i,n in enumerate(self.g['nodes']) for c in n.get('children',[])}
        self.world={};self.bones=self.g['extensions']['VRMC_vrm']['humanoid']['humanBones']
        for i,n in enumerate(self.g['nodes']):self.world_matrix(i)
    def world_matrix(self,i):
        if i not in self.world:self.world[i]=(self.world_matrix(self.parents[i]) if i in self.parents else np.eye(4))@matrix(self.g['nodes'][i])
        return self.world[i]
    def joint(self,key):return self.joints.index(self.bones[key]['node'])
    def point(self,key):return self.world[self.bones[key]['node']][:3,3]
    def material(self,name,hexcode,metal=0):
        if name in self.materials:return self.materials[name]
        rgb=np.array([int(hexcode[i:i+2],16)/255 for i in (0,2,4)]);linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
        mid=len(self.g['materials']);self.g['materials'].append({'name':'Match_'+name,'pbrMetallicRoughness':{'baseColorFactor':[*linear,1],'metallicFactor':metal,'roughnessFactor':.48 if metal else .72},'doubleSided':True,'extensions':{'VRMC_materials_mtoon':{'specVersion':'1.0','shadeColorFactor':(linear*.70).tolist(),'shadingShiftFactor':-.12,'shadingToonyFactor':.75,'giEqualizationFactor':.8,'outlineWidthMode':'worldCoordinates','outlineWidthFactor':.00035,'outlineColorFactor':[.025,.012,.025]}}})
        self.materials[name]=mid;return mid
    def weights(self,verts,bone=None):
        j=np.zeros((len(verts),4),dtype=np.uint16);w=np.zeros((len(verts),4),dtype=np.float32)
        if bone:j[:,0]=self.joint(bone);w[:,0]=1;return j,w
        keys=['hips','spine','chest','upperChest'];ys=[self.point(k)[1] for k in keys]
        for i,v in enumerate(verts):
            k=max(0,min(2,np.searchsorted(ys,v[1])-1));t=np.clip((v[1]-ys[k])/(ys[k+1]-ys[k]),0,1)
            j[i,:2]=[self.joint(keys[k]),self.joint(keys[k+1])];w[i,:2]=[1-t,t]
        return j,w
    def add(self,mat,verts,norms,indices,bone=None,weights=None):
        v=np.asarray(verts,dtype=np.float32);n=np.asarray(norms,dtype=np.float32);idx=np.asarray(indices,dtype=np.uint32).flatten()
        tris=idx.reshape(-1,3)
        face=np.cross(v[tris[:,1]]-v[tris[:,0]],v[tris[:,2]]-v[tris[:,0]])
        flip=(face*n[tris].mean(axis=1)).sum(axis=1)<0
        tris[flip]=tris[flip][:,[0,2,1]]
        j,w=weights if weights is not None else self.weights(v,bone)
        self.groups.setdefault(mat,[]).append((v,n,idx,j,w))
    def ellipsoid(self,mat,center,radii,bone=None,drop=False):
        v,n,i=gem(*center,*radii,10,16,drop);self.add(mat,v,n,i,bone)
    def tube(self,mat,points,radius=.001,bone=None):
        pts=np.array(points);v=[];n=[];idx=[];steps=6
        for i,p in enumerate(pts):
            tangent=pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)];tangent/=max(np.linalg.norm(tangent),1e-8)
            up=np.array([0.,1,0]) if abs(tangent[1])<.9 else np.array([1.,0,0])
            a=np.cross(tangent,up);a/=np.linalg.norm(a);b=np.cross(tangent,a)
            for k in range(steps):
                normal=a*math.cos(k*math.tau/steps)+b*math.sin(k*math.tau/steps);v.append(p+normal*radius);n.append(normal)
            if i:
                for k in range(steps):
                    a0=(i-1)*steps+k;a1=(i-1)*steps+(k+1)%steps;b0=i*steps+k;b1=i*steps+(k+1)%steps;idx.extend([a0,a1,b0,a1,b1,b0])
        self.add(mat,v,n,idx,bone)
    def panel(self,mat,verts,bone=None):
        v=np.array(verts);n=np.cross(v[1]-v[0],v[2]-v[0]);n/=max(np.linalg.norm(n),1e-8)
        self.add(mat,v,np.tile(n,(len(v),1)),[x for k in range(1,len(v)-1) for x in [0,k,k+1]],bone)
    def garment(self,mat,profile,start=0,end=math.tau,pleats=0):
        v=[];n=[];ind=[];segments=64
        for row,(y,rx,rz) in enumerate(profile):
            for i in range(segments+1):
                th=start+(end-start)*i/segments;r=1+pleats*math.cos(th*16)
                v.append([rx*math.sin(th)*r,y,rz*math.cos(th)*r+.015+.014*max(0,math.cos(th))]);normal=np.array([math.sin(th)/rx,0,math.cos(th)/rz]);n.append(normal/np.linalg.norm(normal))
                if row and i:
                    a=(row-1)*(segments+1)+i-1;b=a+1;c=row*(segments+1)+i-1;d=c+1;ind.extend([a,c,b,b,c,d])
        self.add(mat,v,n,ind);return np.array(v).reshape(len(profile),segments+1,3)
    def remove_old_accessories(self):
        for n in self.g['nodes']:
            if n.get('name','').startswith(('Seraphina_Earrings','Seraphina_Pendant','Crimson_HairBows','Crimson_Choker')):n.pop('mesh',None)
    def texture_grade(self,kind,low,high):
        seen=set()
        for m in self.g['materials']:
            if kind not in m.get('name',''):continue
            ti=m.get('pbrMetallicRoughness',{}).get('baseColorTexture',{}).get('index')
            if ti is None:continue
            bi=self.g['images'][self.g['textures'][ti]['source']].get('bufferView')
            if bi is None or bi in seen:continue
            seen.add(bi);im=Image.open(io.BytesIO(self.s[bi])).convert('RGBA');a=np.array(im,dtype=np.float32)
            lum=(a[:,:,:3]@np.array([.299,.587,.114]))/255
            lo,hi=np.percentile(lum[a[:,:,3]>100],[4,96]);t=np.clip((lum-lo)/max(.1,hi-lo),0,1)[...,None]
            a[:,:,:3]=np.array(low)*(1-t)+np.array(high)*t
            buf=io.BytesIO();Image.fromarray(a.clip(0,255).astype('uint8')).save(buf,format='PNG');self.s[bi]=bytearray(buf.getvalue())
            m['emissiveFactor']=[0,0,0];toon=m.get('extensions',{}).get('VRMC_materials_mtoon',{});toon['matcapFactor']=[0,0,0]
    def gown_palette(self):
        for m in self.g['materials']:
            name=m.get('name','')
            if not any(k in name for k in ['Tops_01_CLOTH_02','Tops_01_CLOTH_03']):continue
            ti=m.get('pbrMetallicRoughness',{}).get('baseColorTexture',{}).get('index')
            if ti is None:continue
            bi=self.g['images'][self.g['textures'][ti]['source']]['bufferView']
            im=Image.open(io.BytesIO(self.s[bi])).convert('RGBA');a=np.array(im,dtype=np.float32)
            r,gg,bl=a[:,:,0],a[:,:,1],a[:,:,2];opaque=a[:,:,3]>0
            navy=(bl>r*1.03)&opaque
            gold=(r>gg*1.10)&(gg>bl*1.25)&(r>110)&opaque
            wine=(r>bl*1.20)&(r<130)&opaque&~gold
            a[navy,:3]+=np.array([12,10,18]);a[gold,:3]=np.array([188,157,103]);a[wine,:3]+=np.array([7,17,15])
            out=io.BytesIO();Image.fromarray(a.clip(0,255).astype('uint8')).save(out,format='PNG');self.s[bi]=bytearray(out.getvalue())
    def save(self):
        prims=[]
        for mat,parts in self.groups.items():
            v=[];n=[];idx=[];j=[];w=[];offset=0
            for vp,np_,ip,jp,wp in parts:v.append(vp);n.append(np_);idx.append(ip+offset);j.append(jp);w.append(wp);offset+=len(vp)
            attrs={}
            for key,arr,typ,shape in [('POSITION',np.concatenate(v).astype(np.float32),5126,'VEC3'),('NORMAL',np.concatenate(n).astype(np.float32),5126,'VEC3'),('JOINTS_0',np.concatenate(j),5123,'VEC4'),('WEIGHTS_0',np.concatenate(w),5126,'VEC4')]:attrs[key]=append_accessor(self.g,self.s,arr,typ,shape,34962)
            ii=append_accessor(self.g,self.s,np.concatenate(idx).astype(np.uint32).reshape(-1,1),5125,'SCALAR',34963)
            prims.append({'attributes':attrs,'indices':ii,'material':mat})
        mi=len(self.g['meshes']);self.g['meshes'].append({'name':'ReferenceMatched_Wardrobe','primitives':prims})
        ni=len(self.g['nodes']);self.g['nodes'].append({'name':'ReferenceMatched_Wardrobe','mesh':mi,'skin':1});self.g['scenes'][0]['nodes'].append(ni)
        out=bytearray()
        for i,v in enumerate(self.g['bufferViews']):
            while len(out)%4:out.append(0)
            v['byteOffset']=len(out);v['byteLength']=len(self.s[i]);out.extend(self.s[i])
        self.g['buffers'][0]['byteLength']=len(out)
        (P/f'assets/models/{self.name}.vrm').write_bytes(pack_vrm(self.g,bytes(out),self.extra))

def earrings(b,metal,stone):
    h=b.point('head');print(b.name,'head',h)
    for side in [-1,1]:
        x=side*.083;y=h[1]+.080;z=.045
        b.ellipsoid(metal,(x,y,z),(.003,.003,.002),'head')
        b.tube(metal,[(x,y-.003,z),(x,y-.011,z)],.0007,'head')
        b.ellipsoid(metal,(x,y-.021,z+.002),(.006,.012,.003),'head',True)
        b.ellipsoid(stone,(x,y-.021,z+.004),(.004,.009,.002),'head',True)

for name in ['seraphina','companion_alt']:
    b=Build(name);g=b.g;b.remove_old_accessories()
    gold=b.material('AntiqueGold','c29b54',.55);silver=b.material('Silver','c8c5d5',.65)
    ruby=b.material('Ruby','9c304e',.2);amethyst=b.material('Amethyst','9877bd',.2)
    black=b.material('Waistcoat','211d2a');ivory=b.material('Ivory','e7dcc8')
    burgundy=b.material('Burgundy','6f2d42');lapel=b.material('Lapel','89394f');boot=b.material('Boots','211d29',.08)
    ribbon=b.material('Ribbon','973247')
    lace=b.material('BootLaces','4c404d')
    stockings=b.material('Stockings','9c7f88' if name=='seraphina' else '5b515f')
    body=g['meshes'][1];kept=[]
    for p in body['primitives']:
        m=g['materials'][p['material']]['name']
        if 'CLOTH' not in m:kept.append(p);continue
        if name=='seraphina' and any(k in m for k in ['Tops_01_CLOTH_02','Tops_01_CLOTH_03','Shoes_01_CLOTH_01']):
            if 'Tops_01_CLOTH_02' in m:
                pos=get_accessor_np(g,b.s,p['attributes']['POSITION']);idx=get_accessor_np(g,b.s,p['indices']).flatten().reshape(-1,3);c=pos[idx].mean(axis=1)
                cap=(np.max(np.abs(pos[idx][:,:,0]),axis=1)>.130)&(c[:,1]>.88)
                idx=idx[~cap]
                set_accessor_np(g,b.s,p['indices'],idx.flatten().reshape(-1,1));g['accessors'][p['indices']]['count']=idx.size
            kept.append(p)
    body['primitives']=kept
    # Dedicated stocking material avoids carrying the template's garter and skin palette into the final outfit.
    base=next(p for p in body['primitives'] if p['material']==8)
    pos=get_accessor_np(g,b.s,base['attributes']['POSITION']);ai=base['indices'];idx=get_accessor_np(g,b.s,ai).flatten().reshape(-1,3)
    cent=pos[idx].mean(axis=1);select=(cent[:,1]<.63)&(cent[:,1]>.055)
    stockingprim=copy.deepcopy(base);stockingprim['material']=stockings
    typ=g['accessors'][ai]['componentType'];dt=np.uint16 if typ==5123 else np.uint32
    stockingprim['indices']=append_accessor(g,b.s,idx[select].flatten().reshape(-1,1).astype(dt),typ,'SCALAR',34963)
    idx=idx[~select];set_accessor_np(g,b.s,ai,idx.flatten().reshape(-1,1));g['accessors'][ai]['count']=idx.size;body['primitives'].append(stockingprim)
    if name=='seraphina':
        b.gown_palette()
        b.texture_grade('Hair_00_HAIR',[144,132,168],[231,223,242]);b.texture_grade('HairBack_00_HAIR',[144,132,168],[231,223,242])
        earrings(b,silver,amethyst)
        b.tube(gold,[(-.045,.999,.045),(-.027,.979,.082),(0,.969,.096),(.027,.979,.082),(.045,.999,.045)],.001,'upperChest')
        b.ellipsoid(gold,(0,.968,.100),(.009,.011,.003),'upperChest')
        b.ellipsoid(amethyst,(0,.968,.103),(.006,.008,.003),'upperChest')
    else:
        b.texture_grade('Hair_00_HAIR',[42,24,37],[113,66,87]);b.texture_grade('HairBack_00_HAIR',[42,24,37],[113,66,87])
        b.texture_grade('EyeIris',[41,16,35],[204,93,126])
        # Soft rounded cherry bob with lightly curled ends.
        hp=g['meshes'][2]['primitives'][0];pos=get_accessor_np(g,b.s,hp['attributes']['POSITION']);low=np.clip((1.13-pos[:,1])/.13,0,1)
        pos[:,0]+=np.sign(pos[:,0])*low*(.010+np.sin(pos[:,1]*75)*.003)
        set_accessor_np(g,b.s,hp['attributes']['POSITION'],pos)
        inner=b.garment(burgundy,[(.455,.137,.075),(.51,.135,.073),(.60,.123,.070),(.70,.102,.068),(.75,.087,.064)],pleats=.012)
        coat=b.garment(burgundy,[(.445,.162,.088),(.50,.158,.084),(.60,.139,.079),(.71,.108,.073),(.79,.087,.071),(.87,.093,.080),(.94,.113,.086),(1.005,.113,.065)],.62,math.tau-.62)
        vest=b.garment(black,[(.715,.091,.067),(.76,.085,.067),(.82,.083,.070),(.89,.098,.079),(.955,.100,.078),(.990,.077,.060)])
        b.tube(gold,coat[0],.0010);b.tube(gold,coat[:,0],.0008);b.tube(gold,coat[:,-1],.0008)
        b.tube(gold,[(-.058,.742,.083),(0,.709,.098),(.058,.742,.083)],.0008)
        for y in [.925,.895,.865,.835,.805]:b.ellipsoid(gold,(0,y,.111),(.002,.002,.0015))
        # Ivory shirt insert, folded collar, lapels and ruby brooch.
        b.panel(ivory,[(-.046,1.018,.079),(.046,1.018,.079),(0,.953,.116)])
        for side in [-1,1]:
            b.panel(ivory,[(side*.012,1.030,.064),(side*.046,1.016,.075),(side*.030,.987,.105),(0,1.008,.092)])
            b.panel(lapel,[(side*.042,1.003,.111),(side*.087,.979,.109),(side*.060,.871,.124),(side*.043,.907,.128)])
            b.tube(gold,[(side*.042,1.003,.113),(side*.087,.979,.111),(side*.060,.871,.126)],.00065)
        b.ellipsoid(gold,(0,.991,.113),(.011,.014,.003),'upperChest');b.ellipsoid(ruby,(0,.991,.116),(.008,.010,.003),'upperChest')
        # Fitted sleeves follow the humanoid arm bones, without costume frills.
        for side,key in [(-1,'right'),(1,'left')]:
            shoulder=b.point(key+'UpperArm');elbow=b.point(key+'LowerArm');hand=b.point(key+'Hand')
            root=shoulder.copy();root[0]-=side*.03
            rings=[(root,.040,-1),(shoulder,.040,0),(shoulder*.5+elbow*.5,.036,0),(elbow,.032,.5),(elbow*.5+hand*.5,.027,1),(hand,.023,1)]
            verts=[];norms=[];idx=[];js=[];ws=[]
            for ri,(center,rad,blend) in enumerate(rings):
                for i in range(17):
                    th=i*math.tau/16;normal=np.array([0,math.cos(th),math.sin(th)]);verts.append(center+rad*normal);norms.append(normal)
                    if blend<0:
                        js.append([b.joint('upperChest'),b.joint(key+'UpperArm'),0,0]);ws.append([.75,.25,0,0])
                    else:
                        js.append([b.joint(key+'UpperArm'),b.joint(key+'LowerArm'),0,0]);ws.append([1-blend,blend,0,0])
                    if ri and i:
                        a=(ri-1)*17+i-1;c=ri*17+i-1;idx.extend([a,c,a+1,a+1,c,c+1])
            b.add(burgundy,verts,norms,idx,weights=(np.array(js,np.uint16),np.array(ws,np.float32)))
            b.tube(gold,[hand+np.array([0,.0235*math.cos(t),.0235*math.sin(t)]) for t in np.linspace(0,math.tau,25)],.0008,key+'LowerArm')
            for y in [.965,.95]:b.ellipsoid(gold,(hand[0]-side*.012,y,.026),(.0016,.0016,.0015),key+'LowerArm')
            # Ankle boots: rounded toe, ankle shaft and a compact heel.
            foot=b.point(key+'Foot');x=foot[0]
            b.ellipsoid(boot,(x,.043,.025),(.039,.035,.079),key+'Foot')
            b.ellipsoid(boot,(x,.017,.022),(.040,.017,.083),key+'Foot')
            b.ellipsoid(boot,(x,.040,-.037),(.030,.040,.042),key+'Foot')
            verts=[];norm=[];ind=[]
            for row,(y,rx,rz) in enumerate([(.055,.033,.041),(.095,.029,.032),(.135,.031,.032),(.175,.033,.035)]):
                for i in range(25):
                    th=i*math.tau/24;verts.append([x+rx*math.sin(th),y,-.014+rz*math.cos(th)]);norm.append([math.sin(th),0,math.cos(th)])
                    if row and i:
                        a=(row-1)*25+i-1;c=row*25+i-1;ind.extend([a,c,a+1,a+1,c,c+1])
            b.add(boot,verts,norm,ind,key+'Foot')
            b.tube(black,[(x+.033*math.sin(t),.175,-.014+.035*math.cos(t)) for t in np.linspace(0,math.tau,25)],.0012,key+'Foot')
            for y in [.092,.108,.124,.140,.156]:
                b.tube(lace,[(x-.013,y-.006,.024),(x+.013,y+.006,.024)],.00075,key+'Foot')
                b.tube(lace,[(x+.013,y-.006,.025),(x-.013,y+.006,.025)],.00075,key+'Foot')
        # One ribbon on the viewer's right, as in the drawing.
        center=np.array([.098,1.204,.091])
        b.ellipsoid(ribbon,center,(.009,.011,.006),'head')
        for side in [-1,1]:
            b.ellipsoid(ribbon,center+[side*.017,.002,0],(.023,.015,.007),'head')
            b.panel(ribbon,[center,center+[side*.035,.022,-.005],center+[side*.031,-.018,.002],center+[side*.008,-.010,.009]],'head')
            b.tube(black,[center,center+[side*.035,.022,-.004],center+[side*.031,-.018,.003],center],.0007,'head')
        b.panel(ribbon,[center+[-.005,-.005,0],center+[.003,-.010,.002],center+[.010,-.054,0],center+[-.008,-.043,.003]],'head')
        earrings(b,gold,ruby)
        # Gold floral stitching on both lower coat panels.
        for side in [-1,1]:
            for shift in [0,.014]:
                pts=[[side*(.126+.009*math.sin(t*math.pi*2)),.47+shift+t*.066,.091] for t in np.linspace(0,1,18)]
                b.tube(gold,pts,.00055,'hips')
        print('Built reference coat, sleeves, boots, bow, ruby jewelry')
    b.save()
