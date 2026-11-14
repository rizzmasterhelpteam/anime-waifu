const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../content/companion.js'),'utf8');
const start=source.indexOf('  function scheduleAutoBehavior('),end=source.indexOf('  const personalityLines=',start);
function run({hidden=false,quiet=false,focus=false}={}){
 let now=0,callback=null;const actions=[],walks=[];
 const state={autoBehaviorTimer:null,hostEl:{},settings:{poseMode:'auto',interactionFrequency:quiet?'quiet':'playful',autoStroll:true,microMotion:true},document:{hidden,hasFocus:()=>false},Date:{now:()=>now},performance:{now:()=>now},Math,lastPageActivity:0,isDragging:false,isStrolling:false,temporaryPose:null,isFullscreenBlocked:()=>false,timer:{status:focus?'running':'idle'},brain:{stage:0,tick:()=>null},introPending:true,introAt:6000,nextStrollAt:20000,isUserTypingNow:()=>false,performBehavior:id=>actions.push({id,at:now}),startStroll:()=>{walks.push(now);return walks.length>1;},setTimeout:fn=>{callback=fn;return 1;},clearTimeout:()=>{callback=null;}};
 vm.createContext(state);vm.runInContext(source.slice(start,end),state);state.scheduleAutoBehavior(true);
 for(now=2000;now<=30000;now+=2000){const fn=callback;callback=null;if(fn)fn();}
 return{actions,walks};
}
const active=run();assert.deepEqual(active.actions,[{id:'dance',at:6000}]);assert.deepEqual(active.walks,[20000,26000]);
for(const options of [{hidden:true},{quiet:true},{focus:true}]){const r=run(options);assert.equal(r.actions.length,0);assert.equal(r.walks.length,0);}
console.log('Automatic startup passed: visible unfocused page dances at 6s, stroll retries after blocked direction, Calm/hidden/focus remain quiet.');
