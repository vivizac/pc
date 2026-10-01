const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'../../../packages/common/olli-command-router-common.js'),'utf8');

function loadRouter(){
  const sandbox={window:{},console,Date};
  vm.runInNewContext(source,sandbox);
  return sandbox.window.OlliCommandRouter;
}

test('trial update parser identifies update commands and rejects add/cancel wording',()=>{
  const router=loadRouter();
  assert.equal(typeof router.parseTrialUpdateMutationIntent,'function');
  const parsed=router.parseTrialUpdateMutationIntent(
    '박하늘 10월 2일 4시 30분 A반 체험수업을 10월 3일 1시 B반으로 변경해줘'
  );
  assert.equal(parsed?.intent,'update_trial');
  assert.equal(parsed?.guestName,'박하늘');
  assert.equal(router.parseTrialUpdateMutationIntent('박하늘 10월 3일 1시 체험 등록해줘'),null);
  assert.equal(router.parseTrialUpdateMutationIntent('박하늘 10월 3일 체험 취소해줘'),null);
});

test('trial update parser is available to multi-write parsing without changing standalone Agent routing',()=>{
  const start=source.indexOf('function parseSingleWriteIntent');
  const end=source.indexOf('function parseMultiWriteIntent',start);
  assert.ok(start>=0&&end>start);
  assert.doesNotMatch(source.slice(start,end),/parseTrialUpdateMutationIntent/);
});
