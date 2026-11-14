const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const scope={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../shared/defaults.js'),'utf8'),scope);
const {CompanionBrain,behaviorMotion}=scope.WAIFU_SHARED;
let now=1;const brain=new CompanionBrain(()=>0);
brain.tick(now);const actions=[];
for(let i=0;i<300;i++){now+=2000;const action=brain.tick(now);if(action)actions.push(action);}
assert.deepEqual(actions.slice(0,5),['garden','dance','pout','rest','relax']);
const elapsed=brain.elapsed;for(let i=0;i<100;i++){now+=2000;brain.tick(now,true);}assert.equal(brain.elapsed,elapsed);
now+=3600000;brain.tick(now,true);now+=2000;brain.tick(now);assert.equal(brain.elapsed,elapsed+2000,'Hidden time must not catch up');
const quiet=brain.elapsed;for(let i=0;i<100;i++){now+=2000;brain.tick(now,false,'quiet');}assert.equal(brain.elapsed,quiet);
brain.stage=3;assert.equal(brain.touch(now,true),'sidestep');assert.equal(brain.touch(now+2000,true),null);assert.equal(brain.touch(now+6000,true),'greet');
brain.stage=1;assert.equal(brain.touch(now+10000),'showPlant');assert.equal(brain.stage,1,'Garden interaction should preserve activity stage');
for(const id of ['garden','dance','pout','rest','sidestep'])for(const crimson of [false,true]){
 const behavior={id,crimson,start:0,until:20000};
 for(let time=0;time<=21000;time+=16){const motion=behaviorMotion(behavior,time);assert(Object.values(motion).every(Number.isFinite));assert(Math.abs(motion.roll)<.15);}
 assert.equal(behaviorMotion(behavior,21000).weight,0);
}
console.log('Behavior checks passed: staged timing, recovery, pauses, Quiet, anti-spam, reconciliation, gardening and shared finite motion.');
