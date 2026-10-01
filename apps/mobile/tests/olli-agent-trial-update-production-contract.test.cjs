const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const mobileRoot=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(mobileRoot,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const privacy=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/trial-guest-privacy.cjs'),'utf8');
const tool=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/tools/trial-update-prepare-tools.cjs'),'utf8');
const {validateTrialSourceMessage}=require('../api/_lib/olli-agent/runtime.cjs');

test('production trial_update_prepare requires persisted source message and returns only saved card',()=>{
  assert.match(endpoint,/'trial_update_prepare_probe'/);
  assert.match(endpoint,/'trial_update_prepare'/);
  assert.match(endpoint,/mode === 'trial_update_prepare'/);
  assert.match(endpoint,/trial_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint,/OLLI_AGENT_TRIAL_SOURCE_MESSAGE_REQUIRED/);
  assert.match(endpoint,/runTrialUpdatePrepare\(/);
  const marker="mode:'trial_update_prepare'";
  const start=endpoint.indexOf(marker);
  const block=start>=0?endpoint.slice(start,start+950):'';
  assert.match(block,/message:probe\.persistedMessage/);
  assert.match(block,/recoveredAfterPersist:probe\.recoveredAfterPersist===true/);
  assert.doesNotMatch(block,/safeText|subjectRefs|output:|guestName|oneTimeSessionId|targetTimeSlot/);
});

test('production trial update validates stored Team Chat source before Agent execution',()=>{
  const start=runtime.indexOf('async function runTrialUpdatePrepare({');
  const end=runtime.indexOf('\n\nfunction resolveWaitlistUpdatePrepareScope',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/validateTrialSourceMessage\(/);
  assert.ok(block.indexOf('validateTrialSourceMessage({')<block.indexOf('return runTrialUpdatePrepareAgent({'));
  assert.match(block,/requestId:'team-chat-message:'\+sourceId/);
  assert.match(block,/replyToMessageId:sourceId/);
  assert.match(block,/requirePersistedMessage:true/);
});

test('trial source binding accepts exact stored text and rejects changed text',async()=>{
  const requestContext={sessionToken:'secret',academyId:'academy-a',memberId:'member-a'};
  const exact=await validateTrialSourceMessage({
    requestContext,
    sourceMessageId:88,
    sourceMessageText:'박하늘 10월 2일 체험수업을 10월 3일 1시 B반으로 변경해줘',
    callRpc:async()=>({
      ok:true,
      current_member_id:'member-a',
      messages:[{
        id:88,
        sender_member_id:'member-a',
        message_type:'text',
        body:'@올리 박하늘 10월 2일 체험수업을 10월 3일 1시 B반으로 변경해줘'
      }]
    })
  });
  assert.equal(exact.id,88);

  await assert.rejects(
    validateTrialSourceMessage({
      requestContext,
      sourceMessageId:88,
      sourceMessageText:'박하늘 10월 2일 체험수업을 10월 4일로 변경해줘',
      callRpc:async()=>({
        ok:true,
        current_member_id:'member-a',
        messages:[{
          id:88,
          sender_member_id:'member-a',
          message_type:'text',
          body:'박하늘 10월 2일 체험수업을 10월 3일 1시 B반으로 변경해줘'
        }]
      })
    }),
    error=>error?.code==='OLLI_AGENT_TRIAL_SOURCE_MESSAGE_BODY_MISMATCH'
  );
});

test('production trial update keeps guest privacy before model execution',()=>{
  assert.match(endpoint,/mode === 'trial_update_prepare_probe' \|\| mode === 'trial_update_prepare'/);
  assert.match(endpoint,/prepareTrialGuestPrivacyInput\(message, requestContext\)/);
  const start=runtime.indexOf('async function runTrialUpdatePrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runTrialUpdatePrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.ok(block.indexOf('resolveTrialUpdatePrepareScope(preparedPrivacy)')>=0);
  assert.ok(block.indexOf('resolveTrialUpdatePrepareScope(preparedPrivacy)')<block.indexOf('assertOpenAiKey()'));
  assert.match(privacy,/preparePrivacySafeMessages/);
  assert.match(privacy,/replacementRuleCount|privacy:prepared\.privacy/);
});

test('production trial update reuses persisted-card recovery and never exposes internal tool ids to model schema',()=>{
  const start=runtime.indexOf('async function runTrialUpdatePrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runTrialUpdatePrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/capturePersistedMessage\(message\)/);
  assert.match(block,/pickupPersistedMessageForClient\(message\)/);
  assert.match(block,/runError=error/);
  assert.match(block,/requirePersistedMessage&&!persistedMessage/);
  assert.match(block,/recoveredAfterPersist:!!runError/);

  const schemaStart=tool.indexOf('parameters:z.object({');
  const schemaEnd=tool.indexOf('}),\n    async execute',schemaStart);
  const schema=tool.slice(schemaStart,schemaEnd);
  assert.doesNotMatch(schema,/guestName|studentName|oneTimeSessionId|timeSlot|academyId|memberId|division|sourceMessageId/);
});
