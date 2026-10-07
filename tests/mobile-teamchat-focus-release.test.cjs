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

test('Team Chat composer and mention button share the same click-time focus helper',()=>{
  const helperStart=js.indexOf('function focusOlliTalkComposerInput(){');
  const helperEnd=js.indexOf('\n  async function openOlliTalkMentionPicker',helperStart);
  assert.ok(helperStart>=0 && helperEnd>helperStart);
  const helper=js.slice(helperStart,helperEnd);
  assert.match(helper,/input\.focus\(\{ preventScroll:true \}\)/);

  const initStart=js.indexOf('function init(){');
  const inputStart=js.indexOf("if (input) {",initStart);
  const inputEnd=js.indexOf("\n    if (mentionTriggerButton)",inputStart);
  const inputBody=js.slice(inputStart,inputEnd);
  assert.doesNotMatch(inputBody,/input\.addEventListener\('pointerdown'/);
  assert.match(inputBody,/input\.addEventListener\('click',[\s\S]*focusOlliTalkComposerInput\(\)/);
  assert.match(js,/mentionTriggerButton\.addEventListener\('click', openOlliTalkMentionPicker\)/);
  assert.match(js,/async function openOlliTalkMentionPicker\(event\)[\s\S]*focusOlliTalkComposerInput\(\)/);
});
