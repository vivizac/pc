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
