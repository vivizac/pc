const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const baseJs = fs.readFileSync('kinder-feedback.js', 'utf8');
const teacherJs = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const adapter = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');
const runtime = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');

test('normal QuickNote input is only a read-only launcher for the shared sheet', () => {
  assert.match(html, /id="kcfInput"[^>]*readonly/);
  assert.doesNotMatch(baseJs, /kcfKeyboardOpen/);
  assert.doesNotMatch(baseJs, /updateKinderChatFeedbackKeyboardOffset/);
  const pointer = baseJs.match(/input\.addEventListener\('pointerdown',[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(pointer, /window\.KcfComposerSheet \|\| window\.KcfTeacherSheet/);
  assert.match(pointer, /event\.preventDefault\(\)/);
  assert.match(pointer, /sheet\.open\(\)/);
});

test('normal and Class modes share the same flat QuickNote sheet', () => {
  assert.match(html, /kcf-teacher-sheet\.css\?v=20261001-unified-sheet-1/);
  assert.match(html, /kcf-teacher-sheet\.js\?v=20261001-unified-sheet-1/);
  assert.match(teacherJs, /global\.KcfComposerSheet = api/);
  assert.match(teacherCss, /\.kcfTeacherSheet \{[\s\S]*?border-radius:0;/);
  assert.match(teacherCss, /\.kcfTeacherSheetOverlay\.show \.kcfTeacherSheet/);
});

test('Teacher sheet mirrors existing inline text in both directions', () => {
  assert.match(teacherJs, /function syncToBase\(\)/);
  assert.match(teacherJs, /target\.value = source\.value/);
  assert.match(teacherJs, /target\.dispatchEvent\(new Event\('input'/);
  assert.match(teacherJs, /function syncFromBase\(options\)/);
  assert.match(teacherJs, /if \(target\.value !== source\.value\) target\.value = source\.value/);
  assert.match(runtime, /var teacherPrefill = inputBeforeTeacher \? String\(inputBeforeTeacher\.value \|\| ''\) : ''/);
  assert.match(runtime, /input\.value = teacherPrefill/);
});

test('iOS accessory Done cancels by blur while Enter remains a normal newline', () => {
  assert.doesNotMatch(teacherJs, /enterkeyhint="done"/);
  assert.doesNotMatch(teacherJs, /input\.addEventListener\('keydown'/);
  const blur = teacherJs.match(/input\.addEventListener\('blur',[\s\S]*?\n      \}\);/)?.[0] || '';
  assert.match(blur, /state\.open && !state\.submitting/);
  assert.match(blur, /syncToBase\(\)/);
  assert.match(blur, /close\(\{ sync:false \}\)/);
  assert.doesNotMatch(blur, /submitKinderChatFeedback/);
});

test('Teacher send closes the sheet only after successful submit', () => {
  const pointer = teacherJs.match(/send\.addEventListener\('pointerdown',[\s\S]*?\n      \}\);/)?.[0] || '';
  const click = teacherJs.match(/send\.addEventListener\('click',[\s\S]*?\n      \}\);/)?.[0] || '';
  assert.match(pointer, /event\.preventDefault\(\)/);
  assert.match(click, /await global\.submitKinderChatFeedback\(\)/);
  assert.match(teacherJs, /function onSuccessfulSubmit\(\)[\s\S]*?close\(\{ sync:false \}\)/);
  assert.match(runtime, /completeSuccessfulSubmit\(context\)[\s\S]*?global\.KcfTeacherSheet\.onSuccessfulSubmit\(\)/);
  assert.doesNotMatch(adapter, /closeComposerAfterSuccessfulSubmit/);
  assert.doesNotMatch(adapter, /__olliPhoneSubmitCloseInstalled/);
});

test('shared sheet exposes Class mode control and the existing feedback submit source', () => {
  assert.match(html, /id="kcfTeacherBtn"[^>]*>Class<\/button>/);
  assert.match(teacherJs, /id="kcfTeacherSheetModeBtn"/);
  assert.match(teacherJs, /modeBtn\.textContent = enabled \? 'C' : 'Class'/);
  assert.match(teacherJs, /id="kcfTeacherSheetSendBtn"/);
  assert.match(teacherJs, /toggleKinderChatFeedbackTeacherMode/);
});


test('tapping the inline input opens the shared sheet regardless of Class mode state', () => {
  const pointer = baseJs.match(/input\.addEventListener\('pointerdown',[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.doesNotMatch(pointer, /teacherMode\.isEnabled\(\)/);
  assert.match(pointer, /event\.preventDefault\(\)/);
  assert.match(pointer, /sheet\.open\(\)/);
});


test('successful send close does not write the submitted text back over the next student state', () => {
  assert.match(teacherJs, /suppressBlurSync:false/);
  assert.match(teacherJs, /if \(!state\.suppressBlurSync\) syncToBase\(\)/);
  assert.match(teacherJs, /state\.suppressBlurSync = !shouldSync/);
  assert.match(teacherJs, /function onSuccessfulSubmit\(\)[\s\S]*?close\(\{ sync:false \}\)/);
});


test('Teacher scroll lock mirrors the feedback edit sheet behavior', () => {
  assert.match(teacherCss, /html\.kcfTeacherSheetOpen,[\s\S]*?body\.kcfTeacherSheetOpen \{[\s\S]*?width:100%;[\s\S]*?height:100%;[\s\S]*?overflow:hidden !important;[\s\S]*?overscroll-behavior:none;/);
  assert.match(teacherJs, /function preventTeacherBackgroundTouchMove\(event\)/);
  assert.match(teacherJs, /document\.addEventListener\('touchmove', preventTeacherBackgroundTouchMove, \{ capture:true, passive:false \}\)/);
  assert.match(teacherJs, /kcfAutoStudentRosterScroller/);
});

test('Teacher student cards keep the selectable pill UI inside the rebuilt sheet', () => {
  assert.match(teacherCss, /\.kcfTeacherSheetRosterHost \.kcfAutoStudentChip \{[\s\S]*?border-radius:999px;/);
  assert.match(teacherCss, /\.kcfTeacherSheetRosterHost \.kcfAutoStudentChip\.selected \{[\s\S]*?color:#1677ff;[\s\S]*?border:1px solid #1677ff;/);
  assert.doesNotMatch(teacherCss, /kcfAutoTeacherLabel/);
});


test('Teacher hides the underlying feedback page and restores it when closed', () => {
  assert.match(teacherCss, /body\.kcfTeacherSheetOpen #kcfPersistentTopLayer,[\s\S]*?body\.kcfTeacherSheetOpen #kinderChatFeedbackScreen \.kcfInner \{[\s\S]*?visibility:hidden !important;[\s\S]*?opacity:0 !important;/);
  assert.match(teacherJs, /document\.body\.classList\.add\('kcfTeacherSheetOpen'\)/);
  assert.match(teacherJs, /document\.body\.classList\.remove\('kcfTeacherSheetOpen'\)/);
});

test('Teacher action row sits directly above the keyboard without safe-area padding', () => {
  assert.match(teacherCss, /\.kcfTeacherSheetBody \{[\s\S]*?padding:8px 16px 0;/);
  assert.match(teacherCss, /\.kcfTeacherSheetBottom \{[\s\S]*?flex:0 0 40px;[\s\S]*?height:40px;[\s\S]*?padding:0;/);
  assert.doesNotMatch(teacherCss, /safe-area-inset-bottom/);
});


test('Class sheet send button matches the normal QuickNote send button size', () => {
  assert.match(teacherCss, /\.kcfTeacherSheetSendBtn \{[\s\S]*?width:33px;[\s\S]*?height:33px;[\s\S]*?min-width:33px;/);
  assert.match(teacherCss, /\.kcfTeacherSheetSendBtn svg \{[\s\S]*?width:21px;[\s\S]*?height:21px;/);
});
