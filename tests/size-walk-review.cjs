const BASE=process.env.REVIEW_BASE_URL || 'http://127.0.0.1:8765';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('assert/strict'),fs=require('fs');
const out=process.env.REVIEW_OUTPUT || require('path').join(__dirname,'../work/size-walk');fs.mkdirSync(out,{recursive:true});
const fixture=()=>{
 window.instances=[];
 for(const name of ['WaifuMeshAnimator','WaifuVrmAnimator']){
  let ctor;Object.defineProperty(window,name,{get:()=>ctor,set:C=>{ctor=class extends C{constructor(...args){super(...args);instances.push(this)}}},configurable:true});
 }
 const listeners=[];window.state={settings:{renderMode:'2d',activeModel:'seraphina',enabled:true,sizePx:1000,autoStroll:false,greetOnLoad:false,showBubbles:false,poseMode:'idle',cursorFollow:false},timer:{status:'idle'}};
 const set=async value=>{state={...state,...value};listeners.forEach(f=>f({settings:{newValue:state.settings}},'local'))};
 window.chrome={runtime:{getURL:p=>location.origin+'/'+p,onMessage:{addListener:()=>{}},sendMessage:async m=>{if(m.type==='UPDATE_SETTINGS'){await set({settings:{...state.settings,...m.patch}});return{ok:true,settings:state.settings};}return m.type==='GET_STATE'?state:{ok:false};}},storage:{local:{get:async()=>state,set},onChanged:{addListener:f=>listeners.push(f)}},tabs:{query:async()=>[{url:'https://example.com'}],sendMessage:async()=>({ok:true})}};
};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH,headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
 const context=await browser.newContext({viewport:{width:1100,height:800}});await context.addInitScript(fixture);
 const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(BASE+'/popup/popup.html');await p.waitForTimeout(500);
 assert.equal(await p.locator('#range-size').getAttribute('max'),'1000');
 for(const size of [180,320,480,720,1000]){
   await p.click(`[data-size="${size}"]`);assert.equal(await p.evaluate(()=>state.settings.sizePx),size);
 }
 assert((await p.evaluate(()=>document.body.scrollHeight))<=600);
 await p.screenshot({path:out+'/size-controls.png',clip:{x:0,y:0,width:380,height:600}});
 await p.goto(BASE+'/README.md');await p.setContent('<body style="margin:0;background:#252630"><h2 style="color:#ddd;font:20px Segoe UI;margin:25px">Companion size & walking review</h2></body>');
 for(const file of ['shared/defaults.js','vendor/vrm-bundle.js','content/animator.js','content/secondary-motion.js','content/authored-motion.js','content/vrm-animator.js','content/companion.js'])await p.addScriptTag({url:BASE+'/'+file});
 await p.waitForFunction(()=>instances.at(-1)?.sprites?.size===12);
 assert.equal(await p.evaluate(()=>instances.at(-1).displayHeight),744);
 await p.screenshot({path:out+'/large-companion.png'});
 await p.setViewportSize({width:600,height:500});await p.waitForTimeout(200);
 assert.equal(await p.evaluate(()=>instances.at(-1).displayHeight),444);
 const fit=await p.evaluate(()=>{const a=instances.at(-1);const r=a.canvas.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
 assert(fit.left>=0&&fit.top>=0&&fit.right<=600&&fit.bottom<=500,JSON.stringify(fit));
 // Verify sprite timing at both large and small sizes, independent of travel speed.
 const spriteTiming=await p.evaluate(()=>{
   const a=instances.at(-1);a.stopLoop();const samples=[];
   for(const height of [180,720,1000]){
     a.resize(height);a.walkAmount=1;a.setWalking(true,-1,50);a.walkPhase=0;
     let now=performance.now(),transitions=0,last='';a.lastFrameTime=now;
     for(let i=0;i<60;i++){now+=1000/30;a.renderFrame(now);const key=a.resolveActiveFrame(now).key;if(last&&key!==last)transitions++;last=key;}
     samples.push({height,transitions});
   }return samples;
 });
 assert(spriteTiming.every(s=>s.transitions>=11),JSON.stringify(spriteTiming));
 await p.goto(BASE+'/README.md');await p.setContent('<body style="margin:0;display:flex;background:#23232d"><canvas id="c"></canvas></body>');
 await p.addScriptTag({url:BASE+'/vendor/vrm-bundle.js'});await p.addScriptTag({url:BASE+'/content/secondary-motion.js'});await p.addScriptTag({url:BASE+'/content/authored-motion.js'});await p.addScriptTag({url:BASE+'/content/vrm-animator.js'});
 await p.setViewportSize({width:1200,height:850});
 const metrics=[];
 for(const name of ['seraphina','companion_alt']){
  const m=await p.evaluate(async name=>{
   window.a?.destroy();const old=document.querySelector('canvas'),c=document.createElement('canvas');old.replaceWith(c);
   window.a=new WaifuVrmAnimator(c,{height:720});a.fetchModelBuffer=async()=>({buffer:await(await fetch('/assets/models/'+name+'.vrm')).arrayBuffer(),name,source:'bundled'});
   await a.preloadAll();a.stopLoop();a.setWalking(true,-1,220);
   const draw = a.renderer.render.bind(a.renderer); a.renderer.render = () => {};
   let now=performance.now();a.lastFrameTime=now;
   const v=new WAIFU_VRM_VENDOR.THREE.Vector3(),ys=[];
   const upper=a.legSegments.left[0],lower=a.legSegments.left[1];
   for(let i=0;i<240;i++){
    now+=1000/60;a.renderFrame(now);a.pivotGroup.updateWorldMatrix(true,true);
    if(i>90&&a.walkPhase/(Math.PI*2)%1<.5){a.boneMap.get('leftFoot').node.getWorldPosition(v);a.pivotGroup.worldToLocal(v);ys.push(v.y);}
    if(![...a.boneMap.values()].every(r=>r.node.quaternion.toArray().every(Number.isFinite)))throw Error('Non-finite joint');
   }
   a.resize(1000);const enlarged=a.displayHeight;a.resize(720);
   a.renderer.render = draw;draw(a.scene,a.camera);
   return{name,groundRange:Math.max(...ys)-Math.min(...ys),ankleMin:Math.min(...ys),ankleMax:Math.max(...ys),legLength:upper+lower,enlarged,cadence:a.walkCadence};
  },name);
  assert.equal(m.enlarged,1000);assert(m.groundRange<m.legLength*.035,JSON.stringify(m));metrics.push(m);console.log(m);
  await p.screenshot({path:out+'/'+name+'-walk.png'});
 }
 assert.deepEqual(errors,[]);const result={spriteTiming,metrics,viewportFit:fit,errors};fs.writeFileSync(out+'/checks.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
