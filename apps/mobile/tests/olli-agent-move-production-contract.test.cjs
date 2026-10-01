const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const mobileRoot=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(mobileRoot,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const tool=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/tools/move-prepare-tools.cjs'),'utf8');

test('production move_prepare requires stored source and returns only persisted action card',()=>{
  assert.match(endpoint,/'move_prepare_probe'/);
  assert.match(endpoint,/'move_prepare'/);
  assert.match(endpoint,/move_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint,/OLLI_AGENT_MOVE_SOURCE_MESSAGE_REQUIRED/);

  const marker="mode:'move_prepare'";
  const start=endpoint.indexOf(marker);
  const end=endpoint.indexOf("} else if (mode === 'move_cancel_prepare_probe')",start);
  const block=start>=0&&end>start?endpoint.slice(start,end):'';
  assert.match(block,/message:probe\.persistedMessage/);
  assert.match(block,/recoveredAfterPersist:probe\.recoveredAfterPersist===true/);
  assert.doesNotMatch(block,/safeText|subjectRefs|output:|studentId|studentName|sourceEnrollmentId|timeSlot/);
});

test('production move validates stored Team Chat source before Agent run',()=>{
  const start=runtime.indexOf('async function runMovePrepare({');
  const end=runtime.indexOf('\nasync function runMoveCancelPrepare({',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/validateMoveSourceMessage\(/);
  assert.ok(block.indexOf('validateMoveSourceMessage({')<block.indexOf('return runMovePrepareAgent({'));
  assert.match(block,/requestId:'team-chat-message:'\+sourceId/);
  assert.match(block,/replyToMessageId:sourceId/);
  assert.match(block,/requirePersistedMessage:true/);
});

test('move scope is resolved before OpenAI and persisted-card recovery is enabled',()=>{
  const start=runtime.indexOf('async function runMovePrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runMovePrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.ok(block.indexOf('resolveMovePrepareScope(preparedPrivacy)')>=0);
  assert.ok(block.indexOf('resolveMovePrepareScope(preparedPrivacy)')<block.indexOf('assertOpenAiKey()'));
  assert.match(block,/pickupPersistedMessageForClient\(message\)/);
  assert.match(block,/runError=error/);
  assert.match(block,/requirePersistedMessage&&!persistedMessage/);
  assert.match(block,/recoveredAfterPersist:!!runError/);
});

test('move instructions preserve source group server-side and forbid internal ids',()=>{
  const start=runtime.indexOf('async function runMovePrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runMovePrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/server preserves the current source group when possible/i);
  assert.match(block,/Never ask for, infer, or reveal a real student name, UUID, enrollment ID, internal time slot/i);
});

test('model schema excludes source linkage and internal identifiers',()=>{
  assert.match(tool,/p_reply_to_message_id:replyId/);
  const start=tool.indexOf('parameters:z.object({');
  const end=tool.indexOf('}),\n    async execute',start);
  const schema=tool.slice(start,end);
  assert.doesNotMatch(schema,/sourceMessageId|replyToMessageId|requestId|studentId|studentName|sourceEnrollmentId|timeSlot|academyId|memberId|division|effectiveDate/);
});
