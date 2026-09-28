const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('olli-observation-roster-phone.js', 'utf8');
const css = fs.readFileSync('olli-observation-roster-phone.css', 'utf8');
const controls = fs.readFileSync('olli-phone-control-style.css', 'utf8');

test('roster owns its hamburger and memo owns its own back button', () => {
  const persistentNav = html.match(/<div aria-hidden="true" id="observationPersistentNavLayer">([\s\S]*?)<\/div>\s*<!-- PAGE: 관찰노트 학생목록 -->/)?.[1] || '';
  const rosterPage = html.match(/id="observationRosterScreen"([\s\S]*?)<!-- PAGE: 초등부 노트 -->/)?.[1] || '';
  const memoPage = html.match(/id="studentMemoScreen"([\s\S]*?)<!-- PAGE: 실패 성장 페이지 -->/)?.[1] || '';
  assert.doesNotMatch(persistentNav, /observationRosterRecordRoomBtn/);
  assert.match(rosterPage, /id="observationRosterRecordRoomBtn"/);
  assert.doesNotMatch(memoPage, /observationRosterRecordRoomBtn/);
  assert.match(memoPage, /id="observationMemoTopBackBtn"/);
  assert.doesNotMatch(js, /setObservationPersistentNavMode/);
  assert.match(js, /function enforceObservationMemoPageOwnership\(\)[\s\S]*setObservationPersistentNavVisible\(true\)/);
});

test('memo bottom back button is fully removed', () => {
  assert.doesNotMatch(html, /id="memoRosterBackBtn"/);
  assert.doesNotMatch(html, /id="memoStudentSelectWrap"/);
  assert.doesNotMatch(css, /#memoRosterBackBtn/);
  assert.doesNotMatch(controls, /#memoRosterBackBtn/);
});

test('memo owns a Team Chat geometry top back button', () => {
  assert.match(css, /#studentMemoScreen\[data-memo-body-view="editor"\] \.observationMemoTopBackBtn \{[\s\S]*width:44px;[\s\S]*height:44px/);
  assert.match(css, /\.observationMemoTopBackBtn \.memoRosterBackIcon \{[\s\S]*width:21px;[\s\S]*height:21px/);
});

test('roster owns observation quick-note tabs while memo has none and shared nav owns only Work', () => {
  const persistentNav = html.match(/<div aria-hidden="true" id="observationPersistentNavLayer">([\s\S]*?)<\/div>\s*<!-- PAGE: 관찰노트 학생목록 -->/)?.[1] || '';
  const rosterPage = html.match(/id="observationRosterScreen"([\s\S]*?)<!-- PAGE: 초등부 노트 -->/)?.[1] || '';
  const memoPage = html.match(/id="studentMemoScreen"([\s\S]*?)<!-- PAGE: 실패 성장 페이지 -->/)?.[1] || '';

  assert.doesNotMatch(persistentNav, /observationWorkTabs/);
  assert.match(persistentNav, /class="olliTopWorkBtn observationTopWorkBtn/);

  assert.match(rosterPage, /class="olliWorkTabs observationWorkTabs"/);
  assert.match(rosterPage, />관찰노트</);
  assert.match(rosterPage, />퀵노트</);

  assert.doesNotMatch(memoPage, /observationWorkTabs/);
  assert.doesNotMatch(memoPage, />관찰노트</);
  assert.doesNotMatch(memoPage, />퀵노트</);

  assert.match(css, /#observationRosterScreen \.observationWorkTabs \{/);
  assert.doesNotMatch(css, /#studentMemoScreen \.observationWorkTabs/);
  assert.doesNotMatch(css, /#observationPersistentNavLayer \.observationWorkTabs/);
});


test('roster hamburger stays above the roster page inner surface', () => {
  assert.match(css, /#observationRosterScreen \.observationRosterRecordRoomBtn \{[\s\S]*z-index:120;/);
});


test('memo top back button keeps the canonical phone glass surface after ownership split', () => {
  assert.match(controls, /#studentMemoScreen\[data-memo-body-view="editor"\] \.observationMemoTopBackBtn,/);
});
