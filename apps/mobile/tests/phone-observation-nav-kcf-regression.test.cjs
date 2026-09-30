const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const index = fs.readFileSync('index.html', 'utf8');
const kcfJs = fs.readFileSync('kinder-feedback.js', 'utf8');
const observationJs = fs.readFileSync('olli-observation-roster-phone.js', 'utf8');
const observationCss = fs.readFileSync('olli-observation-roster-phone.css', 'utf8');

test('roster hamburger belongs only to the roster page and memo owns its back button', () => {
  const nav = index.match(/<div aria-hidden="true" id="observationPersistentNavLayer">([\s\S]*?)<\/div>\s*<!-- PAGE: 관찰노트 학생목록 -->/)?.[1] || '';
  const roster = index.match(/id="observationRosterScreen"([\s\S]*?)<!-- PAGE: 초등부 노트 -->/)?.[1] || '';
  const memo = index.match(/id="studentMemoScreen"([\s\S]*?)<!-- PAGE: 실패 성장 페이지 -->/)?.[1] || '';

  assert.doesNotMatch(nav, /observationRosterRecordRoomBtn/);
  assert.match(roster, /id="observationRosterRecordRoomBtn"/);
  assert.doesNotMatch(memo, /observationRosterRecordRoomBtn/);
  assert.match(memo, /id="observationMemoTopBackBtn"/);
  assert.doesNotMatch(index, /id="memoRosterBackBtn"/);
  assert.doesNotMatch(observationJs, /setObservationPersistentNavMode/);
  assert.match(observationJs, /function enforceObservationMemoPageOwnership\(\)[\s\S]*setObservationPersistentNavVisible\(true\)/);
  assert.match(observationCss, /#studentMemoScreen\[data-memo-body-view="editor"\] \.observationMemoTopBackBtn/);
  assert.match(observationCss, /#observationRosterScreen \.observationRosterRecordRoomBtn/);
  assert.doesNotMatch(observationCss, /#observationPersistentNavLayer \.observationRosterRecordRoomBtn/);
});

test('opening one-minute feedback explicitly hides the observation persistent nav', () => {
  assert.match(kcfJs, /function openKinderChatFeedbackPage\(\) \{[\s\S]*?window\.setObservationPersistentNavVisible\(false\);/);
  assert.match(observationJs, /window\.setObservationPersistentNavVisible = setObservationPersistentNavVisible;/);
});

test('observation navigation assets use the roster-hamburger-owner cache key', () => {
  assert.match(index, /olli-observation-roster-phone\.js\?v=20260930-observation-roster-clean-rebuild-1/);
  assert.match(index, /olli-observation-roster-phone\.css\?v=20260930-observation-roster-clean-rebuild-1/);
  assert.match(index, /olli-phone-control-style\.css\?v=20260925-roster-hamburger-owner-1/);
  assert.doesNotMatch(index, /kinder-feedback-keyboard\.css/);
});
