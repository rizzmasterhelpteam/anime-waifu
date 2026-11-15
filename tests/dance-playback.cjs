const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
vm.runInThisContext(fs.readFileSync(path.join(root,'vendor/vrm-bundle.js'),'utf8'));
global.WAIFU_VRM_VENDOR=WAIFU_VRM_VENDOR;
global.chrome={runtime:{getURL:p=>p}};
let decoded=0,closed=0;
global.createImageBitmap=async()=>{decoded++;return{close(){closed++;}};};
global.fetch=async p=>new Response(fs.readFileSync(path.join(root,p)));
vm.runInThisContext(fs.readFileSync(path.join(root,'shared/dance-player.js'),'utf8'));
(async()=>{
 for(const model of ['seraphina','gothic_red']){
  const sprite=new WAIFU_DANCE.SpriteDance();const duration=await sprite.prepare(model);
  assert.equal(duration,10);assert.equal(sprite.pages.size,2);
  const ctx={save(){},restore(){},drawImage(...args){assert.equal(args.length,9);},globalAlpha:1};
  for(let second=0;second<10;second++){
   assert(sprite.draw(ctx,{start:0},second*1000,0,0,320,420));
   await Promise.all([...sprite.pending.values()]);assert(sprite.pages.size<=2);
  }
  sprite.release();assert.equal(sprite.pages.size,0);
  const skeleton=new WAIFU_DANCE.SkeletonDance();assert.equal(await skeleton.prepare(model),10);
  const T=WAIFU_VRM_VENDOR.THREE,boneMap=new Map();for(const key of ['hips','leftUpperArm','leftUpperLeg','head'])boneMap.set(key,{node:new T.Object3D()});
  let updates=0;
  const animator={boneMap,_setBoneWorldEuler(key,x,y,z){updates++;assert([x,y,z].every(Number.isFinite));boneMap.get(key).node.quaternion.setFromEuler(new T.Euler(x,y,z));}};
  skeleton.apply(animator,{start:0},2300);assert.equal(updates,4);assert(Math.abs(boneMap.get('leftUpperArm').node.quaternion.z)>.15,'Clip must visibly rotate arms, not overwrite its own interpolation target');
  const normalizedBones=new Map();
  for(const key of boneMap.keys())normalizedBones.set(key,{node:new T.Object3D(),restLocalQ:new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),.1),restLocalPos:new T.Vector3(0,1,0),isNormalizedVrm:true});
  let lookups=0;const originalGet=normalizedBones.get.bind(normalizedBones);normalizedBones.get=key=>{lookups++;return originalGet(key);};
  const normalized={boneMap:normalizedBones,_setBoneWorldEuler(){throw Error('Normalized VRMs must use quaternion playback');}};
  skeleton.apply(normalized,{start:0},2300);const bindingLookups=lookups;
  const arm=originalGet('leftUpperArm'),expected=arm.restLocalQ.clone().multiply(skeleton.targets.get('leftUpperArm').quaternion);
  assert(arm.node.quaternion.angleTo(expected)<1e-6,'Normalized playback must retain the rig rest rotation');
  skeleton.apply(normalized,{start:0},2400);assert.equal(lookups,bindingLookups,'Bone bindings must be cached between frames');
  const base=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.15),hips=originalGet('hips');
  for(const ms of [0,1,9999,10000]){
   arm.node.quaternion.copy(base);hips.node.position.set(.2,1.1,.3);
   skeleton.apply(normalized,{start:0},ms);
   assert(arm.node.quaternion.angleTo(base)<.0001,'Entry and exit must approach the current base pose continuously');
   assert(hips.node.position.distanceTo(new T.Vector3(.2,1.1,.3))<.0001,'Fades must preserve base pelvis position');
  }
  skeleton.action.reset().play();
  let maxTravel=0,maxKnee=0;
  for(let t=0;t<10;t+=.1){skeleton.mixer.setTime(t);maxTravel=Math.max(maxTravel,Math.abs(skeleton.targets.get('root').position.x));const e=new T.Euler().setFromQuaternion(skeleton.targets.get('leftLowerLeg').quaternion);maxKnee=Math.max(maxKnee,e.x);}
  assert(maxTravel>.09,'Dance must translate the pelvis during steps');assert(maxKnee>.3,'Dance must include actual knee-driven steps');
  skeleton.release();assert.equal(skeleton.bindings,null);assert.equal(skeleton.boundAnimator,null);
 }
 assert.equal(decoded,closed,'All decoded image pages must be released');
 console.log('Dance playback passed: both 240-frame sequences, two-page cache bound, real GLB parsing, finite skeletal tracks and resource cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;});
