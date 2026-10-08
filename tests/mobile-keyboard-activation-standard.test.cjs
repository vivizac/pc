'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const core=read('apps/mobile/olli-mobile-keyboard-activation.js');
const html=read('apps/mobile/index.html');
const talk=read('apps/mobile/olli-talk-beta.js');
const record=read('apps/mobile/olli-record-search-controls.js');
const quick=read('apps/mobile/kinder-feedback.js');
const quickCss=read('apps/mobile/kinder-feedback.css');
const teacher=read('apps/mobile/kcf-teacher-sheet.js');

test('mobile keyboard activation core owns stop, preventScroll focus, and activation order',()=>{
  assert.match(core,/function stopEvent\(event\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)/);
  assert.match(core,/function focus\(input, options\)[\s\S]*target\.focus\(\{ preventScroll:true \}\)/);
  assert.match(core,/function activate\(event, options\)[\s\S]*stopEvent\(event\)[\s\S]*beforeFocus[\s\S]*focus\(opts\.input, opts\)[\s\S]*afterFocus/);
});

test('Team Chat composer activation uses the shared core',()=>{
  assert.match(talk,/function activateOlliTalkComposerInput\(event\)[\s\S]*OlliMobileKeyboardActivation[\s\S]*keyboard\.activate\(event/);
  assert.doesNotMatch(talk,/function stopOlliTalkComposerActivationEvent/);
  assert.doesNotMatch(talk,/function focusOlliTalkComposerInput/);
});

test('Observation search activates from its button and has no input fallback or dedicated focus helper',()=>{
  assert.match(record,/function handleSearchPillClick\(event\)[\s\S]*OlliMobileKeyboardActivation[\s\S]*keyboard\.activate\(event,[\s\S]*input:getRecordSearchInput/);
  assert.doesNotMatch(record,/function focusRecordSearchInput/);
  assert.doesNotMatch(record,/openRecordSearchFromInputFallback/);
  assert.doesNotMatch(record,/input\.addEventListener\('click'/);
});

test('QuickNote inline input activates from a button click and sheets use the shared core once on open',()=>{
  assert.match(html,/id="kcfInputActivateBtn"[^>]*type="button"/);
  assert.match(quickCss,/\.kcfInputActivateBtn\s*\{[\s\S]*position:absolute;[\s\S]*inset:0/);
  assert.match(quick,/inputActivateButton\.addEventListener\('click',[\s\S]*openKinderChatFeedbackComposerSheet\(event\)/);
  assert.doesNotMatch(quick,/composerBottom\.addEventListener\('pointerdown'/);
  for(const source of [teacher]){
    const openStart=source.indexOf('function open(event)');
    const openEnd=source.indexOf('\n  function close(options)',openStart);
    assert.ok(openStart>=0 && openEnd>openStart);
    const openBody=source.slice(openStart,openEnd);
    assert.match(openBody,/OlliMobileKeyboardActivation[\s\S]*keyboard\.activate\(event/);
    assert.doesNotMatch(openBody,/setTimeout\(focusEditor, 40\)/);
    assert.doesNotMatch(openBody,/requestAnimationFrame\([\s\S]*focusEditor\(\)/);
  }
});

test('shared keyboard activation script loads before every consumer',()=>{
  const coreIndex=html.indexOf('olli-mobile-keyboard-activation.js?v=20261008-standard-1');
  assert.ok(coreIndex>=0);
  for(const token of [
    'kinder-feedback.js?v=20261008-continuous-1',
    'olli-talk-beta.js?v=20261008-visible-motion-1',
    'olli-record-search-controls.js?v=20261008-keyboard-standard-1',
    'kcf-teacher-sheet.js?v=20261008-continuous-1'
  ]){
    const index=html.indexOf(token);
    assert.ok(index>coreIndex, token+' must load after keyboard core');
  }
});
