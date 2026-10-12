const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

function scrollHarness({inline=true, sheet=false, height=40, top=0, roster=false, inComposer=true}={}) {
  const source = read('kcf-teacher-sheet.js');
  const start = source.indexOf('  function teacherScrollableTarget(');
  const end = source.indexOf('\n  function syncWarning()', start);
  const element = {scrollHeight:height, clientHeight:40, scrollTop:top,
    classList:{contains:()=>roster}};
  const target = {closest:selector=>selector.startsWith('#kinderChatFeedbackScreen')
    ? (inComposer ? {} : null) : element};
  const context = {state:{inlineOpen:inline},document:{body:{classList:{contains:()=>sheet}}}};
  vm.runInNewContext(source.slice(start, end), context);
  const move = (x,y) => {
    let prevented = false;
    context.preventTeacherBackgroundTouchMove({target,touches:[{clientX:x,clientY:y}],
      cancelable:true,preventDefault:()=>{prevented=true;}});
    return prevented;
  };
  context.trackTeacherComposerTouch({touches:[{clientX:100,clientY:100}]});
  return {move,context};
}

test('inline short input blocks vertical page pan, preserves taps and horizontal movement',()=>{
  const s=scrollHarness();
  assert.equal(s.move(100,120),true);
  assert.equal(s.move(100,103),false);
  assert.equal(s.move(120,102),false);
});
test('inline composer guard does not intercept conversation scrolling',()=>{
  assert.equal(scrollHarness({inComposer:false}).move(100,120),false);
});
test('long input scrolls internally but cannot drag beyond top or bottom',()=>{
  assert.equal(scrollHarness({height:200,top:80}).move(100,120),false);
  assert.equal(scrollHarness({height:200,top:0}).move(100,120),true);
  assert.equal(scrollHarness({height:200,top:0}).move(100,80),false);
  assert.equal(scrollHarness({height:200,top:160}).move(100,80),true);
  assert.equal(scrollHarness({height:200,top:160}).move(100,120),false);
});
test('continuous sheet retains short-input protection and long-text scrolling',()=>{
  assert.equal(scrollHarness({inline:false,sheet:true}).move(100,120),true);
  assert.equal(scrollHarness({inline:false,sheet:true,height:200,top:80}).move(100,120),false);
});
test('inline student-card row preserves horizontal swipe and blocks vertical page pan',()=>{
  const s=scrollHarness({roster:true});
  assert.equal(s.move(120,100),false);
  assert.equal(s.move(100,120),true);
});
test('finished touch does not reuse a previous gesture',()=>{
  const s=scrollHarness();s.context.clearTeacherComposerTouch();
  assert.equal(s.move(100,120),false);
});

test('memo entry and exit get a foreground layer before mounting the standby attendance',()=>{
  for(const className of ['observation-editor-slide-enter','observation-editor-slide-leave']) {
    const classes=new Set();let inlineZ='1',completed=0;
    const screen={offsetWidth:393,classList:{add:k=>classes.add(k),remove:(...ks)=>ks.forEach(k=>classes.delete(k))},
      addEventListener:()=>{},removeEventListener:()=>{}};
    const context={getObservationMemoScreen:()=>screen,cancelObservationMemoPageSlide:()=>{},
      clearObservationMemoSlideClasses:()=>classes.clear(),observationMemoSlideTimer:null,
      observationMemoSlideCancel:null,OBSERVATION_MEMO_SLIDE_MS:360,
      setTimeout:fn=>{context.finish=fn;return 1;},clearTimeout:()=>{},requestAnimationFrame:()=>{},
      window:{releaseOlliMainDrawerAttendanceRearPage:()=>{inlineZ='';},
        syncOlliMainDrawerAttendanceRearPage:()=>{inlineZ=inlineZ || (classes.has(className)?'120000':'1');}}};
    const source=read('olli-observation-roster-phone.js');
    vm.runInNewContext(source.slice(source.indexOf('function runObservationMemoPageSlide('),
      source.indexOf('\nfunction createObservationMemoSnapshot(')),context);
    context.runObservationMemoPageSlide(className,()=>completed++);
    assert.equal(inlineZ,'120000');
    assert.equal(completed,0);
    context.finish();assert.equal(completed,1);
  }
});
