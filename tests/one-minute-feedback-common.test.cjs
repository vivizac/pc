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

test('common registration keeps selected-student flow while phone may opt into inline student-name feedback', () => {
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
  assert.match(submit, /window\.__olliCommandsMovedToTalk !== true/);
  assert.match(submit, /if \(!selectedStudent\)/);
  assert.match(submit, /아직 이 문장은 실행 가능한 명령으로 연결되지 않았어요/);
  assert.match(registration, /window\.submitKinderChatFeedbackCommandChoice = async function/);
  assert.match(registration, /userText: text/);
});

test('phone inline student-name feedback is opt-in and reuses the existing AI submit path', () => {
  assert.match(registration, /function resolveKcfInlineFeedbackTarget\(text\)/);
  assert.match(registration, /names\.sort\(function\(a, b\)\{ return b\.length - a\.length; \}\)/);
  assert.match(registration, /var candidates = findKcfStudentsByName\(matchedName\);/);
  assert.match(registration, /ambiguous:candidates\.length > 1/);

  const submitStart = registration.indexOf('window.submitKinderChatFeedback = async function');
  const submitEnd = registration.indexOf('window.submitKinderChatFeedbackCommandChoice', submitStart);
  const submit = registration.slice(submitStart, submitEnd);
  assert.match(submit, /window\.__olliPhoneInlineStudentFeedbackEnabled === true/);
  assert.match(submit, /var feedbackText = text;/);
  assert.match(submit, /resolveKcfInlineFeedbackTarget\(text\)/);
  assert.match(submit, /feedbackText = inlineTarget\.body/);
  assert.match(submit, /continueKinderChatFeedbackSubmit\(feedbackText, selectedStudent, autoSubmitContext\)/);
  assert.match(submit, /openKinderChatFeedbackSaveStudentPicker\('', inlineTarget\.candidates/);
  assert.match(submit, /학생 이름 다음에 수업기록을 적어주세요/);
});


test('existing same-name picker supports inline feedback submit mode without duplicating UI', () => {
  assert.match(registration, /window\.openKinderChatFeedbackSaveStudentPicker = function\(itemId, candidates, options\)/);
  assert.match(registration, /var mode = opts\.mode === 'submit' \? 'submit' : 'save';/);
  assert.match(registration, /피드백을 보낼 학생을 선택해 주세요/);
  assert.match(registration, /mode === 'submit' \? '피드백 전송' : '기록실 저장'/);
  assert.match(registration, /pending\.mode === 'submit'/);
  assert.match(registration, /await continueKinderChatFeedbackSubmit\(submitText, student, pending\.autoSubmitContext \|\| null\)/);
  assert.doesNotMatch(registration, /Teacher에서 학생을 선택한 뒤 보내주세요/);
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


test('AI response aliases are restored from request-bound student identity before queue save', () => {
  assert.match(runtime, /function getFeedbackDisplayStudentName\(name\)/);
  assert.match(runtime, /function restoreFeedbackStudentAliases\(text, studentName\)/);
  assert.match(runtime, /output = output\.replace\(\/학생\\s\*A\/g, displayName\)/);
  assert.match(runtime, /output = output\.replace\(\/학생\\s\*\[B-Z\]\/g, '다른 친구'\)/);
  assert.match(runtime, /const restoredText = restoreFeedbackStudentAliases\(parsed\.cleanText, item\.studentName\)/);
  assert.match(runtime, /resultText: restoredText/);
});


test('one-minute feedback guarantees an AI request and falls back to the phone LIVE transport', () => {
  assert.match(registration, /function startKcfFeedbackRequestGuaranteed\(requestOptions, canUseKinderChatLive\)/);
  assert.match(registration, /typeof window\.startTodayFeedbackRequest === 'function'/);
  assert.match(registration, /typeof window\.startKinderChatFeedbackLiveRequest === 'function'/);
  assert.match(registration, /requestContent: buildKcfDirectLiveRequestContent/);
  assert.match(registration, /var feedbackItem = startKcfFeedbackRequestGuaranteed\(requestOptions, canUseKinderChatLive\)/);
  assert.match(registration, /if \(!feedbackItem\) throw new Error\('1분 피드백 AI 요청을 시작하지 못했습니다\.'\)/);
});

test('one-minute feedback keeps the typed record when AI request startup fails', () => {
  const submitStart = registration.indexOf('window.submitKinderChatFeedback = async function');
  const submitEnd = registration.indexOf('window.submitKinderChatFeedbackCommandChoice', submitStart);
  const submit = registration.slice(submitStart, submitEnd);
  assert.match(submit, /try \{\s*await continueKinderChatFeedbackSubmit/);
  assert.match(submit, /AI 연결에 실패했어요\. 수업기록은 그대로 두었으니 다시 전송해 주세요\./);
});


test('one-minute completion waits for AI result instead of request start', () => {
  const submitStart = registration.indexOf('function continueKinderChatFeedbackSubmit');
  const submitEnd = registration.indexOf('window.submitKinderChatFeedback = async function', submitStart);
  const submitFlow = registration.slice(submitStart, submitEnd);
  assert.doesNotMatch(submitFlow, /markKcfStudentFeedbackSent/);

  assert.match(runtime, /function notifyKcfFeedbackRequestResult\(item, status, errorMessage = ''\)/);
  assert.match(runtime, /notifyKcfFeedbackRequestResult\(item, completedStatus\)/);
  assert.match(runtime, /notifyKcfFeedbackRequestResult\(item, 'error', errorMessage\)/);
  assert.match(runtime, /onFeedbackRequestResult/);
});


test('suspicious feedback detector includes malformed Unicode replacement characters', () => {
  assert.match(runtime, /function getSuspiciousFeedbackPattern\(\)/);
  assert.match(runtime, /\\uFFFD\+/);
  assert.match(runtime, /\\uD800-\\uDFFF/);
  assert.match(runtime, /const pattern = getSuspiciousFeedbackPattern\(\)/);
});
