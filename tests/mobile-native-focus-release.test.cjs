'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const quick=fs.readFileSync(path.join(root,'apps/mobile/kinder-feedback.js'),'utf8');
const search=fs.readFileSync(path.join(root,'apps/mobile/olli-record-search-controls.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');

test('QuickNote opens its composer after release instead of pointerdown',()=>{
  const start=quick.indexOf("if (composerBottom) {");
  const end=quick.indexOf("\n  document.querySelectorAll('.kcfKeywordBtn')",start);
  assert.ok(start>=0 && end>start);
  const body=quick.slice(start,end);

  assert.match(body,/composerBottom\.addEventListener\('click'/);
  assert.doesNotMatch(body,/composerBottom\.addEventListener\('pointerdown'/);
  assert.match(body,/openKinderChatFeedbackComposerSheet\(\)/);
});

test('Observation record search suppresses closed-state pointer focus and opens on click',()=>{
  const start=search.indexOf('function bindRecordSearchInput()');
  const end=search.indexOf('\nfunction initRecordSearchHandlers()',start);
  assert.ok(start>=0 && end>start);
  const body=search.slice(start,end);

  assert.match(body,/input\.addEventListener\('pointerdown',[\s\S]*if \(isRecordSearchOpen\(\)\) return;[\s\S]*event\.preventDefault\(\)/);
  assert.match(body,/input\.addEventListener\('click', openRecordSearchFromInputFallback, true\)/);
  assert.match(search,/function openRecordSearchFromInputFallback\(event\)[\s\S]*handleSearchPillClick\(event\)/);
});

test('Native-focus timing changes use fresh mobile cache keys',()=>{
  assert.match(html,/kinder-feedback\.js\?v=20261008-native-focus-1/);
  assert.match(html,/olli-record-search-controls\.js\?v=20261008-native-focus-1/);
});
