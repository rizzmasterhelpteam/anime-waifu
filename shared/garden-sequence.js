(function(root){
 'use strict';
 const clamp=v=>Math.max(0,Math.min(1,v));
 function state(seconds){
  const growth=clamp((seconds-6)/5);
  return{pot:clamp(seconds/.65),watering:seconds>=1&&seconds<6,growth,look:clamp((seconds-11.5)/1),done:seconds>=13};
 }
 class GardenSequence{
  constructor(container){this.el=container;this.raf=null;this.revealTimer=null;this.generation=0;}
  start(onReveal,{visual=true}={}){
   this.stop();this.el.hidden=false;
   if(!visual){const generation=this.generation;this.el.hidden=true;this.revealTimer=setTimeout(()=>{this.revealTimer=null;if(generation===this.generation)onReveal?.();},13000);return;}
   this.el.innerHTML='<svg viewBox="0 0 160 190" xmlns="http://www.w3.org/2000/svg"><g data-pot><ellipse cx="69" cy="155" rx="38" ry="7" fill="#0002"/><path d="M39 130H99L91 177H47Z" fill="#b76c52" stroke="#744839" stroke-width="3"/><rect x="35" y="123" width="68" height="14" rx="4" fill="#d48768"/><ellipse cx="69" cy="126" rx="29" ry="5" fill="#493126"/></g><g data-plant><path d="M69 126Q65 95 72 52" fill="none" stroke="#437b49" stroke-width="5"/><path d="M69 100Q32 100 40 76Q64 72 69 100M69 81Q102 84 105 58Q80 55 69 81M72 61Q55 53 65 37Q82 42 72 61" fill="#77b56a" stroke="#437b49" stroke-width="2"/><circle cx="70" cy="38" r="8" fill="#e7afc8"/></g><g data-water stroke="#83c9eb" stroke-width="3" stroke-linecap="round"><path d="M106 79L92 96M102 91L88 110M96 105L81 123"/></g><g data-can><path d="M113 60L91 47L86 53L111 75" fill="#75aab7" stroke="#375b68" stroke-width="2"/><rect x="108" y="56" width="31" height="30" rx="5" fill="#8db8c4" stroke="#375b68" stroke-width="2"/><path d="M137 60Q158 58 153 76Q149 83 139 79" fill="none" stroke="#537e8d" stroke-width="5"/></g></svg>';
   this.nodes=Object.fromEntries(['pot','plant','water','can'].map(key=>[key,this.el.querySelector('[data-'+key+']')]));
   const began=performance.now(),generation=this.generation;let revealed=false;
   const step=now=>{if(generation!==this.generation)return;const t=(now-began)/1000,s=this.render(t);
    if(s.done&&!revealed){revealed=true;onReveal?.();}
    if(t<16)this.raf=requestAnimationFrame(step);else this.stop();
   };this.raf=requestAnimationFrame(step);
  }
  render(t){
   const s=state(t),{pot,plant,water,can}=this.nodes;
    pot.style.opacity=String(s.pot);plant.style.opacity=s.growth>0?'1':'0';plant.setAttribute('transform',`translate(69 126) scale(${Math.max(.01,s.growth)}) translate(-69 -126)`);
    can.style.opacity=s.watering?'1':'0';can.setAttribute('transform',`rotate(${-18+Math.sin(t*2)*3} 120 72)`);
    water.style.opacity=s.watering?String(.6+Math.sin(t*13)*.35):'0';water.setAttribute('transform',`translate(0 ${(t*14)%7})`);
   return s;
  }
  stop(){this.generation++;if(this.raf!==null)cancelAnimationFrame(this.raf);if(this.revealTimer!==null)clearTimeout(this.revealTimer);this.raf=null;this.revealTimer=null;this.el.hidden=true;}
 }
 root.WAIFU_GARDEN={GardenSequence,state};
})(globalThis);
