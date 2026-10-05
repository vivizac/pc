'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const trial=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/trial-guest-privacy.cjs'),'utf8');
const wait=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/waitlist-guest-privacy.cjs'),'utf8');

test('batch guest division selected by deterministic buttons can enter direct SOT without another AI call',()=>{
  assert.match(trial,/divisionOverride/);
  assert.match(wait,/divisionOverride/);
  assert.match(runtime,/structuredSelection\?\.division/);
  assert.match(runtime,/prepareTrialGuestPrivacyInput\(text,selectedDivision\)/);
  assert.match(runtime,/prepareWaitlistGuestPrivacyInput\(text,selectedDivision\)/);
});
test('batch cancellation and clarification source checks use the correct deterministic scope',()=>{
  const start=runtime.indexOf("}else if(intent==='cancel_makeup')");
  const block=runtime.slice(start,start+1400);
  assert.match(block,/resolveMakeupCancelPrepareScope/);
  assert.doesNotMatch(block,/resolveMakeupUpdatePrepareScope/);
  assert.match(runtime,/item\?\.contextText\|\|item\?\.text/);
});
