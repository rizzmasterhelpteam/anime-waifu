(function(root){
 'use strict';
 const canonical=k=>k==='gothic_red'?'gothic_red':'seraphina';
 const url=p=>chrome.runtime.getURL(p);
 async function resource(path,type){const r=await fetch(url(path),{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Dance asset unavailable: '+path);return type==='json'?r.json():r.arrayBuffer();}
 const weight=(elapsed,duration)=>Math.max(0,Math.min(1,elapsed/.25,(duration-elapsed)/.25));
 class SpriteDance {
  constructor(){this.pages=new Map();this.pending=new Map();this.generation=0;this.meta=null;this.model=null;}
  async prepare(key){
   key=canonical(key);if(this.model!==key||!this.meta){this.release();const generation=this.generation;this.model=key;const m=await resource('assets/animations/'+key+'/dance.json','json');if(generation!==this.generation)throw Error('Dance cancelled');if(m.fps!==24||m.width!==320||m.height!==420||!Array.isArray(m.pages)||m.frameCount<1)throw Error('Invalid dance manifest');this.meta=m;}
   await Promise.all([this.page(0),this.page(1)]);return this.meta.duration;
  }
  page(index){
   if(!this.meta?.pages[index])return Promise.resolve(null);
   if(this.pages.has(index))return Promise.resolve(this.pages.get(index));
   if(this.pending.has(index))return this.pending.get(index);
   const generation=this.generation,path=this.meta.pages[index];
   const promise=(async()=>{const buffer=await resource(path);const bitmap=await createImageBitmap(new Blob([buffer],{type:'image/webp'}));if(generation!==this.generation){bitmap.close();return null;}this.pages.set(index,bitmap);return bitmap;})().finally(()=>{if(generation===this.generation)this.pending.delete(index);});
   this.pending.set(index,promise);return promise;
  }
  draw(ctx,behavior,now,x,y,w,h){
   const m=this.meta;if(!m)return false;
   const elapsed=(now-behavior.start)/1000,index=Math.min(m.frameCount-1,Math.max(0,Math.floor(elapsed*m.fps))),page=Math.floor(index/m.framesPerPage),slot=index%m.framesPerPage;
   for(const [id,bitmap]of this.pages)if(id!==page&&id!==page+1){bitmap.close();this.pages.delete(id);}
   this.page(page+1).catch(()=>{});
   const bitmap=this.pages.get(page);
   if(!bitmap){this.page(page).catch(()=>{});return false;}
   ctx.save();ctx.globalAlpha=weight(elapsed,m.duration);ctx.drawImage(bitmap,slot%m.columns*m.width,Math.floor(slot/m.columns)*m.height,m.width,m.height,x,y,w,h);ctx.restore();return true;
  }
  release(){this.generation++;for(const bitmap of this.pages.values())bitmap.close();this.pages.clear();this.pending.clear();this.meta=null;this.model=null;}
 }
 class SkeletonDance {
  constructor(){this.model=null;this.scene=null;this.generation=0;}
  async prepare(key){
   key=canonical(key);if(this.model===key&&this.scene)return this.duration;
   this.release();const generation=this.generation,V=root.WAIFU_VRM_VENDOR,T=V.THREE;
   const buffer=await resource('assets/animations/'+key+'/dance.glb');
   const gltf=await new Promise((resolve,reject)=>new V.GLTFLoader().parse(buffer,'',resolve,reject));
   if(generation!==this.generation)throw Error('Dance cancelled');
   if(!gltf.animations[0])throw Error('Missing dance tracks');
   this.model=key;this.scene=gltf.scene;this.mixer=new T.AnimationMixer(this.scene);this.action=this.mixer.clipAction(gltf.animations[0]);this.action.setLoop(T.LoopOnce,1);this.action.clampWhenFinished=true;this.action.play();this.duration=gltf.animations[0].duration;
   this.euler=new T.Euler();this.beforeQ=new T.Quaternion();this.targetQ=new T.Quaternion();this.targets=new Map();this.scene.traverse(n=>{if(n.name)this.targets.set(n.name,n);});
   return this.duration;
  }
  apply(animator,behavior,now){
   if(!this.scene)return;
   const elapsed=Math.max(0,(now-behavior.start)/1000),blend=weight(elapsed,this.duration);
   this.mixer.setTime(Math.min(this.duration,elapsed));
   for(const [key,node]of this.targets){
    const record=animator.boneMap.get(key);if(!record)continue;
    this.beforeQ.copy(record.node.quaternion);this.euler.setFromQuaternion(node.quaternion,'XYZ');
    animator._setBoneWorldEuler(key,this.euler.x,this.euler.y,this.euler.z);
    this.targetQ.copy(record.node.quaternion);
    record.node.quaternion.slerpQuaternions(this.beforeQ,this.targetQ,blend);
   }
  }
  release(){this.generation++;this.mixer?.stopAllAction();if(this.scene)this.mixer?.uncacheRoot(this.scene);this.scene=null;this.model=null;this.targets?.clear();}
 }
 root.WAIFU_DANCE={SpriteDance,SkeletonDance,weight};
})(globalThis);
