const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('KCF LIVE renders incoming network chunks immediately without artificial character pacing', () => {
  assert.doesNotMatch(js, /KCF_LIVE_REVEAL_BASE_DELAY_MS/);
  assert.doesNotMatch(js, /createKinderChatFeedbackLiveTextRenderer/);

  const start = js.indexOf('function startKinderChatFeedbackLiveRequest(options = {})');
  const end = js.indexOf('async function copyKinderChatSourceCardText', start);
  assert.ok(start >= 0 && end > start);
  const live = js.slice(start, end);

  assert.match(live, /const \{ value, done \} = await reader\.read\(\)/);
  assert.match(live, /fullText \+= decoder\.decode\(value, \{ stream:true \}\)/);
  assert.match(live, /liveUi\.bubble\.textContent = visibleText \|\| '…'/);
  assert.doesNotMatch(live, /liveTextRenderer/);
  assert.doesNotMatch(live, /setTimeout\(renderNext/);
});

test('phone cache-busts the direct LIVE renderer', () => {
  assert.match(html, /kinder-feedback\.js\?v=20260923-live-direct-1/);
});
