const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const endpoint = fs.readFileSync(path.join(mobileRoot, 'api/olli-agent.js'), 'utf8');
const runtime = fs.readFileSync(path.join(mobileRoot, 'api/_lib/olli-agent/runtime.cjs'), 'utf8');
const tool = fs.readFileSync(path.join(mobileRoot, 'api/_lib/olli-agent/tools/makeup-prepare-tools.cjs'), 'utf8');

const {
  normalizePickupSourceMessageText,
  validateMakeupSourceMessage,
} = require('../api/_lib/olli-agent/runtime.cjs');

test('production makeup_prepare is separate from probe and requires a saved source Team Chat message', () => {
  assert.match(endpoint, /'makeup_prepare_probe'/);
  assert.match(endpoint, /'makeup_prepare'/);
  assert.match(endpoint, /mode === 'makeup_prepare'/);
  assert.match(endpoint, /makeup_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint, /OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_REQUIRED/);
  assert.match(endpoint, /runMakeupPrepare\(/);
  assert.match(endpoint, /sourceMessageText: message/);

  const response = endpoint.match(/mode:'makeup_prepare'[\s\S]*?\}\);/)?.[0] || '';
  assert.match(response, /message:probe\.persistedMessage/);
  assert.match(response, /recoveredAfterPersist:probe\.recoveredAfterPersist === true/);
  assert.doesNotMatch(response, /subjectRefs|privacy:|output:|studentId|studentName|timeSlot|classGroup/);
});

test('production makeup validates source before Agent run and derives retry/reply linkage from source id', () => {
  const start = runtime.indexOf('async function runMakeupPrepare({');
  const end = runtime.indexOf('\n\nasync function runStudentProfileProbe({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';

  assert.match(block, /Number\.isSafeInteger\(sourceId\)/);
  assert.match(block, /validateMakeupSourceMessage\(/);
  assert.ok(block.indexOf('validateMakeupSourceMessage({') < block.indexOf('return runMakeupPrepareAgent({'));
  assert.match(block, /sourceMessageText/);
  assert.match(block, /requestId:'team-chat-message:' \+ sourceId/);
  assert.match(block, /replyToMessageId:sourceId/);
  assert.match(block, /requirePersistedMessage:true/);
});

test('production makeup can recover persisted confirmation card after model finalization fails', () => {
  const start = runtime.indexOf('async function runMakeupPrepareAgent({');
  const end = runtime.indexOf('\n\nasync function runMakeupPrepareProbe({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';

  assert.match(block, /capturePersistedMessage\(message\)/);
  assert.match(block, /pickupPersistedMessageForClient\(message\)/);
  assert.match(block, /catch \(error\) \{[\s\S]*runError = error;[\s\S]*!requirePersistedMessage \|\| !persistedMessage/);
  assert.match(block, /requirePersistedMessage && !persistedMessage/);
  assert.match(block, /recoveredAfterPersist:!!runError/);
});

test('makeup confirmation card keeps retry id and reply linkage server-only', () => {
  assert.match(tool, /p_reply_to_message_id:replyId/);
  assert.match(tool, /capturePersistedMessage\(sent\.message\)/);
  const start = tool.indexOf('parameters:z.object({');
  const end = tool.indexOf('}),\n    async execute', start);
  const schema = tool.slice(start, end);
  assert.doesNotMatch(
    schema,
    /sourceMessageId|replyToMessageId|requestId|studentId|student_id|classGroup|class_group|timeSlot|time_slot/
  );
});

test('makeup source validation reuses exact normalized Team Chat binding and returns makeup-specific errors', async () => {
  assert.equal(
    normalizePickupSourceMessageText('@올리 학생A 내일 4시 30분 보강 등록해줘'),
    '학생A 내일 4시 30분 보강 등록해줘'
  );

  const requestContext = {
    sessionToken:'session-secret',
    academyId:'academy-a',
    memberId:'member-a',
  };

  const source = await validateMakeupSourceMessage({
    requestContext,
    sourceMessageId:77,
    sourceMessageText:'학생A 내일 4시 30분 보강 등록해줘',
    callRpc:async () => ({
      ok:true,
      current_member_id:'member-a',
      messages:[{
        id:77,
        sender_member_id:'member-a',
        message_type:'text',
        body:'@올리 학생A 내일 4시 30분 보강 등록해줘',
      }],
    }),
  });
  assert.equal(source.id,77);

  await assert.rejects(
    validateMakeupSourceMessage({
      requestContext,
      sourceMessageId:77,
      sourceMessageText:'학생A 내일 4시 30분 보강 등록해줘',
      callRpc:async () => ({
        ok:true,
        current_member_id:'member-a',
        messages:[{
          id:77,
          sender_member_id:'member-b',
          message_type:'text',
          body:'학생A 내일 4시 30분 보강 등록해줘',
        }],
      }),
    }),
    (error) =>
      error?.code === 'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_OWNER_MISMATCH' &&
      /보강 Agent/.test(error?.message || '')
  );
});

test('makeup source validation maps non-text, missing, body mismatch and request-context mismatch codes', async () => {
  const requestContext = {
    sessionToken:'session-secret',
    academyId:'academy-a',
    memberId:'member-a',
  };

  async function expectCode(payload, expectedCode) {
    await assert.rejects(
      validateMakeupSourceMessage({
        requestContext,
        sourceMessageId:77,
        sourceMessageText:'학생A 내일 4시 보강 등록해줘',
        callRpc:async () => payload,
      }),
      (error) => error?.code === expectedCode
    );
  }

  await expectCode({
    ok:true,
    current_member_id:'member-a',
    messages:[{id:77,sender_member_id:'member-a',message_type:'ai',body:'학생A 내일 4시 보강 등록해줘'}],
  }, 'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_TYPE_INVALID');

  await expectCode({
    ok:true,
    current_member_id:'member-a',
    messages:[],
  }, 'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_NOT_FOUND');

  await expectCode({
    ok:true,
    current_member_id:'member-a',
    messages:[{id:77,sender_member_id:'member-a',message_type:'text',body:'학생A 금요일 5시 보강 등록해줘'}],
  }, 'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_BODY_MISMATCH');

  await expectCode({
    ok:true,
    current_member_id:'member-b',
    messages:[{id:77,sender_member_id:'member-a',message_type:'text',body:'학생A 내일 4시 보강 등록해줘'}],
  }, 'OLLI_AGENT_MAKEUP_SOURCE_CONTEXT_MISMATCH');
});

test('production endpoint still does not connect PC or Mobile Team Chat routing directly', () => {
  assert.doesNotMatch(endpoint, /sendTeamChat.*makeup|routeTeamChat.*makeup/i);
});
