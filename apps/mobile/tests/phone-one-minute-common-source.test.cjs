const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const vercel = fs.readFileSync('vercel.json', 'utf8');
const kcf = fs.readFileSync('kinder-feedback.js', 'utf8');
const adapter = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');
const commonFiles = fs.readFileSync('OLLI_COMMON_FILES.txt', 'utf8');

test('phone has no duplicate shared feedback execution file', () => {
  assert.equal(fs.existsSync('olli-feedback-runtime.js'), false);
  assert.match(html, /<script src="olli-feedback-runtime\.js\?v=20260913-one-minute-common-1"><\/script>/);
  assert.match(vercel, /"source":"\/olli-feedback-runtime\.js"/);
  assert.match(vercel, /vivizac\/pc\/main\/olli-feedback-runtime\.js/);
});

test('phone loads common registration runtime and does not own submit execution', () => {
  assert.match(html, /<script src="olli-feedback-registration-runtime\.js\?v=20260913-one-minute-common-1"><\/script>/);
  assert.match(vercel, /vivizac\/pc\/main\/olli-feedback-registration-runtime\.js/);
  assert.doesNotMatch(kcf, /async function submitKinderChatFeedback\(\)/);
  assert.doesNotMatch(kcf, /window\.submitKinderChatFeedback\s*=/);
  assert.match(kcf, /function setKinderChatFeedbackGuideVisibility\(visible\)/);
});

test('phone opts into inline student-name feedback while execution stays in the shared runtime', () => {
  assert.match(adapter, /window\.__olliPhoneInlineStudentFeedbackEnabled = true;/);
  assert.doesNotMatch(kcf, /resolveKcfInlineFeedbackTarget/);
});

test('phone-specific lifecycle remains in adapter only', () => {
  assert.match(adapter, /installPhoneOneMinuteFeedbackLifecycle/);
  assert.match(adapter, /OlliOneMinuteFeedbackLifecycle/);
  assert.match(adapter, /resetOneMinuteFeedback/);
});


test('phone loads shared command schedule and router before feedback registration', () => {
  assert.equal(fs.existsSync('olli-command-schedule-common.js'), false);
  assert.equal(fs.existsSync('olli-command-router-common.js'), false);
  assert.match(commonFiles, /^olli-command-schedule-common\.js$/m);
  assert.match(commonFiles, /^olli-command-router-common\.js$/m);
  assert.match(html, /<script src="olli-command-schedule-common\.js\?v=20260918-write-commands-1"><\/script>/);
  assert.match(html, /<script src="olli-command-router-common\.js\?v=20260918-write-commands-1"><\/script>/);
  assert.match(vercel, /"source":"\/olli-command-schedule-common\.js"/);
  assert.match(vercel, /vivizac\/pc\/main\/olli-command-schedule-common\.js/);
  assert.match(vercel, /"source":"\/olli-command-router-common\.js"/);
  assert.match(vercel, /vivizac\/pc\/main\/olli-command-router-common\.js/);
  assert.ok(html.indexOf('olli-command-schedule-common.js') < html.indexOf('olli-command-router-common.js'));
  assert.ok(html.indexOf('olli-command-router-common.js') < html.indexOf('olli-feedback-registration-runtime.js'));
});
