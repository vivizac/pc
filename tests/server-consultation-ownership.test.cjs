const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const api=read('apps/mobile/api/consultation-summary.js');
const pc=read('apps/pc/olli-data-consultation-summary.js');
const mobile=read('apps/mobile/olli-student-core.js');
const client=read('packages/common/olli-consultation-progress-client.js');
const pcRuntime=read('apps/pc/olli-consultation-runtime.js');
const mobileRuntime=read('apps/mobile/olli-consultation-mobile-runtime.js');
const migration=read('supabase/migrations/20261023193000_consultation_server_source_of_truth.sql');

function getHelpers() {
  const js=api.replace('export default async function handler','async function handler')
    .replace('export const __test =','const __test =');
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
test('elementary annual summary requires March or April final growth (2 other records not sufficient)',()=>{
 const h=getHelpers(),due=h.parseMonth('2026-04');
 const row=(date,feedback_type='growth')=>({date,feedback_type,content:'growth example'});
 const prior=[row('2025-06-20'),row('2025-09-13'),row('2025-12-12')];
 assert.equal(h.relevantRows(prior,[],'elementary','every_12',due,12).status,'insufficient');
 const march=h.relevantRows([...prior,row('2026. 3. 28.')],[],'elementary','every_12',due,12);
 assert.equal(march.status,'ready');
 assert.equal(h.relevantRows([...prior,row('2026-04-08')],[],'elementary','every_12',due,12).status,'ready');
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
   assert.match(code,/fetchConsultationSummaryFromServer/);
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
 assert.match(mobileRuntime,/getThisMonthConsultationDueStudents/);
 assert.match(mobileRuntime,/previousMobileAcademyRenderer/);
 assert.match(pc,/pendingGeneration/);
 assert.match(mobile,/pendingGeneration/);
 assert.match(mobileRuntime,/toggleAcademyConsultationCompleted/);
 assert.match(mobileRuntime,/loadOlliConsultationProgressFromServer/);
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
 assert.match(proxy,/vivizac-feedback\.vercel\.app\/api\/consultation-summary/);
 assert.doesNotMatch(proxy,/api\.openai\.com/);
 assert.match(api,/oll[i]_\S*consultation_summary_job_access/);
});
