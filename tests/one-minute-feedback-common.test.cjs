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

test('common registration keeps AUTO, student command, popup selection, and direct-name submit in one owner', () => {
  assert.match(registration, /function getKcfSelectedStudent\(\)/);
  assert.match(registration, /getKinderChatFeedbackManualSelection/);
  assert.match(registration, /KcfAutoMode\.getSelection/);
  assert.match(registration, /function parseKcfTypedStudentInput\(text\)/);
  assert.match(registration, /findKcfStudentsByName\(typedInput\.studentName\)/);
  assert.match(registration, /typedCandidates\.length === 1/);
  assert.match(registration, /openKinderChatFeedbackSaveStudentPicker\('', typedCandidates, 'submit'/);
  assert.match(registration, /text === '학생'/);
  assert.match(registration, /openKinderChatFeedbackStudentManagePopup\(\)/);
  assert.match(registration, /window\.selectKinderChatFeedbackStudentFromManage = function/);

  const submitStart = registration.indexOf('window.submitKinderChatFeedback = async function');
  const submitEnd = registration.indexOf('window.openKinderChatFeedbackSaveStudentPicker', submitStart);
  const submit = registration.slice(submitStart, submitEnd);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  assert.match(submit, /compactCommand === '가이드'/);
  assert.match(submit, /compactCommand === '가이드삭제'/);
  assert.match(submit, /compactCommand === '가이드숨김'/);
  assert.match(submit, /KcfAutoMode\.isEditing/);
  assert.match(submit, /captureSubmitContext/);
  assert.match(submit, /getKcfSelectedStudent\(\)/);
  assert.match(submit, /!selectedStudent && !\(autoSubmitContext && autoSubmitContext\.enabled\)/);
  assert.match(submit, /parseKcfTypedStudentInput\(text\)/);
  assert.match(submit, /input\.value = text/);
  assert.match(registration, /userText: text/);
});

test('direct-name parser requires a first-line name and preserves body-only feedback', () => {
  const parserStart = registration.indexOf('function parseKcfTypedStudentInput(text)');
  const parserEnd = registration.indexOf('function getKcfSelectedStudent()', parserStart);
  const parser = registration.slice(parserStart, parserEnd);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  assert.match(parser, /normalized\.indexOf\('\\n'\)/);
  assert.match(parser, /normalized\.slice\(0, firstBreak\)/);
  assert.match(parser, /normalized\.slice\(firstBreak \+ 1\)/);
});
