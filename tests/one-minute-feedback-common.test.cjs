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

test('common registration uses selected student identity and body-only input', () => {
  assert.match(registration, /function getKcfSelectedStudent\(\)/);
  assert.match(registration, /getKinderChatFeedbackManualSelection/);
  assert.match(registration, /KcfAutoMode\.getSelection/);
  assert.doesNotMatch(registration, /첫 줄에는 학생 이름을/);
  assert.doesNotMatch(registration, /input\.value = \(student\.name/);
  const submitStart = registration.indexOf('window.submitKinderChatFeedback = async function');
  const submitEnd = registration.indexOf('window.openKinderChatFeedbackSaveStudentPicker', submitStart);
  const submit = registration.slice(submitStart, submitEnd);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  assert.doesNotMatch(submit, /parseKinderChatFeedbackInput/);
  assert.match(submit, /compactCommand === '가이드'/);
  assert.match(submit, /compactCommand === '가이드삭제'/);
  assert.match(submit, /compactCommand === '가이드숨김'/);
  assert.match(submit, /KcfAutoMode\.isEditing/);
  assert.match(submit, /getKcfSelectedStudent\(\)/);
  assert.match(registration, /userText: text/);
});
