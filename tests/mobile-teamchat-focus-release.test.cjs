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
  assert.match(js,/async function runOlliTalkComposerControl\(event, options = \{\}\)[\s\S]*const useMention = options\.mention === true[\s\S]*activateOlliTalkComposerInput\(event\)[\s\S]*renderOlliTalkMentionMenu\(\)[\s\S]*loadOlliTalkMembers\(\)[\s\S]*syncViewport\(\)/);
  assert.match(js,/if \(useMention && olliTalkMentionModeActive\)[\s\S]*clearOlliTalkMentionDraft\(\)[\s\S]*input\.blur\(\)/);
  assert.match(js,/if \(useMention\) \{[\s\S]*olliTalkMentionModeActive = true[\s\S]*input\.setRangeText\(insertion/);
  assert.match(js,/function runOlliTalkComposerActivation\(event, mode\)[\s\S]*runOlliTalkComposerControl\(event, \{ mention:mode === 'mention' \}\)/);
  assert.match(js,/function bindOlliTalkComposerActivationControl\(target, mode\)[\s\S]*target\.addEventListener\('click'[\s\S]*runOlliTalkComposerActivation\(event, mode\)/);
  assert.match(js,/bindOlliTalkComposerActivationControl\(composerActivateButton, 'input'\)/);
  assert.match(js,/bindOlliTalkComposerActivationControl\(mentionTriggerButton, 'mention'\)/);
  assert.doesNotMatch(js,/composerActivateButton\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(js,/mentionTriggerButton\.addEventListener\('pointerdown'/);
  assert.match(js,/async function openOlliTalkMentionPicker\(event\)[\s\S]*runOlliTalkComposerControl\(event, \{ mention:true \}\)/);
});

test('Team Chat shared activation captures motion positions before keyboard focus',()=>{
  const start=js.indexOf('async function runOlliTalkComposerControl(event, options = {}){');
  const end=js.indexOf('\n  function runOlliTalkComposerActivation',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);
  const before=body.indexOf('const activationMotionFrame = captureOlliTalkKeyboardVisualFrame();');
  const focus=body.indexOf('const activated = activateOlliTalkComposerInput(event);');
  const animate=body.indexOf('preserveOlliTalkKeyboardVisualFrame(activationMotionFrame);',focus);
  const waiting=body.indexOf('await loadOlliTalkMembers();');
  assert.ok(before>=0 && before<focus);
  assert.ok(animate>focus && waiting>animate);
  assert.match(body,/if \(useMention && olliTalkMentionModeActive\)[\s\S]*preserveOlliTalkKeyboardVisualFrame\(activationMotionFrame\)/);
  assert.match(js,/bindOlliTalkComposerActivationControl\(composerActivateButton, 'input'\)/);
  assert.match(js,/bindOlliTalkComposerActivationControl\(mentionTriggerButton, 'mention'\)/);
});
