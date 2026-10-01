const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/makeup-cancel-prepare-tools.cjs'),'utf8');
test('makeup cancel reason is fixed server-side and absent from Agent tool schema',()=>{
  assert.ok(tool.includes('normalizeMakeupCancelReason'));
  const start=tool.indexOf('parameters:z.object({');
  const end=tool.indexOf('}),\n    async execute',start);
  assert.doesNotMatch(tool.slice(start,end),/reason/);
});
test('makeup cancel tool stores pending cancel card only',()=>{
  assert.ok(tool.includes("p_action_type:'cancel_makeup'") || tool.includes("p_action_type: 'cancel_makeup'"));
  assert.ok(tool.includes('olli_team_chat_send_action'));
  assert.ok(!tool.includes("callRpc('olli_team_chat_action_execute'"));
});
