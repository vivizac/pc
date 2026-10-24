'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const api=read('packages/common/api/_lib/consultation-summary-handler.cjs');
const client=read('packages/common/olli-consultation-progress-client.js');
const ui=read('packages/common/olli-consultation-manual-summary-ui.js');
const pc=read('apps/pc/pc-student-management.js');
const mobile=read('apps/mobile/olli-student-core.js');
const migration=read('supabase/migrations/20261025111000_consultation_legacy_candidates_owner_review.sql');
test('owner candidates are strictly read-only; period and ownership rules remain enforced',()=>{
  assert.match(migration,/m\.role in \('owner','super_admin'\)/);
  assert.match(migration,/not exists\(select 1 from public\.olli_consultation_summary_jobs j/);
  assert.match(migration,/sf\.summary_months=v_rule_months/);
  assert.match(migration,/sf\.created_at>=v_due-interval '1 month'/);
  assert.doesNotMatch(migration,/(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)\s+public\.(?:summary_feedbacks|olli_consultation_summary_jobs)/i);
  assert.match(migration,/to service_role/);
});
test('server only reads candidates and verifies the original due month for linking',()=>{
  assert.match(api,/action==='legacy_candidates'\s*\|\|\s*action==='link_legacy'/);
  assert.match(api,/verifyDue\(ownerStudent\[0\],rule,parseMonth\(dueMonth\)\)/);
  assert.match(api,/olli_consultation_legacy_summary_candidates/);
  assert.match(api,/confirmExactRecord!==true/);
  assert.match(api,/p_confirm_exact_record:true/);
});
test('both applications can request an owner-confirmed link; no readiness inferred from candidate match',()=>{
  assert.match(client,/async listLegacyCandidates\(/);
  assert.match(client,/async linkLegacySummary\(/);
  assert.match(client,/confirmExactRecord:true/);
  assert.match(client,/async checkSummaryStatus\(/);
  assert.match(ui,/checkbox\.checked/);
  assert.match(ui,/checkSummaryStatus\(\{id:studentId\},task\)/);
  assert.match(pc,/openLegacyReview/);
  assert.match(mobile,/listLegacyCandidates\(student\.id,task\.key\)/);
  assert.ok(mobile.indexOf('listLegacyCandidates(student.id,task.key)')<mobile.indexOf('const result=await fetchConsultationSummaryFromServer(student,task)'));
});
