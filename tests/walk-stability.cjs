const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const scope={window:{devicePixelRatio:1},performance:{now:()=>0},cancelAnimationFrame(){},requestAnimationFrame:()=>1};
vm.createContext(scope);
for(const file of ['shared/defaults.js','content/animator.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),scope);
const keys=['walk_left','walk_pass_left','walk_contact_right','walk_pass_right'];
for(const model of ['seraphina','gothic_red'])for(const height of [180,480,1000])for(const direction of [-1,1]){
 let draws=[],scales=[];
 const ctx={clearRect(){},save(){},restore(){},translate(){},rotate(){},scale:(...args)=>scales.push(args),drawImage:(...args)=>draws.push({args,alpha:ctx.globalAlpha})};
 const canvas={style:{transform:'perspective(560px) rotateY(8deg)'},getContext:()=>ctx};
 const animator=new scope.WaifuMeshAnimator(canvas,{modelKey:model,height});
 const files=scope.WAIFU_SHARED.getSpriteFiles(model);
 for(const key of [...keys,'idle']){const png=fs.readFileSync(path.join(root,files[key]));animator.sprites.set(key,{key,width:png.readUInt32BE(16),height:png.readUInt32BE(20)});}
 animator.walkAmount=1;animator.setWalking(true,direction,height*.42);
 animator.targetLookX=1;animator.targetLookY=-1;animator.hoverTarget=1;animator.bounceStart=0;
 const seen=new Set();
 for(let frame=1;frame<=180;frame++){
  draws=[];scales=[];animator.renderFrame(frame*1000/60);
  assert.equal(draws.length,1,'Walking must draw one opaque source pose, never blended silhouettes');
  const {args,alpha}=draws[0];assert(keys.includes(args[0].key));seen.add(args[0].key);
  assert.equal(args.length,5,'Draw the complete original bitmap without atlas resampling or mesh warping');
  assert.equal(alpha,1);assert(Math.abs(args[3]/args[4]-460/600)<1e-10,'Preserve source aspect ratio');
  assert.equal(scales.length,1);assert.equal(Math.abs(scales[0][0]),1);assert.equal(scales[0][1],1);
  assert.equal(canvas.style.transform,'','Walking must not tilt the sprite with CSS perspective');
 }
 assert.equal(seen.size,4,'The complete contact/pass cycle must still animate');animator.destroy();
}
console.log('2D walk stability passed: both characters, both directions, three sizes, intact source poses, fixed aspect ratio and full opacity.');
