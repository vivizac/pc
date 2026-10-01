const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const kcf = fs.readFileSync('kinder-feedback.js', 'utf8');
const talk = fs.readFileSync('olli-talk-beta.js', 'utf8');
const talkCss = fs.readFileSync('olli-talk-beta.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('QuickNote restored feedback actions are present', () => {
  assert.match(kcf, /kcfLiveCopyBtn/);
  assert.match(kcf, /kcfLiveEditBtn/);
  assert.match(kcf, /kcfLiveSaveBtn/);
  assert.match(kcf, /복사 \+ 저장/);
});

test('Team Chat keyboard behavior is restored while Agent bridges remain', () => {
  assert.doesNotMatch(talk, /olliTalkKeepInputFocusUntil/);
  assert.match(talk, /--olli-talk-chat-bottom-gap/);
  assert.doesNotMatch(talk, /--olli-talk-chat-reserve/);
  assert.match(talkCss, /--olli-talk-chat-bottom-gap:74px/);
  assert.match(talk, /isOlliTalkWaitlistCancelAgentCandidate/);
  assert.match(talk, /isOlliTalkMakeupUpdateAgentCandidate/);
  assert.match(talk, /isOlliTalkPickupUpdateAgentCandidate/);
});

test('rollback assets use fresh cache keys', () => {
  assert.match(html, /kinder-feedback\.js\?v=20261001-pre-sep30-rollback-1/);
  assert.match(html, /kinder-feedback\.css\?v=20261001-pre-sep30-rollback-1/);
  assert.match(html, /olli-talk-beta\.js\?v=20261001-pre-sep30-rollback-1/);
  assert.match(html, /olli-talk-beta\.css\?v=20261001-pre-sep30-rollback-1/);
  assert.match(html, /kcf-auto-mode-runtime\.js\?v=20261001-pre-sep30-rollback-1/);
});
