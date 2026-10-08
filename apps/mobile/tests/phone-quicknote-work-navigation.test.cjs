const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const kcfCss = fs.readFileSync('kinder-feedback.css', 'utf8');
const kcfJs = fs.readFileSync('kinder-feedback.js', 'utf8');
const talkCss = fs.readFileSync('olli-talk-beta.css', 'utf8');
const talkJs = fs.readFileSync('olli-talk-beta.js', 'utf8');
const phoneBaseCss = fs.readFileSync('olli-phone-base.css', 'utf8');

test('QuickNote replaces the old one-minute header with QuickNote and Work tabs', () => {
  assert.match(html, /data-page-key="kinder-chat-feedback" data-page-name="퀵노트"/);
  assert.match(html, /class="olliWorkTab active" role="tab" type="button">퀵노트<\/button>/);
  assert.match(html, /class="olliWorkTab olliWorkTabWithBadge" onclick="openOlliTalkBetaPage\(event\)" role="tab" type="button">Work<span[^>]*data-olli-work-badge[^>]*><\/span><\/button>/);
  assert.doesNotMatch(html, /id="kcfOlliTalkBtn"/);
  assert.doesNotMatch(html, /<span class="kcfModeTitle">1분 피드백<\/span>/);
  assert.doesNotMatch(html, /<div class="kcfModeSub">퀵모드<\/div>/);
  assert.match(html, /<div class="recordUtilityLabel">퀵노트<\/div>/);
});

