const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
vm.runInThisContext(fs.readFileSync(require('node:path').join(__dirname,'../shared/cloud-config.js'),'utf8'));
(async()=>{const {url,publishableKey}=WAIFU_CLOUD_CONFIG;const headers={apikey:publishableKey,'Content-Type':'application/json'};
 for(const authorization of [null,'Bearer invalid']){const r=await fetch(url+'/functions/v1/companion-chat',{method:'POST',headers:{...headers,...(authorization?{authorization}:{})},body:'{}'});assert.equal(r.status,401);}
 const preflight=await fetch(url+'/functions/v1/companion-chat',{method:'OPTIONS',headers:{Origin:'chrome-extension://test'}});assert.equal(preflight.status,204);
 for(const table of ['profiles','companion_preferences','conversations','messages']){const r=await fetch(url+'/rest/v1/'+table+'?select=*',{headers});assert([401,403].includes(r.status),table+' accessible anonymously');}
 const r=await fetch(url+'/rest/v1/rpc/consume_companion_quota',{method:'POST',headers,body:JSON.stringify({p_user_id:'00000000-0000-0000-0000-000000000000'})});assert([401,403,404].includes(r.status));
 console.log('Cloud checks passed: unauthenticated chat/data/quota denied; preflight allowed.');
})().catch(e=>{console.error(e);process.exit(1)});
