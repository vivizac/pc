'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('packages/common/olli-feedback-target-month.js');
function prepare({prompt='2026-03',confirmed=true,rpc={ok:true,row:{target_month:'2026-03'}}}={}){
  const calls={rpc:[],prompt:0,confirm:0};
  const window={
    location:{hostname:'vivizac-feedback.vercel.app'},
    localStorage:{getItem:key=>key==='olli_account_session_token_v1'?'demo-session':null},
    getOlliCurrentAcademyId:()=> 'academy-id',
    prompt:()=>{calls.prompt++;return prompt;},confirm:()=>{calls.confirm++;return confirmed;},
    supabase:async(...args)=>{calls.rpc.push(args);return rpc;}
  };
  vm.runInNewContext(source,{window,Date,Error,Object,String,Set});
  return {api:window.OlliFeedbackTargetMonth,calls,window};
}
const row={id:18,feedback_type:'growth',target_month:null,content:'keep me'};
test('explicit owner correction writes only target month through session RPC',async()=>{
 const s=prepare(),saved=await s.api.changeSavedMonth({studentId:'student-id',recordId:18,row});
 assert.equal(saved.target_month,'2026-03');assert.equal(s.calls.rpc.length,1);
 const [method,url,payload]=s.calls.rpc[0];assert.equal(method,'POST');
 assert.equal(url,'rpc/olli_growth_feedback_target_month_access');
 assert.equal(payload.p_expected_target_month,null);assert.equal(payload.p_target_month,'2026-03');
 assert.equal(payload.p_session_token,'demo-session');assert.equal(payload.p_feedback_id,'18');
 assert.equal(JSON.stringify(row),JSON.stringify({id:18,feedback_type:'growth',target_month:null,content:'keep me'}));
});
test('invalid, future and cancelled months never call the server',async()=>{
 const bad=prepare({prompt:'2099-12'});await assert.rejects(()=>bad.api.changeSavedMonth({studentId:'s',recordId:18,row}),/현재 월/);
 assert.equal(bad.calls.rpc.length,0);
 const cancel=prepare({prompt:null});assert.equal(await cancel.api.changeSavedMonth({studentId:'s',recordId:18,row}),null);
 assert.equal(cancel.calls.rpc.length,0);
 const decline=prepare({confirmed:false});assert.equal(await decline.api.changeSavedMonth({studentId:'s',recordId:18,row}),null);
 assert.equal(decline.calls.rpc.length,0);
});
test('other feedback types and preview hosts reject writes',async()=>{
 const s=prepare();
 await assert.rejects(()=>s.api.changeSavedMonth({studentId:'s',recordId:18,row:{feedback_type:'class'}}),/성장 피드백/);
 s.window.location.hostname='pc-git-new-feature.vercel.app';
 await assert.rejects(()=>s.api.changeSavedMonth({studentId:'s',recordId:18,row}),/미리보기/);
 assert.equal(s.calls.rpc.length,0);
});
test('server denied or concurrent correction does not signal success',async()=>{
 const s=prepare({rpc:{ok:false,code:'TARGET_MONTH_CHANGED',message:'다른 기기에서 수정했습니다.'}});
 await assert.rejects(()=>s.api.changeSavedMonth({studentId:'s',recordId:18,row}),/다른 기기/);
 assert.equal(s.calls.rpc.length,1);
});
test('DB migration enforces academy and month CAS, protects body and creates audit',()=>{
 const sql=read('supabase/migrations/20261024135000_growth_feedback_target_month_correction.sql');
 assert.match(sql,/olli_account_id_from_session/);assert.match(sql,/m\.role in \('owner','manager','super_admin'\)/);
 assert.match(sql,/f\.academy_id=p_academy_id and f\.student_id=p_student_id/);
 assert.match(sql,/not coalesce\(f\.is_deleted,false\)/);
 assert.match(sql,/v_previous is distinct from p_expected_target_month/);
 assert.match(sql,/for update;/);assert.match(sql,/TARGET_MONTH_CHANGED/);
 assert.match(sql,/set target_month=p_target_month,updated_at=now\(\)/);
 assert.doesNotMatch(sql,/update public.feedbacks f set content/);
 assert.match(sql,/insert into public\.olli_growth_target_month_audit/);
});
test('both record archives expose manual month correction for growth feedback only',()=>{
 const pc=read('apps/pc/olli-data-attendance-feedback.js'),mobile=read('apps/mobile/olli-record-student-picker-phone-adapter.js');
 assert.match(pc,/window\.OlliFeedbackTargetMonth\?\.isGrowthRecord/);
 assert.match(pc,/window\.changeAttendanceGrowthTargetMonth=/);
 assert.match(mobile,/window\.changeMemoArchiveGrowthMonth=/);
 assert.match(mobile,/window\.OlliFeedbackTargetMonth\.changeSavedMonth/);
 assert.doesNotMatch(pc,/await softDeleteAttendanceSummaryFeedback\(item\)/);
 for(const html of [read('apps/pc/index.html'),read('apps/mobile/index.html')])
   assert.match(html,/olli-feedback-target-month\.js\?v=20261024-historical-month-rpc-1/);
});
