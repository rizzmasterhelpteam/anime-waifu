const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),scope={window:{devicePixelRatio:1},performance:{now:()=>0},cancelAnimationFrame(){},requestAnimationFrame:()=>1};vm.createContext(scope);
for(const file of ['shared/defaults.js','content/animator.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),scope);
function context(){
 let matrix=[1,0,0,1,0,0],stack=[],draws=[],water=[];
 const multiply=n=>{const [a,b,c,d,e,f]=matrix,[g,h,i,j,k,l]=n;matrix=[a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];};
 const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
 const ctx=new Proxy({
  reset(){draws=[];water=[];},result:()=>({draws,water,point}),
  save(){stack.push({matrix:matrix.slice(),stroke:this.strokeStyle});},restore(){const s=stack.pop();matrix=s.matrix;this.strokeStyle=s.stroke;},
  translate(x,y){multiply([1,0,0,1,x,y]);},scale(x,y){multiply([x,0,0,y,0,0]);},rotate(a){multiply([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]);},
  drawImage(image){draws.push({image,matrix:matrix.slice()});},moveTo(x,y){if(this.strokeStyle==='#83c9eb')water.push(point(matrix,x,y));}
 },{get:(o,k)=>k in o?o[k]:()=>{}});return ctx;
}
for(const model of ['seraphina','gothic_red'])for(const height of [180,480,1000]){
 const ctx=context(),canvas={style:{},getContext:()=>ctx},a=new scope.WaifuMeshAnimator(canvas,{modelKey:model,height});
 for(const key of ['idle','garden']){const data=fs.readFileSync(path.join(root,scope.WAIFU_SHARED.getSpriteFiles(model)[key]));a.sprites.set(key,{key,width:data.readUInt32BE(16),height:data.readUInt32BE(20)});}
 a.behavior={id:'garden',start:0,until:16000};
 for(const t of [1.2,3.7,4.6,5.2,7.5,9.5,13.5]){
  ctx.reset();a.renderFrame(t*1000);const {draws,water,point}=ctx.result(),g=a.gardenFrame;
  assert.equal(draws.length,g.state.look>0?3:2);assert(draws.slice(0,2).every(d=>d.image===a.sprites.get('garden')),'The hand, can and forearm must remain one source layer');
  if(g.state.watering){
   assert.equal(water.length,3);const nozzle=point(draws[1].matrix,model==='seraphina'?98:89,model==='seraphina'?973:970);
   assert(Math.hypot(water[0][0]-nozzle[0],water[0][1]-nozzle[1])<=3.01*g.scale,'The stream must follow the transformed nozzle at every size and tilt');
  }else assert.equal(water.length,0,'No water while holding, lowering or admiring the plant');
  const soil=point(draws[0].matrix,g.soil.x,g.soil.y);assert(soil[0]>0&&soil[0]<canvas.width&&soil[1]>0&&soil[1]<canvas.height,'The soil must stay inside the canvas');
 }
 a.behavior=null;ctx.reset();a.renderFrame(17000);assert.equal(ctx.result().draws.length,1,'Cancelling the action must remove every garden prop');a.destroy();
}
console.log('2D garden grip passed: both characters, three sizes, attached forearm/can, nozzle tracking, staged pouring and cancellation.');
