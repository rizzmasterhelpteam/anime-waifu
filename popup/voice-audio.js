(function(root){
 'use strict';
 function encodePCM(samples){const bytes=new Uint8Array(samples.length*2),view=new DataView(bytes.buffer);for(let i=0;i<samples.length;i++){const v=Math.max(-1,Math.min(1,samples[i]));view.setInt16(i*2,Math.round(v*(v<0?32768:32767)),true);}let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
 function decodePCM(data){const raw=atob(data);if(raw.length%2)throw Error('Invalid audio');const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),out=new Float32Array(bytes.length/2);for(let i=0;i<out.length;i++)out[i]=view.getInt16(i*2,true)/32768;return out;}
 root.WAIFU_VOICE_AUDIO={encodePCM,decodePCM};
})(globalThis);
