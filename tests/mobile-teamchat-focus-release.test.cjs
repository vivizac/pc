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

test('Team Chat composer taps do not mark chat gesture ownership',()=>{
  const initStart=js.indexOf('function init(){');
  const inputStart=js.indexOf("if (input) {",initStart);
  const inputEnd=js.indexOf("\n    if (mentionTriggerButton)",inputStart);
  assert.ok(initStart>=0 && inputStart>=0 && inputEnd>inputStart);
  const inputBody=js.slice(inputStart,inputEnd);

  assert.match(
    inputBody,
    /input\.addEventListener\('pointerdown', event => \{[\s\S]*event\.preventDefault\(\);[\s\S]*\}\);/
  );
  const pointerStart=inputBody.indexOf("input.addEventListener('pointerdown'");
  const pointerEnd=inputBody.indexOf("\n\n      if (composer)",pointerStart);
  assert.ok(pointerStart>=0 && pointerEnd>pointerStart);
  assert.doesNotMatch(inputBody.slice(pointerStart,pointerEnd),/input\.focus\(/);
  assert.match(
    inputBody,
    /input\.addEventListener\('click', \(\) => \{[\s\S]*input\.focus\(\{ preventScroll:true \}\)[\s\S]*renderOlliTalkMentionMenu\(\)/
  );
  assert.doesNotMatch(inputBody,/olliTalkChatGestureActive\s*=\s*true/);
  assert.doesNotMatch(inputBody,/settleOlliTalkChatGesture\(/);
});
