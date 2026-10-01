const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const mobileRoot=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(mobileRoot,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const tool=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/tools/waitlist-add-prepare-tools.cjs'),'utf8');

test('production waitlist_add_prepare returns only the persisted action card',()=>{
  assert.match(endpoint,/'waitlist_add_prepare_probe'/);
  assert.match(endpoint,/'waitlist_add_prepare'/);
  assert.match(endpoint,/OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_REQUIRED/);

  const marker="mode:'waitlist_add_prepare'";
  const start=endpoint.indexOf(marker);
  const end=endpoint.indexOf("} else if (mode === 'waitlist_update_prepare_probe')",start);
  const block=start>=0&&end>start?endpoint.slice(start,end):'';
  assert.match(block,/message:probe\.persistedMessage/);
  assert.match(block,/recoveredAfterPersist:probe\.recoveredAfterPersist===true/);
  assert.doesNotMatch(block,/subjectRefs|privacy:|output:|studentId|studentName|targetTimeSlot/);
});

test('production waitlist add validates persisted source before Agent execution',()=>{
  const start=runtime.indexOf('async function runWaitlistAddPrepare({');
  const end=runtime.indexOf('\n\nfunction resolveWaitlistUpdatePrepareScope',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/validateWaitlistSourceMessage\(/);
  assert.ok(block.indexOf('validateWaitlistSourceMessage({')<block.indexOf('return runWaitlistAddPrepareAgent({'));
  assert.match(block,/requestId:'team-chat-message:'\+sourceId/);
  assert.match(block,/replyToMessageId:sourceId/);
  assert.match(block,/requirePersistedMessage:true/);
});

test('guest fallback is resolved before OpenAI execution',()=>{
  const start=runtime.indexOf('async function runWaitlistAddPrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runWaitlistAddPrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.ok(block.indexOf('resolveWaitlistAddPrepareScope(preparedPrivacy)')>=0);
  assert.ok(block.indexOf('resolveWaitlistAddPrepareScope(preparedPrivacy)')<block.indexOf('assertOpenAiKey()'));
});

test('persisted-card recovery is enabled for waitlist add',()=>{
  const start=runtime.indexOf('async function runWaitlistAddPrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runWaitlistAddPrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/capturePersistedMessage\(message\)/);
  assert.match(block,/pickupPersistedMessageForClient\(message\)/);
  assert.match(block,/runError=error/);
  assert.match(block,/requirePersistedMessage&&!persistedMessage/);
  assert.match(block,/recoveredAfterPersist:!!runError/);
});

test('model schema excludes source linkage and internal identifiers',()=>{
  assert.match(tool,/p_reply_to_message_id:replyId/);
  const start=tool.indexOf('parameters:z.object({');
  const end=tool.indexOf('}),\n    async execute',start);
  const schema=tool.slice(start,end);
  assert.doesNotMatch(schema,/sourceMessageId|replyToMessageId|requestId|studentId|studentName|waitlistId|timeSlot|academyId|memberId|division/);
});
