"""Offline chroma-key/atlas pipeline. Original videos are never modified."""
import argparse,json,math
from pathlib import Path
from collections import deque
import numpy as np
from PIL import Image
import imageio.v2 as iio
ROOT=Path(__file__).resolve().parents[1]
NAMES={'seraphina':'Person_dancing_on_green_screen_8cbd46c3_1080p.mp4','gothic_red':'Person_dancing_on_green_screen_76c716b8_1080p.mp4'}

def cutout(rgb):
 a=rgb.astype(np.float32);r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
 alpha=np.clip((42-(g-np.maximum(r,b)))/30,0,1)
 # Keep the largest foreground component; detached watermark/sparkles disappear.
 small=np.array(Image.fromarray((alpha*255).astype('uint8')).resize((135,240)))>100
 seen=np.zeros_like(small);best=[]
 for y,x in zip(*np.where(small)):
  if seen[y,x]:continue
  q=deque([(int(y),int(x))]);seen[y,x]=1;component=[]
  while q:
   yy,xx=q.popleft();component.append((yy,xx))
   for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
    ny,nx=yy+dy,xx+dx
    if 0<=ny<240 and 0<=nx<135 and small[ny,nx] and not seen[ny,nx]:seen[ny,nx]=1;q.append((ny,nx))
  if len(component)>len(best):best=component
 keep=np.zeros((240,135),dtype='uint8')
 for y,x in best:keep[y,x]=255
 from PIL import ImageFilter
 mask=np.array(Image.fromarray(keep).filter(ImageFilter.MaxFilter(5)).resize((rgb.shape[1],rgb.shape[0]),Image.Resampling.NEAREST))/255
 alpha*=mask
 # Despill only edge pixels; retain original skin, dress, hair and outline colors.
 edge=(alpha>0)&(alpha<.99);a[:,:,1]=np.where(edge,np.minimum(g,np.maximum(r,b)+8),g)
 rgba=np.dstack((a,alpha*255)).astype('uint8');rgba[alpha==0,:3]=0
 return Image.fromarray(rgba)

def build(folder,character):
 source=folder/NAMES[character];reader=iio.get_reader(str(source),'ffmpeg');meta=reader.get_meta_data();fps=round(meta['fps']);count=round(meta['duration']*fps)
 dest=ROOT/'assets/animations'/character;dest.mkdir(parents=True,exist_ok=True)
 scratch=ROOT/'work/dance-frames'/character;scratch.mkdir(parents=True,exist_ok=True)
 union=None
 for i in range(count):
  frame=cutout(reader.get_data(i));bbox=frame.getbbox()
  if bbox:union=bbox if union is None else (min(union[0],bbox[0]),min(union[1],bbox[1]),max(union[2],bbox[2]),max(union[3],bbox[3]))
  frame.save(scratch/f'{i:03}.png')
 reader.close();w,h=320,420;scale=min((w-24)/(union[2]-union[0]),(h-24)/(union[3]-union[1]));rw=round((union[2]-union[0])*scale);rh=round((union[3]-union[1])*scale)
 pages=[]
 for page in range(math.ceil(count/24)):
  atlas=Image.new('RGBA',(1920,1680))
  for slot in range(24):
   index=page*24+slot
   if index>=count:break
   image=Image.open(scratch/f'{index:03}.png').crop(union).resize((rw,rh),Image.Resampling.LANCZOS)
   cell=Image.new('RGBA',(w,h));cell.alpha_composite(image,((w-rw)//2,h-8-rh));atlas.alpha_composite(cell,((slot%6)*w,(slot//6)*h))
  name=f'dance-{page:02}.webp';atlas.save(dest/name,'WEBP',quality=88,method=6,alpha_quality=100);pages.append(f'assets/animations/{character}/{name}')
 result={'id':'dance-primary','fps':fps,'frameCount':count,'duration':count/fps,'width':w,'height':h,'columns':6,'framesPerPage':24,'pages':pages,'source':source.name,'anchor':[.5,1]}
 (dest/'dance.json').write_text(json.dumps(result,indent=2)+'\n')
 print(character,count,union,'bytes',sum((ROOT/path).stat().st_size for path in pages),flush=True)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('folder',type=Path);args=parser.parse_args()
 for character in NAMES:build(args.folder,character)
