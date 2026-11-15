(function(root){
 'use strict';
 const T=root.WAIFU_VRM_VENDOR.THREE;
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const damp=(v,target,rate,dt)=>v+(target-v)*(1-Math.exp(-rate*dt));
 const ease=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
 const buffers=new Map();

 class WaifuAuthoredMotion {
  static fetchBuffer(model){
   model=model==='gothic_red'?'gothic_red':'seraphina';
   if(!buffers.has(model))buffers.set(model,(async()=>{
    const response=await fetch(chrome.runtime.getURL('assets/animations/'+model+'/authored-actions.glb'),{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Authored animation library failed to load');return response.arrayBuffer();
   })().catch(error=>{buffers.delete(model);throw error;}));
   return buffers.get(model);
  }
  static async create(animator,buffer){
   const gltf=await new Promise((resolve,reject)=>new root.WAIFU_VRM_VENDOR.GLTFLoader().parse(buffer,'',resolve,reject));
   return new WaifuAuthoredMotion(animator,gltf);
  }
  constructor(animator,gltf){
   this.a=animator;this.scene=gltf.scene;this.mixer=new T.AnimationMixer(this.scene);
   this.actions=new Map(gltf.animations.map(clip=>[clip.name,this.mixer.clipAction(clip)]));
   for(const key of ['idle','walk','dance','water','foldArms','consume','wave','celebrate','talk'])if(!this.actions.has(key))throw Error('Missing authored animation: '+key);
   this.metadata=gltf.parser.json.extras;this.targets=new Map();this.scene.traverse(node=>{if(node.name)this.targets.set(node.name,node);});
   if(!(this.metadata?.clips?.walk?.footTravelLegLengths>0))throw Error('Invalid authored gait metadata');
   this.bindings=[];
   for(const [key,record]of animator.boneMap){const target=this.targets.get(key);if(record.isNormalizedVrm&&target)this.bindings.push({key,record,target,from:record.node.quaternion.clone()});}
   this.base=animator.pivotGroup.position.clone();this.rootPosition=new T.Vector3();this.fromRoot=new T.Vector3();this.targetRoot=new T.Vector3();
   this.scratchQ=new T.Quaternion();this.gazeQ=new T.Quaternion();this.scratchEuler=new T.Euler();this.point=new T.Vector3();
   this.clipTime=0;this.age=0;this.name=null;this.token=null;this.blending=false;
  }
  walkSpeedPx(rate=1){
   const a=this.a,clip=this.metadata.clips.walk;
   return clip.footTravelLegLengths*a.legLength/a.modelHeight*(a.displayHeight*.85)/clip.duration*rate;
  }
  select(now){
   const a=this.a,b=a.behavior,active=a.microMotion&&b&&now<b.until,t=active?Math.max(0,(now-b.start)/1000):0;
   if(!a.microMotion){const name={wave:'wave',think:'foldArms',tea:'consume',celebrate:'celebrate'}[a.currentPose]||'idle';return {name,token:'static:'+name,time:name==='idle'||name==='consume'?0:this.actions.get(name).getClip().duration*.3};}
   if(a.walkAmount>.09)return {name:'walk',token:'walk',speed:clamp(a.walkSpeed/this.walkSpeedPx(),.25,1.35)};
   if(active){
    const token=b.id+':'+b.start;
    if(b.id==='garden'){
     if(t<1)return {name:'idle',token:token+':soil'};
     if(t<7.2)return {name:'water',token:token+':water',time:(t-1)/6.2*this.actions.get('water').getClip().duration};
     if(t<11.8)return {name:'idle',token:token+':grow'};
     return {name:'talk',token:token+':present'};
    }
    if(b.id==='dance')return {name:'dance',token,speed:a.modelKey==='gothic_red'?.95:.85};
    if(['pout','sidestep'].includes(b.id))return {name:'foldArms',token,speed:.85};
    if(b.id==='showPlant')return {name:'talk',token,speed:.85};
    if(b.id==='rest')return {name:'consume',token,time:this.sipTime(t)};
   }
   const name={idle:'idle',wave:'wave',think:'foldArms',tea:'consume',celebrate:'celebrate'}[a.currentPose]||'idle';
   return {name,token:name+':'+a.poseEnteredAt,speed:name==='wave'?.85:name==='celebrate'?(a.modelKey==='gothic_red'?.75:.65):1,time:name==='consume'?this.sipTime((now-a.poseEnteredAt)/1000):undefined};
  }
  sipTime(age){const phase=((age%8)+8)%8;return phase<4?0:(phase-4)/4*this.actions.get('consume').getClip().duration;}
  apply(selection,dt){
   const a=this.a,changed=selection.token!==this.token;
   if(changed){
    const first=this.name===null;
    for(const b of this.bindings)b.from.copy(b.record.node.quaternion);
    this.fromRoot.copy(a.pivotGroup.position).sub(this.base).multiplyScalar(1/a.legLength);
    this.action?.stop();this.action=this.actions.get(selection.name);this.action.reset().setLoop(T.LoopRepeat,Infinity).play();
    this.name=selection.name;this.token=selection.token;this.clipTime=0;this.age=first?1:0;
   }
   this.age+=dt;this.clipTime+=dt*(selection.speed??1);
   const duration=this.action.getClip().duration;
   this.phase=selection.time===undefined?this.clipTime%duration:clamp(selection.time,0,duration-.00001);
   this.mixer.setTime(this.phase);
   // A single whole-pose handoff; no per-joint lag, Euler reconstruction or
   // hinge enforcement is allowed to reshape the authored performance.
   const blend=a.microMotion?ease(this.age/.45):1;this.blending=blend<1;
   for(const {record,target,from}of this.bindings){
    this.scratchQ.copy(record.restLocalQ).multiply(target.quaternion).normalize();
    record.node.quaternion.slerpQuaternions(from,this.scratchQ,blend);record.node.position.copy(record.restLocalPos);
   }
   this.targetRoot.copy(this.targets.get('motionRoot').position);
   this.rootPosition.lerpVectors(this.fromRoot,this.targetRoot,blend);
   a.pivotGroup.position.copy(this.base).addScaledVector(this.rootPosition,a.legLength);
   // Only transitions need a floor safeguard. The final clips already include
   // a shoe-sole fit for each avatar and retain the source foot roll.
   if(this.blending){
    a.pivotGroup.updateWorldMatrix(true,true);let lowest=Infinity;
    for(const side of ['left','right']){
     const foot=a.boneMap.get(side+'Foot')?.node;if(!foot)continue;
     foot.getWorldQuaternion(this.scratchQ);
     for(const offset of this.metadata.soleOffsets[side]){
      this.point.fromArray(offset).multiplyScalar(a.legLength).applyQuaternion(this.scratchQ).add(foot.getWorldPosition(this.targetRoot));
      a.pivotGroup.parent.worldToLocal(this.point);lowest=Math.min(lowest,this.point.y);
     }
    }
    if(Number.isFinite(lowest)&&lowest<0)a.pivotGroup.position.y-=lowest;
   }
  }
  renderFrame(now){
   const a=this.a,dt=clamp((now-a.lastFrameTime)/1000,.001,.06);a.lastFrameTime=now;
   const t=(now-a.startTime)/1000;
   a.walkSpeed=damp(a.walkSpeed,a.microMotion?a.targetWalkSpeed:0,8,dt);
   a.walkAmount=damp(a.walkAmount,a.microMotion&&a.walkTarget?1:0,8,dt);
   if(!a.microMotion){a.walkAmount=0;a.walkSpeed=0;}
   a.lookX=damp(a.lookX,a.microMotion?a.targetLookX:0,6,dt);a.lookY=damp(a.lookY,a.microMotion?a.targetLookY:0,6,dt);
   a.eyeX=damp(a.eyeX,a.microMotion?a.targetEyeX:0,12,dt);a.eyeY=damp(a.eyeY,a.microMotion?a.targetEyeY:0,12,dt);
   a.hoverBoost=damp(a.hoverBoost,a.hoverTarget,8,dt);a.smoothDragLag=damp(a.smoothDragLag,a.dragVelX,9,dt);a.dragVelX*=Math.exp(-10*dt);a.dragVelY*=Math.exp(-10*dt);
   a.orbitYaw=damp(a.orbitYaw,a.targetOrbitYaw,14,dt);a.orbitPitch=damp(a.orbitPitch,a.targetOrbitPitch,14,dt);
   a.zoomLevel=damp(a.zoomLevel,a.targetZoomLevel,14,dt);a.zoomPanY=damp(a.zoomPanY,a.targetZoomPanY,12,dt);
   const active=a.microMotion&&a.behavior&&now<a.behavior.until;
   const away=active&&['pout','sidestep'].includes(a.behavior.id)?(a.modelKey==='gothic_red'?.32:.16):0;
   const heading=a.walkAmount>.09?a.walkDir*1.25:away;
   a.walkYaw+=clamp(damp(a.walkYaw,heading,6,dt)-a.walkYaw,-1.7*dt,1.7*dt);
   a.pivotGroup.rotation.set(0,a.orbitYaw+a.walkYaw,0);
   const focus=a.modelHeight*(.50*(1-clamp((a.zoomLevel-1)*1.15,0,1))+a.zoomPanY*clamp((a.zoomLevel-1)*1.15,0,1)),distance=a.baseCamDist/Math.max(1,a.zoomLevel);
   a.camera.position.set(0,focus+Math.sin(a.orbitPitch)*distance,Math.cos(a.orbitPitch)*distance);a.camera.lookAt(0,focus,0);
   const selection=this.select(now);
   a.walkPhase+=dt*(selection.name==='walk'?(selection.speed||1)*Math.PI*2/this.actions.get('walk').getClip().duration:0);
   a.secondaryMotion?.update(dt,t,a.walkPhase,a.walkAmount,selection.name==='celebrate'?.15:0,a.dragVelX*60/a.displayHeight,a.dragVelY*60/a.displayHeight,a.microMotion&&!a.paused);
   this.apply(selection,dt);
   // Keep eye/head response small enough that it cannot overwrite a gesture.
   const head=a.boneMap.get('head');
   if(head&&a.microMotion&&['idle','talk','foldArms'].includes(selection.name)){
    this.scratchEuler.set(a.lookY*.035,a.lookX*.08,0);this.gazeQ.setFromEuler(this.scratchEuler);head.node.quaternion.multiply(this.gazeQ);
   }
   if(a._lookAtTargetObj)a._lookAtTargetObj.position.set(a.eyeX*.45,a.modelHeight*(selection.name==='water'||selection.name==='plant'?.35:.82)-a.eyeY*.2,2.2);
   const tea=selection.name==='consume';
   for(const prop of a.teaPropNodes){prop.visible=tea;prop.scale.setScalar(tea?ease(this.age/.35):1);}
   let blink=0;
   if(a.microMotion){
    if(now>=a.nextBlinkAt&&a.blinkUntil<now){a.blinkUntil=now+150;a.nextBlinkAt=now+2600+Math.random()*2600;}
    if(now<a.blinkUntil)blink=Math.sin((a.blinkUntil-now)/150*Math.PI);
   }
   for(const name of ['blinkLeft','blinkRight'])a._applyExpression(name,0);
   a._applyExpression('blink',blink);a._applyExpression('happy',Math.max(['wave','celebrate','dance'].includes(selection.name)?.2:.035,a.apiExpression==='happy'?a.apiExpressionWeight:0));
   a._applyExpression('relaxed',Math.max(tea?.12:0,a.apiExpression==='relaxed'?a.apiExpressionWeight:0));
   a._applyExpression('angry',Math.max(away?.18:0,a.apiExpression==='angry'?a.apiExpressionWeight:0));
   if(a.apiExpression&&!['happy','relaxed','angry','blink'].includes(a.apiExpression))a._applyExpression(a.apiExpression,a.apiExpressionWeight);
   a._applyExpression('aa',a.mouthOpenWeight);
   // Humanoid animation, expressions and native spring bones update together.
   if(a.vrm){const count=Math.max(1,Math.ceil(dt*60));for(let i=0;i<count;i++)a.vrm.update(dt/count);}
   a.secondaryMotion?.apply();
   if(tea){
    // The source holds a small item. Keep the saucer level while following the
    // hand's authored path; tilt the cup slightly toward the mouth during a sip.
    a.pivotGroup.updateWorldMatrix(true,true);
    const sip=Math.sin(this.phase/this.action.getClip().duration*Math.PI);
    for(const prop of a.teaPropNodes){
     if(!prop.isGroup)continue;
     prop.parent.getWorldQuaternion(this.scratchQ).invert();a.pivotGroup.getWorldQuaternion(this.gazeQ);this.scratchQ.multiply(this.gazeQ);
     this.gazeQ.setFromEuler(this.scratchEuler.set(-.3*sip,0,0));prop.quaternion.copy(this.scratchQ).multiply(this.gazeQ);
    }
   }
   a._updateGarden3D(now);a.renderer.render(a.scene,a.camera);
  }
  dispose(){this.mixer.stopAllAction();this.mixer.uncacheRoot(this.scene);this.bindings.length=0;this.targets.clear();this.a=null;}
 }
 root.WaifuAuthoredMotion=WaifuAuthoredMotion;
})(globalThis);
