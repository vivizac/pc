const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const baseCss = fs.readFileSync(path.join(root, 'olli-phone-base.css'), 'utf8');
const observationCss = fs.readFileSync(path.join(root, 'olli-observation-roster-phone.css'), 'utf8');
const talkJs = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');

test('record-room academy management and attendance header replaces notification with Olli Talk', () => {
  assert.doesNotMatch(html, /id="recordNotifyBtn"/);
  assert.doesNotMatch(html, /class="recordNotifyBtn"/);
  assert.doesNotMatch(html, /알림 기능 준비 중/);
  assert.match(html, /aria-label="설정과 올리톡"/);
  assert.match(html, /id="recordOlliTalkBtn"[^>]*onclick="openOlliTalkBetaPage\(event\)"/);
  assert.match(html, /class="recordOlliTalkIcon"><img[^>]*src="olli-character\.svg\?v=20260915-svg-3-black"/);
  assert.doesNotMatch(baseCss, /recordNotifyBtn/);
  assert.match(baseCss, /\.recordOlliTalkBtn \{/);
  assert.match(baseCss, /\.recordOlliTalkIcon img \{[\s\S]*?width:28px;[\s\S]*?height:28px;/);
});

test('observation replaces the upper-right Olli Talk circle with persistent Observation and Work tabs', () => {
  assert.doesNotMatch(html, /id="observationRosterOlliTalkBtn"/);
  assert.doesNotMatch(html, /class="observationOlliTalkIcon"/);
  assert.match(html, /class="olliWorkTabs observationWorkTabs"/);
  assert.match(html, /class="olliWorkTab active"[^>]*>관찰노트<\/button>/);
  assert.match(html, /class="olliWorkTab olliWorkTabWithBadge" onclick="openOlliTalkBetaPage\(event\)"[^>]*>Work<span[^>]*data-olli-work-badge[^>]*><\/span><\/button>/);
  assert.match(observationCss, /\.observationWorkTabs \{[\s\S]*?left:50%;[\s\S]*?top:var\(--vivizac-memo-top-y\)/);
});

test('Olli Talk context tab returns to observation roster or the open memo editor', () => {
  assert.match(talkJs, /olliTalkBetaReturnPageId/);
  assert.match(talkJs, /sourceScreen = Array\.from\(document\.querySelectorAll\('\.pageScreen'\)\)/);
  assert.match(talkJs, /function isObservationOlliTalkContext\(\)[\s\S]*observationRosterScreen[\s\S]*studentMemoScreen/);
  assert.match(talkJs, /function syncOlliTalkContextTab\(\)[\s\S]*관찰노트[\s\S]*퀵노트/);
  assert.match(talkJs, /olliTalkBetaReturnPageId === 'studentMemoScreen'[\s\S]*memoScreen\.style\.display = 'flex'[\s\S]*setObservationPersistentNavVisible\(true\)/);
  assert.match(talkJs, /olliTalkBetaReturnPageId === 'observationRosterScreen'[\s\S]*showObservationMemoRoster\(\)/);
  assert.match(talkJs, /function openOlliTalkContextPage\(event\)[\s\S]*isObservationOlliTalkContext\(\)[\s\S]*closeOlliTalkBetaPage\(event\)/);
});

test('legacy risk-signal page references are no longer left in the phone base stylesheet', () => {
  assert.doesNotMatch(baseCss, /위험신호/);
  assert.doesNotMatch(baseCss, /위험노트/);
});
