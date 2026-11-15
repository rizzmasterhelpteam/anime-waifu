const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
for(const file of ['vendor/vrm-bundle.js','shared/defaults.js','shared/dance-player.js','content/authored-motion.js','content/vrm-animator.js'])vm.runInThisContext(fs.readFileSync(path.join(root,file),'utf8'));
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
 a.vrm={scene:a.modelRoot,update(){},humanoid:{getNormalizedBoneNode:k=>a.boneMap.get(k)?.node,getRawBoneNode:k=>a.boneMap.get(k)?.node}};
 a.legLength=points.hips.y-points.leftFoot.y;a.legSegments={};for(const side of ['left','right'])a.legSegments[side]=[points[side+'UpperLeg'].distanceTo(points[side+'LowerLeg']),points[side+'LowerLeg'].distanceTo(points[side+'Foot'])];
 a.startTime=0;a.lastFrameTime=0;a._captureSupportRest();return a;
}
WaifuVrmAnimator.prototype._initThree=function(){this.scene=new T.Scene();this.pivotGroup=new T.Group();this.scene.add(this.pivotGroup);this.camera=new T.PerspectiveCamera();this.renderer={render(){}};this._tmpEuler=new T.Euler();this._tmpDeltaQ=new T.Quaternion();this._tmpConjQ=new T.Quaternion();};
WaifuVrmAnimator.prototype.resize=function(h){this.displayHeight=h;};
(async()=>{
 for(const model of ['seraphina','gothic_red']){
  const a=rig(model),previous=new Map();a.authoredMotion=await WaifuAuthoredMotion.create(a,await WaifuAuthoredMotion.fetchBuffer(model));let clock=0,maxSpeed=0,maxPenetration=0,sourceChecks=0,peakJoint=null;
  const skin=new T.CylinderGeometry(.1,.09,.5,16,12).translate(0,.8,0),count=skin.getAttribute('position').count,weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
  skin.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Uint16Array(count*4),4));skin.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));const sourceMesh=new T.SkinnedMesh(skin,new T.MeshStandardMaterial({color:0xffffff}));sourceMesh.name='Repair_ContinuousTorso';a.modelRoot.add(sourceMesh);sourceMesh.bind(new T.Skeleton([a.boneMap.get('hips').node]));a._createMotionLining();
  const lining=a.modelRoot.getObjectByName('Motion_FabricUnderlap');assert(lining&&a.motionLiningCount===1);assert.equal(lining.skeleton,sourceMesh.skeleton);assert(lining.bindMatrix.equals(sourceMesh.bindMatrix));assert.notEqual(lining.geometry,skin);assert.deepEqual(lining.geometry.getAttribute('skinWeight').array,skin.getAttribute('skinWeight').array);assert(lining.geometry.index.count<skin.index.count,'Fabric must cover the torso strip, leaving the neckline intact');assert(!lining.material.transparent&&lining.material.opacity===1,'Fabric underlap must be opaque');
  const dressGeometry=new T.CylinderGeometry(.11,.13,.6,12,16).translate(0,.35,0),dressCount=dressGeometry.getAttribute('position').count,dressWeights=new Float32Array(dressCount*4);for(let i=0;i<dressCount;i++)dressWeights[i*4]=1;
  dressGeometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Uint16Array(dressCount*4),4));dressGeometry.setAttribute('skinWeight',new T.Float32BufferAttribute(dressWeights,4));const dressMaterial=new T.MeshStandardMaterial();dressMaterial.name='Test_Tops_01_CLOTH_02';const dress=new T.SkinnedMesh(dressGeometry,[dressMaterial,dressMaterial.clone()]);a.modelRoot.add(dress);const oldPalette=new T.Skeleton([a.boneMap.get('hips').node]);dress.bind(oldPalette);a.modelRoot.position.z=.05;a.pivotGroup.updateWorldMatrix(true,true);dress.skeleton.update();const restVertices=Array.from({length:dressCount},(_,i)=>dress.applyBoneTransform(i,new T.Vector3().fromBufferAttribute(dressGeometry.getAttribute('position'),i)));a._fitDressSkinning();dress.skeleton.update();for(let i=0;i<dressCount;i++)assert(dress.applyBoneTransform(i,new T.Vector3().fromBufferAttribute(dress.geometry.getAttribute('position'),i)).distanceTo(restVertices[i])<1e-6,'Expanded garment palette must preserve the actual skinned rest pose');
  if(model==='seraphina'){assert.equal(a.motionDressFitCount,1);assert.equal(oldPalette.bones.length,1,'Other meshes must retain their own bone palette');assert.equal(dress.skeleton.bones.length,5,'Missing leg joints must be added to the garment palette');assert.notEqual(dress.geometry,dressGeometry);assert.deepEqual(dress.geometry.getAttribute('position').array,dressGeometry.getAttribute('position').array,'Dress rest shape must stay unchanged');const weights=dress.geometry.getAttribute('skinWeight'),indices=dress.geometry.getAttribute('skinIndex');let legVertices=0;for(let i=0;i<dressCount;i++){let sum=0;for(let k=0;k<4;k++){const w=weights.array[i*4+k];sum+=w;if(indices.array[i*4+k]>0&&w>.1)legVertices++;}assert(Math.abs(sum-1)<1e-5,'Dress weights must normalize');}assert(legVertices>100,'Lower gown must follow the legs rather than independent cloth joints');assert.equal(dressGeometry.getAttribute('skinIndex').getX(0),0,'Shared original attributes must not be mutated');}
  // Production VRMs must not enter the old procedural pose/IK/clamp path.
  a._stabilizePose=a._reachHand=a._solveWalkLeg=()=>{throw Error('Legacy motion reshaped an authored performance');};
  for(const action of ['idle','wave','think','celebrate','tea','walk','garden','dance','pout','sidestep','rest','showPlant']){
   a.behavior=null;a.setWalking(false);a.setPose(['wave','think','celebrate','tea'].includes(action)?action:action==='rest'?'tea':'idle',false);a.poseEnteredAt=clock;
   const duration=action==='garden'?16:action==='dance'?10:5;
   if(action==='dance')await a.prepareDance();
   if(['garden','dance','pout','sidestep','rest','showPlant'].includes(action))a.behavior={id:action,start:clock,until:clock+duration*1000,crimson:model==='gothic_red'};
   if(action==='walk')a.setWalking(true,1,210);
   for(let frame=0;frame<duration*60;frame++){
    clock+=1000/60;a.renderFrame(clock);a.pivotGroup.updateWorldMatrix(true,true);
    for(const [key,rec]of a.boneMap){assert(rec.node.quaternion.toArray().every(Number.isFinite),model+' '+action+' '+key);if(previous.has(key)){const speed=previous.get(key).angleTo(rec.node.quaternion)*60;if(speed>maxSpeed){maxSpeed=speed;peakJoint={action,key,frame};}assert(speed<22,'Discontinuous joint '+model+' '+action+' '+key+' '+speed+' frame '+frame+' phase '+a.authoredMotion.phase);}previous.set(key,rec.node.quaternion.clone());}
    let lowest=Infinity;for(const side of ['left','right']){const foot=a.boneMap.get(side+'Foot').node,worldQ=foot.getWorldQuaternion(new T.Quaternion()),worldP=foot.getWorldPosition(new T.Vector3());for(const o of a.authoredMotion.metadata.soleOffsets[side]){const p=new T.Vector3(...o).multiplyScalar(a.legLength).applyQuaternion(worldQ).add(worldP);lowest=Math.min(lowest,p.y);}}
    maxPenetration=Math.max(maxPenetration,-lowest/a.legLength);assert(lowest>-.025*a.legLength,'Shoe penetrated floor '+action+' '+lowest);
    if(!a.authoredMotion.blending){for(const b of a.authoredMotion.bindings){const expected=b.record.restLocalQ.clone().multiply(b.target.quaternion).normalize();assert(b.record.node.quaternion.angleTo(expected)<1e-5,'Authored 3D joint rotation was altered '+b.key);}sourceChecks++;}
    if(action==='garden'&&frame>=220&&frame<=315)assert(a.garden3D.stream.visible,'A steady held pour must not flicker on and off');
    if(action==='garden'&&frame===240){assert(a.garden3D.can.visible&&a.garden3D.stream.visible);assert(!a.garden3D.plant.visible,'Plant must grow after watering');const grip=new T.Vector3();for(const key of ['rightMiddleIntermediate','rightMiddleDistal'])grip.add(a.boneMap.get(key).node.getWorldPosition(new T.Vector3()));grip.multiplyScalar(.5);const can=a.garden3D.can.getWorldPosition(new T.Vector3());assert(grip.distanceTo(can)<.0001,'Top handle must sit inside the curled fingers, not at the wrist');const g=a.garden3D,positions=g.stream.children[1].geometry.getAttribute('position');assert(new T.Vector3().fromBufferAttribute(positions,0).distanceTo(g.point)<1e-6,'Water must start at the nozzle');assert(Math.abs(positions.getY(16)-g.target.y)<1e-6,'Gravity must bring water to soil height');assert(Math.hypot(positions.getX(16)-g.target.x,positions.getZ(16)-g.target.z)<a.modelHeight*.055,'Water must physically land inside the pot');assert(positions.getY(8)>(positions.getY(0)+positions.getY(16))/2,'Gravity stream must curve down instead of aiming as a straight beam');}
    if(action==='garden'&&frame===730){assert(a.garden3D.plant.visible&&a.garden3D.plant.scale.x>.99);assert(!a.garden3D.can.visible&&!a.garden3D.stream.visible);}
    if(action==='showPlant'&&frame===120){assert(a.garden3D.plant.visible&&a.garden3D.plant.scale.x>.99);assert(!a.garden3D.can.visible);}
   }
  }
  a.behavior={id:'garden',start:clock,until:clock+16000};a.setPose('idle',false);for(let i=0;i<240;i++){clock+=1000/60;a.renderFrame(clock);}assert(a.garden3D.can.visible&&a.garden3D.stream.visible);
  const originalRaw=a.vrm.humanoid.getRawBoneNode,rawFingers=new Map();
  for(const key of ['rightMiddleIntermediate','rightMiddleDistal']){const n=new T.Object3D();n.position.copy(a.boneMap.get(key).node.getWorldPosition(new T.Vector3())).add(new T.Vector3(.02,0,0));a.scene.add(n);rawFingers.set(key,n);}
  a.vrm.humanoid.getRawBoneNode=key=>rawFingers.get(key)||originalRaw(key);a._updateGarden3D(clock);
  const renderedGrip=new T.Vector3();for(const n of rawFingers.values())renderedGrip.add(n.getWorldPosition(new T.Vector3()));renderedGrip.multiplyScalar(.5);
  assert(a.garden3D.can.getWorldPosition(new T.Vector3()).distanceTo(renderedGrip)<1e-6,'The rendered raw finger grip must win over the invisible normalized rig');
  a.vrm.humanoid.getRawBoneNode=originalRaw;for(const n of rawFingers.values())a.scene.remove(n);
  a.behavior=null;a.setWalking(false);a.setPose('idle',false);clock+=1000/60;a.renderFrame(clock);assert(!a.garden3D.group.visible,'Mid-watering cancellation must hide all 3D garden props');
  a.setWalking(true,1,210);for(let i=0;i<180;i++){if(i===90)a.setWalking(true,-1,210);const yaw=a.walkYaw;clock+=1000/60;a.renderFrame(clock);assert(Math.abs(a.walkYaw-yaw)<=1.7/60+.00001,'Direction changes must not snap the entire avatar around');}assert(a.walkYaw<-.5);
  a.setWalking(true,1,210);for(let i=0;i<90;i++){clock+=1000/60;a.renderFrame(clock);}a.microMotion=false;clock+=1000/60;a.renderFrame(clock);assert.equal(a.walkAmount,0,'Disabling animation must not freeze a partially blended walking pose');assert.equal(a.poseWeights.idle,1);
  for(const pose of ['idle','wave','think','tea','celebrate']){a.setPose(pose,false);clock+=1000/60;a.renderFrame(clock);const staticPose=new Map([...a.boneMap].map(([k,r])=>[k,r.node.quaternion.clone()]));clock+=1000/60;a.renderFrame(clock);for(const [k,r]of a.boneMap)assert(r.node.quaternion.angleTo(staticPose.get(k))<1e-6,'Static pose must be settled '+pose+' '+k);}
  const materials=new Set();a.garden3D.group.traverse(n=>{if(n.material)materials.add(n.material);});let disposed=0;for(const m of materials)m.addEventListener('dispose',()=>disposed++);a._disposeCurrentModel();assert.equal(disposed,materials.size,'Garden materials must be released on model change');assert.equal(a._poseHistory,null);
  assert(sourceChecks>3000);assert.equal(a.authoredMotion,null);console.log(model,{maxJointRadiansPerSecond:maxSpeed,maxSolePenetrationLegLengths:maxPenetration,unalteredAuthoredPoseFrames:sourceChecks,peakJoint});
 }
 console.log('Full rig passed: all 12 actions, preserved authored joint rotations, sole contact, transitions, hand-held props, staged growth, cancellation and resource disposal.');
})().catch(e=>{console.error(e);process.exitCode=1;});
