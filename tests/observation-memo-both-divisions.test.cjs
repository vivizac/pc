const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const session = fs.readFileSync('observation-memo-session-common.js', 'utf8');
const common = fs.readFileSync('observation-memo-common.js', 'utf8');

test('shared observation session accepts elementary and kinder with compatible draft key', () => {
  assert.match(session, /!\['elementary', 'kinder'\]\.includes\(session\.type\)/);
  assert.match(session, /noteType: getSupabaseNoteDraftType\(student\) \|\| 'elementary_observation'/);
  assert.match(session, /localEntry: getObservationMemoLocalSnapshot\(student\)/);
  assert.match(session, /type: session\.type/);
});

test('shared observation editor autosaves both divisions', () => {
  assert.match(common, /\['elementary', 'kinder'\]\.includes\(currentMemoType\)/);
  assert.match(common, /return \['elementary', 'kinder'\]\.includes\(currentMemoType\) \? currentMemoType : '';/);
  assert.match(common, /!\['elementary', 'kinder'\]\.includes\(currentMemoType\)/);
});

test('shared observation shell renders both divisions and hides elementary analysis for kinder', () => {
  assert.match(common, /!\['elementary', 'kinder'\]\.includes\(session\.type\)/);
  assert.match(common, /setAttribute\('data-current-memo-type', session\.type\)/);
  assert.match(common, /const isElementary = session\.type === 'elementary';/);
  assert.match(common, /analysisBtn\.hidden = !isElementary;/);
  assert.match(common, /memoType !== 'elementary'/);
});
