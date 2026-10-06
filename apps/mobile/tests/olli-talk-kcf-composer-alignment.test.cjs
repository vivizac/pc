const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const kcf = fs.readFileSync(path.join(root, 'kinder-feedback.css'), 'utf8');
const talk = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
const observation = fs.readFileSync(path.join(root, 'olli-observation-roster-phone.css'), 'utf8');
const base = fs.readFileSync(path.join(root, 'olli-phone-base.css'), 'utf8');

test('QuickNote and Team Chat composers share top-button horizontal edges and observation bottom baseline', () => {
  for (const source of [kcf, talk]) {
    assert.match(source, /left:var\(--olli-phone-guide-x, ?16px\)/);
    assert.match(source, /right:var\(--olli-phone-guide-x, ?16px\)/);
    assert.match(source, /bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\)/);
    assert.match(source, /width:auto/);
    assert.match(source, /max-width:none/);
    assert.match(source, /padding:0/);
  }
});

test('QuickNote and Team Chat default composer heights match the 47px Observation roster search shell', () => {
  assert.match(base, /--olli-phone-bottom-control-height:\s*47px;/);
  assert.match(observation, /\.memoRosterSearchPill,[\s\S]*?height:var\(--olli-phone-bottom-control-height, 47px\) !important;[\s\S]*?min-height:var\(--olli-phone-bottom-control-height, 47px\) !important;/);
  assert.match(kcf, /\.kcfComposer \{[\s\S]*?height:var\(--olli-phone-bottom-control-height, 47px\);[\s\S]*?min-height:var\(--olli-phone-bottom-control-height, 47px\);[\s\S]*?max-height:var\(--olli-phone-bottom-control-height, 47px\);[\s\S]*?box-sizing:border-box;/);
  assert.match(talk, /\.olliTalkBetaComposer\{[\s\S]*?height:var\(--olli-phone-bottom-control-height, 47px\);[\s\S]*?min-height:var\(--olli-phone-bottom-control-height, 47px\);[\s\S]*?max-height:var\(--olli-phone-bottom-control-height, 47px\);[\s\S]*?box-sizing:border-box;/);
  assert.match(kcf, /kcfKeyboardOpen \.kcfComposer:not\(\.kcfVoiceCaptureMode\)[\s\S]*?height:auto;[\s\S]*?max-height:none;/);
  assert.match(talk, /olliTalkKeyboardOpen \.olliTalkBetaComposer\{[\s\S]*?height:auto;[\s\S]*?max-height:none;/);
});


test('QuickNote and Team Chat center their one-line composer controls vertically', () => {
  assert.match(kcf, /\.kcfComposer \{[\s\S]*?flex-direction:column;[\s\S]*?justify-content:center;/);
  assert.match(kcf, /kcfKeyboardOpen \.kcfComposer:not\(\.kcfVoiceCaptureMode\),[\s\S]*?justify-content:flex-start;/);
  assert.match(kcf, /\.kcfComposerBottom \{[\s\S]*?display:flex;[\s\S]*?align-items:center;/);
  assert.match(talk, /\.olliTalkBetaComposer\{[\s\S]*?height:var\(--olli-phone-bottom-control-height, 47px\);[\s\S]*?align-items:center;/);
  assert.match(talk, /olliTalkKeyboardOpen \.olliTalkBetaComposer\{[\s\S]*?height:auto;[\s\S]*?align-items:flex-end;/);
});
test('Olli Talk microphone matches the QuickNote microphone size and icon treatment', () => {
  assert.match(talk, /\.olliTalkBetaVoiceBtn\{[\s\S]*?width:33px;[\s\S]*?height:33px;/);
  assert.match(talk, /\.olliTalkBetaVoiceBtn svg\{[\s\S]*?width:26px;[\s\S]*?height:26px;[\s\S]*?stroke-width:1\.9/);
  assert.match(talk, /\.olliTalkBetaVoiceBtn\.active\{[\s\S]*?background:#0A84FF;[\s\S]*?color:#fff/);
  assert.match(kcf, /\.kcfVoiceBtn \{[\s\S]*?width:33px;[\s\S]*?height:33px;/);
  assert.match(kcf, /\.kcfVoiceBtn svg \{[\s\S]*?width:26px;[\s\S]*?height:26px;[\s\S]*?stroke-width:1\.9/);
  assert.match(kcf, /\.kcfVoiceBtn\.active \{[\s\S]*?background:#0A84FF;[\s\S]*?color:#fff/);
});

test('Olli Talk input left inset follows 1-minute feedback input inset', () => {
  assert.match(talk, /\.olliTalkBetaInput\{[\s\S]*?min-height:34px;[\s\S]*?padding:5px 2px 3px;/);
  assert.match(kcf, /\.kcfInput \{[\s\S]*?min-height:34px;[\s\S]*?padding:5px 2px 3px;/);
});


test('QuickNote and Team Chat no longer own a separate keyboard-open shadow', () => {
  for (const source of [kcf, talk]) {
    assert.doesNotMatch(source, /KeyboardOpen[\s\S]*?0 -10px 28px rgba\(0,0,0,0?\.035\)/);
  }
});
