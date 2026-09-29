const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('Olli Talk binds to the shared chat realtime domain', () => {
  assert.match(source, /watchDomain\('chat'/);
  assert.match(source, /loadOlliTalkBetaMessages\(\{ showLoading:false \}\)/);
  assert.match(source, /ensureConnected\(\{ force:false, reason:'olli_talk_open' \}\)/);
});

test('Olli Talk adds no independent polling loop', () => {
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test('Phone busts the shared realtime common cache for chat domain support', () => {
  assert.match(html, /olli-realtime-common\.js\?v=20260920-chat-1/);
});
