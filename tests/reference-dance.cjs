const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
vm.runInThisContext(fs.readFileSync(path.join(root,'vendor/vrm-bundle.js'),'utf8'));
global.WAIFU_VRM_VENDOR=WAIFU_VRM_VENDOR;
global.chrome={runtime:{getURL:p=>p}};
global.fetch=async p=>new Response(fs.readFileSync(path.join(root,p)));
vm.runInThisContext(fs.readFileSync(path.join(root,'shared/dance-player.js'),'utf8'));
const T=WAIFU_VRM_VENDOR.THREE;
function geometry(model){
 const buffer=fs.readFileSync(path.join(root,'assets/models',model==='gothic_red'?'companion_alt.vrm':'seraphina.vrm'));
 const json=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString());
 const parents=new Map();json.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
 function matrix(i){const n=json.nodes[i],m=new T.Matrix4().compose(new T.Vector3(...(n.translation||[0,0,0])),new T.Quaternion(...(n.rotation||[0,0,0,1])),new T.Vector3(...(n.scale||[1,1,1])));return parents.has(i)?matrix(parents.get(i)).multiply(m):m;}
 const points=Object.fromEntries(Object.entries(json.extensions.VRMC_vrm.humanoid.humanBones).map(([name,v])=>[name,new T.Vector3().setFromMatrixPosition(matrix(v.node))]));
 const hips=points.hips.clone(),leg=hips.y-points.leftFoot.y;for(const p of Object.values(points))p.sub(hips).multiplyScalar(1/leg);return points;
}
(async()=>{
 for(const model of ['seraphina','gothic_red']){
  const player=new WAIFU_DANCE.SkeletonDance();await player.prepare(model);
  const reference=JSON.parse(fs.readFileSync(path.join(root,'pipeline/motion',model+'-dance-landmarks.json')));
  assert.equal(reference.frameCount,240);assert(reference.armRefinement.includes('source-frame'));
  assert.equal(player.faceCues.length,240);
  const clip=fs.readFileSync(path.join(root,'assets/animations',model,'dance-natural.glb'));
  const metadata=JSON.parse(clip.subarray(20,20+clip.readUInt32LE(12)).toString()).extras;
  assert(metadata.conditioning);assert(clip.length<150000,'Conditioned clips must stay smaller than the old dense tracks');
  const rest=geometry(model),previous=new Map();let heading=null,unwrapped=0,minTurn=0,maxTurn=0,maxGroundError=0,minSoleUp=1,maxSpeed=0;
  for(let frame=0;frame<600;frame++){
   player.mixer.setTime(frame/60);
   for(const [name,node]of player.targets){
    if(previous.has(name)){
     const speed=previous.get(name).angleTo(node.quaternion)*60;maxSpeed=Math.max(maxSpeed,speed);
     assert(speed<(name.endsWith('Foot')?6:metadata.conditioning.maxLocalRadiansPerSecond[name]||3.5)+.03,'Abrupt joint motion: '+name+' / '+speed);
    }
    previous.set(name,node.quaternion.clone());
   }
   for(const side of ['left','right']){
    const knee=new T.Euler().setFromQuaternion(player.targets.get(side+'LowerLeg').quaternion);
    assert(knee.x>=.035&&knee.x<=.69&&Math.abs(knee.y)<.01&&Math.abs(knee.z)<.01,'Knees must bend in their natural hinge plane');
   }
   const positions={hips:new T.Vector3()},quats={hips:player.targets.get('hips').quaternion.clone()};
   for(const [bone,parent]of [['spine','hips'],['chest','spine'],['upperChest','chest'],...['left','right'].flatMap(side=>[[side+'Shoulder','upperChest'],[side+'UpperArm',side+'Shoulder'],[side+'LowerArm',side+'UpperArm'],[side+'Hand',side+'LowerArm'],[side+'UpperLeg','hips'],[side+'LowerLeg',side+'UpperLeg'],[side+'Foot',side+'LowerLeg']])]){
    positions[bone]=rest[bone].clone().sub(rest[parent]).applyQuaternion(quats[parent]).add(positions[parent]);
    quats[bone]=quats[parent].clone().multiply(player.targets.get(bone)?.quaternion||new T.Quaternion());
   }
   const rootY=player.targets.get('root').position.y;
   maxGroundError=Math.max(maxGroundError,Math.abs(Math.min(positions.leftFoot.y,positions.rightFoot.y)+rootY+1));
   for(const side of ['left','right'])minSoleUp=Math.min(minSoleUp,new T.Vector3(0,1,0).applyQuaternion(quats[side+'Foot']).y);
   const forward=new T.Vector3(0,0,1).applyQuaternion(quats.hips),yaw=Math.atan2(forward.x,forward.z);
   if(heading!==null){let delta=yaw-heading;delta=Math.atan2(Math.sin(delta),Math.cos(delta));unwrapped+=delta;}
   heading=yaw;minTurn=Math.min(minTurn,unwrapped);maxTurn=Math.max(maxTurn,unwrapped);
   if(model==='seraphina'&&frame===330){assert(positions.leftHand.y>rest.head.y&&positions.rightHand.y>rest.head.y,'Raised-arm phrase must occur at the source 5.5 s checkpoint');}
   if(model==='gothic_red'&&frame===330){assert(positions.leftHand.y<positions.leftUpperArm.y&&positions.rightHand.y<positions.rightUpperArm.y,'Crimson must be in the distinct source hands-on-waist phrase at 5.5 s');}
  }
  assert(maxTurn-minTurn<1.05,'Unstable source spins must become modest whole-body turns');
  assert(minSoleUp>.999,'Soles must stay level instead of pointing down during knee bends');
  assert(maxGroundError<.035,'The support ankle must stay close to the rest floor');
  const expressions={};player.applyFace({_applyExpression:(k,v)=>expressions[k]=v},{start:0},model==='seraphina'?5500:9000);
  assert(expressions.blinkLeft>.9&&expressions.blinkRight===0,'The source wink must retain eye and timing');
  player.mixer.setTime(model==='seraphina'?3:1);assert(Math.abs(player.targets.get('leftIndexIntermediate').quaternion.z)>.3,'Source fist must animate finger joints');
  player.release();assert.equal(player.faceCues,null);
  console.log(model,{turnRadians:maxTurn-minTurn,maxGroundError,minSoleUp,maxSpeed,bytes:clip.length});
 }
 console.log('Reference dance passed: gentle turns, bounded angular speed, natural knee hinges, level soles, support contact, distinct gestures and smaller clips.');
})().catch(e=>{console.error(e);process.exitCode=1;});
