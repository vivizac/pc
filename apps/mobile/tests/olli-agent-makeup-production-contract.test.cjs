const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/runtime.cjs'),'utf8');
test('makeup add update cancel production modes exist and are source-bound',()=>{
  for(const mode of ["'makeup_prepare'","'makeup_update_prepare'","'makeup_cancel_prepare'"]) assert.ok(endpoint.includes(mode),mode);
  for(const fn of ['runMakeupPrepare','runMakeupUpdatePrepare','runMakeupCancelPrepare']) assert.ok(runtime.includes(fn),fn);
});
test('makeup cancel validates separate stored reason message',()=>{
  assert.ok(runtime.includes('validateMakeupReasonMessage'));
  assert.ok(endpoint.includes('reasonMessageId'));
  assert.ok(endpoint.includes('reasonMessageText'));
});
