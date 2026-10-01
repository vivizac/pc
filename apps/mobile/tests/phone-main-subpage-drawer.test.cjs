const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const baseCss = fs.readFileSync('olli-phone-base.css', 'utf8');
const kcfCss = fs.readFileSync('kinder-feedback.css', 'utf8');
const drawerJs = fs.readFileSync('olli-main-subpage-drawer.js', 'utf8');
const talkJs = fs.readFileSync('olli-talk-beta.js', 'utf8');
const runtimeJs = fs.readFileSync('olli-observation-runtime.js', 'utf8');
const rosterJs = fs.readFileSync('olli-observation-roster-phone.js', 'utf8');
const kcfJs = fs.readFileSync('kinder-feedback.js', 'utf8');

test('QuickNote and Observation hamburgers open the shared Attendance drawer', () => {
  assert.match(html, /id="observationRosterRecordRoomBtn" onclick="openOlliMainSubpageDrawer\(event, 'observation'\)"/);
  assert.match(html, /class="kcfRoundBtn kcfRecordBtn" onclick="openOlliMainSubpageDrawer\(event, 'quicknote'\)"/);
  assert.match(html, /src="olli-main-subpage-drawer\.js\?v=20260930-attendance-real-paint-1"/);
  assert.match(drawerJs, /async function prepareAttendanceState\(\)[\s\S]*openRecordAttendanceDashboard/);
  assert.match(drawerJs, /getOlliLastRecordDivisionView/);
});

test('QuickNote and Observation hamburgers declare their source while Work hamburger stays disabled', () => {
  assert.match(drawerJs, /function getMainPageFromExplicitSource\(sourceKind\)/);
  assert.match(drawerJs, /normalized === 'quicknote'[\s\S]*kinderChatFeedbackScreen/);
  assert.match(drawerJs, /normalized === 'observation'[\s\S]*studentMemoScreen[\s\S]*observationRosterScreen/);
  assert.match(html, /class="olliTalkBetaBackBtn" disabled title="메뉴" type="button"/);
  assert.doesNotMatch(html, /class="olliTalkBetaBackBtn" onclick="openOlliMainSubpageDrawer\(event, 'work'\)"/);
  assert.match(drawerJs, /function openOlliMainSubpageDrawer\(event, sourceKind\)[\s\S]*const explicitMainPage = getMainPageFromExplicitSource\(sourceKind\);[\s\S]*const mainPage = explicitMainPage \|\| getVisibleMainPage\(\);/);
});

test('Main page still stops with the right quarter visible and tapping it restores the same main page', () => {
  assert.match(baseCss, /transform:translate3d\(75%,0,0\) !important;/);
  assert.match(baseCss, /width:25vw;/);
  assert.match(baseCss, /clip-path:inset\(0 25% 0 0\);/);
  assert.match(drawerJs, /hit\.addEventListener\('click', closeOlliMainSubpageDrawer\)/);
});

