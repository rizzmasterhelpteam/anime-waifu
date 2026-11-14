(function(){
 'use strict';
 const $=id=>document.getElementById(id),start=$('start'),mute=$('mute'),end=$('end'),status=$('status'),portrait=$('portrait');
 let call=null,starting=false;
 const say=text=>{status.textContent=text;};
 async function message(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw Error(r?.error||'Could not connect');return r;}
 function clearPlayback(c){for(const source of c.sources){try{source.stop();}catch{}}c.sources.clear();c.nextAudio=0;portrait.classList.remove('speaking');}
 function stop(text='Call ended'){
  const c=call;call=null;
  if(c){clearTimeout(c.timeout);clearTimeout(c.handshake);clearInterval(c.clock);clearInterval(c.authCheck);c.socket?.close();c.stream?.getTracks().forEach(t=>t.stop());if(c.capture){c.capture.port.onmessage=null;c.capture.disconnect();}c.input?.disconnect();clearPlayback(c);c.audio?.close().catch(()=>{});c.token=null;}
  start.disabled=false;mute.disabled=true;end.disabled=true;mute.textContent='Mute microphone';mute.setAttribute('aria-pressed','false');$('timer').textContent='Voice conversation · up to 10 minutes';say(text);
 }
 function send(c,body){if(call===c&&c.socket?.readyState===WebSocket.OPEN)c.socket.send(JSON.stringify(body));}
 function play(c,data,mime){
  const pcm=WAIFU_VOICE_AUDIO.decodePCM(data);if(!pcm.length)return;
  const rate=Number(/rate=(\d+)/.exec(mime||'')?.[1]||24000);if(rate<8000||rate>48000)throw Error('Unsupported audio rate');
  if(c.nextAudio-c.audio.currentTime>15)throw Error('Audio playback fell behind. Please restart the call.');
  const buffer=c.audio.createBuffer(1,pcm.length,rate);buffer.copyToChannel(pcm,0);
  const source=c.audio.createBufferSource();source.buffer=buffer;source.connect(c.audio.destination);c.sources.add(source);
  const when=Math.max(c.audio.currentTime+0.015,c.nextAudio||0);c.nextAudio=when+buffer.duration;
  source.onended=()=>{c.sources.delete(source);if(call===c&&!c.sources.size){portrait.classList.remove('speaking');say(c.muted?'Microphone muted':'Listening…');}};
  source.start(when);portrait.classList.add('speaking');say('Speaking…');
 }
 async function begin(){
  if(call||starting)return;starting=true;start.disabled=true;
  const c={sources:new Set(),muted:false,ready:false,nextAudio:0};call=c;end.disabled=false;say('Opening microphone…');
  try{
   const audio=c.audio=new AudioContext({sampleRate:16000});await audio.resume();if(call!==c)return;
   const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   if(call!==c){stream.getTracks().forEach(t=>t.stop());return;}c.stream=stream;
   if(audio.sampleRate!==16000)throw Error('This browser cannot capture 16 kHz audio. Try current Chrome or Brave.');
   const {settings}=await chrome.storage.local.get('settings');if(call!==c)return;
   const character=settings?.activeModel==='gothic_red'?'gothic_red':'seraphina';$('name').textContent=character==='gothic_red'?'Crimson':'Seraphina';$('initial').textContent=character==='gothic_red'?'C':'S';
   say('Connecting to your companion…');
   const credentials=await message('CLOUD_VOICE_TOKEN',{character});if(call!==c)return;
   c.token=credentials.token;c.expires=Date.parse(credentials.expiresAt);
   if(credentials.model!=='gemini-3.8-live'||!c.token||!Number.isFinite(c.expires)||c.expires<=Date.now())throw Error('Invalid voice configuration');
   await audio.audioWorklet.addModule(chrome.runtime.getURL('popup/voice-capture.js'));if(call!==c)return;
   c.input=audio.createMediaStreamSource(stream);c.capture=new AudioWorkletNode(audio,'voice-capture');
   c.capture.port.onmessage=({data})=>{if(call!==c||!c.ready||c.muted)return;if(c.socket.bufferedAmount>64000){stop('Connection is too slow. Please retry.');return;}send(c,{realtimeInput:{audio:{data:WAIFU_VOICE_AUDIO.encodePCM(data),mimeType:'audio/pcm;rate=16000'}}});};
   c.input.connect(c.capture);c.capture.connect(audio.destination);
   const ws=c.socket=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token='+encodeURIComponent(c.token));
   c.handshake=setTimeout(()=>{if(call===c)stop('Voice connection timed out. Please retry.');},20000);
   ws.onopen=()=>send(c,{setup:{model:'models/gemini-3.8-live',generationConfig:{responseModalities:['AUDIO']}}});
   // Process all parts, preserving frame order even when the browser delivers Blobs.
   let messages=Promise.resolve();
   ws.onmessage=event=>{messages=messages.then(async()=>{
    const text=typeof event.data==='string'?event.data:await event.data.text();if(call!==c)return;const data=JSON.parse(text);
    if(data.error)throw Error('Gemini could not continue the call. Please retry.');
    if(data.setupComplete){clearTimeout(c.handshake);c.ready=true;mute.disabled=false;say('Listening… Speak to begin.');}
    const content=data.serverContent;
    if(content?.interrupted){clearPlayback(c);say(c.muted?'Microphone muted':'Listening…');}
    for(const part of content?.modelTurn?.parts||[]){if(part.inlineData?.data&&part.inlineData.mimeType?.startsWith('audio/pcm'))play(c,part.inlineData.data,part.inlineData.mimeType);}
    if(data.goAway)say('This call is ending soon. Start a new call to continue.');
   }).catch(e=>{if(call===c)stop(e.message||'Voice playback failed');});};
   ws.onerror=()=>{if(call===c)stop('Could not connect to Gemini Live. Check your network and API access.');};
   ws.onclose=()=>{if(call===c)stop('Call disconnected. Start a new conversation to reconnect.');};
   c.timeout=setTimeout(()=>{if(call===c)stop('Ten-minute call complete. Start another when you are ready.');},Math.min(c.expires-Date.now(),600000));
   c.clock=setInterval(()=>{if(call===c){const seconds=Math.max(0,Math.ceil((c.expires-Date.now())/1000));$('timer').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' remaining';}},1000);
   c.authCheck=setInterval(()=>{message('CLOUD_STATUS').then(r=>{if(call===c&&!r.user)stop('Signed out. Sign in again to continue.');}).catch(()=>{if(call===c)stop('Session unavailable. Sign in again to continue.');});},30000);
  }catch(e){if(call===c)stop(e.name==='NotAllowedError'?'Microphone access is needed. Allow it in your browser, then retry.':e.message||'Could not start voice');}
  finally{starting=false;}
 }
 start.addEventListener('click',begin);end.addEventListener('click',()=>stop());
 mute.addEventListener('click',()=>{const c=call;if(!c?.ready)return;c.muted=!c.muted;c.stream.getAudioTracks().forEach(t=>t.enabled=!c.muted);if(c.muted)send(c,{realtimeInput:{audioStreamEnd:true}});mute.textContent=c.muted?'Unmute microphone':'Mute microphone';mute.setAttribute('aria-pressed',String(c.muted));say(c.muted?'Microphone muted':'Listening…');});
 window.addEventListener('pagehide',()=>stop());
 message('CLOUD_STATUS').then(r=>{if(!r.user)say('Sign in from the extension Account tab before starting.');}).catch(e=>say(e.message));
})();
