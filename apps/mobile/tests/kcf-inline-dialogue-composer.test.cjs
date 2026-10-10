const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const sheet = read('kcf-teacher-sheet.js');
const css = read('kcf-teacher-sheet.css');
const input = read('kinder-feedback.js');
const registration = read('olli-feedback-registration-phone-adapter.js');
const baseCss = read('kinder-feedback.css');
const roster = read('kcf-auto-mode-runtime.js');
const html = read('index.html');

test('dialogue activates the original inline input; continuous keeps the original sheet', () => {
  assert.match(sheet, /if \(state\.composerMode !== 'continuous'\) return openInline\(event\)/);
  assert.match(sheet, /keyboard\.activate\(event, \{\s*input:input/);
  assert.match(sheet, /mountRoster\(\);\s*mountSheetControls\(\)/);
  assert.doesNotMatch(roster, /global\.KcfTeacherSheet\.open\(event\)/);
  assert.match(sheet, /state\.inlineOpen && state\.composerMode === 'continuous'/);
  assert.match(sheet, /state\.open && state\.composerMode === 'dialogue'/);
});

test('inline editor starts five rows tall and keeps original draft, roster and button elements', () => {
  assert.match(sheet, /input\.rows = 5/);
  assert.match(sheet, /input\.readOnly = false/);
  assert.match(sheet, /input\.rows = 1/);
  assert.match(input, /kcfInlineDialogueActive'\) \? 128 : 34/);
  assert.match(sheet, /bottom\.insertBefore\(roster, document\.getElementById\('kcfVoiceBtn'\)\)/);
  assert.match(sheet, /restoreInlineRoster\(\)/);
  assert.match(css, /grid-template-rows:128px 34px/);
  for (const [selector, column] of [
    ['.kcfAttachBtn', 1],
    ['.kcfComposerBottom > .kcfAutoStudentRoster', 2],
    ['.kcfComposerModeBtn', 3],
    ['.kcfVoiceBtn', 4],
    ['.kcfSendBtn', 5]
  ]) {
    const start = css.lastIndexOf('#kinderChatFeedbackScreen.kcfInlineDialogueActive ' + selector + ' {');
    assert.notEqual(start, -1, 'missing inline layout for ' + selector);
    assert.match(css.slice(start, start + 190), new RegExp('grid-column:' + column));
  }
});

test('keyboard follows only the inline composer; chat scroll changes only with new messages', () => {
  assert.match(css, /kcfInlineDialogueActive \.kcfComposerLayer \{[\s\S]*?--kcf-inline-vv-height/);
  assert.match(css, /kcfInlineDialogueActive \.kcfChatArea \{\s*padding-bottom:var\(--kcf-inline-chat-reserve/);
  assert.doesNotMatch(css, /kcfInlineDialogueActive \.kcfChatArea \{[^}]*transform:/);
  assert.match(sheet, /Extra scrollable space is only used when a message arrives/);
  assert.match(input, /area\.scrollTop = area\.scrollHeight/);
});

test('modified QuickNote assets are cache-busted', () => {
  for (const name of ['kinder-feedback.js', 'kcf-auto-mode-runtime.js']) {
    assert.ok(html.includes(name + '?v=20261010-inline-dialogue-1'), name);
  }
  assert.ok(html.includes('kcf-teacher-sheet.js?v=20261010-continuous-folded-1'));
});

test('mode button toggles immediately and shows the active mode label without a popup', () => {
  assert.match(sheet, /setComposerMode\(state\.composerMode === 'dialogue' \? 'continuous' : 'dialogue', event\)/);
  assert.match(sheet, /label\.textContent = continuous \? '연속기록' : '대화'/);
  assert.match(sheet, /btn\.setAttribute\('aria-label', continuous \? '대화로 전환' : '연속기록으로 전환'\)/);
  assert.doesNotMatch(sheet, /kcfComposerModeMenu|closeModeMenus|aria-haspopup|aria-expanded/);
  assert.ok(sheet.includes('<svg class="kcfModeChevron" viewBox="0 0 24 24" aria-hidden="true">'));
  assert.ok(sheet.includes('<path d="m6 9 6 6 6-6"></path></svg>'));
  assert.match(css, /\.kcfModeChevron\{flex:0 0 13px;width:13px;height:13px/);
  assert.doesNotMatch(css, /kcfComposerModeMenu|kcfComposerModeOption/);
  const footer = css.split('.kcfTeacherSheetBottom {')[1]?.split('}')[0] || '';
  assert.ok(footer.includes('gap:4px;'));
  assert.ok(css.includes('#kcfTeacherSheetModeHost{flex:0 0 auto;margin-left:8px;margin-right:0;}'));
  assert.ok(css.includes('#kcfTeacherSheetVoiceHost{flex:0 0 33px;margin-right:0;}'));
  assert.ok(html.includes('kcf-teacher-sheet.css?v=20261010-continuous-footer-align-1'));
});

test('inline QuickNote height morph matches TeamChat easing without changing keyboard or message motion', () => {
  assert.match(sheet, /function animateInlineComposer\(composer, fromHeight\)/);
  assert.match(sheet, /duration:190, easing:'cubic-bezier\(\.2,\.65,\.2,1\)'/);
  assert.match(sheet, /prefers-reduced-motion: reduce/);
  assert.match(sheet, /previous\.cancel\(\)/);
  assert.match(sheet, /animation\.addEventListener\('finish', finish/);
  assert.match(sheet, /animation\.addEventListener\('cancel', finish/);
  assert.match(sheet, /function openInline\(event\)[\s\S]*?animateInlineComposer\(composer, fromHeight\);[\s\S]*?keyboard\.activate/);
  assert.match(sheet, /function closeInline\(options\)[\s\S]*?animateInlineComposer\(composer, fromHeight\);/);
  assert.match(sheet, /input\.rows = 5/);
  assert.match(sheet, /input\.rows = 1/);
  assert.doesNotMatch(sheet.slice(sheet.indexOf('function animateInlineComposer'), sheet.indexOf('function openInline')), /scrollTop|\.kcfChatArea|transform/);
});

test('continuous-record mode button uses active dialogue footer position', () => {
  const footer = css.split('.kcfTeacherSheetBottom {')[1]?.split('}')[0] || '';
  assert.ok(footer.includes('--kcf-dialogue-matched-bottom:calc(var(--olli-phone-guide-bottom, max(10px, env(safe-area-inset-bottom))) + 6px);'));
  assert.match(footer, /flex:0 0 calc\(40px \+ var\(--kcf-dialogue-matched-bottom\)\)/);
  assert.match(footer, /height:calc\(40px \+ var\(--kcf-dialogue-matched-bottom\)\)/);
  assert.ok(footer.includes('padding:0 calc(var(--olli-phone-guide-x, 16px) + 10px) var(--kcf-dialogue-matched-bottom);'));
  assert.ok(css.includes('#kcfTeacherSheetModeHost{flex:0 0 auto;margin-left:8px;margin-right:0;}'));
  assert.ok(css.includes('#kcfTeacherSheetVoiceHost{flex:0 0 33px;margin-right:0;}'));
  assert.match(css, /#kinderChatFeedbackScreen\.kcfInlineDialogueActive \.kcfComposerBottom \{[^}]*column-gap:4px/);

  // The two modes anchor the *right edge* of the same button identically.
  // In dialogue: guide inset + 1px border + 9px padding + send/mic + gaps.
  // In continuous: guide inset + 10px footer padding + send/mic + gaps.
  for (const guideInset of [10, 16, 22, 28]) {
    const dialogueRight = guideInset + 1 + 9 + 33 + 4 + 33 + 4;
    const continuousRight = guideInset + 10 + 33 + 4 + 33 + 4;
    assert.equal(continuousRight, dialogueRight);
  }
  // Both vertically center a 33px button at the same distance above the keyboard.
  for (const phoneGuideBottom of [1, 10, 16, 34]) {
    const dialogueBottom = phoneGuideBottom + 1 + 8 + (34 - 33) / 2;
    const continuousBottom = phoneGuideBottom + 6 + (40 - 38) / 2 + (38 - 33) / 2;
    assert.equal(continuousBottom, dialogueBottom);
  }
});

test('continuous feedback starts folded and returns from editor with all rows collapsed', () => {
  assert.match(sheet, /if \(continuous && !wasContinuous\) document\.body\.classList\.add\('kcfContinuousFeedbackFolded'\)/);
  assert.match(sheet, /if \(state\.composerMode === 'continuous'\) \{\s*global\.foldPhoneKcfContinuousFeedback\?\.\(\)/);
  assert.match(registration, /function foldPhoneKcfContinuousFeedback\(\)/);
  assert.match(registration, /row\.classList\.remove\('kcfContinuousFeedbackExpanded'\)/);
  assert.match(registration, /row\.dataset\.kcfContinuousReady = '1'/);
  assert.match(registration, /row\.classList\.toggle\('kcfContinuousFeedbackExpanded', !folded\)/);
  assert.match(registration, /row\.classList\.toggle\('kcfContinuousFeedbackExpanded'\)/);
  assert.match(baseCss, /body\.kcfContinuousMode #kinderChatFeedbackScreen \.kcfLiveResponseRow \.kcfLiveBubble,/);
});

test('continuous mode hides global collect/expand while dialogue keeps it', () => {
  assert.match(registration, /toggle\.hidden = continuous \|\| !hasPhoneKcfGeneratedFeedback\(\)/);
  assert.match(registration, /if \(continuous\) return; \/\/ No global collect\/expand button/);
  assert.match(baseCss, /body\.kcfContinuousMode #kinderChatFeedbackScreen \.kcfFeedbackCollectToggleBtn,/);
  assert.match(registration, /document\.body\.classList\.toggle\('kcfFeedbackCollectView'\)/);
  assert.ok(html.includes('olli-feedback-registration-phone-adapter.js?v=20261010-continuous-folded-1'));
  assert.ok(html.includes('kinder-feedback.css?v=20261010-continuous-folded-1'));
});

test('only successful dialogue feedback submission closes the inline input and keyboard', () => {
  assert.match(sheet, /function onSuccessfulSubmit\(\)\{\s*if \(state\.composerMode === 'continuous'\) return;/);
  assert.match(sheet, /if \(state\.inlineOpen\) closeInline\(\);/);
  assert.match(sheet, /else if \(state\.open\) close\(\{ sync:false \}\);/);
  assert.match(sheet, /function closeInline\(options\)[\s\S]*?document\.activeElement === input\) input\.blur\(\)/);
});
