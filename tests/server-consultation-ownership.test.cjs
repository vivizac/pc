const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const api=read('packages/common/api/_lib/consultation-summary-handler.cjs');
const pc=read('apps/pc/olli-data-consultation-summary.js');
const mobile=read('apps/mobile/olli-student-core.js');
const client=read('packages/common/olli-consultation-progress-client.js');
const pcRuntime=read('apps/pc/olli-consultation-runtime.js');
const mobileRuntime=read('apps/mobile/olli-consultation-mobile-runtime.js');
const migration=read('supabase/migrations/20261023193000_consultation_server_source_of_truth.sql');

function getHelpers() {
  const js=api.replace('module.exports=handler;', '')
    .replace('module.exports.runScheduled=(task)=>main(task,{scheduled:true});', '')
    .replace('module.exports.__test=', 'const __test =');
  return vm.runInNewContext(js+'\n__test',{Date,URL,Set,console,process:{env:{}},fetch:()=>{throw Error('No network allowed in unit tests')}});
}
function section(source,begin,end) {
  const a=source.indexOf(begin),b=source.indexOf(end,a+begin.length);
  assert.ok(a>=0&&b>a,'Missing section '+begin);
  return source.slice(a,b);
}
test('calendar month calculation: April 2025 enrollment means April 2026 due',()=>{
 const h=getHelpers();
 const enrolled={enrolled_at:'2025-04-14'};
 const due=h.parseMonth('2026-04');
 assert.equal(h.verifyDue(enrolled,'every_12',due),12);
 assert.equal(h.monthKey(h.addMonth(due,-1)),'2026-03');
 assert.equal(h.monthKey(h.addMonth(due,-12)),'2025-04');
 assert.throws(()=>h.verifyDue(enrolled,'every_12',h.parseMonth('2026-03')),/등록일/);
 assert.throws(()=>h.verifyDue(enrolled,'after_3',due),/등록일/);
});
test('elementary annual summary requires last lesson-month growth even if recorded in April',()=>{
 const h=getHelpers(),due=h.parseMonth('2026-04');
 const row=(date,feedback_type='growth')=>({date,feedback_type,content:'growth example'});
 const prior=[row('2025-06-20'),row('2025-09-13'),row('2025-12-12')];
 assert.equal(h.relevantRows(prior,[],'elementary','every_12',due,12).status,'insufficient');
 const march=h.relevantRows([...prior,row('2026. 3. 28.')],[],'elementary','every_12',due,12);
 assert.equal(march.status,'ready');
 assert.equal(h.relevantRows([...prior,row('2026-04-08')],[],'elementary','every_12',due,12).status,'insufficient');
 assert.equal(h.relevantRows([...prior,{...row('2026-04-08'),target_month:'2026-03'}],[],'elementary','every_12',due,12).status,'ready');
 assert.equal(h.relevantRows([...prior,row('2026-05-08')],[],'elementary','every_12',due,12).status,'insufficient');
 assert.equal(h.relevantRows([...prior,row('2026-04-08','class')],[],'elementary','every_12',due,12).status,'insufficient');
});
test('kinder first-month consultation requires four feedbacks',()=>{
 const h=getHelpers(),due=h.parseMonth('2026-10');
 const rows=Array.from({length:3},(_,i)=>({date:'2026-09-'+String(i+5).padStart(2,'0'),content:'feedback'}));
 assert.equal(h.relevantRows(rows,[],'kinder','after_1',due,1).status,'insufficient');
 assert.equal(h.relevantRows([...rows,{date:'2026-10-03',content:'feedback'}],[],'kinder','after_1',due,1).status,'ready');
});
test('client auto-check uses single server endpoint, no client-side AI and auto-save',()=>{
 for(const source of [pc,mobile]) {
   const code=section(source,'async function runAcademyConsultationSummaryAutoCheck()','window.toggleAcademyConsultationSummaryPreview =');
   assert.match(code,/inspectConsultationSummaryFromServer/);
   assert.doesNotMatch(code,/fetchConsultationSummaryFromServer/);
   assert.doesNotMatch(code,/createSummaryFeedbackFromRows/);
   assert.doesNotMatch(code,/saveConsultationSummaryFeedbackAuto/);
   assert.match(code,/status:'error'/);
 }
 assert.match(client,/requestSummary\(studentId, taskKey\)/);
 assert.match(client,/\/api\/consultation-summary/);
});
test('consultation completion never treats a local optimistic button as confirmed write',()=>{
 const code=section(pcRuntime,'async function toggleAcademyConsultationCompleted(','function updateOlliConsultationSettingUI(');
 assert.match(code,/OlliConsultationServer\.readProgress\(/);
 assert.match(code,/OlliConsultationServer\.setCompleted\(/);
 assert.doesNotMatch(code,/saveOlliConsultationProgressShared/);
 assert.doesNotMatch(code,/pressedBtn\.classList\.toggle/);
 assert.match(code,/catch \(error\)/);
 // The original academy dashboard remains the sole screen renderer.
 // The mobile server runtime only synchronizes progress; it must never overlay it.
 const originalDashboard=read('apps/mobile/olli-settings-server-sync.js');
 assert.match(originalDashboard,/function renderAcademyConsultationList\(students\)/);
 assert.match(originalDashboard,/data-consult-preview|toggleAcademyConsultationSummaryPreview/);
 assert.match(originalDashboard,/renderAcademyConsultationSummaryPreview/);
 assert.doesNotMatch(mobileRuntime,/previousMobileAcademyRenderer|renderOlliServerConsultationDashboard/);
 assert.match(pc,/pendingGeneration/);
 assert.match(mobile,/pendingGeneration/);
 assert.match(mobileRuntime,/toggleAcademyConsultationCompleted/);
 assert.match(mobileRuntime,/loadOlliConsultationProgressFromServer/);
 assert.match(pcRuntime,/restoreOlliConsultationPendingRecovery/);
});
test('database enforces single job per academy student rule and due-month with atomic claim',()=>{
 assert.match(migration,/primary key \(academy_id, student_id, rule_key, due_month\)/);
 assert.match(migration,/for update;/i);
 assert.match(migration,/claim_token uuid/);
 assert.match(migration,/status='generating' and v_job\.leased_until>now\(\)/);
 assert.match(migration,/on conflict \(academy_id,client_mutation_id\) do nothing/);
 assert.match(migration,/revoke all on public\.olli_consultation_summary_jobs/);
 assert.match(migration,/public\.olli_account_id_from_session/);
 assert.match(migration,/p_action='set_rules'/);
 assert.match(client,/readRules: \(\) => request\('read_rules'\)/);
 assert.match(migration,/m\.role in \('owner','manager','super_admin'\)/);
});
test('PC API proxies mobile shared server, without its own AI generation',()=>{
 const proxy=read('apps/pc/api/consultation-summary.js');
 assert.match(proxy, /require\('\.\/_lib\/consultation-summary-handler\.cjs'\)/);
 assert.equal(proxy, read('apps/mobile/api/consultation-summary.js'));
 assert.match(api,/olli_consultation_summary_job_access/);
 assert.doesNotMatch(proxy,/api\.openai\.com/);
});

test('consultation carry-over uses the same calendar task core on both devices',()=>{
 const source=read('packages/common/olli-consultation-task-core.js');
 const calculate=vm.runInNewContext(source+'\ncalculateOlliConsultationTasks',{Date,Set});
 const enrolled=new Date(2025,3,14), reference=new Date(2026,9,23);
 const rules=['after_1','every_12'];
 const active=calculate({type:'elementary',id:'00000000-0000-4000-8000-000000000001'},{
   now:reference,enrolled,rules,progress:{tracking_started_month:'2026-04',completed:{}}
 });
 assert.equal(active.filter(x=>x.ruleKey==='every_12').length,1);
 assert.equal(active.find(x=>x.ruleKey==='every_12').dueMonth,'2026-04');
 const task=active.find(x=>x.ruleKey==='every_12');
 const done={completed_at:'2026-10-22T11:00:00Z',completed_month:'2026-10'};
 const sameMonth=calculate({type:'elementary',id:'00000000-0000-4000-8000-000000000001'},{
   now:reference,enrolled,rules,progress:{tracking_started_month:'2026-04',completed:{[task.key]:done}}
 });
 assert.equal(sameMonth.find(x=>x.key===task.key)?.completed,true);
 const afterMonth=calculate({type:'elementary',id:'00000000-0000-4000-8000-000000000001'},{
   now:new Date(2026,10,1),enrolled,rules,progress:{tracking_started_month:'2026-04',completed:{[task.key]:done}}
 });
 assert.equal(afterMonth.some(x=>x.key===task.key),false);
});
test('summary claim RPC is executable only by service role',()=>{
 const migration=read('supabase/migrations/20261023233000_consultation_job_server_only.sql');
 assert.match(migration,/revoke execute on function public\.olli_consultation_summary_job_access/);
 assert.match(migration,/from public, anon, authenticated/);
 assert.match(migration,/to service_role/);
});

test('annual growth gate uses explicit lesson target month rather than generation date',()=>{
 const h=getHelpers(),due=h.parseMonth('2026-04');
 const old=[{date:'2025-06-20',feedback_type:'growth',content:'first'},{date:'2025-11-21',feedback_type:'growth',content:'second'}];
 assert.equal(h.relevantRows([...old,{date:'2026-04-05',feedback_type:'growth',content:'April draft without target month'}],[],'elementary','every_12',due,12).status,'insufficient');
 assert.equal(h.relevantRows([...old,{date:'2026-04-05',target_month:'2026-03',feedback_type:'growth',content:'March lessons written April'}],[],'elementary','every_12',due,12).status,'ready');
 assert.equal(h.relevantRows([...old,{date:'2026-04-05',target_month:'2026-04',feedback_type:'growth',content:'April lessons'}],[],'elementary','every_12',due,12).status,'insufficient');
});
test('expired generation lease is allowed to proceed to atomic claim check',()=>{
 const s=read('packages/common/api/_lib/consultation-summary-handler.cjs');
 assert.doesNotMatch(s,/if\(status\.status==='generating'\)return/);
 assert.match(s,/p_action:'claim'/);
});
test('shared consultation handler is staged identically in both apps',()=>{
 for (const app of ['pc','mobile']) {
   const m=JSON.parse(read('packages/common/'+app+'-runtime-manifest.json'));
   assert.ok(m.files.includes('api/_lib/consultation-summary-handler.cjs'),app);
   assert.match(read('apps/'+app+'/api/consultation-summary.js'),/require\('\.\/_lib\/consultation-summary-handler\.cjs'\)/);
 }
});

test('preview deployments cannot mutate production consultation progress or generate AI',()=>{
 const server=read('packages/common/api/_lib/consultation-summary-handler.cjs');
 const client=read('packages/common/olli-consultation-progress-client.js');
 assert.match(server,/process\.env\.VERCEL_ENV==='preview'/);
 assert.match(server,/PREVIEW_WRITE_BLOCKED/);
 assert.match(client,/assertProductionWriteHost/);
 assert.match(client,/setCompleted: \(taskKeys, completed\) => \{ assertProductionWriteHost\(\)/);
});
test('manual record selection can only generate on shared server from validated saved IDs',()=>{
 const handler=read('packages/common/api/_lib/consultation-summary-handler.cjs');
 assert.match(handler,/manual_1','manual_3','manual_6','manual_12/);
 assert.match(handler,/selectedFeedbackIds/);
 assert.match(handler,/Number\.isSafeInteger/);
 assert.match(handler,/SELECTION_NOT_FOUND/);
 assert.match(handler,/SELECTION_INVALID/);
 assert.match(handler,/p_action:'revise'/);
 assert.match(handler,/Number\(row\.id\)/);
 for(const source of [pc,mobile]){
   const manual=section(source,'async function requestSummaryFeedbackFromRecords(','window.requestConsultationSummaryFeedback =');
   assert.match(manual,/requestManualSummary\(/);
   assert.match(manual,/OlliConsultationManualUI\.open/);
   assert.doesNotMatch(manual,/createSummaryFeedbackFromRows\(/);
   assert.doesNotMatch(manual,/saveFeedbackRowVerified/);
   assert.doesNotMatch(manual,/addRecordSummaryPopup/);
   assert.match(source,/throw new Error\('종합 피드백은 올리 공통 서버에서만 생성할 수 있습니다/);
 }
});

test('manual edit saves to the same authorized job instead of inserting a second summary row',()=>{
 const client=read('packages/common/olli-consultation-progress-client.js');
 const ui=read('packages/common/olli-consultation-manual-summary-ui.js');
 const migration=read('supabase/migrations/20261024003500_consultation_manual_summary_server.sql');
 assert.match(client,/reviseManualSummary\(studentId, taskKey, content\)/);
 assert.match(ui,/reviseManualSummary\(studentId,taskKey,value\)/);
 assert.doesNotMatch(ui,/saveFeedbackRowVerified/);
 assert.match(migration,/p_action='revise'/);
 assert.match(migration,/where sf\.id=v_job\.feedback_id and sf\.academy_id=p_academy_id/);
 assert.match(migration,/revoke execute on function public\.olli_consultation_summary_job_access/);
 assert.match(migration,/to service_role/);
});
test('manual UI scripts and styles are present in both staging manifests',()=>{
 for(const app of ['pc','mobile']){
   const m=JSON.parse(read('packages/common/'+app+'-runtime-manifest.json'));
   assert.ok(m.files.includes('olli-consultation-manual-summary-ui.js'));
   assert.ok(m.files.includes('olli-consultation-manual-summary-ui.css'));
   assert.match(read('apps/'+app+'/index.html'),/olli-consultation-manual-summary-ui\.js\?v=/);
 }
});

test('cron can only run in production with secret and explicit enable flag',()=>{
 const source=read('packages/common/api/_lib/consultation-summary-cron.cjs');
 assert.match(source,/CRON_SECRET/);
 assert.match(source,/OLLI_CONSULTATION_CRON_ENABLED/);
 assert.match(source,/VERCEL_ENV!=='production'/);
 assert.match(source,/summary\.runScheduled\(task\)/);
 assert.match(source,/return res\.status\(401\)/);
 assert.match(source,/p_limit:6/);
 const sql=read('supabase/migrations/20261024101500_consultation_server_cron.sql');
 assert.match(sql,/CRON_ROLE_DENIED/);
 assert.match(sql,/service_scheduler/);
 assert.match(sql,/current_setting\('request\.jwt\.claim\.role'/);
 assert.match(sql,/cron_candidates/);
 const config=JSON.parse(read('apps/mobile/vercel.json'));
 assert.ok(config.crons.some(x=>x.path==='/api/consultation-summary-cron'));
});

test('growth feedback target_month reaches the protected server storage layer on PC and mobile',()=>{
 for(const app of ['pc','mobile']) {
   const source=read('apps/'+app+'/olli-storage-core.js');
   const feature=source.slice(source.indexOf("feature: 'general_feedback'"),source.indexOf("feature: 'general_feedback'")+1800);
   assert.match(feature,/valueColumns:[^\n]*'target_month'/);
   assert.match(feature,/selectColumns:[^\n]*'target_month'/);
 }
 const sql=read('supabase/migrations/20261024110500_feedback_target_month_rpc.sql');
 assert.match(sql,/lesson_date, target_month, member_id/);
 assert.match(sql,/p_payload->>'target_month'/);
});

test('fresh PC and mobile HTML bypass stale runtime while old tabs require manual refresh',()=>{
 for(const app of ['pc','mobile']){
   const html=read('apps/'+app+'/index.html');
   const cfg=JSON.parse(read('apps/'+app+'/vercel.json'));
   assert.match(html,/olli-storage-core\.js\?v=20261024-target-month-save-2/);
   for(const source of ['/','/index.html']){
     const header=cfg.headers.find(x=>x.source===source);
     assert.match(header.headers.find(x=>x.key==='Cache-Control').value,/no-store/);
   }
 }
 assert.match(read('apps/pc/index.html'),/olli-data-feedback\.js\?v=20261024-target-month-save-2/);
 assert.match(read('apps/mobile/index.html'),/olli-student-core\.js\?v=20261024-exact-task-2/);
});

test('scheduler does not expire unfinished consultations after thirteen months',()=>{
 const s=read('supabase/migrations/20261024114000_consultation_cron_unfinished_carryover.sql');
 assert.match(s,/generate_series\(1,240\)/);
 assert.doesNotMatch(s,/interval '13 months'/);
 assert.match(s,/tracking_started_month/);
 assert.match(s,/completed/);
});

test('historical consultation adoption must match exact task identity',()=>{
 const sql=read('supabase/migrations/20261024130000_consultation_legacy_summary_adoption_guard.sql');
 assert.match(sql,/legacy_review_required/);
 assert.match(sql,/client_mutation_id='consultation:'/);
 assert.match(sql,/sf\.client_mutation_id is distinct from/);
 assert.match(sql,/last_error='LEGACY_SUMMARY_REVIEW'/);
 const handler=read('packages/common/api/_lib/consultation-summary-handler.cjs');
 assert.match(handler,/if\(status\.status==='legacy_review_required'\)/);
 assert.match(handler,/if\(claim\.status==='legacy_review_required'\)/);
});
