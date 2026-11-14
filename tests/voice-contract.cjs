const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {transformSync}=require('esbuild');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

async function endpointChecks(){
 let handler,providerConfig,authOK=true,anonymous=false,quotaOK=true,key='server-test-key',calls=0;
 const source=read('supabase/functions/companion-voice/index.ts').replace(/^import .*;\r?\n/,'');
 const context={Response,Request,AbortSignal,TextDecoder,Uint8Array,Date,JSON,Modality:{AUDIO:'AUDIO'},
  Deno:{env:{get:n=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private',GEMINI_API_KEY:key})[n]},serve:fn=>handler=fn},
  fetch:async url=>String(url).endsWith('/user')?new Response(JSON.stringify({id:'user-one',is_anonymous:anonymous}),{status:authOK?200:401}):new Response(JSON.stringify(quotaOK)),
  GoogleGenAI:class{constructor(){this.authTokens={create:async p=>{calls++;providerConfig=p.config;return{name:'auth_tokens/short-lived-test'};}};}}
 };
 vm.runInNewContext(transformSync(source,{loader:'ts',target:'es2022'}).code,context);
 const request=(body,authorization='Bearer valid')=>handler(new Request('https://test.invalid',{method:'POST',headers:authorization?{authorization}:{},body:JSON.stringify(body)}));
 assert.equal((await request({},null)).status,401);
 authOK=false;assert.equal((await request({character:'seraphina'})).status,401);authOK=true;
 anonymous=true;assert.equal((await request({character:'seraphina'})).status,403);anonymous=false;
 assert.equal((await request({character:'unknown'})).status,400);
 assert.equal((await request({character:'seraphina',extra:'x'.repeat(1200)})).status,413);
 key=undefined;assert.equal((await request({character:'seraphina'})).status,503);key='server-test-key';
 quotaOK=false;assert.equal((await request({character:'seraphina'})).status,429);quotaOK=true;
 assert.equal(calls,0,'Rejected requests must not call Gemini');
 for(const character of ['seraphina','gothic_red']){
  const response=await request({character,model:'gemini-3.8-live-extended-thinking'});assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.model,'gemini-3.8-live');assert.equal(result.token,'auth_tokens/short-lived-test');
  assert(!JSON.stringify(result).includes('server-test-key'));
  assert.equal(providerConfig.uses,1);assert.equal(providerConfig.liveConnectConstraints.model,'gemini-3.8-live');
  assert(Date.parse(providerConfig.expireTime)-Date.now()<=600000);
  assert(Date.parse(providerConfig.newSessionExpireTime)-Date.now()<=60000);
  const config=providerConfig.liveConnectConstraints.config;
  assert.equal(config.responseModalities[0],'AUDIO');assert(!config.thinkingConfig);assert(!config.outputAudioTranscription);assert(!config.inputAudioTranscription);
  assert.equal(config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,character==='gothic_red'?'Leda':'Sulafat');
 }
 assert.equal((await handler(new Request('https://test.invalid',{method:'OPTIONS'}))).status,204);
}

async function audioAndCallChecks(){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false,classList:{add(){},remove(){}},setAttribute(){},addEventListener(type,fn){this[type]=fn;}});return elements.get(id);};
 let tracksStopped=0,playbackStopped=0,socket,clock=0;
 const track={enabled:true,stop(){tracksStopped++;}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 class AudioContext{constructor(){this.sampleRate=16000;this.currentTime=0;this.destination={};this.audioWorklet={addModule:async()=>{}};}
  async resume(){} async close(){}createMediaStreamSource(){return{connect(){},disconnect(){}};}createBuffer(){return{copyToChannel(){},duration:0.02};}
  createBufferSource(){return{connect(){},start(){},stop(){playbackStopped++;}};}}
 class WebSocket{static OPEN=1;constructor(url){socket=this;this.url=url;this.readyState=1;this.bufferedAmount=0;this.sent=[];}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;}}
 const context={document:{getElementById:element},window:{addEventListener(){}},navigator:{mediaDevices:{getUserMedia:async()=>stream}},AudioContext,AudioWorkletNode:class{constructor(){this.port={};}connect(){}disconnect(){}},WebSocket,
  chrome:{runtime:{getURL:p=>'chrome-extension://test/'+p,sendMessage:async m=>m.type==='CLOUD_STATUS'?{ok:true,user:{email:'test'}}:{ok:true,token:'temporary',model:'gemini-3.8-live',expiresAt:new Date(Date.now()+600000).toISOString()}},storage:{local:{get:async()=>({settings:{activeModel:'gothic_red'}})}}},
  setTimeout:()=>++clock,clearTimeout(){},setInterval:()=>++clock,clearInterval(){},Date,JSON,Math,Number,Float32Array,Uint8Array,DataView,Set,Promise,encodeURIComponent,
  btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')};
 vm.runInNewContext(read('popup/voice-audio.js'),context);
 const codec=context.WAIFU_VOICE_AUDIO;
 const samples=new Float32Array([-2,-1,-0.5,0,0.5,1,2]);const decoded=codec.decodePCM(codec.encodePCM(samples));
 assert.equal(decoded[0],-1);assert(Math.abs(decoded[4]-.5)<.0001);assert(decoded[6]>.999);
 vm.runInNewContext(read('popup/voice.js'),context);
 await element('start').click();assert(socket.url.includes('Constrained?access_token=temporary'));
 socket.onopen();assert.equal(socket.sent[0].setup.model,'models/gemini-3.8-live');
 const receive=async body=>{socket.onmessage({data:JSON.stringify(body)});await new Promise(r=>setImmediate(r));};
 await receive({setupComplete:{}});assert.equal(element('mute').disabled,false);
 await receive({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:codec.encodePCM(new Float32Array(480))}}]}}});
 await receive({serverContent:{interrupted:true}});assert.equal(playbackStopped,1,'Barge-in must clear queued audio');
 element('mute').click();assert.equal(track.enabled,false);assert(socket.sent.at(-1).realtimeInput.audioStreamEnd);
 element('mute').click();assert.equal(track.enabled,true);
 element('end').click();assert.equal(tracksStopped,1);assert.equal(socket.readyState,3);assert.equal(element('start').disabled,false);
}

(async()=>{await endpointChecks();await audioAndCallChecks();console.log('Voice checks passed: model lock, auth/quota rejection, expiring credentials, PCM audio, interruption, mute and microphone cleanup.');})().catch(e=>{console.error(e);process.exitCode=1;});
