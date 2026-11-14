const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');let frame,celebrations=0;
const scope={performance:{now:()=>0},requestAnimationFrame:fn=>{frame=fn;return 1;},cancelAnimationFrame(){}};
vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(root,'shared/garden-sequence.js'),'utf8'),scope);
const nodes=new Map();const container={hidden:true,querySelector:key=>{if(!nodes.has(key))nodes.set(key,{style:{},setAttribute(name,value){this[name]=value;}});return nodes.get(key);}};
const garden=new scope.WAIFU_GARDEN.GardenSequence(container);garden.start(()=>celebrations++);
frame(0);assert.equal(nodes.get('[data-plant]').style.opacity,'0');
frame(3000);assert.equal(nodes.get('[data-can]').style.opacity,'1');assert.equal(nodes.get('[data-plant]').style.opacity,'0');assert.equal(celebrations,0);
frame(7000);assert(nodes.get('[data-plant]').transform.includes('scale(0.2)'));assert.equal(nodes.get('[data-can]').style.opacity,'0');
frame(11000);assert(nodes.get('[data-plant]').transform.includes('scale(1)'));assert.equal(celebrations,0);
frame(13000);assert.equal(celebrations,1);frame(14000);assert.equal(celebrations,1);garden.stop();assert.equal(container.hidden,true);frame(15000);assert.equal(celebrations,1);
vm.runInContext(fs.readFileSync(path.join(root,'shared/defaults.js'),'utf8'),scope);
for(let ms=0;ms<=16000;ms+=50){
 const motion=scope.WAIFU_SHARED.behaviorMotion({id:'garden',start:0,until:16000},ms);
 assert(motion.bend>=0&&motion.bend<=.38,'Gardening must never over-bend during the watering/growth transition');
}
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
