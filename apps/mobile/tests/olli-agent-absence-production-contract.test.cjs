const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const mobileRoot=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(mobileRoot,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const privacy=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/privacy.cjs'),'utf8');
const tool=fs.readFileSync(path.join(mobileRoot,'api/_lib/olli-agent/tools/absence-prepare-tools.cjs'),'utf8');
const {
  validateAbsenceReasonMessage,
}=require('../api/_lib/olli-agent/runtime.cjs');

test('production absence_prepare requires stored command and reason messages',()=>{
  assert.match(endpoint,/'absence_prepare_probe'/);
  assert.match(endpoint,/'absence_prepare'/);
  assert.match(endpoint,/absence_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint,/absence_prepare에는 저장된 결석 사유 메시지와 사유가 필요합니다/);
  assert.match(endpoint,/runAbsencePrepare\(/);

  const marker="mode:'absence_prepare'";
  const start=endpoint.indexOf(marker);
  const end=endpoint.indexOf("} else if (mode === 'class_once_prepare_probe')",start);
  const block=start>=0&&end>start?endpoint.slice(start,end):'';
  assert.match(block,/message:probe\.persistedMessage/);
  assert.match(block,/recoveredAfterPersist:probe\.recoveredAfterPersist===true/);
  assert.doesNotMatch(block,/safeText|subjectRefs|output:|studentId|timeSlot/);
});

test('absence privacy path removes reason before privacy-safe model input',()=>{
  assert.match(endpoint,/prepareAbsencePrivacyInput\(/);
  assert.match(privacy,/async function prepareAbsencePrivacyInput/);

  const start=runtime.indexOf('async function runAbsencePrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runAbsencePrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/absence reason is private server-side context/i);
  assert.doesNotMatch(block,/preparedPrivacy\.safeText.*reason|reason.*preparedPrivacy\.safeText/);

  const schemaStart=tool.indexOf('parameters:z.object({');
  const schemaEnd=tool.indexOf('}),\n    async execute',schemaStart);
  assert.doesNotMatch(tool.slice(schemaStart,schemaEnd),/reason/);
});

test('production absence validates source and reason messages before Agent execution',()=>{
  const start=runtime.indexOf('async function runAbsencePrepare({');
  const end=runtime.indexOf('\n\nasync function validateClassOnceSourceMessage',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/validateAbsenceSourceMessage\(/);
  assert.match(block,/validateAbsenceReasonMessage\(/);
  assert.ok(block.indexOf('validateAbsenceSourceMessage({')<block.indexOf('return runAbsencePrepareAgent({'));
  assert.ok(block.indexOf('validateAbsenceReasonMessage({')<block.indexOf('return runAbsencePrepareAgent({'));
  assert.match(block,/requestId:'team-chat-absence:'\+sourceId\+':'\+reasonId/);
  assert.match(block,/replyToMessageId:reasonId/);
  assert.match(block,/requirePersistedMessage:true/);
});

test('absence reason binding accepts exact stored text and rejects detached reason',async()=>{
  const requestContext={sessionToken:'secret',academyId:'academy-a',memberId:'member-a'};
  const exact=await validateAbsenceReasonMessage({
    requestContext,
    reasonMessageId:88,
    reasonMessageText:'사유: 감기',
    reason:'감기',
    callRpc:async()=>({
      ok:true,
      current_member_id:'member-a',
      messages:[{
        id:88,
        sender_member_id:'member-a',
        message_type:'text',
        body:'@올리 사유: 감기'
      }]
    })
  });
  assert.equal(exact.reason,'감기');

  await assert.rejects(
    validateAbsenceReasonMessage({
      requestContext,
      reasonMessageId:88,
      reasonMessageText:'사유: 감기',
      reason:'병원',
      callRpc:async()=>({
        ok:true,
        current_member_id:'member-a',
        messages:[{
          id:88,
          sender_member_id:'member-a',
          message_type:'text',
          body:'사유: 감기'
        }]
      })
    }),
    e=>e?.code==='OLLI_AGENT_ABSENCE_REASON_BODY_MISMATCH'
  );
});

test('persisted-card recovery remains enabled for absence preparation',()=>{
  const start=runtime.indexOf('async function runAbsencePrepareAgent({');
  const end=runtime.indexOf('\n\nasync function runAbsencePrepareProbe',start);
  const block=start>=0&&end>start?runtime.slice(start,end):'';
  assert.match(block,/capturePersistedMessage\(message\)/);
  assert.match(block,/pickupPersistedMessageForClient\(message\)/);
  assert.match(block,/runError=error/);
  assert.match(block,/requirePersistedMessage&&!persistedMessage/);
  assert.match(block,/recoveredAfterPersist:!!runError/);
});
