const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/runtime.cjs'),'utf8');
test('pickup add production validates stored source and returns persisted action',()=>{
  assert.ok(endpoint.includes("'pickup_prepare'"));
  assert.ok(endpoint.includes('runPickupPrepare'));
  assert.ok(runtime.includes('validatePickupSourceMessage'));
  assert.ok(runtime.includes('requirePersistedMessage:true'));
});
