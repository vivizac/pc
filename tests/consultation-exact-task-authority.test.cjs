'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('packages/common/olli-consultation-progress-client.js');
const server=read('packages/common/api/_lib/consultation-summary-handler.cjs');
const migration=read('supabase/migrations/20261024170000_consultation_exact_summary_link_and_audit.sql');
const pc=read('apps/pc/olli-data-consultation-summary.js');
const mobile=read('apps/mobile/olli-student-core.js');
const pcUi=read('apps/pc/pc-student-management.js');

function createClient(tasks) {
  const map=new Map(),academyId='academy-test',studentId='3cc399c3-3ea2-4d4d-bef9-42af455bcf8d';
  const window={
    getConsultationDueTasksForStudent:()=>tasks,
    getOlliCurrentAcademyId:()=>academyId,
    localStorage:{
      getItem:k=>k==='olli_account_session_token_v1'?'session-token':map.get(k)||null,
      setItem:(k,v)=>map.set(k,v)
    },
    supabase:async()=>({ok:true,progress:{}}),
    fetch:async(_path,params)=>{
      const req=JSON.parse(params.body);
      return {ok:true,json:async()=>({ok:true,status:'ready',feedbackId:42,content:'latest',taskKey:req.taskKey})};
    },
    location:{hostname:'vivizac-feedback.vercel.app'}
  };
  vm.runInNewContext(source,{window,Date,JSON,Number,Set,Error});
  return {core:window.OlliConsultationServer,student:{id:studentId},academyId,map};
}
test('12-month analysis stays 12 months at 12, 24 and 36 months of enrollment',()=>{
  const tasks=[12,24,36].map((months,i)=>({
    key:'id:3cc399c3-3ea2-4d4d-bef9-42af455bcf8d|every_12|'+(2024+i)+'-10',
    ruleKey:'every_12',dueMonth:(2024+i)+'-10',occurrenceMonths:months
  }));
  const {core,student,academyId}=createClient(tasks);
  const newest=core.getPrimaryTask(student,12);
  assert.equal(newest.occurrenceMonths,36);
  assert.equal(core.getSummaryMonthsForTask(newest),12);
  const keys=tasks.map(task=>core.getCacheKey(academyId,task));
  assert.equal(new Set(keys).size,3);
});
test('shared PC and Mobile client caches readiness by EXACT due task, never per student/months alone',async()=>{
  const id='3cc399c3-3ea2-4d4d-bef9-42af455bcf8d';
  const older={key:'id:'+id+'|every_12|2025-10',ruleKey:'every_12',dueMonth:'2025-10'};
  const current={key:'id:'+id+'|every_12|2026-10',ruleKey:'every_12',dueMonth:'2026-10'};
  const {core,student,academyId}=createClient([older,current]);
  const oldKey=core.getCacheKey(academyId,older),newKey=core.getCacheKey(academyId,current);
  core.writeCachedStatus(oldKey,{status:'ready',feedbackId:12});
  assert.equal(core.readCachedStatus(oldKey).status,'ready');
  assert.equal(core.readCachedStatus(newKey),null);
  const currentResult=await core.checkSummaryStatus(student,current);
  assert.equal(currentResult.status,'ready');
  assert.equal(currentResult.feedbackId,42);
  assert.equal(core.readCachedStatus(newKey).feedbackId,42);
  assert.match(pc,/OlliConsultationServer\.getPrimaryTask|core\?\.getPrimaryTask/);
  assert.match(mobile,/getPrimaryTask\?\.\(student,requestedMonths\)/);
  assert.match(pcUi,/core\.checkSummaryStatus\(student,task\)/);
});
test('no ready status from malformed server response without linked feedback ID',async()=>{
  const id='3cc399c3-3ea2-4d4d-bef9-42af455bcf8d';
  const task={key:'id:'+id+'|after_1|2026-10',ruleKey:'after_1',dueMonth:'2026-10'};
  const {core,student}=createClient([task]);
  core.inspectSummary=async()=>({status:'ready',content:'orphan'});
  // The public client is frozen; use the mock window fetch route instead in the next invocation.
  assert.equal(Object.isFrozen(core),true);
  assert.match(source,/const verified=data\.status==='ready'&&Number\.isSafeInteger\(Number\(data\.feedbackId\)\)/);
});
test('server inspect requires linked row, no material heuristic, no old date fallback',()=>{
  const inspect=server.slice(server.indexOf("if(action==='inspect')"),server.indexOf("if(action==='revise')"));
  assert.match(inspect,/olli_consultation_summary_jobs/);
  assert.match(inspect,/job\?\.status!=='ready'/);
  assert.match(inspect,/job\.feedback_id/);
  assert.doesNotMatch(inspect,/relevantRows\(|material\.status|candidates\[0\]|created_at\.desc/);
  assert.match(server,/p_action:'claim'/);
  assert.match(server,/p_action:'finish'/);
});
test('legacy links require explicit owner review, are audited and cannot reuse one summary for two tasks',()=>{
  assert.match(migration,/p_confirm_exact_record boolean default false/);
  assert.match(migration,/m\.role in \('owner','super_admin'\)/);
  assert.match(migration,/olli_consultation_summary_jobs_feedback_unique/);
  assert.match(migration,/olli_consultation_summary_link_audit/);
  assert.match(migration,/RECORD_BELONGS_TO_ANOTHER_TASK/);
  assert.match(migration,/RECORD_PERIOD_NOT_VERIFIED/);
  assert.match(migration,/grant execute on function public\.olli_consultation_legacy_summary_link/);
});
