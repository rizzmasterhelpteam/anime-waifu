(function(){
 'use strict';
 const details=document.getElementById('cloud-account'),status=document.getElementById('cloud-status'),email=document.getElementById('cloud-email'),password=document.getElementById('cloud-password'),signed=document.getElementById('cloud-signed');
 let conversationId=null,character=null,busy=false;
 async function send(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw Error(r?.error||'Could not connect');return r;}
 async function refresh(){const r=await send('CLOUD_STATUS');signed.hidden=!r.user;document.getElementById('cloud-login').hidden=Boolean(r.user);status.textContent=r.user?'Signed in as '+r.user.email:'Sign in to save settings and chat. The companion also works offline.';}
 document.querySelector('[data-tab="account"]').addEventListener('click',()=>{if(details.open)refresh().catch(e=>status.textContent=e.message);else details.open=true;});
 details.addEventListener('toggle',()=>{if(details.open)refresh().catch(e=>status.textContent=e.message);});
 for(const button of details.querySelectorAll('[data-cloud-action]'))button.addEventListener('click',async()=>{
  if(busy)return;busy=true;const buttons=[...details.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);status.textContent='Working…';
  try{const action=button.dataset.cloudAction;
   if(action==='SIGN_IN'||action==='SIGN_UP'){const r=await send('CLOUD_'+action,{email:email.value,password:password.value});password.value='';await refresh();if(r.confirmationRequired)status.textContent='Check your email to confirm your account, then sign in.';}
   else if(action==='GOOGLE'){await send('CLOUD_GOOGLE');await refresh();}
   else if(action==='CHAT'){
    const input=document.getElementById('cloud-message');const message=input.value.trim();if(!message)throw Error('Write a message first');
    const {settings}=await chrome.storage.local.get('settings');const next=settings?.activeModel||'seraphina';if(character!==next){conversationId=null;character=next;}
    const r=await send('CLOUD_CHAT',{message,character,conversationId});conversationId=r.conversationId;document.getElementById('cloud-reply').textContent=r.reply;input.value='';status.textContent='Reply received';
   }else{await send('CLOUD_'+action);status.textContent=action==='PUSH'?'Settings saved':action==='PULL'?'Saved settings loaded':action==='CLEAR_HISTORY'?'Chat history deleted':'Signed out';if(action==='SIGN_OUT'){conversationId=null;document.getElementById('cloud-reply').textContent='';await refresh();}if(action==='CLEAR_HISTORY')conversationId=null;}
  }catch(e){status.textContent=e.message;}finally{busy=false;buttons.forEach(b=>b.disabled=false);}
 });
})();