test('QuickNote uses the Class input automatically and exposes a dialogue/continuous-record mode selector', () => {
  const rosterCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
  assert.match(html, /id="kcfModeSwitchBtn"/);
  assert.doesNotMatch(html, /id="kcfTeacherBtn"/);
  assert.match(rosterCss, /kcfTeacherRosterMode \.kcfComposerBottom \{[\s\S]*grid-template-columns:90px minmax\(0,1fr\) 33px/);
  assert.match(rosterCss, /kcfTeacherRosterMode \.kcfAutoStudentRoster \{[\s\S]*grid-column:2;[\s\S]*grid-row:2;/);
  assert.match(kcfJs, /function openKinderChatFeedbackComposerSheet\(event\)/);
  assert.match(kcfJs, /function autoResizeKinderChatFeedbackInput\(input\)[\s\S]*const height = 34;/);
});

test('Work page hides and disables the hamburger', () => {
  assert.match(html, /aria-disabled="true" aria-label="메뉴" class="olliTalkBetaBackBtn" disabled hidden title="메뉴" type="button"/);
  assert.doesNotMatch(html, /class="olliTalkBetaBackBtn" onclick="openOlliMainSubpageDrawer\(event, 'work'\)"/);
  assert.match(html, /class="olliTalkBetaMenuIcon"/);
  assert.doesNotMatch(html, /class="olliTalkBetaBackIcon"/);
  assert.match(html, /id="olliTalkContextTab" onclick="openOlliTalkContextPage\(event\)" role="tab" type="button">퀵노트<\/button>/);
  assert.match(html, /aria-selected="true" class="olliWorkTab active" role="tab" type="button">Work<\/button>/);
  assert.match(talkCss, /#olliTalkBetaScreen \.olliTalkBetaBackBtn:disabled\{[\s\S]*pointer-events:none;[\s\S]*opacity:1;/);
  assert.match(talkJs, /window\.openOlliTalkContextPage = openOlliTalkContextPage;/);
  assert.match(talkJs, /window\.openQuickNoteFromOlliTalk = openQuickNoteFromOlliTalk;/);
});

test('QuickNote and Work tabs use one shared visual source', () => {
  const rules = kcfCss.match(/\.olliWorkTabs\{/g) || [];
  assert.equal(rules.length, 1);
  assert.doesNotMatch(talkCss, /\.olliWorkTabs\{/);
});


test('QuickNote top blur keeps the Team Talk blur geometry without a white veil', () => {
  assert.match(kcfCss, /\.kcfTopFadeLayer\{[\s\S]*height:calc\(var\(--vivizac-memo-top-y\) \+ 70px\);[\s\S]*background:transparent;[\s\S]*backdrop-filter:blur\(2px\);[\s\S]*mask-image:linear-gradient\(to bottom,#000 0%,#000 58%,transparent 100%\)/);
});

test('QuickNote and Work tabs use the lighter label weights and selected gray', () => {
  assert.match(kcfCss, /\.olliWorkTab\{[\s\S]*height:40px;[\s\S]*font-weight:350;/);
  assert.match(kcfCss, /\.olliWorkTab\.active\{[\s\S]*background:rgba\(247,247,247,\.96\);[\s\S]*font-weight:450;/);
});


test('QuickNote and Work segmented control is taller without changing width', () => {
  assert.match(kcfCss, /\.olliWorkTabs\{[\s\S]*width:min\(160px,[\s\S]*height:48px;/);
});


test('QuickNote and Work segmented control keeps the hamburger depth without a doubled outer border', () => {
  const tabs = kcfCss.match(/\.olliWorkTabs\{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(tabs.includes('border:.5px solid transparent'));
  assert.ok(tabs.includes('inset 0 1px 0 rgba(255,255,255,0.96)'));
  assert.ok(tabs.includes('inset 1px 0 0 rgba(255,255,255,0.30)'));
  assert.ok(tabs.includes('0 0 0 1px rgba(255,255,255,0.62)'));
  assert.ok(tabs.includes('0 0 34px 10px rgba(0,0,0,0.045)'));
  assert.ok(tabs.includes('0 0 78px 22px rgba(0,0,0,0.035)'));
  assert.ok(!tabs.includes('border:.5px solid rgba(255,255,255,.88)'));
});


test('QuickNote and Work segmented control matches Team Talk glass treatment', () => {
  const tabs = kcfCss.match(/\.olliWorkTabs\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(tabs, /border:\.5px solid transparent;/);
  assert.match(tabs, /background:linear-gradient\([\s\S]*rgba\(255,255,255,\.66\) 0%[\s\S]*rgba\(255,255,255,\.46\) 46%[\s\S]*rgba\(255,255,255,\.30\) 100%/);
  assert.match(tabs, /backdrop-filter:blur\(2px\);/);
  assert.match(kcfCss, /\.olliWorkTabs::before\{[\s\S]*background:rgba\(255,255,255,\.30\);/);
  assert.match(kcfCss, /\.olliWorkTabs::after\{[\s\S]*box-shadow:inset -1px 0 0 rgba\(255,255,255,\.28\);/);
  assert.match(kcfCss, /\.olliWorkTab\{[\s\S]*position:relative;[\s\S]*z-index:2;/);
});


test('QuickNote keeps top blur without the white veil and adds matching bottom blur', () => {
  assert.match(kcfCss, /\.kcfTopFadeLayer\{[\s\S]*background:transparent;[\s\S]*backdrop-filter:blur\(2px\);[\s\S]*mask-image:linear-gradient\(to bottom,#000 0%,#000 58%,transparent 100%\)/);
  assert.doesNotMatch(kcfCss, /\.kcfTopFadeLayer\{[\s\S]*?rgba\(255,255,255,\.60\)/);
  assert.match(kcfCss, /\.kcfBottomFadeLayer\{[\s\S]*height:104px;[\s\S]*background:transparent;[\s\S]*backdrop-filter:blur\(2px\);[\s\S]*mask-image:linear-gradient\(to top,#000 0%,#000 54%,transparent 100%\)/);
  assert.match(html, /class="kcfBottomFadeLayer" id="kcfBottomFadeLayer"/);
});


test('QuickNote scroll surface reaches the physical top edge like Team Talk', () => {
  assert.match(kcfCss, /#kinderChatFeedbackScreen\s*\{[\s\S]*padding-top:0;/);
});


test('Work context tab switches its label and return target for observation pages', () => {
  assert.match(talkJs, /function isObservationOlliTalkContext\(\)[\s\S]*observationRosterScreen[\s\S]*studentMemoScreen/);
  assert.match(talkJs, /tab\.textContent = observation \? '관찰노트' : '퀵노트';/);
  assert.match(talkJs, /function openOlliTalkContextPage\(event\)[\s\S]*closeOlliTalkBetaPage\(event\)[\s\S]*openQuickNoteFromOlliTalk\(event\)/);
});

test('Work return to observation memo restores the editor utility portal', () => {
  assert.match(talkJs, /olliTalkBetaReturnPageId === 'studentMemoScreen'[\s\S]*classList\.remove\('observation-editor-keyboard-open'\)/);
  assert.match(talkJs, /olliTalkBetaReturnPageId === 'studentMemoScreen'[\s\S]*setObservationMemoEditorMode/);
  assert.match(talkJs, /olliTalkBetaReturnPageId === 'studentMemoScreen'[\s\S]*mountObservationMemoEditorTools/);
  assert.match(html, /olli-talk-beta\.js\?v=20260923-no-open-effect-1/);
});


test('Work page opens immediately without the old scale/fade entrance effect', () => {
  assert.doesNotMatch(talkJs, /OLLI_TALK_WORK_ENTER_MS/);
  assert.doesNotMatch(talkJs, /runOlliTalkWorkEnter/);
  assert.doesNotMatch(talkJs, /screen\.animate\([\s\S]*scale\(0\.985\)/);
  assert.doesNotMatch(talkJs, /screen\.style\.zIndex = '120500'/);
  assert.match(html, /olli-talk-beta\.js\?v=20260923-no-open-effect-1/);
});

test('QuickNote Observation roster memo and Work share the phone-screen corner radius', () => {
  assert.match(phoneBaseCss, /--olli-phone-screen-corner-radius:clamp\(46px, calc\(env\(safe-area-inset-top, 0px\) \+ 2px\), 56px\)/);
  assert.match(phoneBaseCss, /#kinderChatFeedbackScreen,[\s\S]*#observationRosterScreen,[\s\S]*#studentMemoScreen,[\s\S]*#olliTalkBetaScreen\s*\{[\s\S]*border-radius:var\(--olli-phone-screen-corner-radius\);[\s\S]*overflow:hidden;/);
});


test('QuickNote Observation roster memo and Work use the same soft left-edge page shadow', () => {
  assert.match(phoneBaseCss, /#kinderChatFeedbackScreen,[\s\S]*#observationRosterScreen,[\s\S]*#studentMemoScreen,[\s\S]*#olliTalkBetaScreen\s*\{[\s\S]*-18px 0 38px rgba\(0,0,0,\.10\)[\s\S]*-4px 0 14px rgba\(0,0,0,\.055\)/);
});


test('QuickNote Observation roster memo and Work share a 1.5px inner highlight', () => {
  assert.match(phoneBaseCss, /#kinderChatFeedbackScreen,[\s\S]*#observationRosterScreen,[\s\S]*#studentMemoScreen,[\s\S]*#olliTalkBetaScreen\s*\{[\s\S]*inset 0 0 0 1\.5px rgba\(255,255,255,\.55\)/);
});

test('Work keeps the shared inner highlight visible above its full-cover chat viewport', () => {
  assert.match(talkCss, /#olliTalkBetaScreen \.olliTalkBetaViewport::after\{[\s\S]*box-shadow:inset 0 0 0 1\.5px rgba\(255,255,255,\.55\);[\s\S]*pointer-events:none;/);
});






test('active QuickNote and Observation tabs share the darker gray background', () => {
  const css = fs.readFileSync('kinder-feedback.css', 'utf8');
  assert.match(css, /\.olliWorkTab\.active\{[\s\S]*?background:rgba\(242,242,242,\.96\);/);
});
