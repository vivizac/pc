const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const storage = fs.readFileSync(path.join(root,'olli-storage-core.js'),'utf8');
const attendance = fs.readFileSync(path.join(root,'olli-data-attendance-feedback.js'),'utf8');
const foundation = fs.readFileSync(path.join(root,'olli-data-foundation.js'),'utf8');
const vercel = fs.readFileSync(path.join(root,'vercel.json'),'utf8');

function featureBlock(feature){
  const start=storage.indexOf(`feature: '${feature}'`);
  assert.notEqual(start,-1,`${feature} missing`);
  const b0=storage.lastIndexOf('FeatureRegistry.register({',start);
  const b1=storage.indexOf('\n  });',start);
  return storage.slice(b0,b1+6);
}

test('mobile feedback features use account-session RPC transport',()=>{
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

test('mobile attendance feedback reads no longer use direct REST',()=>{
  assert.doesNotMatch(attendance,/supabase\('GET', buildAttendanceStudentFeedbackPath/);
  assert.match(attendance,/loadAttendanceFeedbackRowsSecure/);
});

test('mobile common feedback fallback carries stable mutation id',()=>{
  const matches=foundation.match(/client_mutation_id: commonRecordId/g)||[];
  assert.ok(matches.length >= 3);
});

test('mobile preview loads secured feedback policy from PC work branch',()=>{
  assert.match(vercel,/pc\/main\/olli-operations-feedback-policy\.js/);
  assert.doesNotMatch(vercel,/pc\/main\/olli-operations-feedback-policy\.js/);
});
