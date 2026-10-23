'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createService}=require('../packages/common/api/_lib/consultation-messages.cjs');

const ROW={channel_id:'70003056-4724-4136-9e6f-01cf40a9bb79',pf_id:'KA01PF261021001527714ZobNrZiJlwr',
  template_id:'KA01TP261023074507442LGNZ4eiNbXq',template_body:'안녕하세요\n#{학생이름_주격}',
  approval_state:'pending'};
function harness(providerResult, {credentials=true,failProvider=false}={}){
 const updates=[];
 const env={SUPABASE_SECRET_KEY:'test-only',OLLI_CONSULTATION_SOLAPI_CREDENTIALS:credentials?JSON.stringify({apiKey:'test-key',apiSecret:'test-secret'}):'{}'};
 const fetchImpl=async (url,options)=>{
   const u=String(url);
   if(u.includes('rpc/olli_consultation_template_sync_snapshot')) return new Response(JSON.stringify([ROW]),{status:200,headers:{'Content-Type':'application/json'}});
   if(u.includes('rpc/olli_consultation_template_sync_apply')){
     const input=JSON.parse(options.body);updates.push(input);
     return new Response(JSON.stringify({ok:true,state:input.p_provider_status==='APPROVED'&&input.p_content_matches?'approved':'pending'}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   if(u.includes('/kakao/v2/templates/')){
     if(failProvider)throw new Error('Simulated provider outage');
     return new Response(JSON.stringify({templateList:providerResult}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   throw new Error('Unexpected outgoing URL: '+u);
 };
 return {service:createService({env,fetchImpl}),updates};
}
test('provider APPROVED with exact approved body transitions to approved',async()=>{
 const h=harness([{templateId:ROW.template_id,status:'APPROVED',content:ROW.template_body,isHidden:false,isDeleted:false}]);
 const result=await h.service.syncProviderTemplates();
 assert.equal(result.checked,1);assert.equal(result.errors,0);
 assert.equal(h.updates[0].p_provider_status,'APPROVED');
 assert.equal(h.updates[0].p_content_matches,true);
});
test('approved status with edited body is not approved',async()=>{
 const h=harness([{templateId:ROW.template_id,status:'APPROVED',content:'changed',isHidden:false,isDeleted:false}]);
 await h.service.syncProviderTemplates();
 assert.equal(h.updates[0].p_content_matches,false);
});
test('missing/hidden templates become non-sendable',async()=>{
 for(const items of [[],[{templateId:ROW.template_id,status:'APPROVED',content:ROW.template_body,isHidden:true}]]){
  const h=harness(items);await h.service.syncProviderTemplates();
  assert.equal(h.updates[0].p_content_matches,false);
  assert.notEqual(h.updates[0].p_provider_status,'APPROVED');
 }
});
test('provider outage records a sanitized failure only',async()=>{
 const h=harness([],{failProvider:true});
 const result=await h.service.syncProviderTemplates();
 assert.equal(result.errors,1);
 assert.equal(h.updates[0].p_error_code,'PROVIDER_QUERY_FAILED');
});
test('no provider credentials prevents synchronization',async()=>{
 const h=harness([],{credentials:false});const result=await h.service.syncProviderTemplates();
 assert.equal(result.configured,false);assert.equal(h.updates.length,0);
});

test('administrator signed status sync requires valid internal HMAC',async()=>{
 const crypto=require('node:crypto');
 const handler=require('../packages/common/api/_lib/consultation-messages-handler.cjs');
 const envKeys=['VERCEL_ENV','OLLI_ADMIN_TEMPLATE_SYNC_SECRET','SUPABASE_SECRET_KEY','OLLI_CONSULTATION_SOLAPI_CREDENTIALS'];
 const previous=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 const originalFetch=global.fetch;
 let calls=0;
 const rsp=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this},json(value){this.value=value;return this}});
 try{
  process.env.VERCEL_ENV='production';
  process.env.OLLI_ADMIN_TEMPLATE_SYNC_SECRET='dummy-internal-sync-signing-secret-long-enough';
  process.env.SUPABASE_SECRET_KEY='test-key-only';
  process.env.OLLI_CONSULTATION_SOLAPI_CREDENTIALS=JSON.stringify({apiKey:'key',apiSecret:'secret'});
  global.fetch=async(url,opts)=>{
   calls++;
   if(String(url).includes('olli_consultation_template_sync_snapshot'))return Response.json([ROW]);
   if(String(url).includes('olli_consultation_template_sync_apply'))return Response.json({ok:true,state:'approved'});
   if(String(url).includes('api.solapi.com'))return Response.json({templateList:[{templateId:ROW.template_id,status:'APPROVED',content:ROW.template_body}]});
   throw new Error('Unexpected URL');
  };
  let res=rsp();
  await handler({method:'POST',headers:{'x-olli-sync-at':String(Date.now()),'x-olli-sync-signature':'invalid'},body:{action:'admin-template-sync'}},res);
  assert.equal(res.statusCode,401);assert.equal(calls,0);
  const at=String(Date.now());
  const sig=crypto.createHmac('sha256',process.env.OLLI_ADMIN_TEMPLATE_SYNC_SECRET).update(at+':template-sync').digest('hex');
  res=rsp();
  await handler({method:'POST',headers:{'x-olli-sync-at':at,'x-olli-sync-signature':sig},body:{action:'admin-template-sync'}},res);
  assert.equal(res.statusCode,200);assert.equal(res.value.templateSync.checked,1);
 }finally{
  global.fetch=originalFetch;
  for(const [k,v] of Object.entries(previous)) {if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
