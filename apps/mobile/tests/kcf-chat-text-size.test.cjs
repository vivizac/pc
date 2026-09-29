const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync('kinder-feedback.css','utf8');
const html = fs.readFileSync('index.html','utf8');

test('chat message content uses GPT-like 15px body sizing', () => {
  assert.match(css, /\.kcfBubble \{[\s\S]*?font-size:calc\(15px \* var\(--olli-text-scale\)\);/);
  assert.match(css, /\.kcfQuestionList li \{[\s\S]*?font-size:calc\(15px \* var\(--olli-text-scale\)\);/);
});

test('LIVE editor matches displayed chat body size', () => {
  const start = css.indexOf('#kinderChatFeedbackScreen .kcfLiveEditArea {');
  const end = css.indexOf('#kinderChatFeedbackScreen .kcfLiveResponseRow.editing .kcfLiveBubble', start);
  const block = css.slice(start, end);
  assert.match(block, /font-size:calc\(15px \* var\(--olli-text-scale\)\);/);
});

test('document-card chat text is proportionally reduced', () => {
  assert.match(css, /\.kcfDocumentTitle \{\s*font-size:calc\(13px \* var\(--olli-text-scale\)\);/);
  assert.match(css, /\.kcfDocumentSub \{\s*font-size:calc\(11\.5px \* var\(--olli-text-scale\)\);/);
});

test('header stays unchanged and css is cache-busted', () => {
  assert.match(css, /#kcfPersistentTopLayer \.kcfModeTitle \{[\s\S]*?font-size:calc\(20px \* var\(--olli-text-scale\)\);/);
  assert.match(html, /kinder-feedback\.css\?v=20260916-chat-text-gpt-1/);
});
