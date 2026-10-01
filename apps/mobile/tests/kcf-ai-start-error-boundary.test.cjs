const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = fs.readFileSync('../../packages/common/olli-feedback-registration-runtime.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('QuickNote reports AI connection failure only before request acceptance', () => {
  const start = runtime.indexOf('async function continueKinderChatFeedbackSubmit');
  const end = runtime.indexOf('window.submitKinderChatFeedback = async function', start);
  const submit = runtime.slice(start, end);

  const requestAt = submit.indexOf('var feedbackItem = startKcfFeedbackRequestGuaranteed');
  const acceptedAt = submit.indexOf("if (!feedbackItem) throw new Error('1분 피드백 AI 요청을 시작하지 못했습니다.')");
  const cleanupAt = submit.indexOf('// From this point the AI request has already started successfully.');

  assert.ok(requestAt >= 0);
  assert.ok(acceptedAt > requestAt);
  assert.ok(cleanupAt > acceptedAt);
  assert.match(submit, /Post-submit UI cleanup must never be reported as an AI connection failure/);
});

test('post-request sheet, selection, input, photo, draft, keyword, and badge cleanup cannot bubble as AI failure', () => {
  const start = runtime.indexOf('// From this point the AI request has already started successfully.');
  const end = runtime.indexOf('window.submitKinderChatFeedback = async function', start);
  const cleanup = runtime.slice(start, end);

  assert.match(cleanup, /completeSuccessfulSubmit/);
  assert.match(cleanup, /onSuccessfulSubmit/);
  assert.match(cleanup, /학생 선택 상태 확인 실패/);
  assert.match(cleanup, /입력창 초기화 실패/);
  assert.match(cleanup, /사진 초기화 실패/);
  assert.match(cleanup, /임시 입력 초기화 실패/);
  assert.match(cleanup, /키워드 초기화 실패/);
  assert.match(cleanup, /배지 갱신 실패/);
});

test('presentation errors do not block the AI request start', () => {
  const start = runtime.indexOf('async function continueKinderChatFeedbackSubmit');
  const end = runtime.indexOf('var requestOptions = {', start);
  const setup = runtime.slice(start, end);
  assert.match(setup, /사용자 메시지 표시 실패, AI 요청은 계속합니다/);
  assert.match(setup, /안내 메시지 표시 실패, AI 요청은 계속합니다/);
});

test('mobile loads the corrected staged common runtime', () => {
  assert.match(html, /olli-feedback-registration-runtime\.js\?v=20261002-ai-error-boundary-1/);
});
