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
  assert.ok(html.includes('kcf-teacher-sheet.js?v=20261010-stable-caret-keyboard-glass-1'));
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
  assert.ok(css.includes('#kcfTeacherSheetModeHost{flex:0 0 auto;margin-left:8px;margin-right:12px;}'));
  assert.ok(css.includes('#kcfTeacherSheetVoiceHost{flex:0 0 33px;margin-right:12px;}'));
  assert.ok(html.includes('kcf-teacher-sheet.css?v=20261010-stable-caret-keyboard-glass-1'));
});

test('dialogue opens without animating the focused textarea ancestor', () => {
  const opener = sheet.split('function openInline(event){')[1]?.split('function closeInline(options){')[0] || '';
  const closer = sheet.split('function closeInline(options){')[1]?.split('function open(event){')[0] || '';
  assert.doesNotMatch(opener, /animateInlineComposer\(composer, fromHeight\)/);
  assert.match(closer, /animateInlineComposer\(composer, fromHeight\)/);
  assert.match(opener, /previous\.cancel\(\)/);
  assert.match(css, /animation:kcfInlineGlassExpand 190ms cubic-bezier\(\.2,\.65,\.2,1\) both/);
  assert.match(css, /@keyframes kcfInlineGlassExpand/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(sheet, /input\.rows = 5/);
  assert.match(sheet, /input\.rows = 1/);
});

test('continuous footer matches original controls and plus has no focus chrome', () => {
  const footer = css.split('.kcfTeacherSheetBottom {')[1]?.split('}')[0] || '';
  assert.match(footer, /flex:0 0 40px;/);
  assert.match(footer, /height:40px;/);
  assert.match(footer, /padding:0 11px;/);
  assert.doesNotMatch(footer, /--kcf-dialogue-matched-bottom/);
  assert.ok(css.includes('#kcfTeacherSheetModeHost{flex:0 0 auto;margin-left:8px;margin-right:12px;}'));
  assert.ok(css.includes('#kcfTeacherSheetVoiceHost{flex:0 0 33px;margin-right:12px;}'));
  const plus = css.split('body.kcfContinuousMode #kcfTeacherSheetOverlay .kcfAttachBtn {')[1]?.split('}')[0] || '';
  assert.match(plus, /outline:0;/);
  assert.match(plus, /box-shadow:none;/);
  assert.match(plus, /filter:none;/);
});

test('active dialogue glass is less transparent and caret stays in normal textarea geometry', () => {
  const active = css.split('#kinderChatFeedbackScreen.kcfInlineDialogueActive .kcfComposer {')[1]?.split('}')[0] || '';
  assert.match(active, /background:transparent;/);
  assert.match(active, /height:183px;/);
  const glass = css.split('#kinderChatFeedbackScreen.kcfInlineDialogueActive .kcfComposer::before {')[1]?.split('}')[0] || '';
  assert.match(glass, /background:rgba\(255,255,255,\.96\)/);
  assert.match(glass, /backdrop-filter:blur\(22px\)/);
  assert.match(glass, /pointer-events:none;/);
  const textarea = css.split('#kinderChatFeedbackScreen.kcfInlineDialogueActive .kcfInput {')[1]?.split('}')[0] || '';
  assert.match(textarea, /text-align:left;/);
  assert.match(textarea, /text-indent:0;/);
  assert.match(sheet, /input\.setSelectionRange\(0, 0\); input\.scrollTop = 0;/);
});

test('iOS input gets final grid and viewport geometry before native focus', () => {
  const opener = sheet.split('function openInline(event){')[1]?.split('function closeInline(options){')[0] || '';
  const iFocus = opener.indexOf('keyboard.activate(event, {');
  for (const step of ["placeModeButton(screen.querySelector('.kcfComposerBottom'))",
    'mountInlineRoster();', 'teacherMode?.refreshRoster?.();',
    'global.autoResizeKinderChatFeedbackInput?.(input);',
    'syncViewport();', 'input.getBoundingClientRect();']) {
    assert.ok(opener.indexOf(step) >= 0 && opener.indexOf(step) < iFocus, step);
  }
  assert.match(opener, /return !!activated;/);
  const closer = sheet.split('function closeInline(options){')[1]?.split('function open(event){')[0] || '';
  for (const field of ['--kcf-inline-vv-left', '--kcf-inline-vv-top', '--kcf-inline-vv-width', '--kcf-inline-vv-height']) {
    assert.ok(closer.includes(field), 'stale viewport cleared: ' + field);
  }
  assert.match(closer, /layer\.style\.removeProperty\(name\)/);
});

test('active mic/send controls match the idle layout and keyboard assistant inset', () => {
  assert.match(css, /#kinderChatFeedbackScreen\.kcfInlineDialogueActive \.kcfComposerWrap \{\s*bottom:1px;/);
  assert.match(css, /#kinderChatFeedbackScreen\.kcfInlineDialogueActive \.kcfComposer \{[^}]*padding:7px 11px 5px;/);
  assert.match(css, /grid-template-columns:33px minmax\(0, 1fr\) max-content 45px 33px/);
  assert.equal(4 + 12, 4 + (45 - 33));
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
  assert.ok(html.includes('olli-feedback-registration-phone-adapter.js?v=20261010-olli-integrated-1'));
  assert.ok(html.includes('kinder-feedback.css?v=20261010-hide-active-collect-toggle-1'));
});

test('collect/expand controls hide only while the normal dialogue input is active', () => {
  assert.match(sheet, /screen\.classList\.add\('kcfInlineDialogueActive'\)/);
  assert.match(sheet, /screen\.classList\.remove\('kcfInlineDialogueActive'\)/);
  assert.match(baseCss, /body:not\(\.kcfContinuousMode\) #kinderChatFeedbackScreen\.kcfInlineDialogueActive \.kcfFeedbackCollectToggleBtn,/);
  assert.match(baseCss, /#kinderChatFeedbackScreen \.kcfFeedbackCollectToggleBtn\[hidden\],/);
  assert.match(registration, /toggle\.hidden = continuous \|\| !hasPhoneKcfGeneratedFeedback\(\)/);
});

test('only successful dialogue feedback submission closes the inline input and keyboard', () => {
  assert.match(sheet, /function onSuccessfulSubmit\(\)\{\s*if \(state\.composerMode === 'continuous'\) return;/);
  assert.match(sheet, /if \(state\.inlineOpen\) closeInline\(\);/);
  assert.match(sheet, /else if \(state\.open\) close\(\{ sync:false \}\);/);
  assert.match(sheet, /function closeInline\(options\)[\s\S]*?document\.activeElement === input\) input\.blur\(\)/);
});
