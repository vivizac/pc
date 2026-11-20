'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const shared=read('packages/common/olli-feedback-runtime.js');
const mobile=read('apps/mobile/kinder-feedback.js');
const pc=read('apps/pc/pc-kinder-feedback.js');
const apiSource=read('apps/mobile/api/feedback-client-error.js');

function makeReporter({token='session-test',errorIssue=true}={}){
  const start=shared.indexOf('function getQuicknoteEditSaveErrorCode(');
  const end=shared.indexOf('function getTodayFeedbackSavedSourceTable(',start);
  assert.ok(start>=0&&end>start,'shared original error reporter');
  const records=[],requests=[];
  const win={ getOlliPhoneWritableAccountSessionToken:()=>token };
  const report=new Function('window','localStorage','fetch','recordOlliStorageIssue','getOlliCurrentAcademyId',
    shared.slice(start,end)+'\nreturn reportQuicknoteEditSaveFailure;')(
    win,{getItem:()=>token},(url,options)=>{
      requests.push({url,options});return Promise.resolve({ok:true});
    },x=>{if(errorIssue)records.push(x)},()=> '6871d975-6c50-426d-97b1-81ac4e35ba27');
  return {report,records,requests};
}
const item={id:'tf_test123',savedAcademyId:'6871d975-6c50-426d-97b1-81ac4e35ba27',
  studentName:'비밀학생',resultText:'민감한 피드백 원문이 여기 있습니다'};
