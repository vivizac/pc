const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const mobileRoot=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(mobileRoot,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const tool=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/tools/waitlist-update-prepare-tools.cjs'),'utf8');
const {validateWaitlistSourceMessage}=require('../api/_lib/olli-agent/runtime.cjs');

test('production waitlist_update_prepare requires a saved source message',()=>{
  assert.match(endpoint,/'waitlist_update_prepare_probe'/);
  assert.match(endpoint,/'waitlist_update_prepare'/);
  assert.match(endpoint,/mode === 'waitlist_update_prepare'/);
  assert.match(endpoint,/waitlist_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint,/OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_REQUIRED/);
  assert.match(endpoint,/runWaitlistUpdatePrepare\(/);
  const marker="mode:'waitlist_update_prepare'";
  const start=endpoint.indexOf(marker);
  const block=start>=0?endpoint.slice(start,start+950):'';
  assert.match(block,/message:probe\.persistedMessage/);
  assert.match(block,/recoveredAfterPersist:probe\.recoveredAfterPersist === true/);
  assert.doesNotMatch(block,/subjectRefs|privacy:|output:|studentId|studentName|waitlistId|targetTimeSlot/);
});

test('production waitlist update validates stored source before Agent execution',()=>{
  const start=runtime.indexOf('async function runWaitlistUpdatePrepare({');
  const end=runtime.indexOf('\n\nfunction resolveWaitlistCancelPrepareScope',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/Number\.isSafeInteger\(sourceId\)/);
  assert.ok(block.indexOf('validateWaitlistSourceMessage({')>=0);
  assert.ok(block.indexOf('validateWaitlistSourceMessage({')<block.indexOf('return runWaitlistUpdatePrepareAgent({'));
  assert.match(block,/requestId:'team-chat-message:' \+ sourceId/);
  assert.match(block,/replyToMessageId:sourceId/);
  assert.match(block,/requirePersistedMessage:true/);
});

test('production waitlist update uses persisted-card recovery',()=>{
  const start=runtime.indexOf('async function runWaitlistUpdatePrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runWaitlistUpdatePrepareProbe',start);
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

test('waitlist source binding accepts exact text and rejects changed text',async()=>{
  const requestContext={sessionToken:'secret',academyId:'academy-a',memberId:'member-a'};
  const exact=await validateWaitlistSourceMessage({
    requestContext,
    sourceMessageId:77,
    sourceMessageText:'학생A 대기를 토요일 1시 B반으로 변경해줘',
    callRpc:async()=>({
      ok:true,
      current_member_id:'member-a',
      messages:[{id:77,sender_member_id:'member-a',message_type:'text',body:'@올리 학생A 대기를 토요일 1시 B반으로 변경해줘'}]
    })
  });
  assert.equal(exact.id,77);

  await assert.rejects(
    validateWaitlistSourceMessage({
      requestContext,
      sourceMessageId:77,
      sourceMessageText:'학생A 대기를 금요일 4시로 변경해줘',
      callRpc:async()=>({
        ok:true,
        current_member_id:'member-a',
        messages:[{id:77,sender_member_id:'member-a',message_type:'text',body:'학생A 대기를 토요일 1시 B반으로 변경해줘'}]
      })
    }),
    error=>error?.code==='OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_BODY_MISMATCH'
  );
});

test('guest fallback is decided before OpenAI runtime execution',()=>{
  const start=runtime.indexOf('async function runWaitlistUpdatePrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runWaitlistUpdatePrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.ok(block.indexOf('resolveWaitlistUpdatePrepareScope(preparedPrivacy)')>=0);
  assert.ok(block.indexOf('resolveWaitlistUpdatePrepareScope(preparedPrivacy)')<block.indexOf('assertOpenAiKey()'));
});
