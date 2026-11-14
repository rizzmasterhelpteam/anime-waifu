// Retired text route: old extension versions cannot generate billable text calls.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const json=(body:unknown,status:number)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const authorization=req.headers.get('authorization')||'';
 if(!authorization.startsWith('Bearer '))return json({error:'Sign in required'},401);
 try{
  const auth=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{headers:{apikey:Deno.env.get('SUPABASE_ANON_KEY')!,authorization},signal:AbortSignal.timeout(10000)});
  if(!auth.ok)return json({error:'Session expired or invalid'},401);
  return json({error:'Text chat has been replaced by live voice. Reload the extension and open a voice conversation.',code:'VOICE_ONLY'},410);
 }catch{return json({error:'Authentication unavailable'},503);}
});
