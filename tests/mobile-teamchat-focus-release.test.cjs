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

test('Team Chat inactive input and mention button share one controlled activation pipeline',()=>{
  assert.match(js,/function stopOlliTalkComposerActivationEvent\(event\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)/);
  assert.match(js,/function activateOlliTalkComposerInput\(event\)[\s\S]*stopOlliTalkComposerActivationEvent\(event\)[\s\S]*focusOlliTalkComposerInput\(\)[\s\S]*resizeInput\(\)[\s\S]*updateOlliTalkBetaComposerState\(\)[\s\S]*syncViewport\(\)/);
  assert.match(js,/composerActivateButton\.addEventListener\('click',[\s\S]*activateOlliTalkComposerInput\(event\)/);
  assert.match(js,/mentionTriggerButton\.addEventListener\('click', openOlliTalkMentionPicker\)/);
  assert.match(js,/async function openOlliTalkMentionPicker\(event\)[\s\S]*activateOlliTalkComposerInput\(event\)/);

  const initStart=js.indexOf('function init(){');
  const inputStart=js.indexOf("if (input) {",initStart);
  const inputEnd=js.indexOf("\n    if (composerActivateButton)",inputStart);
  assert.ok(initStart>=0 && inputStart>=0 && inputEnd>inputStart);
  const inputBody=js.slice(inputStart,inputEnd);
  assert.doesNotMatch(inputBody,/input\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(inputBody,/input\.addEventListener\('click',[\s\S]*focusOlliTalkComposerInput/);
  assert.match(inputBody,/input\.addEventListener\('click', renderOlliTalkMentionMenu\)/);
});
