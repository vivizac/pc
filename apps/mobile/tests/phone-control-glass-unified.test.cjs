const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html','utf8');
const unified = fs.readFileSync('olli-phone-control-style.css','utf8');
const kcf = fs.readFileSync('kinder-feedback.css','utf8');
const talk = fs.readFileSync('olli-talk-beta.css','utf8');

test('unified phone control stylesheet is loaded after all phone component styles', () => {
  const unifiedAt = html.indexOf('olli-phone-control-style.css?v=20260922-teamtalk-unified-1');
  assert.ok(unifiedAt > html.indexOf('kinder-feedback.css?v=20260922-teamtalk-unified-1'));
  assert.ok(unifiedAt > html.indexOf('olli-talk-beta.css?v=20260922-teamtalk-unified-1'));
  assert.ok(unifiedAt > html.indexOf('olli-observation-roster-phone.css?v=20260922-teamtalk-unified-1'));
  assert.ok(unifiedAt > html.indexOf('olli-record-utility-touch.css'));
});

test('TeamTalk hamburger glass values are the single phone control effect', () => {
  assert.match(unified, /--olli-phone-glass-border:rgba\(255,255,255,\.88\)/);
  assert.match(unified, /linear-gradient\(135deg,rgba\(255,255,255,\.66\) 0%,rgba\(255,255,255,\.46\) 46%,rgba\(255,255,255,\.30\) 100%\)/);
  assert.match(unified, /backdrop-filter:blur\(2px\)/);
  assert.match(unified, /inset -1px 0 0 rgba\(255,255,255,\.28\)/);
  assert.match(unified, /0 2px 12px rgba\(0,0,0,\.10\)/);
});

test('top tabs, top buttons, bottom buttons and input surfaces share the same owner', () => {
  assert.match(unified, /\.olliWorkTabs,/);
  assert.match(unified, /#kcfPersistentTopLayer \.kcfRoundBtn,/);
  assert.match(unified, /#observationPersistentNavLayer \.observationRosterRecordRoomBtn,/);
  assert.match(unified, /#kinderChatFeedbackScreen \.kcfComposer,/);
  assert.match(unified, /#olliTalkBetaScreen \.olliTalkBetaComposer,/);
  assert.match(unified, /#olliTalkPhotoViewerScreen \.olliTalkPhotoViewerBackBtn,/);
  assert.match(unified, /#olliTalkPhotoViewerScreen \.olliTalkPhotoViewerArchiveBtn,/);
  assert.match(unified, /#olliTalkPhotoViewerScreen \.olliTalkPhotoViewerActionBtn,/);
  assert.match(unified, /#observationRosterScreen \.memoRosterSearchPill,/);
  assert.match(html, /id="observationMemoTopBackBtn"/);
  assert.doesNotMatch(html, /id="memoRosterBackBtn"/);
  assert.match(unified, /#studentMemoScreen\[data-memo-body-view="editor"\] \.memoBottomBar #memoBottomAnalysisBtn/);
});

test('legacy stacked pseudo glass layers are removed from component owners', () => {
  assert.doesNotMatch(kcf, /\.olliWorkTabs::before\{/);
  assert.doesNotMatch(kcf, /\.olliWorkTabs::after\{/);
  assert.doesNotMatch(talk, /\.olliTalkBetaBackBtn::before/);
  assert.doesNotMatch(talk, /\.olliTalkBetaComposer::after/);
});
