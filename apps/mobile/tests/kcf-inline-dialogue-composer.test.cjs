const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const sheet = read('kcf-teacher-sheet.js');
const css = read('kcf-teacher-sheet.css');
const baseCss = read('kinder-feedback.css');
const input = read('kinder-feedback.js');
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
  assert.ok(html.includes('kcf-teacher-sheet.js?v=20261010-mode-chevron-1'));
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
  assert.ok(html.includes('kcf-teacher-sheet.css?v=20261010-align-active-buttons-1'));
});

test('QuickNote active mic and send align with idle right and bottom offsets', () => {
  assert.match(baseCss, /#kinderChatFeedbackScreen \.kcfComposer \{[^}]*padding:4px 11px 3px;/);
  assert.match(baseCss, /#kinderChatFeedbackScreen \.kcfVoiceBtn \{[^}]*margin-right:12px;/);
  assert.match(css, /#kinderChatFeedbackScreen\.kcfInlineDialogueActive \.kcfComposer \{[^}]*padding:7px 11px 5px;/);
  assert.match(css, /grid-template-columns:33px minmax\(0, 1fr\) max-content 45px 33px;/);
  assert.match(css, /#kinderChatFeedbackScreen\.kcfInlineDialogueActive \.kcfVoiceBtn \{[^}]*margin:0;/);
  const idleMicToSend = 4 + 12;
  const activeMicToSend = 4 + (45 - 33);
  assert.equal(idleMicToSend, activeMicToSend);
  const idleBottomToCenter = 1 + 3 + (47 - 2 - 4 - 3 - 34) / 2 + 34 / 2;
  const activeBottomToCenter = 1 + 5 + 34 / 2;
  assert.equal(idleBottomToCenter, activeBottomToCenter);
});
