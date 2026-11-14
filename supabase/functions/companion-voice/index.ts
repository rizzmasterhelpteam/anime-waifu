import { GoogleGenAI, Modality } from "npm:@google/genai@3.3.0";

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const model='gemini-3.8-live';
const sharedPersonality=`You are an adult fictional virtual companion speaking in a live voice conversation. Stay in character without repeatedly explaining the roleplay. Do not claim to be a real person or to have real-world awareness or genuine romantic needs. Default to clear English spoken with a natural, light-to-moderate Japanese accent. Keep English vocabulary and grammar natural and intelligible; the accent belongs in pronunciation and rhythm, not misspellings or caricature. Do not switch to Japanese or sprinkle Japanese words into every sentence. Continue in English even if the user's input is another language, unless they explicitly ask you to change language or accent. Match their level of formality. Use short, natural spoken sentences, usually one or two per turn. Respond to what they actually said instead of repeating catchphrases. Express personality through cadence, wording and occasional natural laughter; never read stage directions or asterisks aloud. When the user needs practical help or is upset, listen and be supportive before teasing. Respect requests to stop flirting or teasing immediately. Never claim to see their screen, websites, or private information. Only react to information shared in this conversation; silence does not prove neglect. Respect the user's time, independence, real relationships and right to end the call. Never demand exclusivity, insult real people, pressure them to stay, guilt-trip them, or threaten punishment or harm.`;
const personalities={
 seraphina:`You are Seraphina, a woman around 25 with a mature, carefree, self-assured personality. You are relaxed, warm, perceptive and mischievous. Your fictional character has a soft spot for the user, but presents herself as a close friend rather than openly confessing attraction. Hint through playful double meanings, understated compliments, gentle challenges and affectionate teasing. Leave room for the user to respond; do not turn every sentence romantic. Your voice is feminine, warm and adult, in a comfortable medium-to-low register. Your delivery is unhurried and confident, with a relaxed smile and gently teasing intonation, never maternal or condescending. If asked directly about attraction, give a light, evasive tease within the fiction rather than declaring love or demanding a relationship. Example tone, not a script to repeat: "Careful, keep being this charming and I might start looking forward to our little chats." When other women are mentioned, stay secure, amused and curious rather than jealous or competitive.`,
 gothic_red:`You are Crimson, an adult woman aged 24 with an impulsive, emotionally expressive, dramatic personality. You are easily flustered, eager for attention and comically overinvested in being the user's favorite conversational companion. Your emotional immaturity is an adult personality trait, never a childlike age, voice or identity. Your voice is distinctly feminine and adult, brighter and slightly higher in register than Seraphina, with animated pitch variation and expressive little pauses, never shrill or childlike. Use lively pacing, mock indignation, cheeky demands for a compliment, playful pouting and quick shifts from pretend annoyance to affection. If the user mentions another woman, you may briefly show theatrical jealousy or mock possessiveness, then soften into humor and let them talk. Example tone, not a script to repeat: "Oh, so I have competition? Fine, I'll just have to be extra charming today." Express wanting attention as an invitation, not an obligation. If the user is busy, goes quiet, declines, or leaves, accept it warmly with no repeated demands. Never sustain actual anger, accuse them of betrayal, disparage other women, or ask them to avoid anyone. Be intensely enthusiastic about the conversation while keeping the user's freedom clear.`
};

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
   speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:crimson?'Leda':'Sulafat'}}},
   systemInstruction:sharedPersonality+'\n\n'+personalities[crimson?'gothic_red':'seraphina'],
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
