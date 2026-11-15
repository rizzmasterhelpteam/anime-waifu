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
  let maxTravel=0,maxKnee=0;
  for(let t=0;t<10;t+=.1){skeleton.mixer.setTime(t);maxTravel=Math.max(maxTravel,Math.abs(skeleton.targets.get('root').position.x));const e=new T.Euler().setFromQuaternion(skeleton.targets.get('leftLowerLeg').quaternion);maxKnee=Math.max(maxKnee,e.x);}
  assert(maxTravel>.09,'Dance must translate the pelvis during steps');assert(maxKnee>.3,'Dance must include actual knee-driven steps');
  skeleton.release();
 }
 assert.equal(decoded,closed,'All decoded image pages must be released');
 console.log('Dance playback passed: both 240-frame sequences, two-page cache bound, real GLB parsing, finite skeletal tracks and resource cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;});
