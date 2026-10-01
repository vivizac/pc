const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const mobileRoot=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(mobileRoot,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const privacy=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/trial-guest-privacy.cjs'),'utf8');
const tool=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/tools/trial-cancel-prepare-tools.cjs'),'utf8');
const {
  validateTrialReasonMessage,
}=require('../api/_lib/olli-agent/runtime.cjs');

test('production trial_cancel_prepare requires persisted command and reason messages',()=>{
  assert.match(endpoint,/'trial_cancel_prepare_probe'/);
  assert.match(endpoint,/'trial_cancel_prepare'/);
  assert.match(endpoint,/trial_cancel_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint,/trial_cancel_prepare에는 저장된 체험 취소 사유 메시지와 사유가 필요합니다/);
  assert.match(endpoint,/runTrialCancelPrepare\(/);

  const marker="mode:'trial_cancel_prepare'";
  const start=endpoint.indexOf(marker);
  const end=endpoint.indexOf("} else if (mode === 'trial_update_prepare_probe')",start);
  const block=start>=0&&end>start?endpoint.slice(start,end):'';
  assert.match(block,/message:probe\.persistedMessage/);
  assert.match(block,/recoveredAfterPersist:probe\.recoveredAfterPersist===true/);
  assert.doesNotMatch(block,/safeText|subjectRefs|output:|guestName|oneTimeSessionId|timeSlot/);
});

test('production trial cancel validates both persisted messages before Agent execution',()=>{
  const start=runtime.indexOf('async function runTrialCancelPrepare({');
  const end=runtime.indexOf('\n\nfunction resolveTrialUpdatePrepareScope',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/validateTrialSourceMessage\(/);
  assert.match(block,/validateTrialReasonMessage\(/);
  assert.ok(block.indexOf('validateTrialSourceMessage({')<block.indexOf('return runTrialCancelPrepareAgent({'));
  assert.ok(block.indexOf('validateTrialReasonMessage({')<block.indexOf('return runTrialCancelPrepareAgent({'));
  assert.match(block,/requestId:'team-chat-trial-cancel:'\+sourceId\+':'\+reasonId/);
  assert.match(block,/replyToMessageId:reasonId/);
  assert.match(block,/requirePersistedMessage:true/);
});

test('reason message binding accepts exact stored text and rejects a detached reason',async()=>{
  const requestContext={sessionToken:'secret',academyId:'academy-a',memberId:'member-a'};
  const exact=await validateTrialReasonMessage({
    requestContext,
    reasonMessageId:88,
    reasonMessageText:'사유: 가족여행',
    reason:'가족여행',
    callRpc:async()=>({
      ok:true,
      current_member_id:'member-a',
      messages:[{
        id:88,
        sender_member_id:'member-a',
        message_type:'text',
        body:'@올리 사유: 가족여행'
      }]
    })
  });
  assert.equal(exact.reason,'가족여행');

  await assert.rejects(
    validateTrialReasonMessage({
      requestContext,
      reasonMessageId:88,
      reasonMessageText:'사유: 가족여행',
      reason:'병원',
      callRpc:async()=>({
        ok:true,
        current_member_id:'member-a',
        messages:[{
          id:88,
          sender_member_id:'member-a',
          message_type:'text',
          body:'사유: 가족여행'
        }]
      })
    }),
    error=>error?.code==='OLLI_AGENT_TRIAL_REASON_BODY_MISMATCH'
  );
});

test('trial cancellation reason is removed before privacy-safe model input',()=>{
  assert.match(endpoint,/prepareTrialCancelPrivacyInput\(message, reason\)/);
  assert.match(privacy,/function prepareTrialCancelPrivacyInput/);

  const start=runtime.indexOf('async function runTrialCancelPrepareAgent({');
  const end=runtime.indexOf('\n\nasync function validateTrialReasonMessage',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/cancellation reason is private server-side context/i);
  assert.doesNotMatch(block,/preparedPrivacy\.safeText.*reason|reason.*preparedPrivacy\.safeText/);

  const schemaStart=tool.indexOf('parameters:z.object({');
  const schemaEnd=tool.indexOf('}),\n    async execute',schemaStart);
  const schema=tool.slice(schemaStart,schemaEnd);
  assert.doesNotMatch(schema,/reason/);
});

test('persisted-card recovery remains enabled for trial cancellation',()=>{
  const start=runtime.indexOf('async function runTrialCancelPrepareAgent({');
  const end=runtime.indexOf('\n\nasync function validateTrialReasonMessage',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/capturePersistedMessage\(message\)/);
  assert.match(block,/pickupPersistedMessageForClient\(message\)/);
  assert.match(block,/runError=error/);
  assert.match(block,/requirePersistedMessage&&!persistedMessage/);
  assert.match(block,/recoveredAfterPersist:!!runError/);
});
