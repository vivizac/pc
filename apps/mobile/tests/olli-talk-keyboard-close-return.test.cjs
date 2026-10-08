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
      'let olliTalkKeyboardClosing=false;',
      'const getScreen=()=>({classList:{contains:()=>true}});',
      'let olliTalkKeyboardClosingReturnLatest=false;',
      'let olliTalkKeyboardUserNavigatedChat=manual;',
      'let olliTalkChatGestureActive=gesture;',
      'let motion=0,updates=0;',
      'const beginOlliTalkKeyboardMotion=()=>{motion++;};',
      'const scheduleOlliTalkKeyboardViewportUpdate=(options)=>{if(options.fullSync)updates++;};',
      handler,
      'input.blur();',
      'return {pending:olliTalkKeyboardClosingReturnLatest,follow:olliTalkKeyboardFollowLatest,closing:olliTalkKeyboardClosing,motion,updates};'
    ].join('\n'));
    return get(input,latest,manual,gesture);
  }
  assert.deepEqual(simulate(true,false,false),{pending:true,follow:false,closing:true,motion:1,updates:1});
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
  assert.match(source,/\/\/ One final bottom reconciliation after iOS visualViewport finishes closing\./);
  assert.match(source,/olliTalkKeyboardClosing = false;\s*syncViewport\(\);/);
  assert.match(source,/if \(olliTalkKeyboardClosingReturnLatest\) \{\s*restoreOlliTalkKeyboardCloseLatest\(\);/);
  assert.match(source,/if \(closingFrame\) preserveOlliTalkKeyboardVisualFrame\(closingFrame\);/);
  assert.match(source,/if \(isOlliTalkComposerActive\(\)\) olliTalkKeyboardUserNavigatedChat = true;/);
});
test('the two-row composer stays expanded during keyboard descent, then collapses after settlement',()=>{
  const viewport=snippet('  function syncViewport(){','  function bindViewport(){');
  const mainOpen=viewport.indexOf("screen.classList.toggle('olliTalkKeyboardOpen', inputFocused || olliTalkKeyboardClosing);");
  assert.ok(mainOpen>0);
  const screen={classList:{active:false,toggle(name,value){if(name==='olliTalkKeyboardOpen')this.active=value;}}};
  const simulate=new Function('screen','focused','closing',
    'const getScreen=()=>screen;const isOlliTalkComposerActive=()=>focused;'
    +'const syncOlliTalkComposerViewport=()=>{};const hideOlliTalkMentionMenu=()=>{};'
    +'const syncOlliTalkChatToComposer=()=>{};const updateOlliTalkBetaComposerState=()=>{};'
    +'const syncOlliTalkInputPlaceholder=()=>{};'
    +viewport+'\nsyncViewport();return screen.classList.active;');
  assert.equal(simulate(screen,false,true),true,'blurred while keyboard descends remains two rows');
  assert.equal(simulate(screen,false,false),false,'after keyboard settlement it returns to one row');
  assert.equal(simulate(screen,true,false),true,'focused stays two rows');
  const motion=snippet('  function beginOlliTalkKeyboardMotion(){','  function continueOlliTalkKeyboardMotion(){');
  const finish=motion.indexOf('olliTalkKeyboardClosing = false;');
  const sync=motion.indexOf('syncViewport();',finish);
  assert.ok(finish>0&&sync>finish);
  assert.match(source,/if \(!isOlliTalkComposerActive\(\) && !olliTalkKeyboardClosing\) \{/);
  assert.match(source,/const OLLI_TALK_KEYBOARD_OPEN_FOLLOW_TAU_MS = 42;/);
});

test('keyboard follow timing remains unchanged during opening and closing',()=>{
  assert.match(source,/const OLLI_TALK_KEYBOARD_FOLLOW_TAU_MS = 32;/);
  assert.match(source,/const OLLI_TALK_KEYBOARD_OPEN_FOLLOW_TAU_MS = 42;/);
  assert.match(source,/olliTalkComposerVisualOffsetY \+= \(0 - olliTalkComposerVisualOffsetY\) \* follow;/);
  assert.match(source,/olliTalkMessagesVisualOffsetY \+= \(0 - olliTalkMessagesVisualOffsetY\) \* follow;/);
});
