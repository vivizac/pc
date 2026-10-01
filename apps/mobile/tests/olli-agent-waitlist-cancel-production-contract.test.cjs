const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/runtime.cjs'),'utf8');
test('waitlist cancel production is source-bound and persisted-card only',()=>{
  assert.ok(endpoint.includes("'waitlist_cancel_prepare'"));
  assert.ok(endpoint.includes('runWaitlistCancelPrepare'));
  assert.ok(runtime.includes('validateWaitlistSourceMessage'));
  assert.ok(runtime.includes('requirePersistedMessage:true'));
});
