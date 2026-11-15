const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');let celebrations=0,revealTimer,cleared=0;
const scope={setTimeout:(fn,ms)=>{assert.equal(ms,13000);revealTimer=fn;return 9;},clearTimeout:id=>{assert.equal(id,9);cleared++;}};
vm.createContext(scope);
for(const file of ['shared/defaults.js','shared/garden-sequence.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),scope);
const container={hidden:false,innerHTML:'old floating can'};
const garden=new scope.WAIFU_GARDEN.GardenSequence(container);garden.start(()=>celebrations++);
assert.equal(container.hidden,true,'An independent floating prop overlay must never render');assert.equal(container.innerHTML,'');assert.equal(garden.raf,null);
garden.stop();revealTimer();assert.equal(celebrations,0,'Cancelled gardening must not speak later');assert.equal(cleared,1);
garden.start(()=>celebrations++);revealTimer();assert.equal(celebrations,1);garden.stop();
const state=scope.WAIFU_GARDEN.state;
assert.equal(state(1).watering,false);assert(state(4).watering&&state(4).carry===1);assert.equal(state(4).growth,0);
assert(!state(7).watering,'Water must stop before the arm lowers');assert(state(9).growth>0&&state(9).growth<1);assert.equal(state(12).growth,1);assert(state(13).done);
assert(state(7).source<state(5).source,'The authored arm must lower through the reverse performance');
for(let ms=0;ms<=16000;ms+=50){const s=state(ms/1000);for(const k of ['growth','pour','carry','source'])assert(s[k]>=0&&s[k]<=1);const motion=scope.WAIFU_SHARED.behaviorMotion({id:'garden',start:0,until:16000},ms);assert(motion.bend>=0&&motion.bend<=.38);}
const source=fs.readFileSync(path.join(root,'content/vrm-animator.js'),'utf8');const start=source.indexOf('    _solveWalkLeg('),end=source.indexOf('    _solveRightArm(',start);
const gait=vm.runInNewContext('({'+source.slice(start,end)+'})',{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))});
gait.legSegments={left:[.52,.48]};gait._walkLegs={left:[0,0,0,0]};
let swingLift=0;
for(let i=0;i<240;i++){
 const phase=i/240*Math.PI*2,r=gait._solveWalkLeg('left',phase,1,.28);assert(r.every(Number.isFinite));assert(r[1]<1);
 const ankleY=-.52*Math.cos(r[0])-.48*Math.cos(r[0]+r[1])-r[3];
 if(i/240<.56)assert(Math.abs(ankleY+1)<1e-6,'Planted stance ankle must remain on the floor');else swingLift=Math.max(swingLift,ankleY+1);
}
assert(swingLift>.03&&swingLift<.06);
console.log('Motion quality passed: soil→water→growth→single reveal, cancellation, planted catwalk stance and bounded swing clearance.');
