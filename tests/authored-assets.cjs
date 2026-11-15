const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');vm.runInThisContext(fs.readFileSync(path.join(root,'vendor/vrm-bundle.js'),'utf8'));
const T=WAIFU_VRM_VENDOR.THREE;
(async()=>{
 for(const model of ['seraphina','gothic_red']){
  const file=fs.readFileSync(path.join(root,'assets/animations',model,'authored-actions.glb'));
  assert(file.length<450000,'Only compact selected motions should ship');
  const g=await new Promise((resolve,reject)=>new WAIFU_VRM_VENDOR.GLTFLoader().parse(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'',resolve,reject));
  const metadata=g.parser.json.extras;assert.equal(metadata.license,'CC0-1.0');assert.equal(g.animations.length,9);
  const targets=new Map();g.scene.traverse(n=>{if(n.name)targets.set(n.name,n);});
  const mixer=new T.AnimationMixer(g.scene);let maxSeam=0;
  for(const clip of g.animations){
   mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();
   const rotations=clip.tracks.filter(t=>t.name.endsWith('.quaternion'));assert(rotations.length>=50,'Whole body and hands must be authored together');
   for(const track of rotations)for(let i=0;i<track.values.length;i+=4){const q=new T.Quaternion().fromArray(track.values,i);assert(Math.abs(q.length()-1)<1e-5,'Invalid joint quaternion');}
   if(metadata.clips[clip.name].loop){
    mixer.setTime(0);const first=new Map([...targets].map(([k,n])=>[k,n.quaternion.clone().normalize()]));const firstRoot=targets.get('motionRoot').position.clone();
    mixer.setTime(clip.duration-.000001);
    for(const [k,n]of targets){const angle=n.quaternion.clone().normalize().angleTo(first.get(k));maxSeam=Math.max(maxSeam,angle);assert(angle<.002,'Visible loop seam in '+clip.name+' '+k+' '+angle);}
    assert(targets.get('motionRoot').position.distanceTo(firstRoot)<.002,'Root loop seam '+clip.name);
   }
   if(clip.name==='walk'){
    let thigh=0,arm=0,forearmDepth=0;const q0=new T.Quaternion();mixer.setTime(0);q0.copy(targets.get('leftUpperLeg').quaternion);
    for(let i=0;i<80;i++){mixer.setTime(i/80*clip.duration);thigh=Math.max(thigh,q0.angleTo(targets.get('leftUpperLeg').quaternion));forearmDepth=Math.max(forearmDepth,Math.abs(new T.Euler().setFromQuaternion(targets.get('leftLowerArm').quaternion).y));arm=Math.max(arm,Math.abs(new T.Euler().setFromQuaternion(targets.get('leftUpperArm').quaternion).x));}
    assert(thigh>.35&&arm>.12,'Walk must include actual stepping and coordinated arm swing');
    assert(forearmDepth>.25,'Source elbow plane must survive retargeting instead of being forced into a Z hinge');
   }
  }
  mixer.stopAllAction();mixer.uncacheRoot(g.scene);console.log(model,{bytes:file.length,clips:g.animations.length,maxLoopSeamRadians:maxSeam});
 }
 console.log('Authored assets passed: complete body tracks, valid quaternions, seamless loops and preserved 3D elbow planes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
