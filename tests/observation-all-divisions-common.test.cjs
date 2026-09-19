const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const session = fs.readFileSync('observation-memo-session-common.js', 'utf8');
const common = fs.readFileSync('observation-memo-common.js', 'utf8');
const history = fs.readFileSync('observation-memo-version-history-common.js', 'utf8');

test('observation session accepts elementary and kinder with compatibility note type', () => {
  assert.match(session, /noteType: 'elementary_observation'/);
  assert.match(session, /localEntry: getObservationMemoLocalSnapshot\(student\)/);
  assert.match(session, /if \(!session \|\| !session\.student\) return null;/);
  assert.doesNotMatch(session, /session\.type !== 'elementary'/);
});

test('observation editor autosave guards accept both divisions', () => {
  assert.match(common, /\['elementary', 'kinder'\]\.includes\(String\(currentMemoType \|\| ''\)\)/);
  assert.match(common, /return \['elementary', 'kinder'\]\.includes\(String\(currentMemoType \|\| ''\)\) \? currentMemoType : '';/);
  assert.doesNotMatch(common, /currentMemoType !== 'elementary'/);
});

test('observation shell renders kinder but hides elementary analysis controls', () => {
  assert.match(common, /data-current-memo-type', session\.type === 'kinder' \? 'kinder' : 'elementary'/);
  assert.match(common, /analysisBtn\.style\.display = isElementary \? 'inline-flex' : 'none'/);
  assert.match(common, /analysisBlock\.style\.display = isElementary \? '' : 'none'/);
});

test('version history can resolve either observation division', () => {
  assert.match(history, /\['elementary', 'kinder'\]\.includes\(String\(global\.currentMemoType \|\| ''\)\)/);
});
