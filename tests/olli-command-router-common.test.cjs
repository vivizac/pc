const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const routerSource = fs.readFileSync('olli-command-router-common.js', 'utf8');
const registration = fs.readFileSync('olli-feedback-registration-runtime.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('shared command router starts as a safe pass-through', async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(routerSource, sandbox);
  assert.equal(typeof sandbox.window.OlliCommandRouter, 'object');
  assert.equal(typeof sandbox.window.OlliCommandRouter.route, 'function');

  const result = await sandbox.window.OlliCommandRouter.route('오늘 보강 가능한 시간을 알려줘', {
    source: 'one_minute_feedback'
  });
  assert.equal(result.handled, false);
  assert.equal(result.kind, 'feedback');
  assert.equal(result.text, '오늘 보강 가능한 시간을 알려줘');
  assert.equal(result.clearInput, false);
});

test('one-minute submit checks command router before legacy name parsing', () => {
  const submitStart = registration.indexOf('window.submitKinderChatFeedback = async function');
  const submitEnd = registration.indexOf('window.openKinderChatFeedbackSaveStudentPicker', submitStart);
  const submit = registration.slice(submitStart, submitEnd);
  const routeIndex = submit.indexOf('OlliCommandRouter.route');
  const legacyParserIndex = submit.indexOf('parseKcfTypedStudentInput(text)');

  assert.ok(routeIndex >= 0);
  assert.ok(legacyParserIndex > routeIndex);
  assert.match(submit, /commandRoute\.handled === true/);
  assert.match(submit, /기존 피드백 흐름을 계속합니다/);
});

test('PC loads command router before shared feedback registration', () => {
  const routerIndex = html.indexOf('olli-command-router-common.js');
  const registrationIndex = html.indexOf('olli-feedback-registration-runtime.js');
  assert.ok(routerIndex >= 0);
  assert.ok(registrationIndex > routerIndex);
});
