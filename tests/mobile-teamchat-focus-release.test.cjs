'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('Team Chat only settles a gesture that actually started in chatArea',()=>{
  const start=js.indexOf('const settleOlliTalkChatGesture');
  const end=js.indexOf("\n    if (input) {",start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);

  assert.match(
    body,
    /const endOlliTalkChatGesture = \(\) => \{[\s\S]*if \(!olliTalkChatGestureActive\) return;[\s\S]*settleOlliTalkChatGesture\(180\);[\s\S]*\};/
  );
  assert.match(body,/chatArea\.addEventListener\('pointerdown', beginOlliTalkChatGesture/);
  assert.match(body,/chatArea\.addEventListener\('touchstart', beginOlliTalkChatGesture/);
  assert.match(body,/window\.addEventListener\('pointerup', endOlliTalkChatGesture/);
  assert.match(body,/window\.addEventListener\('touchend', endOlliTalkChatGesture/);
});

test('Team Chat inactive input and mention button use the shared mobile keyboard activation core',()=>{
  assert.match(js,/function activateOlliTalkComposerInput\(event\)[\s\S]*window\.OlliMobileKeyboardActivation[\s\S]*keyboard\.activate\(event/);
  assert.doesNotMatch(js,/function stopOlliTalkComposerActivationEvent/);
  assert.doesNotMatch(js,/stopOlliTalkComposerActivationEvent\(event\)/);
  assert.match(js,/if \(olliTalkMentionModeActive\) \{[\s\S]*OlliMobileKeyboardActivation\?\.stopEvent\(event\)[\s\S]*olliTalkMentionModeActive = false/);
  assert.doesNotMatch(js,/function focusOlliTalkComposerInput/);
  assert.match(js,/composerActivateButton\.addEventListener\('click',[\s\S]*activateOlliTalkComposerInput\(event\)/);
  assert.match(js,/mentionTriggerButton\.addEventListener\('click', openOlliTalkMentionPicker\)/);
  assert.match(js,/async function openOlliTalkMentionPicker\(event\)[\s\S]*activateOlliTalkComposerInput\(event\)/);
});
