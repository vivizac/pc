const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const runtime = fs.readFileSync('olli-feedback-runtime.js', 'utf8');
const registration = fs.readFileSync('olli-feedback-registration-runtime.js', 'utf8');

test('shared feedback runtime delegates only phone LIVE KCF requests before inbox queue creation', () => {
  const fnStart = runtime.indexOf('function startTodayFeedbackRequest(options = {})');
  const liveHook = runtime.indexOf("typeof window.startKinderChatFeedbackLiveRequest === 'function'", fnStart);
  const queueCreate = runtime.indexOf('const item = createTodayFeedbackItem({', fnStart);
  assert.ok(fnStart >= 0 && liveHook > fnStart && queueCreate > liveHook);
  assert.match(runtime, /options\.sourcePage === 'kinderChatFeedback'/);
  assert.match(runtime, /window\.getKinderChatFeedbackTopMode\(\) === 'live'/);
  assert.match(runtime, /requestContent: buildTodayFeedbackRequestContent/);
});

test('shared registration keeps old acknowledgement outside LIVE and suppresses it in LIVE', () => {
  assert.match(registration, /var canUseKinderChatLive =[\s\S]*getKinderChatFeedbackTopMode\(\) === 'live'[\s\S]*startKinderChatFeedbackLiveRequest/);
  assert.match(registration, /if \(!canUseKinderChatLive && typeof addKinderChatMessage === 'function'\)/);
  assert.match(registration, /startTodayFeedbackRequest\(requestOptions\)/);
});
