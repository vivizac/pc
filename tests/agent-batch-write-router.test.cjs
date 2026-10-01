const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function loadRouter(){
  const source=fs.readFileSync(path.join(__dirname,'../packages/common/olli-command-router-common.js'),'utf8');
  const window={};
  vm.runInNewContext(source,{window,console,Date,Math,setTimeout,clearTimeout});
  return window.OlliCommandRouter;
}

test('batch parser accepts connector comma and absence + makeup example',()=>{
  const router=loadRouter();
  const parsed=router.parseMultiWriteIntent('민지 오늘 결석 처리하고, 지수 토요일 1시 보강 등록해줘');
  assert.equal(parsed?.intent,'batch_write');
  assert.deepEqual(Array.from(parsed.commands,cmd=>cmd.intent),['mark_absent','add_makeup']);
  assert.equal(parsed.commands[0].studentName,'민지');
  assert.equal(parsed.commands[1].studentName,'지수');
});

test('batch parser includes update intents and one-time class',()=>{
  const router=loadRouter();
  const parsed=router.parseMultiWriteIntent(
    '민지 10월 3일 1시 보강을 10월 4일 2시로 변경해줘 그리고 지수 토요일 1시 수업 추가해줘'
  );
  assert.equal(parsed?.intent,'batch_write');
  assert.deepEqual(Array.from(parsed.commands,cmd=>cmd.intent),['update_makeup','add_class_once']);
});

test('batch stays bounded to 2 or 3 writes',()=>{
  const router=loadRouter();
  assert.equal(router.parseMultiWriteIntent('민지 오늘 결석 처리해줘'),null);
  const four='민지 오늘 결석 처리해줘; 지수 토요일 1시 보강 등록해줘; 수진 토요일 2시 보강 등록해줘; 하늘 토요일 3시 보강 등록해줘';
  assert.equal(router.parseMultiWriteIntent(four),null);
});
