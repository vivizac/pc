const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'olli-observation-roster-phone.css'), 'utf8');
const source = fs.readFileSync(path.join(root, 'olli-observation-roster-phone.js'), 'utf8');

test('roster removes the old observation title, guide text and upper-right TeamTalk circle', () => {
  const rosterStart = html.indexOf('id="observationRosterScreen"');
  const memoStart = html.indexOf('id="studentMemoScreen"');
  const rosterSegment = html.slice(rosterStart, memoStart);
  assert.doesNotMatch(rosterSegment, /id="memoModeWrap"/);
  assert.doesNotMatch(rosterSegment, /id="memoStudentName"/);
  assert.doesNotMatch(rosterSegment, /id="memoModeSub"/);
  assert.doesNotMatch(html, /id="observationRosterOlliTalkBtn"/);
  assert.doesNotMatch(html, /class="observationOlliTalkIcon"/);
  assert.doesNotMatch(source, /prepareObservationRosterModeControl/);
});

test('persistent observation nav owns hamburger plus centered Observation and Work tabs', () => {
  const navStart = html.indexOf('id="observationPersistentNavLayer"');
  const rosterStart = html.indexOf('id="observationRosterScreen"');
  const navSegment = html.slice(navStart, rosterStart);
  assert.ok(navStart >= 0 && navStart < rosterStart);
  assert.match(navSegment, /id="observationRosterRecordRoomBtn"/);
  assert.match(navSegment, /class="olliWorkTabs observationWorkTabs"/);
  assert.match(navSegment, /class="olliWorkTab active"[^>]*>관찰노트<\/button>/);
  assert.match(navSegment, /class="olliWorkTab olliWorkTabWithBadge" onclick="openOlliTalkBetaPage\(event\)"[^>]*>Work<span[^>]*data-olli-work-badge[^>]*><\/span><\/button>/);
  assert.match(css, /#observationPersistentNavLayer \.observationWorkTabs \{[\s\S]*position:fixed;[\s\S]*left:50%;[\s\S]*top:var\(--vivizac-memo-top-y\);[\s\S]*z-index:120110;/);
});

test('persistent Observation and Work tabs stay above the sliding memo editor', () => {
  assert.match(css, /#observationPersistentNavLayer[\s\S]*?z-index:120100/);
  assert.match(css, /#studentMemoScreen\.observation-editor-slide-enter[\s\S]*?z-index:120000/);
  assert.match(source, /function setObservationMemoEditorMode\(\)[\s\S]*setObservationPersistentNavVisible\(true\);/);
  assert.match(source, /setObservationPersistentNavVisible\(false\)/);
  assert.doesNotMatch(html, /id="memoRecordRoomBtn"/);
  assert.doesNotMatch(css, /#memoRecordRoomBtn/);
});


test('Observation roster only suppresses page animation while the keyboard is open', () => {
  assert.match(css, /#observationRosterScreen\.observation-keyboard-open,[\s\S]*animation:none !important;[\s\S]*transition:none !important;/);
  assert.doesNotMatch(css, /\/\* 키보드 포커스 중[^]*?\*\/[\s\S]*?#observationRosterScreen,\s*#observationRosterScreen \.memoPageInner/);
});


test('observation roster has fixed top and bottom haze layers behind the controls', () => {
  const rosterStart = html.indexOf('id="observationRosterScreen"');
  const memoStart = html.indexOf('id="studentMemoScreen"');
  const rosterSegment = html.slice(rosterStart, memoStart);

  assert.match(rosterSegment, /class="observationRosterTopFadeLayer"/);
  assert.match(rosterSegment, /class="observationRosterBottomFadeLayer"/);
  assert.match(css, /#observationRosterScreen \.observationRosterTopFadeLayer,[\s\S]*?#observationRosterScreen \.observationRosterBottomFadeLayer \{[\s\S]*?z-index:100;[\s\S]*?pointer-events:none;[\s\S]*?backdrop-filter:blur\(2px\);/);
  assert.match(css, /#observationRosterScreen \.observationRosterTopFadeLayer \{[\s\S]*?top:0;[\s\S]*?to bottom,[\s\S]*?rgba\(var\(--vivizac-edge-fade-rgb\),1\) 0%/);
  assert.match(css, /#observationRosterScreen \.observationRosterBottomFadeLayer \{[\s\S]*?bottom:0;[\s\S]*?to top,[\s\S]*?rgba\(var\(--vivizac-edge-fade-rgb\),1\) 0%/);
});


test('Observation roster mirrors QuickNote scroll ownership while search keyboard is open', () => {
  const page = css.match(/#observationRosterScreen \.observationRosterPageInner \{[\s\S]*?\}/)?.[0] || '';
  const scroll = css.match(/#observationRosterScreen \.memoBodyRosterScroll \{[\s\S]*?\}/)?.[0] || '';
  const content = css.match(/#observationRosterScreen \.memoBodyRosterContent \{[\s\S]*?\}/)?.[0] || '';
  const layer = css.match(/#observationRosterScreen \.observationRosterUtilityLayer \{[\s\S]*?\}/)?.[0] || '';
  const utility = css.match(/#observationRosterScreen \.memoRosterUtilityBar \{[\s\S]*?\}/)?.[0] || '';

  assert.match(page,/position:absolute/);
  assert.match(page,/inset:0/);
  assert.match(page,/overflow:hidden/);
  assert.match(scroll,/overflow-y:auto/);
  assert.match(scroll,/overscroll-behavior-y:contain/);
  assert.match(scroll,/touch-action:pan-y/);
  assert.match(scroll,/overflow-anchor:none/);
  assert.match(content,/--observation-roster-content-lift/);
  assert.match(layer,/position:fixed/);
  assert.match(layer,/pointer-events:none/);
  assert.match(utility,/position:absolute !important/);
  assert.match(utility,/pointer-events:auto !important/);
  assert.doesNotMatch(utility,/--olli-observation-keyboard-offset/);
});

test('Observation roster search input uses Team Chat style viewport lock and preventScroll focus', () => {
  assert.match(source,/function syncObservationRosterViewport\(options = \{\}\)/);
  assert.match(source,/function lockObservationRosterUtilityViewport\(\)/);
  assert.match(source,/if \(observationRosterUtilityViewportLock && options\.followKeyboard !== true\)/);
  assert.match(source,/if \(observationRosterScrollGestureActive\) \{[\s\S]*?observationRosterLastViewportSignature = signature;[\s\S]*?return;/);
  assert.match(source,/input\.focus\(\{ preventScroll:true \}\)/);
  assert.match(source,/utilityBar\.addEventListener\('touchmove',[\s\S]*?event\.preventDefault\(\)[\s\S]*?passive:false/);
});

test('Observation roster renders a dedicated content layer and visualViewport utility layer', () => {
  assert.match(source,/memoBodyRosterScroll"><div class="memoBodyRosterContent">/);
  assert.match(source,/observationRosterUtilityLayer/);
  assert.match(source,/--observation-roster-reserve/);
  assert.match(source,/--observation-roster-content-lift/);
  assert.doesNotMatch(source,/--olli-observation-keyboard-offset/);
});
