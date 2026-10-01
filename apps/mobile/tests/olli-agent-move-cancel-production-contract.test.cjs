const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const mobileRoot=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(mobileRoot,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const tool=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/tools/move-cancel-prepare-tools.cjs'),'utf8');
const {validateMoveSourceMessage}=require('../api/_lib/olli-agent/runtime.cjs');

test('production move_cancel_prepare requires stored source and returns only persisted card',()=>{
  assert.match(endpoint,/'move_cancel_prepare_probe'/);
  assert.match(endpoint,/'move_cancel_prepare'/);
  assert.match(endpoint,/move_cancel_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint,/OLLI_AGENT_MOVE_SOURCE_MESSAGE_REQUIRED/);

  const marker="mode:'move_cancel_prepare'";
  const start=endpoint.indexOf(marker);
  const end=endpoint.indexOf("} else if (mode === 'pickup_prepare_probe')",start);
  const block=start>=0&&end>start?endpoint.slice(start,end):'';
  assert.match(block,/message:probe\.persistedMessage/);
  assert.match(block,/recoveredAfterPersist:probe\.recoveredAfterPersist===true/);
  assert.doesNotMatch(block,/safeText|subjectRefs|output:|studentId|studentName|changeId|enrollmentId|timeSlot/);
});

test('production move cancel validates Team Chat source before Agent run',()=>{
  const start=runtime.indexOf('async function runMoveCancelPrepare({');
  const end=runtime.indexOf('\nasync function runMakeupPrepare({',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/validateMoveSourceMessage\(/);
  assert.ok(block.indexOf('validateMoveSourceMessage({')<block.indexOf('return runMoveCancelPrepareAgent({'));
  assert.match(block,/requestId:'team-chat-message:'\+sourceId/);
  assert.match(block,/replyToMessageId:sourceId/);
  assert.match(block,/requirePersistedMessage:true/);
});

test('move source binding accepts exact text and rejects changed text',async()=>{
  const requestContext={sessionToken:'secret',academyId:'academy-a',memberId:'member-a'};
  const exact=await validateMoveSourceMessage({
    requestContext,
    sourceMessageId:77,
    sourceMessageText:'학생A 월요일 4시 수업 이동 예약 취소해줘',
    callRpc:async()=>({
      ok:true,
      current_member_id:'member-a',
      messages:[{id:77,sender_member_id:'member-a',message_type:'text',body:'@올리 학생A 월요일 4시 수업 이동 예약 취소해줘'}]
    })
  });
  assert.equal(exact.id,77);

  await assert.rejects(
    validateMoveSourceMessage({
      requestContext,
      sourceMessageId:77,
      sourceMessageText:'학생A 화요일 5시 수업 이동 예약 취소해줘',
      callRpc:async()=>({
        ok:true,
        current_member_id:'member-a',
        messages:[{id:77,sender_member_id:'member-a',message_type:'text',body:'학생A 월요일 4시 수업 이동 예약 취소해줘'}]
      })
    }),
    e=>e?.code==='OLLI_AGENT_MOVE_SOURCE_MESSAGE_BODY_MISMATCH'
  );
});

test('move cancellation scope resolves before OpenAI and production supports persisted-card recovery',()=>{
  const start=runtime.indexOf('async function runMoveCancelPrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runMoveCancelPrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.ok(block.indexOf('resolveMoveCancelPrepareScope(preparedPrivacy)')>=0);
  assert.ok(block.indexOf('resolveMoveCancelPrepareScope(preparedPrivacy)')<block.indexOf('assertOpenAiKey()'));
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
  assert.doesNotMatch(schema,/sourceMessageId|replyToMessageId|requestId|studentId|studentName|changeId|enrollmentId|timeSlot|academyId|memberId|division/);
});
