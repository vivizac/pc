const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const autoCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const teacherJs = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const observationCss = fs.readFileSync('olli-observation-roster-phone.css', 'utf8');

test('empty KCF chat still owns vertical gestures without page overscroll', () => {
  const chatRule = css.match(/#kinderChatFeedbackScreen \.kcfChatArea\{[^}]*\}/)?.[0] || '';
  const sentinel = css.match(/#kinderChatFeedbackScreen \.kcfChatArea::after\{[^}]*\}/)?.[0] || '';
  assert.match(chatRule, /overflow-y:auto;/);
  assert.match(chatRule, /-webkit-overflow-scrolling:touch;/);
  assert.match(chatRule, /overscroll-behavior-y:contain;/);
  assert.match(chatRule, /touch-action:pan-y;/);
  assert.match(sentinel, /content:'';/);
  assert.match(sentinel, /height:1px;/);
  assert.match(sentinel, /pointer-events:none;/);
});

test('KCF composer layer follows visualViewport without locking document scroll', () => {
  assert.match(js, /function syncKinderChatFeedbackComposerViewport\(\)/);
  assert.match(js, /window\.visualViewport/);
  assert.match(js, /viewport \? Number\(viewport\.offsetLeft \|\| 0\) : 0/);
  assert.match(js, /viewport \? Number\(viewport\.offsetTop \|\| 0\) : 0/);
  assert.match(js, /viewport \? Number\(viewport\.width \|\| layoutWidth\) : layoutWidth/);
  assert.match(js, /viewport \? Number\(viewport\.height \|\| layoutHeight\) : layoutHeight/);
  assert.match(js, /--kcf-composer-vv-left/);
  assert.match(js, /--kcf-composer-vv-top/);
  assert.match(js, /--kcf-composer-vv-width/);
  assert.match(js, /--kcf-composer-vv-height/);
  assert.match(js, /visualViewport\.addEventListener\('resize', syncKinderChatFeedbackViewport/);
  const visualScroll = js.match(/window\.visualViewport\.addEventListener\('scroll',[\s\S]*?\}, \{ passive:true \}\);/)?.[0] || '';
  assert.match(visualScroll, /syncKinderChatFeedbackViewport\(\)/);
  assert.doesNotMatch(visualScroll, /resetKinderChatFeedbackRootViewportScroll\(\)/);
  assert.doesNotMatch(js, /kcfComposerViewportLocked/);
  assert.doesNotMatch(js, /preventKinderChatFeedbackKeyboardBackgroundTouchMove/);
});

test('KCF composer uses a dedicated fixed layer outside the chat inner layer', () => {
  assert.match(
    html,
    /<div class="kcfInner">[\s\S]*?<div class="kcfChatArea" id="kcfChatArea">\s*<\/div>\s*<\/div>\s*<div class="kcfComposerLayer" id="kcfComposerLayer">\s*<div class="kcfComposerWrap">/
  );

  const layer = css.match(/#kinderChatFeedbackScreen \.kcfComposerLayer \{[^}]*\}/)?.[0] || '';
  const wrap = css.match(/#kinderChatFeedbackScreen \.kcfComposerWrap \{[^}]*\}/)?.[0] || '';
  assert.match(layer, /position:fixed;/);
  assert.match(layer, /left:var\(--kcf-composer-vv-left\);/);
  assert.match(layer, /top:var\(--kcf-composer-vv-top\);/);
  assert.match(layer, /width:var\(--kcf-composer-vv-width\);/);
  assert.match(layer, /height:var\(--kcf-composer-vv-height\);/);
  assert.match(layer, /overflow:visible;/);
  assert.match(layer, /pointer-events:none;/);
  assert.match(wrap, /position:absolute;/);
  assert.match(wrap, /pointer-events:auto;/);
  assert.doesNotMatch(wrap, /position:fixed;/);

  assert.match(teacherCss, /kcfTeacherSheetOpen #kinderChatFeedbackScreen \.kcfComposerLayer/);
  assert.match(autoCss, /kcfDedicatedEditSheetOpen #kinderChatFeedbackScreen \.kcfComposerLayer/);
});

test('inline KCF keeps normal composer position without document scroll locking', () => {
  assert.match(js, /let kcfKeyboardBaselineBottom = 0;/);
  assert.match(js, /function getKinderChatFeedbackViewportBottom\(\)/);
  assert.match(js, /kcfKeyboardBaselineBottom - currentBottom/);
  assert.match(js, /viewportShrunk/);
  assert.match(js, /screen\.classList\.toggle\('kcfKeyboardOpen', keyboardOpen\)/);
  assert.doesNotMatch(js, /--kcf-composer-bottom/);
  assert.doesNotMatch(js, /kcfComposerViewportLocked/);
  assert.doesNotMatch(js, /setKinderChatFeedbackComposerViewportLocked/);
  assert.doesNotMatch(js, /preventKinderChatFeedbackKeyboardBackgroundTouchMove/);
  assert.doesNotMatch(js, /composerVisualOffset/);
});

test('keyboard-open KCF keeps the composer four pixels above the visual viewport bottom', () => {
  const rule = css.match(/#kinderChatFeedbackScreen\.kcfKeyboardOpen \.kcfComposerWrap \{[^}]*\}/)?.[0] || '';
  assert.match(rule, /bottom:4px;/);
  assert.match(rule, /padding-bottom:0;/);
});

test('persistent KCF top controls use independent fixed positioning', () => {
  const layer = css.match(/#kcfPersistentTopLayer \{[^}]*\}/)?.[0] || '';
  const headerCenter = css.match(/#kcfPersistentTopLayer \.kcfHeaderCenter\{[^}]*\}/)?.[0] || '';
  const roundButton = css.match(/#kcfPersistentTopLayer \.kcfRoundBtn\{[^}]*\}/)?.[0] || '';
  const modeButtons = css.match(/#kcfPersistentTopLayer #kcfOlliBtn,[\s\S]*?#kcfPersistentTopLayer #kcfInboxModeBtn\{[^}]*\}/)?.[0] || '';
  const inboxBubble = css.match(/#kcfPersistentTopLayer \.kcfVivicotInboxBubble \{[^}]*\}/)?.[0] || '';

  assert.doesNotMatch(layer, /transform:/);
  assert.doesNotMatch(layer, /--kcf-top-shift-y/);
  assert.match(headerCenter, /position:fixed;/);
  assert.match(roundButton, /position:fixed;/);
  assert.match(modeButtons, /position:fixed;/);
  assert.match(inboxBubble, /position:fixed;/);
  assert.doesNotMatch(headerCenter, /position:absolute;/);
  assert.doesNotMatch(roundButton, /position:absolute;/);
  assert.doesNotMatch(inboxBubble, /position:absolute;/);
});

test('persistent KCF header stays visible while the keyboard is open', () => {
  assert.doesNotMatch(css, /kcfKeyboardHidden/);
  assert.doesNotMatch(js, /kcfKeyboardHidden/);
  assert.doesNotMatch(js, /--kcf-top-shift-y/);
  assert.doesNotMatch(css, /--kcf-top-shift-y/);
});

test('voice icon is larger and keeps more space from the send button', () => {
  assert.match(css, /\.kcfVoiceBtn \{[\s\S]*?margin-right:12px;/);
  assert.match(css, /\.kcfVoiceBtn svg \{[\s\S]*?width:24px;[\s\S]*?height:24px;/);
});

test('send arrow is slightly larger while the circular button stays compact', () => {
  assert.match(css, /\.kcfSendBtn \{[\s\S]*?width:32px;[\s\S]*?height:32px;/);
  assert.match(css, /\.kcfSendBtn svg \{[\s\S]*?width:19px;[\s\S]*?height:19px;/);
});

test('KCF no longer keeps the legacy 190px fixed bottom underlay', () => {
  assert.doesNotMatch(css, /#kinderChatFeedbackScreen \.kcfInner::after\s*\{/);
  assert.doesNotMatch(css, /height:190px;/);
});

test('inline KCF composer keeps one small keyboard gap', () => {
  assert.match(css, /kcfKeyboardOpen \.kcfComposerWrap \{[\s\S]*?bottom:4px;[\s\S]*?padding-bottom:0;/);
  assert.match(css, /font-size:max\(16px, calc\(16px \* var\(--olli-text-scale\)\)\) !important;/);
});

test('normal composer remains a two-row inline source layout', () => {
  assert.match(css, /\.kcfComposer \{[\s\S]*?display:flex;[\s\S]*?flex-direction:column;[\s\S]*?gap:5px;/);
  assert.match(css, /\.kcfInput \{[\s\S]*?width:100%;/);
  assert.match(css, /\.kcfComposerBottom \{[\s\S]*?display:flex;[\s\S]*?width:100%;/);
  assert.doesNotMatch(css, /kcfComposerExpanded/);
});

test('Teacher sheet follows visualViewport independently from the inline composer', () => {
  assert.match(teacherJs, /global\.visualViewport/);
  assert.match(teacherJs, /--kcf-teacher-vv-top/);
  assert.match(teacherJs, /--kcf-teacher-vv-height/);
  assert.match(teacherCss, /top:var\(--kcf-teacher-vv-top, 0px\)/);
  assert.match(teacherCss, /height:var\(--kcf-teacher-vv-height, 100vh\)/);
});

test('Teacher iOS accessory Done closes by blur and Enter stays multiline', () => {
  assert.doesNotMatch(teacherJs, /enterkeyhint="done"/);
  assert.doesNotMatch(teacherJs, /input\.addEventListener\('keydown'/);
  const blur = teacherJs.match(/input\.addEventListener\('blur',[\s\S]*?\n      \}\);/)?.[0] || '';
  assert.match(blur, /state\.open && !state\.submitting/);
  assert.match(blur, /syncToBase\(\)/);
  assert.match(blur, /close\(\{ sync:false \}\)/);
  assert.doesNotMatch(blur, /submitKinderChatFeedback/);
});

test('observation memo body begins eight pixels higher', () => {
  assert.match(observationCss, /#studentMemoScreen\[data-memo-body-view="editor"\] #elementaryMemoWrap \{\s*padding-top:12px;\s*\}/);
});

test('KCF input suppresses the iOS gray tap highlight', () => {
  assert.match(css, /\.kcfComposerWrap \{[\s\S]*?-webkit-tap-highlight-color:transparent;/);
  assert.match(css, /\.kcfComposer \{[\s\S]*?-webkit-tap-highlight-color:transparent;/);
  assert.match(css, /\.kcfInput \{[\s\S]*?-webkit-tap-highlight-color:transparent;[\s\S]*?-webkit-appearance:none;/);
});

test('Teacher T and send retain symmetric inline source spacing', () => {
  assert.match(css, /\.kcfComposerBottom \{[\s\S]*?gap:0;[\s\S]*?padding-left:0;/);
});


test('Teacher bottom controls do not add safe-area space above the keyboard', () => {
  assert.match(teacherCss, /\.kcfTeacherSheetBody \{[\s\S]*?padding:8px 16px 0;/);
  assert.match(teacherCss, /\.kcfTeacherSheetBottom \{[\s\S]*?height:40px;/);
  assert.doesNotMatch(teacherCss, /safe-area-inset-bottom/);
});


test('send button does not start the 900ms composer focus-hold window', () => {
  const sendBinding = js.match(/document\.querySelectorAll\('#kcfSendBtn'\)[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.equal(sendBinding, '');
});

test('keyword buttons still keep the composer alive while their chip action runs', () => {
  assert.match(js, /kcfKeepInputFocusUntil = Date\.now\(\) \+ 1400/);
  assert.match(js, /btn\.addEventListener\('pointerdown', keepInputAlive\)/);
});


test('Class button text color is owned by kcf-auto-mode and is visibly lighter', () => {
  const autoCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
  assert.match(autoCss, /#kinderChatFeedbackScreen \.kcfTeacherBtn \{[\s\S]*?color:rgba\(17,17,17,\.50\) !important;/);
  assert.doesNotMatch(css, /#kinderChatFeedbackScreen \.kcfTeacherBtn \{[\s\S]*?color:rgba\(17,17,17,\.50\);/);
  assert.match(css, /#kinderChatFeedbackScreen \.kcfToolBtn \{[\s\S]*?color:#111;/);
});


test('QuickNote input grows with content while the keyboard is open and remains one line when closed', () => {
  const js = fs.readFileSync('kinder-feedback.js', 'utf8');
  const css = fs.readFileSync('kinder-feedback.css', 'utf8');
  assert.match(js, /const minHeight = 34;/);
  assert.match(js, /const maxHeight = 110;/);
  assert.match(js, /const canGrow = document\.activeElement === input \|\| !!screen\?\.classList\.contains\('kcfKeyboardOpen'\)/);
  assert.match(js, /input\.style\.height = 'auto';/);
  assert.match(js, /Math\.min\(maxHeight, input\.scrollHeight \|\| minHeight\)/);
  assert.match(js, /window\.autoResizeKinderChatFeedbackInput = autoResizeKinderChatFeedbackInput;/);
  assert.match(css, /grid-template-rows:minmax\(34px, auto\) 38px;/);
  assert.match(css, /kcfKeyboardOpen:not\(\.kcfTeacherRosterMode\) \.kcfInput \{[\s\S]*?max-height:110px;/);
});



test('QuickNote keyboard controller follows only the composer and leaves chat geometry native', () => {
  assert.match(js,/function syncKinderChatFeedbackViewport\(\)/);
  assert.match(js,/function bindKinderChatFeedbackViewport\(\)/);
  assert.match(js,/function syncKinderChatFeedbackComposerViewport\(\)/);
  assert.match(js,/function resetKinderChatFeedbackRootViewportScroll\(\)/);
  assert.match(js,/window\.scrollTo\(0, 0\)/);
  assert.doesNotMatch(js,/syncKinderChatFeedbackChatToComposer/);
  assert.doesNotMatch(js,/kcfComposerViewportLock/);
  assert.doesNotMatch(js,/kcfKeyboardTransitionActive/);
  assert.doesNotMatch(js,/kcfViewportMoving/);
  assert.doesNotMatch(js,/kcfChatGestureActive/);
});

test('QuickNote uses one full-height chat scroller without translating the message layer', () => {
  const rootRule = css.match(/#kinderChatFeedbackScreen \{[\s\S]*?\}/)?.[0] || '';
  const viewportRule = css.match(/#kinderChatFeedbackScreen \.kcfInner \{[\s\S]*?\}/)?.[0] || '';
  const chatRule = css.match(/#kinderChatFeedbackScreen \.kcfChatArea\{[\s\S]*?\}/)?.[0] || '';
  const listRule = css.match(/#kinderChatFeedbackScreen \.kcfMessageList\{[\s\S]*?\}/)?.[0] || '';
  const rowRule = css.match(/#kinderChatFeedbackScreen \.kcfMsgRow \{[\s\S]*?\}/)?.[0] || '';
  assert.doesNotMatch(rootRule,/position:fixed/);
  assert.match(viewportRule,/position:absolute/);
  assert.match(viewportRule,/inset:0/);
  assert.match(viewportRule,/overflow:hidden/);
  assert.match(chatRule,/flex:1/);
  assert.match(chatRule,/overflow-y:auto/);
  assert.match(chatRule,/overscroll-behavior-y:contain/);
  assert.match(chatRule,/touch-action:pan-y/);
  assert.match(chatRule,/overflow-anchor:none/);
  assert.match(listRule,/min-height:100%/);
  assert.match(listRule,/justify-content:flex-end/);
  assert.doesNotMatch(listRule,/transform:/);
  assert.doesNotMatch(listRule,/--kcf-message-lift/);
  assert.doesNotMatch(rowRule,/--kcf-message-lift/);
  assert.match(chatRule,/padding:112px 16px 176px;/);
  assert.doesNotMatch(css,/--kcf-chat-reserve/);
});

test('QuickNote message rendering appends into kcfMessageList while scrollTop stays owned by kcfChatArea', () => {
  assert.match(index,/id="kcfChatArea"[\s\S]*?id="kcfMessageList"/);
  assert.match(js,/const messageList = getKinderChatFeedbackMessageList\(\)/);
  assert.match(js,/messageList\.appendChild\(row\)/);
  assert.match(js,/area\.scrollTop = area\.scrollHeight/);
  assert.doesNotMatch(js,/kcfChatArea[^\n]*scrollTop\s*\+=/);
});

test('QuickNote programmatic refocus paths keep preventScroll protection', () => {
  const helperStart = js.indexOf('function focusKinderChatFeedbackInput()');
  const helperEnd = js.indexOf('function openKinderChatFeedbackPhotoPicker', helperStart);
  const helper = js.slice(helperStart, helperEnd);
  assert.match(helper,/focus\(\{ preventScroll:true \}\)/);
  assert.doesNotMatch(js,/if \(textInput\) textInput\.focus\(\);/);
  assert.match(js,/textInput\.focus\(\{ preventScroll:true \}\)/);
});


test('QuickNote guide area is excluded from vertical chat scrolling without shrinking the chat scroller', () => {
  const questionRule = css.match(/#kinderChatFeedbackScreen \.kcfQuestionGuide \{[\s\S]*?\}/)?.[0] || '';
  const keywordRule = css.match(/#kinderChatFeedbackScreen \.kcfKeywordScroller \{[\s\S]*?\}/)?.[0] || '';
  const buttonRule = css.match(/#kinderChatFeedbackScreen \.kcfKeywordBtn \{[\s\S]*?\}/)?.[0] || '';
  const chatRule = css.match(/#kinderChatFeedbackScreen \.kcfChatArea\{[\s\S]*?\}/)?.[0] || '';

  assert.match(questionRule,/touch-action:none/);
  assert.match(questionRule,/overscroll-behavior:contain/);
  assert.match(keywordRule,/touch-action:pan-x/);
  assert.match(keywordRule,/overscroll-behavior-y:none/);
  assert.match(buttonRule,/touch-action:pan-x/);
  assert.match(chatRule,/overflow-y:auto/);
});

test('QuickNote guide visibility does not recalculate chat geometry', () => {
  assert.match(js,/function applyKinderChatFeedbackGuideVisibility\(\)/);
  assert.doesNotMatch(js,/scheduleKinderChatFeedbackChatToComposer/);
  assert.doesNotMatch(js,/syncKinderChatFeedbackChatReserve/);
});

test('QuickNote guide touch guard blocks vertical fallthrough but preserves horizontal keyword swipe', () => {
  assert.match(js,/questionGuide\.addEventListener\('touchmove',[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?passive:false/);
  assert.match(js,/keywordScroller\.addEventListener\('touchmove',[\s\S]*?deltaY <= deltaX[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?passive:false/);
});


test('QuickNote composer does not hand vertical drag gestures to the page while keyboard is open', () => {
  assert.match(js,/const composer = input\.closest\('\.kcfComposer'\)/);
  assert.match(js,/composer\.addEventListener\('touchstart'/);
  assert.match(js,/composer\.addEventListener\('touchmove',[\s\S]*?classList\.contains\('kcfKeyboardOpen'\)[\s\S]*?deltaY <= deltaX[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?passive:false/);
});


test('QuickNote touch retap protects the focused input from transient iOS blur', () => {
  const start = js.indexOf("input.addEventListener('pointerdown'");
  const end = js.indexOf("input.addEventListener('focus'", start);
  const block = js.slice(start, end);

  assert.match(block,/event\.pointerType === 'touch'/);
  assert.match(block,/teacherEnabled/);
  assert.match(block,/kcfKeepInputFocusUntil = Date\.now\(\) \+ 900/);
  assert.match(block,/document\.activeElement !== input/);
  assert.match(block,/input\.focus\(\{ preventScroll:true \}\)/);
  assert.match(js,/if \(Date\.now\(\) < kcfKeepInputFocusUntil\)[\s\S]*?currentInput\.focus\(\{ preventScroll:true \}\)/);
});

test('QuickNote keyboard focus never force-resets the root document while iOS is opening the keyboard', () => {
  const start = js.indexOf("input.addEventListener('focus'", js.indexOf('function bindKinderChatFeedbackViewportInteractions'));
  const end = js.indexOf("input.addEventListener('blur'", start);
  const block = js.slice(start, end);

  assert.match(block,/captureKinderChatFeedbackKeyboardBaseline\(true\)/);
  assert.match(block,/syncKinderChatFeedbackViewport\(\)/);
  assert.doesNotMatch(block,/scheduleKinderChatFeedbackRootViewportReset\(\)/);
  assert.doesNotMatch(block,/resetKinderChatFeedbackRootViewportScroll\(\)/);
});


test('QuickNote Class mode can still intentionally hand focus to the Teacher sheet', () => {
  const start = js.indexOf("input.addEventListener('pointerdown'");
  const end = js.indexOf("input.addEventListener('focus'", start);
  const block = js.slice(start, end);
  assert.match(block,/if \(!teacherEnabled\) \{[\s\S]*?kcfKeepInputFocusUntil/);
});
