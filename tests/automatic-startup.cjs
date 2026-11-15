const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../content/companion.js'),'utf8');
const globals={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../shared/defaults.js'),'utf8'),globals);
const {ActivityDirector,wanderDestination}=globals.WAIFU_SHARED;
const start=source.indexOf('  function scheduleAutoBehavior('),end=source.indexOf('  const personalityLines=',start);
function run({hidden=false,quiet=false,focus=false}={}){
 let now=0,callback=null;const walks=[];
 const state={autoBehaviorTimer:null,hostEl:{},settings:{poseMode:'auto',interactionFrequency:quiet?'quiet':'playful',autoStroll:true,microMotion:true},document:{hidden},performance:{now:()=>now},Math,isDragging:false,isStrolling:false,temporaryPose:null,activityLoading:false,isFullscreenBlocked:()=>false,timer:{status:focus?'running':'idle'},brain:{tick:()=>null},routine:new ActivityDirector(()=>0,0),isHovered:false,isUserTypingNow:()=>false,performBehavior:()=>{},startStroll:()=>{walks.push(now);return true;},setTimeout:fn=>{callback=fn;return 1;},clearTimeout:()=>{callback=null;},Promise};
 vm.createContext(state);vm.runInContext(source.slice(start,end),state);state.scheduleAutoBehavior();
 for(now=1000;now<=30000;now+=1000){const fn=callback;callback=null;if(fn)fn();}
 return walks;
}
assert.equal(run()[0],3000);assert(run().length>=8,'Playful must continue selecting actions instead of waiting a minute');
for(const options of [{hidden:true},{quiet:true},{focus:true}])assert.equal(run(options).length,0);
for(const [roll,expected]of [[.1,'walk'],[.75,'dance'],[.9,'garden'],[.99,'rest']])assert.equal(new ActivityDirector(()=>roll).pick(0),expected);
const d=new ActivityDirector(()=>.75);assert.equal(d.pick(0),'dance');assert.notEqual(d.pick(1000),'dance');
let seed=7;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);const counts={walk:0,dance:0,garden:0,rest:0};
for(let i=0;i<10000;i++)counts[new ActivityDirector(random).pick(0)]++;
assert(counts.walk>6500&&counts.walk<7500);assert(counts.dance>counts.garden&&counts.garden>counts.rest);
const xs=[],ys=[];
for(const [width,height,size]of [[1280,720,280],[600,500,440],[400,300,240]])for(let i=0;i<100;i++){
 const p=wanderDestination({right:24,bottom:18},width,height,size,random);
 assert(p.right>=8&&p.bottom>=8);assert(p.right<=Math.max(8,width-Math.round(size*460/600)-8));assert(p.bottom<=Math.max(8,height-size-8));
 if(width===1280){xs.push(p.right);ys.push(p.bottom);}
}
assert(Math.max(...xs)-Math.min(...xs)>600);assert(Math.max(...ys)-Math.min(...ys)>250,'Destinations must span vertical space too');
console.log('Continuous routine passed: weighted rarity, cooldowns, repeated selection, Calm/focus/hidden pause and viewport-wide destinations.');
const motionStart=source.indexOf('  function runSmoothStroll('),motionEnd=source.indexOf('  function startStroll()',motionStart);
let frameCallback;const speeds=[];
const motionState={settings:{position:{right:20,bottom:20},sizePx:280,poseMode:'auto',autoStroll:true},performance:{now:()=>0},Math,applyPosition(){},closeToolbar(){},isStrolling:false,isDragging:false,isHovered:false,document:{hidden:false},animator:{setWalking:(active,dir,speed)=>{if(active)speeds.push(speed);}},updateToolbarActiveState(){},clampPosition:(right,bottom)=>({right,bottom}),strollOffsetX:0,wrapEl:{style:{}},strollRafId:null,requestAnimationFrame:fn=>{frameCallback=fn;return 1;},syncPose(){},stopStroll(){}};
vm.createContext(motionState);vm.runInContext(source.slice(motionStart,motionEnd),motionState);
motionState.runSmoothStroll(100,2000,{deltaBottom:80});frameCallback(1000);
assert(Math.abs(motionState.settings.position.right-70)<.01);assert(Math.abs(motionState.settings.position.bottom-60)<.01);
assert(motionState.wrapEl.style.transform.includes('-40.00px'),'Travel must update vertical transform, not just pick a vertical destination');
frameCallback(2000);assert.equal(motionState.settings.position.right,120);assert.equal(motionState.settings.position.bottom,100);assert(speeds.some(v=>v>60));
console.log('Two-axis path interpolation and diagonal gait speed passed.');
speeds.length=0;motionState.animator.authoredMotion={walkSpeedPx:()=>40};motionState.settings.position={right:20,bottom:20};motionState.runSmoothStroll(100,1000,{deltaBottom:80});frameCallback(1800);assert(speeds.every(v=>v<=40.001),'3D screen travel must respect the actual authored stride speed');frameCallback(10000);assert.equal(motionState.settings.position.right,120);assert.equal(motionState.settings.position.bottom,100);
