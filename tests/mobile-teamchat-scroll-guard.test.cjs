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
  const end=js.indexOf("\n    if (mentionTriggerButton)",start);
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

test('Team Chat direct input focus keeps preventScroll and the new script cache is active',()=>{
  assert.match(js,/input\.addEventListener\('pointerdown', event => \{[\s\S]*event\.preventDefault\(\)[\s\S]*input\.focus\(\{ preventScroll:true \}\)/);
  assert.match(html,/olli-talk-beta\.js\?v=20261007-bubble-layout-stage1-1/);
});

test('Team Chat keyboard focus does not duplicate chat anchoring across focus and visualViewport scroll',()=>{
  const focusStart=js.indexOf("input.addEventListener('focus'");
  const focusEnd=js.indexOf("input.addEventListener('blur'",focusStart);
  assert.ok(focusStart>=0 && focusEnd>focusStart);
  const focusBody=js.slice(focusStart,focusEnd);
  assert.match(focusBody,/isOlliTalkChatNearBottom\(chatArea,120\)/);
  assert.doesNotMatch(focusBody,/scheduleOlliTalkLatestMessageAnchor/);

  const viewportStart=js.indexOf('function bindViewport(){');
  const viewportEnd=js.indexOf('\n  const OLLI_TALK_INPUT_PLACEHOLDER',viewportStart);
  assert.ok(viewportStart>=0 && viewportEnd>viewportStart);
  const viewportBody=js.slice(viewportStart,viewportEnd);
  assert.match(viewportBody,/visualViewport\.addEventListener\('resize',[\s\S]*scheduleOlliTalkLatestMessageAnchor/);
  assert.match(viewportBody,/visualViewport\.addEventListener\('scroll',[\s\S]*syncOlliTalkComposerViewport\(\)/);
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
