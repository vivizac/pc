const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const base = fs.readFileSync(path.join(root, 'olli-phone-base.css'), 'utf8');
const controls = fs.readFileSync(path.join(root, 'olli-phone-control-style.css'), 'utf8');
const kcf = fs.readFileSync(path.join(root, 'kinder-feedback.css'), 'utf8');
const observation = fs.readFileSync(path.join(root, 'olli-observation-roster-phone.css'), 'utf8');
const talk = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
const recordSearch = fs.readFileSync(path.join(root, 'olli-record-search-controls.css'), 'utf8');
const attendance = fs.readFileSync(path.join(root, 'olli-attendance-record.css'), 'utf8');
const recordSearchJs = fs.readFileSync(path.join(root, 'olli-record-search-controls.js'), 'utf8');

test('phone edge controls use the shared left right top and bottom guides', () => {
  assert.match(base, /--olli-phone-guide-x:\s*max\(16px,/);
  assert.match(base, /--olli-phone-guide-top:\s*max\(18px,/);
  assert.match(base, /--olli-phone-guide-bottom:\s*max\(10px, env\(safe-area-inset-bottom\)\)/);
  assert.match(base, /--olli-phone-guide-center-x:\s*50%/);
  assert.match(base, /--olli-phone-control-size:\s*44px/);
  assert.doesNotMatch(controls, /--olli-phone-guide-bottom\s*:/);

  assert.match(kcf, /\.kcfHeaderCenter\{[\s\S]*left:var\(--olli-phone-guide-center-x\);[\s\S]*top:var\(--olli-phone-guide-top\)/);
  assert.match(kcf, /\.kcfComposerWrap \{[\s\S]*left:var\(--olli-phone-guide-x, 16px\);[\s\S]*right:var\(--olli-phone-guide-x, 16px\);[\s\S]*bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\)/);

  assert.match(observation, /\.observationWorkTabs \{[\s\S]*left:var\(--olli-phone-guide-center-x\);[\s\S]*top:var\(--olli-phone-guide-top\);[\s\S]*translateX\(-50%\)/);
  assert.match(observation, /\.memoRosterUtilityBar \{[\s\S]*left:var\(--olli-phone-guide-x\) !important;[\s\S]*right:var\(--olli-phone-guide-x\) !important;[\s\S]*bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\) !important/);
  assert.match(observation, /\.memoBottomBar \{[\s\S]*left:var\(--olli-phone-guide-x\);[\s\S]*bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\)/);
  assert.match(observation, /#memoFeedbackBtn \{[\s\S]*right:var\(--olli-phone-guide-x\);[\s\S]*bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\)/);
  assert.match(observation, /#memoEditorUtilityGroup \{[\s\S]*left:var\(--olli-phone-guide-center-x\);[\s\S]*bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\);[\s\S]*transform:translateX\(-50%\)/);

  assert.match(talk, /\.olliTalkBetaTitleWrap\{[\s\S]*left:var\(--olli-phone-guide-center-x\);[\s\S]*top:calc\(var\(--olli-phone-guide-top\) \+ 22px\)/);
  assert.match(talk, /\.olliTalkBetaComposerWrap\{[\s\S]*left:var\(--olli-phone-guide-x,16px\);[\s\S]*right:var\(--olli-phone-guide-x,16px\);[\s\S]*bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\)/);
  assert.match(talk, /\.olliTalkArchiveTitle\{[^\n]*left:var\(--olli-phone-guide-center-x\);[^\n]*top:calc\(var\(--olli-phone-guide-top\) \+ 22px\)/);
  assert.match(talk, /\.olliTalkArchiveUploadBtn\{[^\n]*left:var\(--olli-phone-guide-x,16px\);right:var\(--olli-phone-guide-x,16px\);bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\)/);
  assert.match(talk, /\.olliTalkPhotoViewerHeader\{[^\n]*padding:var\(--olli-phone-guide-top\) var\(--olli-phone-guide-x,16px\) 14px/);
  assert.match(talk, /\.olliTalkPhotoViewerActions\{[^\n]*bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\);[^\n]*justify-content:center;[^\n]*padding:0 var\(--olli-phone-guide-x,16px\)/);
});

test('keyboard-open controls keep their temporary keyboard-relative baseline', () => {
  assert.match(kcf, /kcfKeyboardOpen \.kcfComposerWrap \{\s*bottom:4px/);
  assert.match(talk, /olliTalkKeyboardOpen \.olliTalkBetaComposerWrap\{\s*bottom:4px/);
  assert.match(observation, /observation-keyboard-open \.memoRosterUtilityBar \{[\s\S]*bottom:4px !important/);
});

test('attendance and academy NOTE positioning remain intentional exceptions', () => {
  assert.match(recordSearch, /\.recordRoomScreenFloatingBar\{[\s\S]*left:18px ;[\s\S]*right:18px ;[\s\S]*bottom:0 ;/);
  assert.match(recordSearch, /left:calc\(var\(--record-control-rail-edge-x, 276px\) - 47px\)/);
  assert.match(recordSearchJs, /const fixedEdgeX = 276;/);
  assert.match(attendance, /#recordRoomScreen \.recordAcademyBackBtn\{[^}]*right:0;[^}]*top:var\(--olli-phone-guide-top, 22px\)/);
});


test('edge-guide cache keys load the corrected bottom baseline', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /kinder-feedback\.css\?v=20260927-bottom-height47-5/);
  assert.match(html, /olli-talk-beta\.css\?v=20260927-bottom-height47-24/);
  assert.match(html, /olli-observation-roster-phone\.css\?v=20260927-bottom-height47-4/);
});


test('legacy phone guide variable names are fully retired from loaded guide owners', () => {
  const combined = [base, controls, kcf, observation, talk, recordSearch, attendance].join('\n');
  for (const legacy of [
    '--vivizac-memo-shell-x',
    '--vivizac-memo-top-y',
    '--vivizac-memo-bottom-y',
    '--olli-phone-bottom-control-y',
    '--vivizac-top-h'
  ]) {
    assert.equal(combined.includes(legacy), false, legacy + ' must not remain');
  }
});
