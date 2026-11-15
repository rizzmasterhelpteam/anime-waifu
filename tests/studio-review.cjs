const BASE=process.env.REVIEW_BASE_URL || 'http://127.0.0.1:8765';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');
const assert=require('node:assert/strict');
const out=process.env.REVIEW_OUTPUT || require('path').join(__dirname,'../work/studio-review'); fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH,headless:true,args:['--enable-webgl','--use-angle=swiftshader','--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1000,height:850}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   window.previewInstances=[];
   for(const name of ['WaifuMeshAnimator','WaifuVrmAnimator']) {
     let current;
     Object.defineProperty(window,name,{configurable:true,get:()=>current,set:C=>{current=class extends C{constructor(...args){super(...args);window.previewInstances.push(this);}};}});
   }
   let state={settings:{renderMode:'2d',activeModel:'seraphina'},timer:{},stats:{}};
   const listeners=[];
   window.chrome={runtime:{getURL:p=>location.origin+'/'+p,sendMessage:async m=>{
      if(m.type==='UPDATE_SETTINGS'){state={...state,settings:{...state.settings,...m.patch}};listeners.forEach(f=>f({settings:{newValue:state.settings}},'local'));return{ok:true,settings:state.settings};}if(m.type==='GET_STATE')return state;
      if(m.type==='GET_3D_MODEL') { const name=state.settings.activeModel==='gothic_red'?'companion_alt.vrm':'seraphina.vrm'; const data=new Uint8Array(await(await fetch('/assets/models/'+name)).arrayBuffer());let b='';for(let i=0;i<data.length;i+=8192)b+=String.fromCharCode(...data.subarray(i,i+8192));return{ok:true,base64:btoa(b),name,source:'bundled'}; }
      return {ok:true};
   }},storage:{local:{get:async()=>state,set:async v=>{const old=state.settings;state={...state,...v};listeners.forEach(f=>f({settings:{newValue:state.settings,oldValue:old}},'local'));}},onChanged:{addListener:f=>listeners.push(f)}},tabs:{query:async()=>[{url:'https://example.com',id:1}],sendMessage:async()=>({ok:true})}};
 });
 await page.goto(BASE+'/popup/popup.html');
 await page.waitForTimeout(1800);
 await page.screenshot({path:out+'/dashboard.png'});
 await page.click('#btn-preview');await page.waitForFunction(()=>previewInstances.at(-1)?.sprites?.size===12);
 await page.click('[data-model="gothic_red"]');await page.waitForTimeout(900);
 assert.equal(await page.evaluate(()=>previewInstances.at(-1).modelKey),'gothic_red');
 await page.screenshot({path:out+'/dashboard-crimson.png'});
 for(const tab of ['alerts','timer','quotes','companion']){await page.click(`[data-tab="${tab}"]`);await page.waitForTimeout(150);}
 const overflow=await page.evaluate(()=>document.body.scrollWidth>380);
 assert.equal(overflow,false);
 const dashboardHeight=await page.evaluate(()=>document.body.scrollHeight);
 assert(dashboardHeight<=600,`Dashboard too tall: ${dashboardHeight}`);
 await page.screenshot({path:out+'/dashboard-final.png',clip:{x:0,y:0,width:380,height:Math.min(850,dashboardHeight)}});
 // Rapid switches must settle on the final selected character and leave one live renderer.
 await page.evaluate(()=>{document.querySelector('[data-model="seraphina"]').click();document.querySelector('[data-model="gothic_red"]').click();});
 await page.waitForTimeout(1200);
 assert.equal(await page.evaluate(()=>previewInstances.at(-1).modelKey),'gothic_red');
 await page.locator('summary').click();await page.locator('#toggle-motion').uncheck();await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>previewInstances.at(-1).rafId),null);
 await page.locator('#toggle-motion').check();
 await page.locator('[data-tab="companion"]').focus();await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('[data-tab="alerts"]').getAttribute('aria-selected'),'true');
 // Inspect the production 2D renderer with all registered assets and both walking directions.
 await page.evaluate(async()=>{
   previewInstances.forEach(a=>a.destroy());
   document.body.innerHTML='<div id="characters" style="display:flex;gap:20px;padding:20px;background:#20212b"></div>';
   for(const model of ['seraphina','gothic_red']){
     const canvas=document.createElement('canvas');document.querySelector('#characters').append(canvas);
     const a=new WaifuMeshAnimator(canvas,{height:420,modelKey:model});await a.preloadAll();a.setPose('idle',false);a.renderFrame(performance.now());
     window['sprite_'+model]=a;
   }
 });
 await page.screenshot({path:out+'/characters-final.png',clip:{x:0,y:0,width:720,height:470}});
 for(const model of ['seraphina','gothic_red']) {
   const keys=await page.evaluate(model=>[...window['sprite_'+model].sprites.keys()],model);
   assert.equal(keys.length,12);
   const walkFrames=await page.evaluate(model=>{const a=window['sprite_'+model];a.walkAmount=1;return [0,1,2,3].map(i=>{a.walkPhase=i*Math.PI/2;return a.resolveActiveFrame(performance.now()).key;});},model);
   assert.equal(new Set(walkFrames).size,4);
 }
 await page.goto(BASE+'/tests/test_animator_tea.html');
 await page.setContent('<html><body style="margin:0;background:#23232d"><canvas id="c"></canvas></body></html>');
 await page.addScriptTag({url:BASE+'/vendor/vrm-bundle.js'});
 await page.addScriptTag({url:BASE+'/content/secondary-motion.js'});await page.addScriptTag({url:BASE+'/content/authored-motion.js'});await page.addScriptTag({url:BASE+'/content/vrm-animator.js'});
 for(const model of ['seraphina','companion_alt']){
   await page.evaluate(async model=>{
     window.a?.destroy(); const old=document.querySelector('canvas');const c=document.createElement('canvas');old.replaceWith(c);
     window.a=new WaifuVrmAnimator(c,{height:550});
     a.fetchModelBuffer=async()=>({buffer:await(await fetch('/assets/models/'+model+'.vrm')).arrayBuffer(),name:model,source:'bundled'});
     await a.preloadAll();a.start();
   },model);
   await page.waitForTimeout(1400);
   await page.screenshot({path:out+'/'+model+'-idle.png'});
   for(const pose of ['wave','think','tea','celebrate']){
      await page.evaluate(p=>a.setPose(p,false),pose);await page.waitForTimeout(1200);
      await page.screenshot({path:out+'/'+model+'-'+pose+'.png'});
   }
   await page.evaluate(()=>{a.setPose('idle',false);a.setWalking(true,-1,160)});await page.waitForTimeout(1500);
   await page.screenshot({path:out+'/'+model+'-walk.png'});
   const metrics=await page.evaluate(()=>({bones:a.boneMap.size,drawCalls:a.renderer.info.render.calls,triangles:a.renderer.info.render.triangles,model:a.modelInfo}));console.log(model,metrics);
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({errors,overflow,dashboardHeight,checks:'2D switching, rapid switching, static mode, keyboard tabs, 24 sprites, eight walk frames, 3D poses on both rigs'}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
