'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.resolve(__dirname,'..');
const router=fs.readFileSync(path.join(root,'packages/common/olli-command-router-common.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const pickup=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/tools/pickup-prepare-tools.cjs'),'utf8');

test('batch addition preflight covers makeup trial waitlist and pickup without another model call',()=>{
  assert.match(router,/\['add_makeup','add_trial','add_waitlist'\]\.includes\(action\)/);
  for(const source of [pc,mobile]){
    assert.match(source,/\['add_makeup','add_trial','add_waitlist','add_pickup'\]\.includes\(intent\)/);
    assert.match(source,/structuredSelection:selection/);
  }
});
test('pickup batch selection is source-of-truth checked as a current regular enrollment',()=>{
  assert.match(pickup,/selectedClassTime = 0/);
  assert.match(pickup,/OLLI_ROUTINE_PICKUP_REGULAR_CLASS_MISMATCH/);
  assert.match(runtime,/selectedClassTime:Number\(selection\.classTime\|\|0\)/);
});
test('trial and waitlist batch selections feed deterministic prepare SOTs',()=>{
  assert.match(runtime,/selection\.sessionDate/);
  assert.match(runtime,/selection\.classGroup/);
  assert.match(runtime,/prepareTrialAddAction/);
  assert.match(runtime,/prepareWaitlistAddAction/);
});
