const BASE=process.env.REVIEW_BASE_URL || 'http://127.0.0.1:8765';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('assert/strict'),fs=require('fs');const out=process.env.REVIEW_OUTPUT || require('path').join(__dirname,'../work/physics');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH,headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
 const p=await browser.newPage({viewport:{width:1000,height:800}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(BASE+'/README.md');await p.setContent('<body style="margin:0;background:#23232d"><canvas></canvas></body>');
 for(const f of ['vendor/vrm-bundle.js','content/secondary-motion.js','content/vrm-animator.js'])await p.addScriptTag({url:BASE+'/'+f});
 const results=[];
 for(const name of ['seraphina','companion_alt']){
  const result=await p.evaluate(async name=>{
   window.a?.destroy();const old=document.querySelector('canvas'),c=document.createElement('canvas');old.replaceWith(c);
   window.a=new WaifuVrmAnimator(c,{height:600,physicsStrength:.9,chestBounce:1});
   a.fetchModelBuffer=async()=>({buffer:await(await fetch('/assets/models/'+name+'.vrm')).arrayBuffer(),name,source:'bundled'});
   await a.preloadAll();a.stopLoop();const draw=a.renderer.render.bind(a.renderer);a.renderer.render=()=>{};
   let now=performance.now();a.lastFrameTime=now;
   const step=(frames,callback)=>{for(let i=0;i<frames;i++){now+=1000/60;a.renderFrame(now);callback?.(i);}};
   step(30);const sm=a.secondaryMotion;if(!sm)throw Error('No physics controller');
   a.triggerBounce();let clickPeak=0;step(150,()=>clickPeak=Math.max(clickPeak,Math.abs(sm.channels[0].x)));
   step(360);const settled=Math.abs(sm.channels[0].x);
   a.setWalking(true,-1,180);let walkPeak=0;step(240,()=>walkPeak=Math.max(walkPeak,Math.abs(sm.channels[0].x)));
   for(let i=0;i<120;i++){a.setDragVelocity(i<60?28:-28,i%20<10?22:-22);step(1);}
   const bounded=sm.channels.every(s=>Number.isFinite(s.x)&&Number.isFinite(s.v)&&Math.abs(s.x)<=s.limit+1e-9);
   const localChestOffset=Math.max(...sm.bones.filter(b=>b.group==='chest').map(b=>b.node.position.distanceTo(b.restP)));
   a.setPhysicsOptions(true,.9,0);step(10);const zeroChest=sm.channels.slice(0,3).every(s=>s.x===0&&s.v===0);
   a.setPhysicsOptions(false,.9,1);step(10);const disabled=sm.channels.every(s=>s.x===0&&s.v===0)&&sm.bones.every(b=>b.node.position.distanceTo(b.restP)<1e-9&&b.node.quaternion.angleTo(b.restQ)<1e-6);
   a.setPhysicsOptions(true,1,1);a.setWalking(false);step(20);a.triggerBounce();step(6);a.setMicroMotion(false);
   const staticMode=a.rafId===null&&sm.channels.every(s=>s.x===0&&s.v===0);
   const managerApi=Object.getOwnPropertyNames(Object.getPrototypeOf(a.vrm.springBoneManager));
   a.setMicroMotion(true);a.stopLoop();a.setPose('idle',false);a.triggerBounce();step(7);
   a.renderer.render=draw;draw(a.scene,a.camera);
   return{name,bones:sm.bones.length,nativeHairJoints:sm.nativeRest.length,clickPeak,settled,walkPeak,localChestOffset,bounded,zeroChest,disabled,staticMode,managerApi};
  },name);
  console.log(result);
  assert.equal(result.bones,11);assert(result.nativeHairJoints>20);assert(result.clickPeak>.003&&result.clickPeak<=.015);assert(result.settled<.002);assert(result.walkPeak>.001&&result.walkPeak<.009&&result.walkPeak<result.clickPeak);assert(result.bounded&&result.zeroChest&&result.disabled&&result.staticMode);
  await p.screenshot({path:out+'/'+name+'-physics.png'});results.push(result);
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/results.json',JSON.stringify({results,errors},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
