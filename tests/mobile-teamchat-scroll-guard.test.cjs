'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');

test('Team Chat blocks vertical composer drags from escaping into iOS page scrolling',()=>{
  const start=js.indexOf("if (input) {",js.indexOf("function init(){"));
  const end=js.indexOf("\n    bindOlliTalkComposerActivationControl(composerActivateButton, 'input');",start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);

  assert.match(body,/let composerTouchStartX = null/);
  assert.match(body,/let composerTouchStartY = null/);
  assert.match(body,/input\.closest\('\.olliTalkBetaComposer'\)/);
  assert.match(body,/composer\.addEventListener\('touchstart',[\s\S]*passive:true/);
  assert.match(body,/composer\.addEventListener\('touchmove',[\s\S]*classList\.contains\('olliTalkKeyboardOpen'\)[\s\S]*deltaY < 6 \|\| deltaY <= deltaX[\s\S]*event\.preventDefault\(\)[\s\S]*passive:false/);
  assert.match(body,/composer\.addEventListener\('touchend', clearComposerTouch, \{ passive:true \}\)/);
  assert.match(body,/composer\.addEventListener\('touchcancel', clearComposerTouch, \{ passive:true \}\)/);
});

test('Team Chat pauses composer viewport correction while the user owns chat scrolling',()=>{
  assert.match(js,/let olliTalkChatGestureActive = false/);
  assert.match(js,/function syncOlliTalkComposerViewport\(options = \{\}\)\{[\s\S]*olliTalkChatGestureActive && options\.force !== true[\s\S]*return;/);
  assert.match(js,/chatArea\.addEventListener\('pointerdown', beginOlliTalkChatGesture/);
  assert.match(js,/chatArea\.addEventListener\('touchstart', beginOlliTalkChatGesture/);
  assert.match(js,/window\.addEventListener\('touchend', endOlliTalkChatGesture/);
  assert.match(js,/syncOlliTalkComposerViewport\(\{ force:true \}\)/);
  assert.match(js,/!olliTalkChatGestureActive[\s\S]*olliTalkKeyboardFollowLatest/);
});

test('Team Chat keeps the chat scroller independent and reserves composer space above its messages',()=>{
  const area=css.match(/#olliTalkBetaScreen \.olliTalkBetaChatArea\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(area,/flex:1/);
  assert.match(area,/min-height:0/);
  assert.match(area,/padding:[\s\S]*var\(--olli-talk-chat-reserve, 74px\)/);
  assert.match(area,/overflow-y:auto/);
  assert.match(area,/overscroll-behavior-y:contain/);
  assert.match(area,/touch-action:pan-y/);
  assert.match(area,/overflow-anchor:none/);

  const syncStart=js.indexOf('function syncOlliTalkChatToComposer(){');
  const syncEnd=js.indexOf('\n  function scheduleOlliTalkChatToComposer()',syncStart);
  assert.ok(syncStart>=0 && syncEnd>syncStart);
  const syncBody=js.slice(syncStart,syncEnd);
  assert.match(syncBody,/setProperty\('--olli-talk-chat-reserve'/);
  assert.doesNotMatch(syncBody,/scrollTop\s*=/);
});

test('Team Chat keeps textarea free of activation hacks and delegates first touch to a button',()=>{
  const start=js.indexOf("if (input) {",js.indexOf("function init(){"));
  const end=js.indexOf("\n    bindOlliTalkComposerActivationControl(composerActivateButton, 'input');",start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);
  assert.doesNotMatch(body,/input\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(body,/focusOlliTalkComposerInput\(\)/);
  assert.match(body,/input\.addEventListener\('click', renderOlliTalkMentionMenu\)/);
  assert.match(html,/id="olliTalkComposerActivateBtn"/);
  assert.match(css,/\.olliTalkComposerActivateBtn\{[\s\S]*position:absolute;[\s\S]*inset:0;[\s\S]*z-index:4/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkComposerActivateBtn\{[\s\S]*visibility:hidden;[\s\S]*pointer-events:none/);
  assert.match(js,/bindOlliTalkComposerActivationControl\(composerActivateButton, 'input'\)/);
  assert.match(js,/bindOlliTalkComposerActivationControl\(mentionTriggerButton, 'mention'\)/);
  assert.doesNotMatch(js,/composerActivateButton\.addEventListener\('pointerdown'/);
  assert.match(html,/olli-talk-beta\.js\?v=20261008-scroll-authority-1/);
  assert.match(html,/olli-talk-beta\.css\?v=20261008-flip-motion-1/);
});

test('Team Chat keyboard focus does not duplicate chat anchoring across focus and visualViewport scroll',()=>{
  const focusStart=js.indexOf("input.addEventListener('focus'");
  const focusEnd=js.indexOf("input.addEventListener('blur'",focusStart);
  assert.ok(focusStart>=0 && focusEnd>focusStart);
  const focusBody=js.slice(focusStart,focusEnd);
  assert.match(focusBody,/isOlliTalkChatNearBottom\(chatArea,120\)/);
  assert.doesNotMatch(focusBody,/scheduleOlliTalkKeyboardViewportUpdate/);

  const viewportStart=js.indexOf('function bindViewport(){');
  const viewportEnd=js.indexOf('\n  const OLLI_TALK_INPUT_PLACEHOLDER',viewportStart);
  assert.ok(viewportStart>=0 && viewportEnd>viewportStart);
  const viewportBody=js.slice(viewportStart,viewportEnd);
  assert.match(viewportBody,/visualViewport\.addEventListener\('resize',[\s\S]*scheduleOlliTalkLatestMessageAnchor/);
  assert.match(viewportBody,/visualViewport\.addEventListener\('scroll',[\s\S]*scheduleOlliTalkKeyboardViewportUpdate/);
  const scrollHandler=viewportBody.slice(viewportBody.indexOf("visualViewport.addEventListener('scroll'"));
  assert.doesNotMatch(scrollHandler,/syncViewport\(\)/);
  assert.doesNotMatch(scrollHandler,/scheduleOlliTalkLatestMessageAnchor\(\)/);
});

test('Team Chat gesture state is cleared when entering or leaving the page',()=>{
  const openStart=js.indexOf('async function openOlliTalkBetaPage(event){');
  const openEnd=js.indexOf('\n  async function closeOlliTalkBetaPage',openStart);
  const closeStart=openEnd;
  const closeEnd=js.indexOf('\n  async function openOlliTalkContextPage',closeStart);
  assert.ok(openStart>=0 && openEnd>openStart && closeEnd>closeStart);
  assert.match(js.slice(openStart,openEnd),/olliTalkChatGestureActive = false/);
  assert.match(js.slice(closeStart,closeEnd),/olliTalkChatGestureActive = false/);
});


test('Team Chat coalesces keyboard events into one continuous RAF motion controller',()=>{
  assert.match(js,/const OLLI_TALK_KEYBOARD_FOLLOW_TAU_MS = 12/);
  assert.match(js,/function scheduleOlliTalkKeyboardViewportUpdate\(options = \{\}\)[\s\S]*requestAnimationFrame\(flushOlliTalkKeyboardViewportUpdate\)/);
  assert.match(js,/function stepOlliTalkKeyboardVisualController\(timestamp\)[\s\S]*Math\.exp\(-dt \/ OLLI_TALK_KEYBOARD_FOLLOW_TAU_MS\)[\s\S]*requestAnimationFrame\(stepOlliTalkKeyboardVisualController\)/);
  assert.match(js,/function preserveOlliTalkKeyboardVisualFrame\(frame[\s\S]*olliTalkComposerVisualOffsetY \+= deltaY[\s\S]*olliTalkMessagesVisualOffsetY \+= deltaY/);
  assert.match(js,/visualViewport\.addEventListener\('resize',[\s\S]*scheduleOlliTalkKeyboardViewportUpdate\(\{[\s\S]*anchorLatest:true/);
  assert.match(js,/visualViewport\.addEventListener\('scroll',[\s\S]*scheduleOlliTalkKeyboardViewportUpdate\(\{composerSync:true\}\)/);
  assert.doesNotMatch(js,/\.animate\(\s*\[/);
  assert.doesNotMatch(js,/VisualAnimation\?\.cancel|KeyboardVisualAnimations\(\)/);
  assert.match(js,/stopOlliTalkKeyboardVisualController\(\)/);
});

test('Team Chat uses only one message position owner per keyboard frame',()=>{
  const start=js.indexOf('function flushOlliTalkKeyboardViewportUpdate(){');
  const end=js.indexOf('\n  function scheduleOlliTalkKeyboardViewportUpdate',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);
  assert.match(body,/let anchoredLatest = false/);
  assert.match(body,/anchoredLatest = scheduleOlliTalkLatestMessageAnchor\(\)/);
  assert.match(body,/messages: !isOlliTalkPendingReasonInputActive\(\) && !anchoredLatest/);
});

test('Team Chat measures actual composer height excluding temporary visual motion',()=>{
  const start=js.indexOf('function getOlliTalkComposerLayoutGeometry(){');
  const end=js.indexOf('\n  function syncOlliTalkChatToComposer()',start);
  assert.ok(start>=0 && end>start);
  const block=js.slice(start,end);
  assert.match(block,/querySelector\('\.olliTalkBetaComposer'\)\?\.getBoundingClientRect\(\)\.height/);
  assert.match(block,/composerRect\.bottom - olliTalkComposerVisualOffsetY/);
  assert.match(block,/reserve: bottomGap \+ composerHeight \+ OLLI_TALK_COMPOSER_MESSAGE_GAP/);
  assert.match(js,/screen\.style\.getPropertyValue\('--olli-talk-chat-reserve'\) !== nextReserve/);
  assert.match(js,/const layoutMessageBottom = messageRect\.bottom - olliTalkMessagesVisualOffsetY/);
});

test('Server message rendering restores scroll synchronously rather than in a later keyboard frame',()=>{
  const start=js.indexOf('function renderOlliTalkServerMessages(payload,options={}){');
  const end=js.indexOf('\n  function getOlliTalkSearchRows()',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);
  assert.match(body,/if\(scrollMode==='preserve-prepend'\)[\s\S]*chatArea\.scrollTop=previousScrollTop\+addedHeight/);
  assert.match(body,/chatArea\.scrollTop=previousScrollTop/);
  assert.doesNotMatch(body,/requestAnimationFrame\(\(\) => \{\s*if \(!chatArea\.isConnected\) return;/);
});
