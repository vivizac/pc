const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../packages/common/api/_lib/consultation-summary-handler.cjs'),'utf8');
const studentId='11111111-1111-4111-8111-111111111111';
const academyId='22222222-2222-4222-8222-222222222222';
const validKey='id:'+studentId+'|every_12|2026-04';
function setup({auth=true,initialGenerating=false,failChat=false,preview=false,legacyReview=false}={}){
 const calls={ai:0,claims:0,finishes:0,reads:0,studentFetches:0,errors:0,revision:0};
 const row={id:21,content:'First server-managed summary',summary_months:12};
 let status=initialGenerating?'generating':'pending';
 let feedbackId=null;
 const json=(data,http=200)=>({ok:http>=200&&http<300,status:http,
   json:async()=>data,text:async()=>JSON.stringify(data)});
 const fetch=async (url,options={})=>{
   const address=String(url);
   if(address.includes('/rpc/olli_consultation_summary_job_access')){
     const params=JSON.parse(options.body||'{}');
     if(!auth)return json({ok:false,code:'SESSION_INVALID'});
     if(params.p_action==='read'){calls.reads++;return json({ok:true,status:legacyReview?'legacy_review_required':status,feedback_id:feedbackId});}
     if(params.p_action==='claim'){
       calls.claims++;
       if(status==='generating'&&!initialGenerating)return json({ok:true,status:'generating'});
       if(status==='ready')return json({ok:true,status:'ready',feedback_id:feedbackId});
       status='generating';initialGenerating=false;
       return json({ok:true,status:'claimed',claim_token:'33333333-3333-4333-8333-333333333333'});
     }
     if(params.p_action==='finish'){
       calls.finishes++;status='ready';feedbackId=21;row.content=params.p_content;
       return json({ok:true,status:'ready',feedback_id:21});
     }
     if(params.p_action==='fail'){calls.errors++;status='error';return json({ok:true,status:'error'});}
     if(params.p_action==='revise'){calls.revision++;row.content=params.p_content;return json({ok:true,status:'ready',feedback_id:21,content:row.content});}
   }
   if(address.includes('/rest/v1/students')){calls.studentFetches++;return json([{id:studentId,name:'Example',division:'elementary',enrolled_at:'2025-04-15',status:'active',is_deleted:false}]);}
   if(address.includes('/rest/v1/fail_feedbacks'))return json([]);
   if(address.includes('/rest/v1/feedbacks'))return json([
     {id:1,date:'2025-07-01',feedback_type:'growth',content:'Growth observation',lesson_date:'2025-07-01'},
     {id:2,date:'2025-11-02',feedback_type:'growth',content:'Growth observation',lesson_date:'2025-11-02'},
     {id:3,date:'2026-03-28',feedback_type:'growth',content:'Final month observation',lesson_date:'2026-03-28'}
   ]);
   if(address.includes('/rest/v1/summary_feedbacks'))return json([row]);
   if(address.includes('/api/chat')){
     calls.ai++;
     if(failChat)return json({error:'OpenAI outage'},500);
     return json({reply:'AI-generated consultation summary with observations and recommendations across the full year.'});
   }
   throw new Error('Unexpected fetch '+address);
 };
 const TestClock=class extends Date {
   constructor(...args){super(...(args.length?args:['2026-04-20T08:00:00Z']));}
   static now(){return new Date('2026-04-20T08:00:00Z').getTime();}
 };
 const sandbox={process:{env:{SUPABASE_SERVICE_ROLE_KEY:'test-key',VERCEL_ENV:preview?'preview':'production'}},console,Date:TestClock,URL,Set,fetch,module:{exports:{} }};
 vm.runInNewContext(source,sandbox);
 const handler=sandbox.module.exports;
 async function call(body){
   const r={code:200,setHeader(){},status(n){this.code=n;return this;},json(data){return {http:this.code,...data};}};
   return handler({method:'POST',body},r);
 }
 return{calls,call,studentId,academyId,key:validKey};
}
test('two simultaneous requests lead to at most one AI generation and one insert',async()=>{
 const s=setup(),body={studentId,academyId,sessionToken:'valid-session',taskKey:validKey};
 const results=await Promise.all([s.call(body),s.call(body)]);
 assert.equal(s.calls.ai,1);
 assert.equal(s.calls.finishes,1);
 assert.ok(results.some(x=>x.status==='ready'));
 assert.ok(results.some(x=>x.status==='generating'||x.status==='ready'));
 const cached=await s.call(body);
 assert.equal(cached.status,'ready');
 assert.equal(s.calls.ai,1);
});
test('expired generating lease can retry claim instead of remaining generating indefinitely',async()=>{
 const s=setup({initialGenerating:true});
 const result=await s.call({studentId,academyId,sessionToken:'valid',taskKey:validKey});
 assert.equal(result.status,'ready');assert.equal(s.calls.ai,1);assert.equal(s.calls.finishes,1);
});
test('invalid session cannot query student data or call AI',async()=>{
 const s=setup({auth:false});
 const result=await s.call({studentId,academyId,sessionToken:'invalid',taskKey:validKey});
 assert.equal(result.http,401);assert.equal(result.error,'SESSION_INVALID');
 assert.equal(s.calls.studentFetches,0);assert.equal(s.calls.ai,0);
});
test('failure before finish releases job through fail action',async()=>{
 const s=setup({failChat:true});
 const result=await s.call({studentId,academyId,sessionToken:'valid',taskKey:validKey});
 assert.equal(result.http,502);assert.equal(s.calls.errors,1);
 assert.equal(s.calls.finishes,0);
});
test('manual generation rejects missing selection and never calls model',async()=>{
 const s=setup();
 const result=await s.call({studentId,academyId,sessionToken:'valid',taskKey:'id:'+studentId+'|manual_6|2026-10',selectedFeedbackIds:[]});
 assert.equal(result.http,400);assert.equal(result.error,'SELECTION_INVALID');
 assert.equal(s.calls.ai,0);assert.equal(s.calls.finishes,0);
});
test('manual revisions use existing job rather than generating another response',async()=>{
 const s=setup();
 const result=await s.call({studentId,academyId,sessionToken:'valid',taskKey:'id:'+studentId+'|manual_6|2026-10',action:'revise',content:'Revised observation content from both devices.'});
 assert.equal(result.status,'ready');assert.equal(s.calls.revision,1);
 assert.equal(s.calls.ai,0);assert.equal(s.calls.finishes,0);
});
test('preview deployments refuse live DB job mutations',async()=>{
 const s=setup({preview:true});
 const result=await s.call({studentId,academyId,sessionToken:'valid',taskKey:validKey});
 assert.equal(result.http,403);assert.equal(result.error,'PREVIEW_WRITE_BLOCKED');
 assert.equal(s.calls.claims,0);assert.equal(s.calls.ai,0);
});

test('legacy summary without exact task identity is not regenerated',async()=>{
 const s=setup({legacyReview:true});
 const result=await s.call({studentId,academyId,sessionToken:'valid',taskKey:validKey});
 assert.equal(result.http,200);assert.equal(result.status,'insufficient');
 assert.match(result.reason,/기존 종합 피드백/);
 assert.equal(s.calls.ai,0);assert.equal(s.calls.claims,0);assert.equal(s.calls.finishes,0);
});

test('stale month cannot regenerate old overdue consultation from any client',async()=>{
 const s=setup();
 const overdue='id:'+studentId+'|every_12|2026-03';
 const result=await s.call({studentId,academyId,sessionToken:'valid',taskKey:overdue});
 assert.equal(result.status,'insufficient');
 assert.equal(result.code,'OUTSIDE_CONSULTATION_MONTH');
 assert.equal(s.calls.ai,0);
 assert.equal(s.calls.claims,0);
 assert.equal(s.calls.finishes,0);
 assert.equal(s.calls.reads,0);
});
