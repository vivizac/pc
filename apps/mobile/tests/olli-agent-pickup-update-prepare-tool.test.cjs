const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/pickup-update-prepare-tools.cjs'),'utf8');
test('pickup update tool stores pending action and not direct pickup mutation',()=>{
  assert.ok(tool.includes('olli_team_chat_send_action'));
  assert.ok(tool.includes('update_pickup_arrival') || tool.includes('update_pickup_dropoff'));
  assert.ok(!tool.includes("callRpc('olli_schedule_save_pickup"));
});
