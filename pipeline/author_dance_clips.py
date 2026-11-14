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
 # Step-touch choreography with planted contact beats and alternating swing feet.
 patterns=[(-.10,.10,0,0,0),(-.24,.10,-.055,.065,0),(-.24,.10,-.10,0,0),(-.24,-.04,-.10,0,.065),(-.24,-.04,-.10,0,0),(-.24,.20,-.025,0,.075),(-.24,.20,.07,0,0),(-.02,.20,.07,.065,0),(-.02,.20,.07,0,0),(-.10,.10,0,.04,.015),(-.10,.10,0,0,0)]
 beats=[];positions=[];times=[i*.4 for i in range(26)]
 for beat in range(26):
  lx,rx,hx,llift,rlift=patterns[beat%10]
  if beat in (0,25):lx,rx,hx,llift,rlift=-.10,.10,0,0,0
  # VRM canonical +X points toward the character's left.
  lx,rx,hx=-lx,-rx,-hx
  p=pose();hipHeight=.975
  for side,fx,lift,offset in [('left',lx,llift,.10),('right',rx,rlift,-.10)]:
   z=.10*math.sin(beat*.8) if lift else 0
   dx=fx-hx-offset;y=-hipHeight+lift;d=min(.999,max(.05,math.sqrt(dx*dx+y*y+z*z)))
   knee=math.pi-math.acos(max(-1,min(1,(.52**2+.48**2-d*d)/(2*.52*.48))))
   thigh=-math.atan2(z,-y)-math.acos(max(-1,min(1,(.52**2+d*d-.48**2)/(2*.52*d))))
   p[side+'UpperLeg']=[thigh,0,math.asin(max(-.3,min(.3,dx/d)))];p[side+'LowerLeg']=[knee,0,0];p[side+'Foot']=[-thigh-knee,0,0]
  sway=math.sin(beat*math.pi/2)*(.065 if lively else .045)
  p['hips']=[0,sway*.8,sway];p['chest']=[-.025,-sway*1.5,-sway*.65];p['head']=[-.025,math.sin(beat*.7)*.12,-sway*.5]
  phrase=(beat//2)%4
  if phrase==0:
   p['leftUpperArm']=[-.20,-.12,-1.05];p['rightUpperArm']=[-.12,.1,1.1];p['leftLowerArm']=[0,-.25,.65];p['rightLowerArm']=[0,.25,-.4]
  elif phrase==1:
   p['leftUpperArm']=[-.35,-.1,-1.15];p['leftLowerArm']=[0,-.3,1.8];p['rightUpperArm']=[-.2,.1,.85];p['rightLowerArm']=[0,.2,-.65]
  elif phrase==2:
   p['leftUpperArm']=[-.25,-.1,-.85];p['rightUpperArm']=[-.25,.1,.85];p['leftLowerArm']=[0,-.2,1.15];p['rightLowerArm']=[0,.2,-1.15]
  else:
   p['rightUpperArm']=[-.28,.1,1.05];p['rightLowerArm']=[0,.25,-1.65];p['leftUpperArm']=[-.10,-.1,-1.1];p['leftLowerArm']=[0,-.25,.3]
  p['root']=[0,math.sin(beat*.42)*.14,0]
  if beat in (0,25):p=pose()
  beats.append(p);positions.append([hx,hipHeight-1,0] if beat not in (0,25) else [0,0,0])
 # Add eased subkeys. This is keyframed motion rather than a runtime oscillator.
 sampled_times=[];sampled_positions=[];sampled={b:[] for b in BONES}
 for j in range(len(times)-1):
  for step in range(12):
   u=step/12;e=u*u*(3-2*u);sampled_times.append(times[j]+(times[j+1]-times[j])*u);sampled_positions.append([positions[j][k]*(1-e)+positions[j+1][k]*e for k in range(3)])
   for b in BONES:sampled[b].append(quat([beats[j][b][i]*(1-e)+beats[j+1][b][i]*e for i in range(3)]))
 sampled_times.append(10);sampled_positions.append([0,0,0])
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
 output=accessor(sampled_positions,3,'VEC3');samplers.append({'input':time_accessor,'output':output,'interpolation':'LINEAR'});channels.append({'sampler':len(samplers)-1,'target':{'node':BONES.index('root'),'path':'translation'}})
 gltf={'asset':{'version':'2.0','generator':'Anime companion authored dance pipeline'},'scene':0,'scenes':[{'nodes':list(range(len(BONES)))}],'nodes':[{'name':b} for b in BONES],'buffers':[{'byteLength':len(data)}],'bufferViews':views,'accessors':accessors,'animations':[{'name':'dance-primary','samplers':samplers,'channels':channels}],'extras':{'coordinateConvention':'canonical XYZ anatomical rotations; retarget with rest-world adapters','source':'authored from all six supplied video references; not motion capture'}}
 raw=json.dumps(gltf,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);data+=b'\0'*((-len(data))%4);blob=struct.pack('<III',0x46546c67,2,12+8+len(raw)+8+len(data))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(data),0x004e4942)+data
 dest=ROOT/'assets/animations'/character;dest.mkdir(parents=True,exist_ok=True);(dest/'dance-v2.glb').write_bytes(blob);print(character,len(blob))
