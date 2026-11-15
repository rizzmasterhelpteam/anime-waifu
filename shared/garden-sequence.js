(function(root){
 'use strict';
 // Renderers own every visible garden element so it shares the character's
 // coordinate system. This controller only schedules the personality bubble.
 const state=seconds=>root.WAIFU_SHARED.gardenState(seconds);
 class GardenSequence{
  constructor(container){this.el=container;this.raf=null;this.revealTimer=null;this.generation=0;}
  start(onReveal){
   this.stop();this.el.hidden=true;this.el.innerHTML='';
   const generation=this.generation;
   this.revealTimer=setTimeout(()=>{this.revealTimer=null;if(generation===this.generation)onReveal?.();},13000);
  }
  stop(){this.generation++;if(this.revealTimer!==null)clearTimeout(this.revealTimer);this.revealTimer=null;this.el.hidden=true;}
 }
 root.WAIFU_GARDEN={GardenSequence,state};
})(globalThis);