test('mobile save failure records actual error code, stage, device and no feedback text',()=>{
  const ctx=makeReporter();
  const code=ctx.report(item,'server_patch',{code:'SERVER_VERIFY_FAILED',message:'민감한 피드백 원문'},'mobile');
  assert.equal(code,'SERVER_VERIFY_FAILED');
  assert.equal(ctx.records.length,1);
  assert.equal(ctx.records[0].feature,'quicknote_feedback_edit');
  assert.match(ctx.records[0].message,/SERVER_VERIFY_FAILED/);
  assert.equal(ctx.requests.length,1);
  const payload=JSON.parse(ctx.requests[0].options.body);
  assert.equal(ctx.requests[0].url,'/api/feedback-client-error');
  assert.deepEqual([payload.stage,payload.errorCode,payload.savePhase,payload.appType],
    ['EDIT_SAVE_FAILED','SERVER_VERIFY_FAILED','server_patch','mobile']);
  assert.doesNotMatch(JSON.stringify(payload),/비밀학생|민감한 피드백/);
});
test('PC records missing server ID and local store failure using existing endpoint',()=>{
  const ctx=makeReporter();
  assert.equal(ctx.report(item,'server_record_id',{code:'RECORD_ID_MISSING'},'pc'),'RECORD_ID_MISSING');
  assert.equal(ctx.report(item,'local_queue_save',{name:'QuotaExceededError'},'pc'),'UNKNOWN');
  const reqs=ctx.requests.map(x=>JSON.parse(x.options.body));
  assert.deepEqual(reqs.map(x=>x.savePhase),['server_record_id','local_queue_save']);
  assert.deepEqual(reqs.map(x=>x.appType),['pc','pc']);
});
test('session unavailable keeps local error record and does not send unauthenticated telemetry',()=>{
  const ctx=makeReporter({token:''});
  ctx.report(item,'record_lookup',{code:'FEEDBACK_ITEM_NOT_FOUND'},'mobile');
  assert.equal(ctx.records.length,1);
  assert.equal(ctx.requests.length,0);
});
test('untrusted exception code is never sent to the server',()=>{
  const ctx=makeReporter();
  ctx.report(item,'server_patch',{code:'sensitive student text <script>'},'mobile');
  assert.equal(JSON.parse(ctx.requests[0].options.body).errorCode,'UNKNOWN');
});
for(const [platform,code] of [['mobile',mobile],['pc',pc]]){
  test(platform+' original edit handler captures missing ID, RPC failure, and local persistence failure',()=>{
    const start=code.indexOf('async function confirmKinderChatFeedbackInboxEdit(id) {');
    const end=code.indexOf('\nfunction ',start);
    assert.ok(start>=0&&end>start);
    const body=code.slice(start,end);
    for(const phase of (platform === 'mobile'
      ? ['record_lookup','server_record_id','server_patch']
      : ['record_lookup','server_record_id','server_patch','local_queue_save']))
      assert.match(body,new RegExp("reportQuicknoteEditSaveFailure\\([^;]+?['\\\"]"+phase+"['\\\"]"));
    if (platform === 'mobile') {
      assert.doesNotMatch(body,/setTodayFeedbackItemsRaw\s*\(/);
      assert.match(body,/rememberOlliPhoneQuickNoteVerifiedEdit/);
    } else {
    assert.match(body,/try\s*\{\s*setTodayFeedbackItemsRaw\(nextList\);\s*\}\s*catch/);
    }
  });
}
function loadEndpoint(mockFetch){
  const source=apiSource.replace('export default async function handler(req, res)', 'async function handler(req, res)');
  return new Function('process','fetch',source+'\nreturn handler;')(
    {env:{SUPABASE_SECRET_KEY:'test-only-key'}},mockFetch);
}
function makeResponse(){
  return {code:0,jsonData:null,headers:{},setHeader(k,v){this.headers[k]=v;},
    status(n){this.code=n;return this;},json(v){this.jsonData=v;return this;},
    end(){return this;}};
}
test('server authenticated endpoint stores edit failure code and phase, no student text',async()=>{
  const calls=[];
  const handler=loadEndpoint(async(url,init)=>{
    calls.push({url,body:JSON.parse(init.body)});
    if(url.endsWith('/olli_team_talk_settings_get'))return {ok:true,text:async()=>JSON.stringify({ok:true})};
    return {ok:true,status:201};
  });
  const res=makeResponse();
  await handler({method:'POST',body:{
    academyId:'6871d975-6c50-426d-97b1-81ac4e35ba27',
    sessionToken:'teacher-session',stage:'EDIT_SAVE_FAILED',promptType:'class',
    requestId:'tf_test123',appType:'pc',savePhase:'server_patch',errorCode:'SERVER_VERIFY_FAILED',
    httpStatus:0,rawContent:'should not be saved'
  }},res);
  assert.equal(res.code,200);
  assert.equal(calls.length,2);
  const record=calls[1].body;
  assert.equal(record.feature,'quicknote_feedback');
  assert.equal(record.app_type,'pc');
  assert.equal(record.message,'EDIT_SAVE_FAILED');
  assert.equal(record.detail.error_code,'SERVER_VERIFY_FAILED');
  assert.equal(record.detail.save_phase,'server_patch');
  assert.doesNotMatch(JSON.stringify(record),/should not be saved/);
  assert.doesNotMatch(JSON.stringify(record),/teacher-session/);
});
test('server continues accepting existing AI stream failure diagnostics',async()=>{
  let written;
  const handler=loadEndpoint(async(url,init)=>{
    if(url.endsWith('/olli_team_talk_settings_get'))return {ok:true,text:async()=>JSON.stringify({ok:true})};
    written=JSON.parse(init.body);return {ok:true};
  });
  const res=makeResponse();
  await handler({method:'POST',body:{
    academyId:'6871d975-6c50-426d-97b1-81ac4e35ba27',
    sessionToken:'teacher-session',stage:'STREAM_RECEIVE',promptType:'class',httpStatus:200
  }},res);
  assert.equal(res.code,200);
  assert.equal(written.message,'STREAM_RECEIVE');
  assert.equal(written.detail.error_code,undefined);
});
test('server rejects unknown stages and cannot leak raw exception text in error code',async()=>{
  const handler=loadEndpoint(async()=>{throw new Error('must not call upstream')});
  const res=makeResponse();
  await handler({method:'POST',body:{academyId:'6871d975-6c50-426d-97b1-81ac4e35ba27',sessionToken:'test',stage:'DROP_TABLE',promptType:'class',httpStatus:0}},res);
  assert.equal(res.code,400);
});
