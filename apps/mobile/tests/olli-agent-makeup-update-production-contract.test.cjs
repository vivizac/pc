const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const endpoint = fs.readFileSync(path.join(mobileRoot, 'api/olli-agent.js'), 'utf8');
const runtime = fs.readFileSync(path.join(mobileRoot, 'api/_lib/olli-agent/runtime.cjs'), 'utf8');
const tool = fs.readFileSync(
  path.join(mobileRoot, 'api/_lib/olli-agent/tools/makeup-update-prepare-tools.cjs'),
  'utf8'
);

const {
  validateMakeupSourceMessage,
} = require('../api/_lib/olli-agent/runtime.cjs');

test('production makeup_update_prepare is separate from probe and requires a saved source message', () => {
  assert.match(endpoint, /'makeup_update_prepare_probe'/);
  assert.match(endpoint, /'makeup_update_prepare'/);
  assert.match(endpoint, /mode === 'makeup_update_prepare'/);
  assert.match(
    endpoint,
    /makeup_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다/
  );
  assert.match(endpoint, /OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_REQUIRED/);
  assert.match(endpoint, /runMakeupUpdatePrepare\(/);
  assert.match(endpoint, /sourceMessageText: message/);

  const marker = "mode:'makeup_update_prepare'";
  const start = endpoint.indexOf(marker);
  const response = start >= 0 ? endpoint.slice(start, start + 900) : '';
  assert.match(response, /message:probe\.persistedMessage/);
  assert.match(response, /recoveredAfterPersist:probe\.recoveredAfterPersist === true/);
  assert.doesNotMatch(
    response,
    /subjectRefs|privacy:|output:|studentId|studentName|oneTimeSessionId|timeSlot/
  );
});

test('production makeup update validates stored source before Agent execution', () => {
  const start = runtime.indexOf('async function runMakeupUpdatePrepare({');
  const end = runtime.indexOf('\n\nasync function runMakeupCancelPrepare({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';

  assert.match(block, /Number\.isSafeInteger\(sourceId\)/);
  assert.match(block, /validateMakeupSourceMessage\(/);
  assert.ok(
    block.indexOf('validateMakeupSourceMessage({') <
    block.indexOf('return runMakeupUpdatePrepareAgent({')
  );
  assert.match(block, /sourceMessageText/);
  assert.match(block, /requestId:'team-chat-message:' \+ sourceId/);
  assert.match(block, /replyToMessageId:sourceId/);
  assert.match(block, /requirePersistedMessage:true/);
});

test('production makeup update recovers a persisted confirmation card after final model output fails', () => {
  const start = runtime.indexOf('async function runMakeupUpdatePrepareAgent({');
  const end = runtime.indexOf('\n\nasync function runMakeupUpdatePrepareProbe({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';

  assert.match(block, /replyToMessageId = null/);
  assert.match(block, /requirePersistedMessage = false/);
  assert.match(block, /capturePersistedMessage\(message\)/);
  assert.match(block, /pickupPersistedMessageForClient\(message\)/);
  assert.match(
    block,
    /catch \(error\) \{[\s\S]*runError = error;[\s\S]*!requirePersistedMessage \|\| !persistedMessage/
  );
  assert.match(block, /requirePersistedMessage && !persistedMessage/);
  assert.match(block, /recoveredAfterPersist:!!runError/);
});

test('makeup update confirmation card keeps source linkage and internal ids outside the model schema', () => {
  assert.match(tool, /p_reply_to_message_id:replyId/);
  assert.match(tool, /capturePersistedMessage\(sent\.message\)/);

  const start = tool.indexOf('parameters:z.object({');
  const end = tool.indexOf('}),\n    async execute', start);
  const schema = tool.slice(start, end);
  assert.doesNotMatch(
    schema,
    /sourceMessageId|replyToMessageId|requestId|studentId|student_id|studentName|oneTimeSessionId|timeSlot|time_slot|academyId|memberId/
  );
});

test('makeup update source binding accepts exact stored text and rejects a changed body', async () => {
  const requestContext = {
    sessionToken:'session-secret',
    academyId:'academy-a',
    memberId:'member-a',
  };

  const source = await validateMakeupSourceMessage({
    requestContext,
    sourceMessageId:91,
    sourceMessageText:'학생A 금요일 4시 A반 보강을 월요일 4시 B반으로 변경해줘',
    callRpc:async () => ({
      ok:true,
      current_member_id:'member-a',
      messages:[{
        id:91,
        sender_member_id:'member-a',
        message_type:'text',
        body:'@올리 학생A 금요일 4시 A반 보강을 월요일 4시 B반으로 변경해줘',
      }],
    }),
  });
  assert.equal(source.id,91);

  await assert.rejects(
    validateMakeupSourceMessage({
      requestContext,
      sourceMessageId:91,
      sourceMessageText:'학생A 금요일 4시 A반 보강을 월요일 5시 B반으로 변경해줘',
      callRpc:async () => ({
        ok:true,
        current_member_id:'member-a',
        messages:[{
          id:91,
          sender_member_id:'member-a',
          message_type:'text',
          body:'학생A 금요일 4시 A반 보강을 월요일 4시 B반으로 변경해줘',
        }],
      }),
    }),
    (error) => error?.code === 'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_BODY_MISMATCH'
  );
});

test('PC and Mobile Team Chat route makeup update only through source-bound production prepare', () => {
  const mobileTalk = fs.readFileSync(path.join(mobileRoot, 'olli-talk-beta.js'), 'utf8');
  const pcTalk = fs.readFileSync(path.resolve(mobileRoot, '../pc/pc-team-talk.js'), 'utf8');

  assert.match(mobileTalk, /mode:'makeup_update_prepare'/);
  assert.match(mobileTalk, /sourceMessageId/);
  assert.match(mobileTalk, /action_type \|\| ''\)\.trim\(\)!=='update_makeup'/);
  assert.doesNotMatch(mobileTalk, /mode:'makeup_update_prepare_probe'/);

  assert.match(pcTalk, /mode:'makeup_update_prepare'/);
  assert.match(pcTalk, /sourceMessageId/);
  assert.match(pcTalk, /action_type\) !== 'update_makeup'/);
  assert.doesNotMatch(pcTalk, /mode:'makeup_update_prepare_probe'/);

  assert.doesNotMatch(mobileTalk, /olli_schedule_update_one_time_session/);
  assert.doesNotMatch(pcTalk, /olli_schedule_update_one_time_session/);
});
