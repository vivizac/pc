'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('olli-talk-beta.js', 'utf8');
function snippet(start, end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Expected source boundaries');
  return source.slice(a,b);
}
function makeCloser({follow=true,manual=false,gesture=false,focused=false,reason=false,visible=true,connected=true}={}){
  const area={isConnected:connected,scrollHeight:1280,clientHeight:600,_top:300,
    get scrollTop(){return this._top;},
    set scrollTop(v){this._top=Math.min(Math.max(0,v),this.scrollHeight-this.clientHeight);}};
  let checks=0;
  const restoreSrc=snippet('  function restoreOlliTalkKeyboardCloseLatest(){','  function isOlliTalkComposerActive(){');
  const restore=new Function('context', [
    'let olliTalkKeyboardClosingReturnLatest=context.follow;',
    'let olliTalkChatGestureActive=context.gesture;',
    'const isOlliTalkComposerActive=()=>context.focused;',
    'const isOlliTalkPendingReasonInputActive=()=>context.reason;',
    'const isOlliTalkBetaVisible=()=>context.visible;',
    'const document={getElementById:(id)=>id==="olliTalkBetaChatArea"?context.area:null};',
    restoreSrc,
    'return restoreOlliTalkKeyboardCloseLatest;'
  ].join('\n'))({follow,gesture,focused,reason,visible,area});
  return {area,restore,checks};
}
test('keyboard closing returns the latest message to the bottom when it was following latest',()=>{
  const x=makeCloser();
  assert.equal(x.area.scrollTop,300);
  assert.equal(x.restore(),true);
  assert.equal(x.area.scrollTop,680);
});
test('closing leaves earlier chat scroll position untouched when latest follow was off',()=>{
  const x=makeCloser({follow:false});
  assert.equal(x.restore(),false);
  assert.equal(x.area.scrollTop,300);
});
test('closing never overrides manual gesture, another focused editor or hidden page',()=>{
  for(const option of [{gesture:true},{focused:true},{reason:true},{visible:false},{connected:false}]){
    const x=makeCloser(option);
    assert.equal(x.restore(),false);
    assert.equal(x.area.scrollTop,300);
  }
});
test('blur remembers whether following latest before it clears the active follow flag',()=>{
  const handler=snippet("      input.addEventListener('blur', () => {","      input.addEventListener('click', renderOlliTalkMentionMenu);");
  function simulate(latest,manual,gesture){
    const input={addEventListener:(type,fn)=>{input[type]=fn;}};
    const get=new Function('input','latest','manual','gesture', [
      'let olliTalkKeyboardFollowLatest=latest;',
      'let olliTalkKeyboardClosingReturnLatest=false;',
      'let olliTalkKeyboardUserNavigatedChat=manual;',
      'let olliTalkChatGestureActive=gesture;',
      'let motion=0,updates=0;',
      'const beginOlliTalkKeyboardMotion=()=>{motion++;};',
      'const scheduleOlliTalkKeyboardViewportUpdate=(options)=>{if(options.fullSync)updates++;};',
      handler,
      'input.blur();',
      'return {pending:olliTalkKeyboardClosingReturnLatest,follow:olliTalkKeyboardFollowLatest,motion,updates};'
    ].join('\n'));
    return get(input,latest,manual,gesture);
  }
  assert.deepEqual(simulate(true,false,false),{pending:true,follow:false,motion:1,updates:1});
  assert.equal(simulate(true,true,false).pending,false);
  assert.equal(simulate(true,false,true).pending,false);
  assert.equal(simulate(false,false,false).pending,false);
});
test('viewport resizing restores the bottom after geometry sync but before FLIP painting',()=>{
  const flush=snippet('  function flushOlliTalkKeyboardViewportUpdate(){','  function scheduleOlliTalkKeyboardViewportUpdate(options = {}){');
  const syncPos=flush.indexOf('if (fullSync) syncViewport();');
  const restorePos=flush.indexOf('if (fullSync) restoreOlliTalkKeyboardCloseLatest();');
  const paintPos=flush.indexOf('preserveOlliTalkKeyboardVisualFrame(motionFrame');
  assert.ok(syncPos>=0&&restorePos>syncPos&&paintPos>restorePos);
  assert.match(source,/\/\/ Hold the two-line composer through keyboard descent;/);
  assert.match(source,/if \(olliTalkKeyboardCollapsePending\) \{[\s\S]*?olliTalkKeyboardCollapsePending = false;[\s\S]*?syncViewport\(\);/);
  assert.match(source,/if \(closingFrame\) preserveOlliTalkKeyboardVisualFrame\(closingFrame\);/);
  assert.match(source,/if \(isOlliTalkComposerActive\(\)\) olliTalkKeyboardUserNavigatedChat = true;/);
});
test('blur keeps two rows throughout keyboard descent, then collapses after viewport settles',()=>{
  const begin=snippet('  function beginOlliTalkKeyboardMotion(){','  function continueOlliTalkKeyboardMotion(){');
  const sync=snippet('  function syncViewport(){','  function bindViewport(){');
  assert.match(source,/olliTalkKeyboardCollapsePending = true;\s*beginOlliTalkKeyboardMotion\(\);/);
  const run = new Function([
    'let olliTalkKeyboardCollapsePending = true;',
    'let olliTalkKeyboardClosingReturnLatest = true;',
    'let olliTalkKeyboardMotionTimer = null;',
    'const OLLI_TALK_KEYBOARD_MOTION_SETTLE_MS = 320;',
    'const active = new Set(["olliTalkKeyboardOpen"]);',
    'const screen={classList:{add(n){active.add(n);},remove(n){active.delete(n);},contains(n){return active.has(n);},toggle(n,v){if(v)active.add(n);else active.delete(n);}}};',
    'const getScreen=()=>screen;',
    'const isOlliTalkComposerActive=()=>false;',
    'const syncOlliTalkComposerViewport=()=>{};',
    'const hideOlliTalkMentionMenu=()=>{};',
    'const syncOlliTalkChatToComposer=()=>{};',
    'const updateOlliTalkBetaComposerState=()=>{};',
    'const syncOlliTalkInputPlaceholder=()=>{};',
    'let later=null,restored=0,painted=0;',
    'const clearTimeout=()=>{};',
    'const setTimeout=(fn)=>{later=fn;return 1;};',
    'const captureOlliTalkKeyboardVisualFrame=()=>({original:true});',
    'const restoreOlliTalkKeyboardCloseLatest=()=>{restored++;};',
    'const preserveOlliTalkKeyboardVisualFrame=()=>{painted++;};',
    begin,sync,
    'syncViewport();',
    'const during=active.has("olliTalkKeyboardOpen");',
    'beginOlliTalkKeyboardMotion();',
    'syncViewport();',
    'const still=active.has("olliTalkKeyboardOpen");',
    'later();',
    'return {during,still,after:active.has("olliTalkKeyboardOpen"),pending:olliTalkKeyboardCollapsePending,restored,painted};'
  ].join('\n'))();
  assert.deepEqual(run,{during:true,still:true,after:false,pending:false,restored:1,painted:1});
});

test('keyboard follow timing remains unchanged during opening and closing',()=>{
  assert.match(source,/const OLLI_TALK_KEYBOARD_FOLLOW_TAU_MS = 32;/);
  assert.match(source,/const OLLI_TALK_KEYBOARD_OPEN_FOLLOW_TAU_MS = 42;/);
  assert.match(source,/olliTalkComposerVisualOffsetY \+= \(0 - olliTalkComposerVisualOffsetY\) \* follow;/);
  assert.match(source,/olliTalkMessagesVisualOffsetY \+= \(0 - olliTalkMessagesVisualOffsetY\) \* follow;/);
});
