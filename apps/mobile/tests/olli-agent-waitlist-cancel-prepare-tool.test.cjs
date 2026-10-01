const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/waitlist-cancel-prepare-tools.cjs'),'utf8');
test('waitlist cancel tool prepares pending action and never executes mutation directly',()=>{
  assert.ok(tool.includes("p_action_type:'cancel_waitlist'") || tool.includes("p_action_type: 'cancel_waitlist'"));
  assert.ok(tool.includes('olli_team_chat_send_action'));
  assert.ok(!tool.includes("callRpc('olli_team_chat_action_execute'"));
});
