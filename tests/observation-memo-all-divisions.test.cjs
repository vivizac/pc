const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const session=fs.readFileSync('observation-memo-session-common.js','utf8');
const common=fs.readFileSync('observation-memo-common.js','utf8');

test('shared observation session prepares both elementary and kinder',()=>{
  assert.match(session,/\['elementary', 'kinder'\]\.includes\(session\.type\)/);
  assert.match(session,/localEntry: getObservationMemoLocalSnapshot\(student\)/);
  assert.match(session,/noteType: getSupabaseNoteDraftType\(student\) \|\| 'elementary_observation'/);
});

test('shared observation editor autosaves both divisions',()=>{
  assert.match(common,/\['elementary', 'kinder'\]\.includes\(currentMemoType\)/);
  assert.match(common,/return \['elementary', 'kinder'\]\.includes\(currentMemoType\) \? currentMemoType : '';/);
});

test('shared observation screen allows kinder while keeping analysis elementary-only',()=>{
  assert.match(common,/!\['elementary', 'kinder'\]\.includes\(session\.type\)/);
  assert.match(common,/setAttribute\('data-current-memo-type', session\.type\)/);
  assert.match(common,/analysisBtn\.style\.display = session\.type === 'elementary' \? 'inline-flex' : 'none'/);
});
