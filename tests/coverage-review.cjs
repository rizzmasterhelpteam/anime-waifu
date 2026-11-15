const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('assert/strict'),fs=require('fs');const out=process.env.REVIEW_OUTPUT || require('path').join(__dirname,'../work/repairs');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH,headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
 const p=await browser.newPage({viewport:{width:1050,height:760}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:8765/README.md');await p.setContent('<body style="margin:0;display:flex;padding:20px;gap:35px;background:repeating-conic-gradient(#f8f9fb 0% 25%,#d5dbe4 0% 50%) 0 / 32px 32px"><section><h3 style="font:15px Segoe UI;text-align:center">Seraphina</h3><canvas id="s"></canvas></section><section><h3 style="font:15px Segoe UI;text-align:center">Crimson</h3><canvas id="c"></canvas></section></body>');
 for(const file of ['vendor/vrm-bundle.js','content/secondary-motion.js','content/authored-motion.js','content/vrm-animator.js'])await p.addScriptTag({url:'http://127.0.0.1:8765/'+file});
 await p.evaluate(async()=>{
  window.models=[];
  for(const [id,name]of[['s','seraphina'],['c','companion_alt']]){
   const a=new WaifuVrmAnimator(document.getElementById(id),{height:620});a.fetchModelBuffer=async()=>({buffer:await(await fetch('/assets/models/'+name+'.vrm')).arrayBuffer(),name,source:'bundled'});await a.preloadAll();a.stopLoop();a.draw=a.renderer.render.bind(a.renderer);a.renderer.render=()=>{};a.time=performance.now();a.lastFrameTime=a.time;models.push(a);
  }
 });
 const all=[];
 for(const [label,angle,pose]of[['front',0,'idle'],['side',Math.PI/2,'idle'],['back',Math.PI,'idle'],['other-side',-Math.PI/2,'idle'],['tea-side',Math.PI/2,'tea'],['wave-front',0,'wave'],['walk-side',Math.PI/2,'idle']]){
  const coverage=await p.evaluate(({angle,pose,label})=>{
   const output=[];
   for(const a of models){
    a.orbitYaw=a.targetOrbitYaw=angle;a.setPose(pose,false);a.setWalking(label==='walk-side',1,label==='walk-side'?180:0);
    for(let i=0;i<110;i++){a.time+=1000/60;a.renderFrame(a.time);}
    a.draw(a.scene,a.camera);a.scene.updateMatrixWorld(true);
    const copy=document.createElement('canvas');copy.width=a.canvas.width;copy.height=a.canvas.height;const ctx=copy.getContext('2d');ctx.drawImage(a.canvas,0,0);const image=ctx.getImageData(0,0,copy.width,copy.height).data;
    let shell;a.modelRoot.traverse(o=>{if(o.isSkinnedMesh&&o.name.startsWith('Repair_ContinuousTorso'))shell=o;});if(!shell)throw Error('Missing opaque body backing');
    let tested=0,opaque=0;const v=new WAIFU_VRM_VENDOR.THREE.Vector3();
    for(let row=2;row<=7;row++)for(let i=0;i<64;i+=2){
      shell.getVertexPosition(row*65+i,v);v.applyMatrix4(shell.matrixWorld).project(a.camera);
      const x=Math.round((v.x*.5+.5)*copy.width),y=Math.round((-.5*v.y+.5)*copy.height);if(x<2||y<2||x>=copy.width-2||y>=copy.height-2)continue;
      let alpha=0;for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)alpha=Math.max(alpha,image[((y+yy)*copy.width+x+xx)*4+3]);tested++;if(alpha>=245)opaque++;
    }
    output.push({model:a.modelInfo.name,view:label,tested,opaque,ratio:opaque/tested});
   }return output;
  },{label,angle,pose});
  console.log(coverage);assert(coverage.every(v=>v.ratio>.99),JSON.stringify(coverage));all.push(...coverage);
  await p.screenshot({path:out+'/'+label+'.png'});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/coverage.json',JSON.stringify({coverage:all,errors},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
