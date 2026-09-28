const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const js = fs.readFileSync('kinder-feedback.js', 'utf8');

test('persistent hamburger is clickable and opens the shared Attendance drawer', () => {
  assert.match(html, /class="kcfRoundBtn kcfRecordBtn" onclick="openOlliMainSubpageDrawer\(event, 'quicknote'\)"/);
  assert.match(html, /src="olli-main-subpage-drawer\.js\?v=20260922-bidirectional-instant-1"/);
  assert.match(css, /#kcfPersistentTopLayer \.kcfRoundBtn\{[\s\S]*?pointer-events:auto;/);
});

test('QuickNote no longer stores or restores a previous record-room page', () => {
  assert.doesNotMatch(js, /kcfReturnRecordView/);
  assert.doesNotMatch(js, /captureKinderChatFeedbackReturnView/);
  assert.match(js, /function closeKinderChatFeedbackPage\(\)[\s\S]*window\.openOlliAttendancePage/);
});

test('QuickNote supports navigation-managed opening without hiding other page screens', () => {
  assert.match(js, /function openKinderChatFeedbackPage\(options = \{\}\)[\s\S]*const navigationManaged = options\?\.navigationManaged === true;/);
  assert.match(js, /if \(!navigationManaged\) \{[\s\S]*document\.querySelectorAll\('\.pageScreen'\)/);
});

test('QuickNote division falls back to the last locally saved Attendance tab', () => {
  assert.match(js, /function getKinderChatFeedbackEntryDivision\(options = \{\}\)[\s\S]*getOlliLastRecordDivisionView/);
});

test('changed QuickNote navigation asset uses a fresh cache key', () => {
  assert.match(html, /kinder-feedback\.js\?v=20260922-navigation-single-owner-1/);
});

test('temporary inbox bubble uses one visible edge, not a duplicate border', () => {
  assert.match(css, /\.kcfVivicotInboxBubble \{[\s\S]*?border:none;[\s\S]*?0 0 0 1px rgba\(255,255,255,0\.92\)/);
  assert.match(css, /\.kcfVivicotInboxBubble::before \{[\s\S]*?border-left:none;[\s\S]*?border-top:none;/);
});


test('hamburger line geometry keeps wider spacing with the short line left-aligned', () => {
  const geometry = '<svg aria-hidden="true" viewbox="0 0 24 24"><path d="M5 7h14"></path><path d="M5 12h14"></path><path d="M5 17h10"></path></svg>';
  assert.equal(html.split(geometry).length - 1, 2);
  assert.doesNotMatch(html, /<path d="M6 8h12"><\/path><path d="M6 12h12"><\/path><path d="M6 16h8"><\/path>/);
});


test('hamburger strokes are slightly thinner in QuickNote and Observation', () => {
  const observationCss = fs.readFileSync('olli-observation-roster-phone.css', 'utf8');
  assert.match(css, /#kcfPersistentTopLayer \.kcfRecordBtn svg \{[\s\S]*?stroke-width:1\.7 !important;/);
  assert.match(observationCss, /#observationRosterScreen \.observationRosterRecordRoomBtn svg \{[\s\S]*?stroke-width:1\.7;/);
});
