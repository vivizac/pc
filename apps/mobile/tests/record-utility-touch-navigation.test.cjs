const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const touch = fs.readFileSync('olli-record-utility-touch.js', 'utf8');

test('phone touch router uses shared Observation and QuickNote navigation shortcuts', () => {
  assert.match(touch, /case 'recordModeToggleBtn':[\s\S]*action = window\.openOlliObservationFromRecordShortcut;/);
  assert.match(touch, /case 'recordStorageToggleBtn':[\s\S]*action = window\.openOlliQuickNoteFromRecordShortcut;/);
});

test('phone touch router no longer bypasses shared navigation with legacy direct page openers', () => {
  const actionBlock = touch.slice(
    touch.indexOf('function runUtilityAction(button)'),
    touch.indexOf("document.addEventListener('pointerdown'", touch.indexOf('function runUtilityAction(button)'))
  );
  assert.doesNotMatch(actionBlock, /action = window\.openObservationNoteFromRecord;/);
  assert.doesNotMatch(actionBlock, /action = window\.openKinderChatFeedbackPage;/);
  assert.doesNotMatch(actionBlock, /memoScreenToReveal\.style\.visibility = 'hidden'/);
});

test('phone loads a cache-busted touch router', () => {
  assert.match(html, /olli-record-utility-touch\.js\?v=20260922-touch-router-1/);
});
