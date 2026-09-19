const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const runtime = fs.readFileSync('olli-feedback-runtime.js', 'utf8');
const registration = fs.readFileSync('olli-feedback-registration-runtime.js', 'utf8');

test('common feedback runtime owns queue/API behavior without wrapper replacement', () => {
  assert.doesNotMatch(runtime, /function wrapFunction\(name, validator\)/);
  assert.doesNotMatch(runtime, /installFeedbackInputGuards/);
  assert.match(runtime, /KcfAutoMode\.filterFeedbackItems/);
  assert.match(runtime, /KcfAutoMode\.shouldDiscardFeedbackJob/);
  assert.match(runtime, /getMemoFeedbackArchiveEditFeature/);
  assert.match(runtime, /options\.student_id/);
  assert.match(runtime, /function buildTodayFeedbackRequestContent/);
  assert.match(runtime, /fetch\('\/api\/chat'/);
});

test('common registration allows name-free natural language and keeps student selection only for feedback context', () => {
  assert.match(registration, /function getKcfSelectedStudent\(\)/);
  assert.match(registration, /getKinderChatFeedbackManualSelection/);
  assert.match(registration, /KcfAutoMode\.getSelection/);
  assert.doesNotMatch(registration, /function parseKcfTypedStudentInput\(text\)/);
  assert.doesNotMatch(registration, /typedCandidates/);
  assert.doesNotMatch(registration, /학생 이름 다음 줄에 수업기록을 적어주세요/);
  assert.doesNotMatch(registration, /학생을 먼저 선택해 주세요/);
  assert.match(registration, /text === '학생'/);
  assert.match(registration, /openKinderChatFeedbackStudentManagePopup\(\)/);
  assert.match(registration, /window\.selectKinderChatFeedbackStudentFromManage = function/);

  const submitStart = registration.indexOf('window.submitKinderChatFeedback = async function');
  const submitEnd = registration.indexOf('window.openKinderChatFeedbackSaveStudentPicker', submitStart);
  const submit = registration.slice(submitStart, submitEnd);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  assert.match(submit, /compactCommand === '가이드'/);
  assert.match(submit, /KcfAutoMode\.isEditing/);
  assert.match(submit, /captureSubmitContext/);
  assert.match(submit, /getKcfSelectedStudent\(\)/);
  assert.match(submit, /if \(!selectedStudent\)/);
  assert.match(submit, /아직 이 문장은 실행 가능한 명령으로 연결되지 않았어요/);
  assert.match(registration, /window\.submitKinderChatFeedbackCommandChoice = async function/);
  assert.match(registration, /userText: text/);
});

test('legacy first-line submit picker path is removed', () => {
  assert.doesNotMatch(registration, /mode === 'submit'/);
  assert.doesNotMatch(registration, /pending\.mode === 'submit'/);
  assert.doesNotMatch(registration, /submitPayload/);
  assert.match(registration, /기록실 저장/);
});


test('shared registration no longer owns phone keyboard dismissal', () => {
  assert.doesNotMatch(registration, /function completeKcfInlineSubmit/);
  assert.doesNotMatch(registration, /onKinderChatFeedbackInlineSubmitComplete/);
});


test('one-minute feedback prompt is selected by purpose, not student division', () => {
  const fn = registration.match(/function getKcfStudentPromptType\(student, feedbackType\)\{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(fn, /feedbackType \|\| 'class'/);
  assert.match(fn, /return 'fail';/);
  assert.match(fn, /return 'class';/);
  assert.doesNotMatch(fn, /elementary/);
});

test('shared selected student context keeps id name and division together', () => {
  assert.match(registration, /window\.__kcfSelectedStudentId = id;/);
  assert.match(registration, /window\.__kcfSelectedStudentName = name;/);
  assert.match(registration, /window\.__kcfSelectedStudentDivision = division;/);
  assert.match(registration, /window\.__kcfSelectedStudentDivision = '';/);
});
