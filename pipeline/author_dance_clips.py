"""Author compact humanoid dance clips from reviewed video poses, not mocap."""
import json,math,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BONES=['hips','spine','chest','neck','head','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot','root']
def quat(e):
 x,y,z=[a*.5 for a in e];c1,c2,c3=math.cos(x),math.cos(y),math.cos(z);s1,s2,s3=math.sin(x),math.sin(y),math.sin(z)
 return [s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3]
def pose(**updates):
 p={k:[0,0,0] for k in BONES};p.update(leftUpperArm=[0,0,-1.35],rightUpperArm=[0,0,1.35],leftLowerArm=[0,-.18,0],rightLowerArm=[0,.18,0],leftUpperLeg=[0,0,-.02],rightUpperLeg=[0,0,.02],leftLowerLeg=[.04,0,0],rightLowerLeg=[.04,0,0]);p.update(updates);return p
for character in ['seraphina','gothic_red']:
 lively=character=='gothic_red'
 # Authored beats: grounded two-step, open arms, face gesture, waist pose, return.
 beats=[pose(),
 pose(hips=[0,.10,.06],chest=[0,-.12,-.06],leftUpperLeg=[-.17,0,-.10],leftLowerLeg=[.28,0,0],leftFoot=[-.11,0,0],rightUpperArm=[-.15,.1,.65],rightLowerArm=[0,.15,-.65],leftUpperArm=[-.12,-.1,-.9],head=[0,-.15,-.06]),
 pose(hips=[0,-.1,-.06],chest=[0,.12,.06],rightUpperLeg=[-.18,0,.1],rightLowerLeg=[.3,0,0],rightFoot=[-.12,0,0],leftUpperArm=[-.1,-.1,-.65],leftLowerArm=[0,-.1,.65],rightUpperArm=[-.12,.1,.9],head=[0,.15,.06]),
 pose(leftUpperArm=[-.35,-.15,-.45],rightUpperArm=[-.35,.15,.45],leftLowerArm=[0,-.4,1.7],rightLowerArm=[0,.4,-1.7],head=[.03,0,-.13],hips=[0,0,.04]),
 pose(leftUpperArm=[-.08,0,-.30],rightUpperArm=[-.08,0,.30],leftLowerArm=[0,-.2,.4],rightLowerArm=[0,.2,-.4],chest=[-.04,.12,0],leftUpperLeg=[-.1,0,-.08],leftLowerLeg=[.18,0,0],leftFoot=[-.08,0,0]),
 pose(leftUpperArm=[-.15,0,.45],rightUpperArm=[-.15,0,-.45],leftLowerArm=[0,-.2,.25],rightLowerArm=[0,.2,-.25],head=[-.07,0,.06]),
 pose(leftUpperArm=[-.3,0,-.9],rightUpperArm=[-.3,0,.9],leftLowerArm=[0,-.2,1.6],rightLowerArm=[0,.2,-1.6],hips=[0,-.16,-.05],head=[0,.2,.08]),
 pose(leftUpperArm=[-.12,-.1,-.65],rightUpperArm=[-.12,.1,.65],leftLowerArm=[0,-.2,.7],rightLowerArm=[0,.2,-.7],chest=[-.03,0,0]),pose()]
 times=[0,1.15,2.3,3.45,4.65,5.8,7.1,8.55,10]
 if lively:
  for p in beats:
   for key in ['hips','head'] :p[key]=[v*1.15 for v in p[key]]
 # Add eased subkeys. This is keyframed motion rather than a runtime oscillator.
 sampled_times=[];sampled={b:[] for b in BONES}
 for j in range(len(times)-1):
  for step in range(12):
   u=step/12;e=u*u*(3-2*u);sampled_times.append(times[j]+(times[j+1]-times[j])*u)
   for b in BONES:sampled[b].append(quat([beats[j][b][i]*(1-e)+beats[j+1][b][i]*e for i in range(3)]))
 sampled_times.append(10)
 for b in BONES:sampled[b].append(quat(beats[-1][b]))
 data=bytearray();views=[];accessors=[]
 def accessor(values,size,kind):
  flat=[v for row in values for v in row] if size>1 else values
  offset=len(data);data.extend(struct.pack('<'+'f'*len(flat),*flat));views.append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4});a={'bufferView':len(views)-1,'componentType':5126,'count':len(values),'type':kind}
  if size==1:a.update(min=[min(values)],max=[max(values)])
  accessors.append(a);return len(accessors)-1
 time_accessor=accessor(sampled_times,1,'SCALAR');samplers=[];channels=[]
 for i,b in enumerate(BONES):
  output=accessor(sampled[b],4,'VEC4');samplers.append({'input':time_accessor,'output':output,'interpolation':'LINEAR'});channels.append({'sampler':len(samplers)-1,'target':{'node':i,'path':'rotation'}})
 gltf={'asset':{'version':'2.0','generator':'Anime companion authored dance pipeline'},'scene':0,'scenes':[{'nodes':list(range(len(BONES)))}],'nodes':[{'name':b} for b in BONES],'buffers':[{'byteLength':len(data)}],'bufferViews':views,'accessors':accessors,'animations':[{'name':'dance-primary','samplers':samplers,'channels':channels}],'extras':{'coordinateConvention':'canonical XYZ anatomical rotations; retarget with rest-world adapters','source':'authored from all six supplied video references; not motion capture'}}
 raw=json.dumps(gltf,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);data+=b'\0'*((-len(data))%4);blob=struct.pack('<III',0x46546c67,2,12+8+len(raw)+8+len(data))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(data),0x004e4942)+data
 dest=ROOT/'assets/animations'/character;dest.mkdir(parents=True,exist_ok=True);(dest/'dance.glb').write_bytes(blob);print(character,len(blob))