test('Remaining main page keeps the 3px highlight-safe fade with no blur', () => {
  assert.match(baseCss, /\.olliMainDrawerMainPage::after\s*\{[\s\S]*inset:3px;[\s\S]*background:rgba\(255,255,255,\.52\)/);
  assert.doesNotMatch(baseCss, /\.olliMainDrawerMainPage\.is-olli-main-drawer-open[\s\S]*?filter:blur\(/);
});

test('drawer orders QuickNote and Observation by the page that opened it', () => {
  assert.match(drawerJs, /const fromObservation = sourceId === 'observationRosterScreen' \|\| sourceId === 'studentMemoScreen';/);
  assert.match(drawerJs, /observationItem\.style\.order = fromObservation \? '4' : '3';/);
  assert.match(drawerJs, /quickNoteItem\.style\.order = fromObservation \? '3' : '4';/);
});

test('Attendance return paints the visible shell before running local list preparation', () => {
  assert.match(drawerJs, /function afterMainSubpagePaint\(\)[\s\S]*?requestAnimationFrame[\s\S]*?requestAnimationFrame/);
  const start = drawerJs.indexOf('async function openOlliAttendancePage');
  const end = drawerJs.indexOf('function setOlliMainSubpageDrawerCompanionHidden', start);
  const body = drawerJs.slice(start, end);
  const show = body.indexOf("screen.style.display = screen.id === 'recordRoomScreen' ? 'flex' : 'none'");
  const paint = body.indexOf('await afterMainSubpagePaint()');
  const prepare = body.indexOf('await prepareAttendanceState({ localOnly: true })');
  assert.ok(show >= 0 && paint > show && prepare > paint);
  assert.match(drawerJs, /function refreshRecordRoomSubpage\(\)[\s\S]*?afterMainSubpagePaint\(\)[\s\S]*?prepareAttendanceState\(\{ localOnly: true \}\)/);
});

test('cross-main navigation is locked against duplicate calls', () => {
  assert.match(drawerJs, /let navigationInFlight = false;/);
  assert.match(drawerJs, /if \(navigationInFlight \|\| !drawerState\) return false;/);
  assert.match(drawerJs, /navigationInFlight = true;[\s\S]*finally \{[\s\S]*navigationInFlight = false;/);
});

test('QuickNote and Observation hide immediately when switching between each other', () => {
  assert.match(html, /id="recordModeToggleBtn" onclick="openOlliObservationFromRecordShortcut\(event\)"/);
  assert.match(html, /id="recordStorageToggleBtn" onclick="openOlliQuickNoteFromRecordShortcut\(event\)"/);
  assert.match(drawerJs, /const hideSourceImmediately =[\s\S]*sourceKind === 'quicknote' && normalizedTarget === 'observation'[\s\S]*sourceKind === 'observation' && normalizedTarget === 'quicknote'/);
  assert.match(drawerJs, /if \(!hideSourceImmediately\) \{[\s\S]*waitForTransition\(sourceMain, 'transform',[\s\S]*SWITCH_EXIT_CLASS/);
  assert.match(drawerJs, /if \(sourceMain\) \{[\s\S]*sourceMain\.style\.display = 'none';[\s\S]*showRecordRoomBehindTransition\(state, \{ fullWidth:true \}\)[\s\S]*prepareDrawerTargetMainPage/);
  assert.match(drawerJs, /recordRoom\.classList\.toggle\('olliMainDrawerSubpage', !fullWidth\)/);
});

test('target page enters only after preparation and waits for the real animation end', () => {
  assert.match(drawerJs, /prepareDrawerTargetMainPage\(normalizedTarget, division\)[\s\S]*waitForAnimation\(targetMain, 'vivizacSlideInFromRight'/);
  assert.match(drawerJs, /element\.addEventListener\('animationend', onEnd\)/);
  assert.match(baseCss, /is-olli-main-drawer-switch-enter[\s\S]*vivizacSlideInFromRight 340ms/);
});


test('entering page and persistent top layer receive the shared role classes before the 340ms entry starts', () => {
  assert.match(drawerJs, /targetMain\.classList\.add\(MAIN_PAGE_CLASS\);/);
  assert.match(drawerJs, /targetCompanion\.classList\.add\(COMPANION_CLASS\);/);
  assert.match(drawerJs, /targetMain\.classList\.add\(SWITCH_ENTER_CLASS\);[\s\S]*targetCompanion\?\.classList\.add\(SWITCH_ENTER_CLASS\)/);
  assert.match(drawerJs, /targetMain\.classList\.remove\(MAIN_PAGE_CLASS, SWITCH_ENTER_CLASS\);/);
  assert.match(drawerJs, /targetCompanion\.classList\.remove\(COMPANION_CLASS, SWITCH_ENTER_CLASS\);/);
});

test('drawer target openers prepare content without taking over screen visibility', () => {
  assert.match(drawerJs, /openObservation\(\{ division, navigationManaged:true \}\)/);
  assert.match(drawerJs, /openQuickNote\(\{ division, navigationManaged:true \}\)/);
  assert.match(rosterJs, /navigationManaged = options\?\.navigationManaged === true/);
  assert.match(kcfJs, /const navigationManaged = options\?\.navigationManaged === true;/);
});

test('Observation has one canonical openObservationNoteFromRecord definition', () => {
  const runtimeDefs = runtimeJs.match(/function openObservationNoteFromRecord\s*\(/g) || [];
  const rosterDefs = rosterJs.match(/function openObservationNoteFromRecord\s*\(/g) || [];
  assert.equal(runtimeDefs.length, 0);
  assert.equal(rosterDefs.length, 1);
});

test('drawer page switches fade Attendance behind the entering target and hide it afterward', () => {
  assert.match(drawerJs, /showRecordRoomBehindTransition\(state\);[\s\S]*beginDrawerReturnFade\(state\.recordRoom\)/);
  assert.match(baseCss, /\.vivizac-slide-under-fade\s*\{[\s\S]*vivizacSlideUnderFade 340ms/);
  assert.match(drawerJs, /state\.recordRoom\.style\.display = 'none';[\s\S]*state\.recordRoom\.setAttribute\('aria-hidden', 'true'\)/);
});

test('record-room shortcuts keep their normal direct behavior when the drawer is closed', () => {
  assert.match(drawerJs, /function openOlliObservationFromRecordShortcut\(event\)[\s\S]*if \(drawerState\)[\s\S]*openObservationNoteFromRecord/);
  assert.match(drawerJs, /function openOlliQuickNoteFromRecordShortcut\(event\)[\s\S]*if \(drawerState\)[\s\S]*openKinderChatFeedbackPage/);
});

test('Work tabs expose one shared unread mention badge source', () => {
  const badges = html.match(/data-olli-work-badge/g) || [];
  assert.equal(badges.length, 2);
  assert.match(kcfCss, /\.olliWorkNotificationBadge\{[\s\S]*background:#0A84FF;/);
  assert.match(talkJs, /document\.querySelectorAll\('\[data-olli-work-badge\], #kcfOlliTalkBadge'\)/);
});
