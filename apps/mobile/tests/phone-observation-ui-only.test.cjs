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


test('Observation roster search input uses Team Chat style viewport lock and preventScroll focus', () => {
  assert.match(source,/function syncObservationRosterViewport\(options = \{\}\)/);
  assert.match(source,/function lockObservationRosterUtilityViewport\(\)/);
  assert.match(source,/if \(observationRosterUtilityViewportLock && options\.followKeyboard !== true\)/);
  assert.match(source,/if \(observationRosterScrollGestureActive\) \{[\s\S]*?observationRosterLastViewportSignature = signature;[\s\S]*?return;/);
  assert.match(source,/input\.focus\(\{ preventScroll:true \}\)/);
  assert.match(source,/utilityBar\.addEventListener\('touchmove',[\s\S]*?event\.preventDefault\(\)[\s\S]*?passive:false/);
});


test('Observation roster search input stays static while typing rerenders only the list', () => {
  const rosterStart = html.indexOf('id="observationRosterScreen"');
  const memoStart = html.indexOf('id="studentMemoScreen"');
  const rosterSegment = html.slice(rosterStart, memoStart);
  assert.match(rosterSegment,/id="observationRosterUtilityLayer"/);
  assert.match(rosterSegment,/id="observationRosterUtilityMount"/);
  assert.match(source,/function renderObservationRosterList\(\)/);
  assert.match(source,/function renderObservationRosterUtility\(\)/);
  assert.match(source,/input\.addEventListener\('input',[\s\S]*?renderObservationRosterList\(\);/);
  assert.doesNotMatch(source,/input\.addEventListener\('input',[\s\S]{0,500}?renderObservationMemoRoster\(\)/);
});

test('Observation roster UtilityLayer alone owns search-bar viewport movement', () => {
  const layer = css.match(/#observationRosterScreen \.observationRosterUtilityLayer \{[\s\S]*?\}/)?.[0] || '';
  assert.match(layer,/position:fixed/);
  assert.match(layer,/--observation-roster-vv-left/);
  assert.match(layer,/--observation-roster-vv-top/);
  assert.match(source,/function syncObservationRosterUtilityViewport\(options = \{\}\)/);
  assert.match(source,/input\.focus\(\{ preventScroll:true \}\)/);
  assert.match(source,/if \(observationRosterScrollGestureActive\)[\s\S]*?return;/);
});


test('Observation roster physically stops its scroll surface above the fixed search bar', () => {
  const view = css.match(/#observationRosterScreen #memoStudentRosterView \{[\s\S]*?\}/)?.[0] || '';
  const scroll = css.match(/#observationRosterScreen \.memoBodyRosterScroll \{[\s\S]*?\}/)?.[0] || '';
  const content = css.match(/#observationRosterScreen \.memoBodyRosterContent \{[\s\S]*?\}/)?.[0] || '';
  assert.match(view,/position:relative/);
  assert.match(view,/overflow:hidden/);
  assert.match(scroll,/position:absolute/);
  assert.match(scroll,/bottom:var\(--observation-roster-scroll-bottom, 94px\)/);
  assert.match(scroll,/overflow-y:auto/);
  assert.doesNotMatch(scroll,/--observation-roster-reserve/);
  assert.doesNotMatch(content,/transform:/);
  assert.doesNotMatch(css,/--observation-roster-content-lift/);
  assert.doesNotMatch(css,/--observation-roster-reserve/);
});

test('Observation roster computes the physical scroll bottom directly from the search bar top', () => {
  const start = source.indexOf('function syncObservationRosterScrollToUtility');
  const end = source.indexOf('function scheduleObservationRosterScrollToUtility', start);
  const body = source.slice(start, end);
  assert.match(body,/viewportRect\.bottom - utilityRect\.top/);
  assert.match(body,/--observation-roster-scroll-bottom/);
  assert.doesNotMatch(body,/keyboardOffset/);
  assert.doesNotMatch(body,/measuredReserve/);
});

test('Observation roster search bar is a non-scroll touch surface while focused', () => {
  const utility = css.match(/#observationRosterScreen \.memoRosterUtilityBar \{[\s\S]*?\}/)?.[0] || '';
  assert.match(utility,/touch-action:none/);
  assert.match(utility,/overscroll-behavior:none/);
  assert.match(source,/const inputFocused = document\.activeElement === getObservationRosterSearchInput\(\)/);
  assert.match(source,/event\.preventDefault\(\);[\s\S]{0,100}event\.stopPropagation\(\);/);
  assert.match(source,/input\.focus\(\{ preventScroll:true \}\)/);
});

test('Observation roster never recreates the focused search input during list refresh', () => {
  assert.match(source,/input\.addEventListener\('focus',[\s\S]{0,260}renderObservationRosterList\(\);[\s\S]{0,100}scheduleObservationRosterScrollToUtility\(\);/);
  assert.doesNotMatch(source,/input\.addEventListener\('focus',[\s\S]{0,320}renderObservationRosterUtility\(\)/);
  assert.match(source,/if \(!currentInput \|\| document\.activeElement !== currentInput\) \{[\s\S]*?renderObservationRosterUtility\(\);/);
});
