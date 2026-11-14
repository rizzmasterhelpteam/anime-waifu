(function(root){
 'use strict';
 const config=root.WAIFU_CLOUD_CONFIG;
 function stored(mode,key,value){return new Promise((resolve,reject)=>{const request=indexedDB.open('waifu_private_auth',1);request.onupgradeneeded=()=>request.result.createObjectStore('session');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('session',mode),s=tx.objectStore('session');const r=mode==='readonly'?s.get(key):value===null?s.delete(key):s.put(value,key);let result=null;r.onsuccess=()=>{result=r.result??null;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};};});}
 const client=WAIFU_AUTH_VENDOR.createClient(config.url,config.publishableKey,{auth:{storage:{getItem:k=>stored('readonly',k),setItem:(k,v)=>stored('readwrite',k,v),removeItem:k=>stored('readwrite',k,null)},persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,flowType:'pkce'},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})}});
 let refreshing=null;
 async function session(){let {data,error}=await client.auth.getSession();if(error)throw error;if(data.session&&data.session.expires_at*1000<Date.now()+60000){refreshing??=client.auth.refreshSession().finally(()=>{refreshing=null;});const r=await refreshing;if(r.error)throw r.error;return r.data.session;}return data.session;}
 const fields=['name','activeModel','renderMode','sizePx','opacity','microMotion','bodyPhysics','physicsStrength','chestBounce','depth25D','autoStroll','cursorFollow','showBubbles','poseMode','motionQuotes'];
 const filter=s=>Object.fromEntries(fields.filter(k=>Object.hasOwn(s||{},k)).map(k=>[k,s[k]]));
 const checked=r=>{if(r.error)throw r.error;return r.data;};
 async function profile(user){checked(await client.from('profiles').upsert({id:user.id,display_name:String(user.user_metadata?.full_name||'').slice(0,60)},{onConflict:'id',ignoreDuplicates:true}));}
 root.WAIFU_CLOUD={async handle(msg){
  if(msg.type==='CLOUD_SIGN_IN'||msg.type==='CLOUD_SIGN_UP'){
   if(typeof msg.email!=='string'||typeof msg.password!=='string'||msg.email.length>254||msg.password.length>128)throw Error('Enter a valid email and password');
   if(msg.type==='CLOUD_SIGN_UP'&&msg.password.length<12)throw Error('Use at least 12 characters for a new password');
   const data=checked(await (msg.type==='CLOUD_SIGN_IN'?client.auth.signInWithPassword({email:msg.email.trim(),password:msg.password}):client.auth.signUp({email:msg.email.trim(),password:msg.password,options:{emailRedirectTo:config.url+'/functions/v1/auth-complete'}})));
   if(data.session)await profile(data.user);return{ok:true,confirmationRequired:!data.session};
  }
  if(msg.type==='CLOUD_GOOGLE'){
   const redirectTo=chrome.identity.getRedirectURL('supabase');const data=checked(await client.auth.signInWithOAuth({provider:'google',options:{redirectTo,skipBrowserRedirect:true}}));
   const result=await chrome.identity.launchWebAuthFlow({url:data.url,interactive:true});if(!result)throw Error('Sign-in cancelled');
   const url=new URL(result);if(url.origin!==new URL(redirectTo).origin||url.pathname!==new URL(redirectTo).pathname)throw Error('Invalid sign-in redirect');
   const code=url.searchParams.get('code');if(!code)throw Error(url.searchParams.get('error_description')||'Sign-in did not complete');
   const auth=checked(await client.auth.exchangeCodeForSession(code));await profile(auth.user);return{ok:true};
  }
  if(msg.type==='CLOUD_SIGN_OUT'){checked(await client.auth.signOut({scope:'local'}));return{ok:true};}
  const current=await session();
  if(msg.type==='CLOUD_STATUS')return{ok:true,user:current?{email:current.user.email}:null};
  if(!current)throw Error('Sign in first');
  if(msg.type==='CLOUD_PUSH'){
   const {settings}=await chrome.storage.local.get('settings');checked(await client.from('companion_preferences').upsert({user_id:current.user.id,settings:filter(settings)},{onConflict:'user_id'}));return{ok:true};
  }
  if(msg.type==='CLOUD_PULL'){
   const row=checked(await client.from('companion_preferences').select('settings').eq('user_id',current.user.id).maybeSingle());if(!row)throw Error('No saved settings yet');
   await updateSettings(filter(row.settings));return{ok:true};
  }
  if(msg.type==='CLOUD_CLEAR_HISTORY'){checked(await client.from('conversations').delete().eq('user_id',current.user.id));return{ok:true};}
  if(msg.type==='CLOUD_VOICE_TOKEN'){
   const response=await fetch(config.url+'/functions/v1/companion-voice',{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+current.access_token,'Content-Type':'application/json'},body:JSON.stringify({character:msg.character}),signal:AbortSignal.timeout(20000)});
   const body=await response.json();if(!response.ok)throw Error(body.error||'Voice unavailable');return{ok:true,...body};
  }
  throw Error('Unknown cloud action');
 }};
})(globalThis);
