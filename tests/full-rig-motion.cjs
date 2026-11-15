const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
for(const file of ['vendor/vrm-bundle.js','shared/defaults.js','shared/dance-player.js','content/vrm-animator.js'])vm.runInThisContext(fs.readFileSync(path.join(root,file),'utf8'));
const T=WAIFU_VRM_VENDOR.THREE;
global.chrome={runtime:{getURL:p=>p}};global.fetch=async p=>new Response(fs.readFileSync(path.join(root,p)));
// Use the actual shipped rig's measured rest geometry, with normalized VRM
// axes. Rendering/textures are omitted; production renderFrame still runs.
function rig(model){
 const bytes=fs.readFileSync(path.join(root,'assets/models',model==='seraphina'?'seraphina.vrm':'companion_alt.vrm'));
 const j=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),parents=new Map();j.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
 function matrix(i){const n=j.nodes[i],m=new T.Matrix4().compose(new T.Vector3(...(n.translation||[0,0,0])),new T.Quaternion(...(n.rotation||[0,0,0,1])),new T.Vector3(...(n.scale||[1,1,1])));return parents.has(i)?matrix(parents.get(i)).multiply(m):m;}
 const bones=j.extensions.VRMC_vrm.humanoid.humanBones,byIndex=new Map(Object.entries(bones).map(([k,b])=>[b.node,k]));
 const points=Object.fromEntries(Object.entries(bones).map(([k,b])=>[k,new T.Vector3().setFromMatrixPosition(matrix(b.node))]));
 const a=new WaifuVrmAnimator({style:{}},{modelKey:model,height:440});
 a.modelRoot=new T.Group();a.pivotGroup.add(a.modelRoot);a.modelHeight=points.head.y+points.head.y*.12;a.isVrmModel=true;
 for(const key of Object.keys(bones)){let parent=parents.get(bones[key].node);while(parent!==undefined&&!byIndex.has(parent))parent=parents.get(parent);const pkey=byIndex.get(parent),node=new T.Object3D();node.name=key;node.position.copy(points[key]);if(pkey)node.position.sub(points[pkey]);a.boneMap.set(key,{node,restLocalQ:node.quaternion.clone(),restLocalPos:node.position.clone(),isNormalizedVrm:true,pkey});}
 for(const rec of a.boneMap.values())(a.boneMap.get(rec.pkey)?.node||a.modelRoot).add(rec.node);
 a.vrm={update(){},humanoid:{getNormalizedBoneNode:k=>a.boneMap.get(k)?.node}};
 a.legLength=points.hips.y-points.leftFoot.y;a.legSegments={};for(const side of ['left','right'])a.legSegments[side]=[points[side+'UpperLeg'].distanceTo(points[side+'LowerLeg']),points[side+'LowerLeg'].distanceTo(points[side+'Foot'])];
 a.startTime=0;a.lastFrameTime=0;a._captureSupportRest();return a;
}
WaifuVrmAnimator.prototype._initThree=function(){this.scene=new T.Scene();this.pivotGroup=new T.Group();this.scene.add(this.pivotGroup);this.camera=new T.PerspectiveCamera();this.renderer={render(){}};this._tmpEuler=new T.Euler();this._tmpDeltaQ=new T.Quaternion();this._tmpConjQ=new T.Quaternion();};
WaifuVrmAnimator.prototype.resize=function(h){this.displayHeight=h;};
(async()=>{
 for(const model of ['seraphina','gothic_red']){
  const a=rig(model),previous=new Map();let clock=0,maxSpeed=0,maxSupportError=0;
  for(const action of ['idle','wave','think','celebrate','tea','walk','garden','dance','pout','sidestep','rest','showPlant']){
   a.behavior=null;a.setWalking(false);a.setPose(['wave','think','celebrate','tea'].includes(action)?action:action==='rest'?'tea':'idle',false);
   const duration=action==='garden'?16:action==='dance'?10:5;
   if(action==='dance')await a.prepareDance();
   if(['garden','dance','pout','sidestep','rest','showPlant'].includes(action))a.behavior={id:action,start:clock,until:clock+duration*1000,crimson:model==='gothic_red'};
   if(action==='walk')a.setWalking(true,1,210);
   for(let frame=0;frame<duration*60;frame++){
    clock+=1000/60;a.renderFrame(clock);a.pivotGroup.updateWorldMatrix(true,true);
    for(const [key,rec]of a.boneMap){assert(rec.node.quaternion.toArray().every(Number.isFinite),model+' '+action+' '+key);if(previous.has(key)){const speed=previous.get(key).angleTo(rec.node.quaternion)*60;maxSpeed=Math.max(maxSpeed,speed);assert(speed<5.03,'Joint snap '+model+' '+action+' '+key+' '+speed);}previous.set(key,rec.node.quaternion.clone());}
    const error=Math.min(...['left','right'].map(side=>{const p=a.boneMap.get(side+'Foot').node.getWorldPosition(new T.Vector3());a.pivotGroup.parent.worldToLocal(p);return p.y-a._supportRest[side];}));maxSupportError=Math.max(maxSupportError,Math.abs(error));assert(Math.abs(error)<1e-5,'Full chained pose lost floor contact '+action+' '+error);
    if(action==='garden'&&frame===210){assert(a.garden3D.can.visible&&a.garden3D.stream.visible);assert(!a.garden3D.plant.visible,'Plant must grow after watering');const hand=a.boneMap.get('rightHand').node.getWorldPosition(new T.Vector3()),can=a.garden3D.can.getWorldPosition(new T.Vector3());assert(hand.distanceTo(can)<.0001,'Watering handle must follow the hand through the full rig');assert(a.boneMap.get('rightIndexIntermediate').node.quaternion.z>0,'Gripping fingers must curl into the palm rather than hyperextend');}
    if(action==='garden'&&frame===690){assert(a.garden3D.plant.visible&&a.garden3D.plant.scale.x>.99);assert(!a.garden3D.can.visible&&!a.garden3D.stream.visible);}
    if(action==='showPlant'&&frame===120){assert(a.garden3D.plant.visible&&a.garden3D.plant.scale.x>.99);assert(!a.garden3D.can.visible);}
   }
  }
  a.behavior={id:'garden',start:clock,until:clock+16000};a.setPose('idle',false);for(let i=0;i<120;i++){clock+=1000/60;a.renderFrame(clock);}assert(a.garden3D.can.visible&&a.garden3D.stream.visible);
  a.behavior=null;a.setWalking(false);a.setPose('idle',false);clock+=1000/60;a.renderFrame(clock);assert(!a.garden3D.group.visible,'Mid-watering cancellation must hide all 3D garden props');
  a.setWalking(true,1,210);for(let i=0;i<180;i++){if(i===90)a.setWalking(true,-1,210);const yaw=a.walkYaw;clock+=1000/60;a.renderFrame(clock);assert(Math.abs(a.walkYaw-yaw)<=1.6/60+.00001,'Direction changes must not snap the entire avatar around');}assert(a.walkYaw<-.5);
  a.setWalking(true,1,210);for(let i=0;i<90;i++){clock+=1000/60;a.renderFrame(clock);}a.microMotion=false;clock+=1000/60;a.renderFrame(clock);assert.equal(a.walkAmount,0,'Disabling animation must not freeze a partially blended walking pose');assert.equal(a.poseWeights.idle,1);
  for(const pose of ['idle','wave','think','tea','celebrate']){a.setPose(pose,false);clock+=1000/60;a.renderFrame(clock);const staticPose=new Map([...a.boneMap].map(([k,r])=>[k,r.node.quaternion.clone()]));clock+=1000/60;a.renderFrame(clock);for(const [k,r]of a.boneMap)assert(r.node.quaternion.angleTo(staticPose.get(k))<1e-6,'Static pose must be settled '+pose+' '+k);}
  const materials=new Set();a.garden3D.group.traverse(n=>{if(n.material)materials.add(n.material);});let disposed=0;for(const m of materials)m.addEventListener('dispose',()=>disposed++);a._disposeCurrentModel();assert.equal(disposed,materials.size,'Garden materials must be released on model change');assert.equal(a._poseHistory,null);
  console.log(model,{maxJointRadiansPerSecond:maxSpeed,maxSupportError});
 }
 console.log('Full rig passed: all 12 actions and transitions, joint speeds, chained floor contact, hand-held watering, staged growth, cancellation and resource disposal.');
})().catch(e=>{console.error(e);process.exitCode=1;});
