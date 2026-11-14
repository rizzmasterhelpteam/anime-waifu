"""Build alpha-correct optical-flow inbetweens from registered walk frames."""
from pathlib import Path
import numpy as np
from PIL import Image
import cv2
root=Path(__file__).resolve().parents[1]
keys=['walk_left','walk_pass_left','walk_contact_right','walk_pass_right']
for model,prefix in [('seraphina',root/'assets/sprites'),('gothic_red',root/'assets/sprites/crimson')]:
 frames=[np.array(Image.open(prefix/(k+'.png')).convert('RGBA').resize((320,420),Image.Resampling.LANCZOS)).astype(np.float32)/255 for k in keys]
 atlas=Image.new('RGBA',(1920,1680));gridx,gridy=np.meshgrid(np.arange(320,dtype=np.float32),np.arange(420,dtype=np.float32))
 for segment in range(4):
  a,b=frames[segment],frames[(segment+1)%4]
  def gray(im):return cv2.cvtColor(np.uint8((im[:,:,:3]*im[:,:,3:4]+1-im[:,:,3:4])*255),cv2.COLOR_RGB2GRAY)
  estimator=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM);estimator.setFinestScale(0)
  forward=estimator.calc(gray(a),gray(b),None)
  backward=estimator.calc(gray(b),gray(a),None)
  aa=a.copy();bb=b.copy();aa[:,:,:3]*=aa[:,:,3:4];bb[:,:,:3]*=bb[:,:,3:4]
  for j in range(6):
   u=j/6
   wa=cv2.remap(aa,gridx-u*forward[:,:,0],gridy-u*forward[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
   wb=cv2.remap(bb,gridx-(1-u)*backward[:,:,0],gridy-(1-u)*backward[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
   out=wa.copy() if u<.5 else wb.copy();out[:,:,:3]/=np.maximum(out[:,:,3:4],1e-6);out=np.uint8(np.clip(out*255,0,255))
   image=Image.fromarray(out);index=segment*6+j;atlas.alpha_composite(image,(index%6*320,index//6*420))
 dest=root/'assets/animations'/model/'walk.webp';atlas.save(dest,'WEBP',quality=90,alpha_quality=100,method=6);print(model,dest.stat().st_size,flush=True)
