import { GoogleGenAI, Modality } from "npm:@google/genai@3.3.0";

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const model='gemini-3.8-live';

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const authorization=req.headers.get('authorization')||'';
 if(!authorization.startsWith('Bearer '))return json({error:'Sign in required'},401);
 try{
  const base=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,authorization},signal:AbortSignal.timeout(10000)});
  if(!auth.ok)return json({error:'Session expired or invalid'},401);
  const user=await auth.json();
  if(!user.id||user.is_anonymous)return json({error:'Registered account required'},403);
  const reader=req.body?.getReader();if(!reader)return json({error:'Character required'},400);
  let text='',size=0;const decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024){await reader.cancel();return json({error:'Request too large'},413);}text+=decoder.decode(value,{stream:true});}
  let input;try{input=JSON.parse(text+decoder.decode());}catch{return json({error:'Invalid JSON'},400);}
  if(!input||!['seraphina','gothic_red'].includes(input.character))return json({error:'Choose a built-in companion'},400);
  const apiKey=Deno.env.get('GEMINI_API_KEY');
  if(!apiKey)return json({error:'Add GEMINI_API_KEY in Supabase Edge Function secrets to enable voice.',code:'AI_NOT_CONFIGURED'},503);
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const quota=await fetch(base+'/rest/v1/rpc/consume_companion_quota',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p_user_id:user.id}),signal:AbortSignal.timeout(10000)});
  if(!quota.ok)return json({error:'Quota service unavailable'},503);
  if(!(await quota.json()))return json({error:'Voice session limit reached. Try again later.'},429);
  const crimson=input.character==='gothic_red';
  const config={
   responseModalities:[Modality.AUDIO],
   speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:crimson?'Aoede':'Kore'}}},
   systemInstruction:`You are ${crimson?'Crimson, a witty, confident':'Seraphina, a warm, graceful'} adult virtual companion. Converse naturally by voice in the user's language. Keep responses brief, usually one or two sentences. Be respectful. Never claim to see websites, screens, or private information. Do not claim to be a real person.`,
   contextWindowCompression:{triggerTokens:'12000',slidingWindow:{targetTokens:'6000'}},
   realtimeInputConfig:{automaticActivityDetection:{silenceDurationMs:450,prefixPaddingMs:100}}
  };
  const expiresAt=new Date(Date.now()+10*60*1000).toISOString();
  const ai=new GoogleGenAI({apiKey,httpOptions:{apiVersion:'v1beta',timeout:15000}});
  const token=await ai.authTokens.create({config:{uses:1,expireTime:expiresAt,newSessionExpireTime:new Date(Date.now()+60000).toISOString(),liveConnectConstraints:{model,config}}});
  if(!token.name)return json({error:'Voice connection unavailable'},502);
  // Only an expiring, single-session credential leaves the server. No audio is saved.
  return json({token:token.name,model,expiresAt,character:input.character});
 }catch{return json({error:'Could not start voice. Check Gemini API access and billing, then retry.'},503);}
});
