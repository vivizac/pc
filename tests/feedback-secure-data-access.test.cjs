const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const storage = fs.readFileSync(path.join(root,'olli-storage-core.js'),'utf8');
const attendance = fs.readFileSync(path.join(root,'olli-data-attendance-feedback.js'),'utf8');
const settings = fs.readFileSync(path.join(root,'olli-settings-storage.js'),'utf8');
const policy = fs.readFileSync(path.join(root,'olli-operations-feedback-policy.js'),'utf8');
const foundation = fs.readFileSync(path.join(root,'olli-data-foundation.js'),'utf8');

function featureBlock(feature){
  const start=storage.indexOf(`feature: '${feature}'`);
  assert.notEqual(start,-1,`${feature} missing`);
  const b0=storage.lastIndexOf('FeatureRegistry.register({',start);
  const b1=storage.indexOf('\n  });',start);
  return storage.slice(b0,b1+6);
}

test('feedback read/write/edit/delete features use session RPC transport',()=>{
  const expected={
    general_feedback:'olli_general_feedback_data_access',
    growth_feedback:'olli_growth_feedback_data_access',
    summary_feedback:'olli_summary_feedback_data_access',
    general_feedback_edit:'olli_general_feedback_data_access',
    growth_feedback_edit:'olli_growth_feedback_data_access',
    summary_feedback_edit:'olli_summary_feedback_data_access',
    summary_feedback_by_id_delete:'olli_summary_feedback_data_access',
    general_feedbacks_by_student_delete:'olli_general_feedback_data_access',
    growth_feedbacks_by_student_delete:'olli_growth_feedback_data_access',
    summary_feedbacks_by_student_delete:'olli_summary_feedback_data_access',
    general_feedback_records_read:'olli_general_feedback_data_access',
    growth_feedback_records_read:'olli_growth_feedback_data_access',
    summary_feedback_records_read:'olli_summary_feedback_data_access'
  };
  Object.entries(expected).forEach(([feature,rpc])=>{
    const block=featureBlock(feature);
    assert.match(block,/transport: 'session_rpc'/);
    assert.match(block,new RegExp(`rpc: '${rpc}'`));
  });
});

test('attendance and settings feedback reads no longer use direct table REST',()=>{
  assert.doesNotMatch(attendance,/supabase\('GET', buildAttendanceStudentFeedbackPath/);
  assert.match(attendance,/loadAttendanceFeedbackRowsSecure/);
  assert.doesNotMatch(settings,/supabase\('GET', `feedbacks\?select=/);
  assert.doesNotMatch(settings,/supabase\('GET', `summary_feedbacks\?select=/);
  assert.match(settings,/loadSettingsBackupFeedbackRowsSecure/);
});

test('idempotent feedback wrapper uses account-session RPCs',()=>{
  assert.doesNotMatch(policy,/olli_feedback_insert_idempotent|olli_growth_feedback_insert_idempotent|olli_summary_feedback_insert_idempotent/);
  assert.match(policy,/olli_general_feedback_data_access/);
  assert.match(policy,/olli_growth_feedback_data_access/);
  assert.match(policy,/olli_summary_feedback_data_access/);
  assert.match(policy,/p_session_token: getFeedbackAccountSessionToken\(\)/);
  assert.match(policy,/p_action: 'write'/);
  assert.match(policy,/p_operation: 'post'/);
});

test('common feedback fallback carries stable client mutation id',()=>{
  const matches=foundation.match(/client_mutation_id: commonRecordId/g)||[];
  assert.ok(matches.length >= 3);
});


test('secure RPC authorization failures are not retried',()=>{
  assert.match(policy,/nonRetryableCodes = new Set/);
  assert.match(policy,/'SESSION_INVALID'/);
  assert.match(policy,/'PERMISSION_DENIED'/);
  assert.match(policy,/'ACADEMY_MISMATCH'/);
  assert.match(policy,/'STUDENT_NOT_FOUND'/);
  assert.match(policy,/nonRetryableCodes\.has\(code\)/);
});
