const BASE=process.env.REVIEW_BASE_URL || 'http://127.0.0.1:8765';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('assert/strict'),fs=require('fs');const out=process.env.REVIEW_OUTPUT || require('path').join(__dirname,'../work/physics');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const b=await chromium.launch({executablePath:process.env.BROWSER_PATH,headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
 const p=await b.newPage({viewport:{width:1000,height:1100}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{
  window.instances=[];window.messages=[];
  for(const name of ['WaifuMeshAnimator','WaifuVrmAnimator']){let ctor;Object.defineProperty(window,name,{get:()=>ctor,set:C=>{ctor=class extends C{constructor(...args){super(...args);instances.push(this)}}},configurable:true});}
  window.state={settings:{renderMode:'3d',activeModel:'seraphina',sizePx:280,microMotion:true,poseMode:'idle'},timer:{},stats:{}};const listeners=[];
  window.chrome={runtime:{getURL:p=>location.origin+'/'+p,sendMessage:async m=>{
    if(m.type==='UPDATE_SETTINGS'){state={...state,settings:{...state.settings,...m.patch}};listeners.forEach(f=>f({settings:{newValue:state.settings}},'local'));return{ok:true,settings:state.settings};}if(m.type==='GET_STATE')return state;
    if(m.type==='GET_3D_MODEL'){const data=new Uint8Array(await(await fetch('/assets/models/seraphina.vrm')).arrayBuffer());let bin='';for(let i=0;i<data.length;i+=8192)bin+=String.fromCharCode(...data.subarray(i,i+8192));return{ok:true,base64:btoa(bin),source:'bundled',name:'seraphina.vrm'};}return{ok:false};
  }},storage:{local:{get:async()=>state,set:async v=>{state={...state,...v};listeners.forEach(f=>f({settings:{newValue:state.settings}},'local'));}},onChanged:{addListener:f=>listeners.push(f)}},tabs:{query:async()=>[{id:1,url:'https://example.com'}],sendMessage:async(id,m)=>{messages.push(m);return{ok:true}}}};
 });
 await p.goto(BASE+'/popup/popup.html');await p.click('#btn-preview');await p.waitForFunction(()=>instances.at(-1)?.secondaryMotion?.bones.length===11);
 await p.click('summary');assert.equal(await p.locator('#range-physics').inputValue(),'90');assert.equal(await p.locator('#range-chest').inputValue(),'100');
 await p.locator('#range-physics').focus();await p.keyboard.press('End');await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>state.settings.physicsStrength),100);
 await p.locator('#range-chest').focus();await p.keyboard.press('Home');await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>state.settings.chestBounce),0);assert.equal(await p.evaluate(()=>instances.at(-1).secondaryMotion.chestStrength),0);
 await p.locator('#range-chest').focus();await p.keyboard.press('End');await p.click('#btn-preview-physics');await p.waitForTimeout(100);
 assert(await p.evaluate(()=>messages.some(m=>m.type==='WAIFU_PHYSICS_PULSE')));
 await p.locator('#toggle-physics').uncheck();assert(await p.locator('#range-physics').isDisabled());assert.equal(await p.evaluate(()=>instances.at(-1).secondaryMotion.enabled),false);
 await p.locator('#toggle-physics').check();await p.locator('#physics-controls').screenshot({path:out+'/controls.png'});
 await p.locator('#toggle-motion').uncheck();assert(await p.locator('#btn-preview-physics').isDisabled());assert.equal(await p.evaluate(()=>instances.at(-1).rafId),null);
 await p.click('[data-render="2d"]');await p.waitForTimeout(400);assert(await p.locator('#physics-controls').isHidden());
 assert.deepEqual(errors,[]);console.log('Physics sliders, persistence, zero chest bounce, off toggle, preview pulse, static mode and 2D hiding passed.');await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
