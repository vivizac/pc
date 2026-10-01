const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const endpoint = fs.readFileSync(path.join(mobileRoot, 'api/olli-agent.js'), 'utf8');
const runtime = fs.readFileSync(path.join(mobileRoot, 'api/_lib/olli-agent/runtime.cjs'), 'utf8');
const tool = fs.readFileSync(
  path.join(mobileRoot, 'api/_lib/olli-agent/tools/waitlist-cancel-prepare-tools.cjs'),
  'utf8'
);

const { validateWaitlistSourceMessage } = require('../api/_lib/olli-agent/runtime.cjs');

test('production waitlist_cancel_prepare is separate from probe and requires a saved source message', () => {
  assert.match(endpoint, /'waitlist_cancel_prepare_probe'/);
  assert.match(endpoint, /'waitlist_cancel_prepare'/);
  assert.match(endpoint, /mode === 'waitlist_cancel_prepare'/);
  assert.match(endpoint, /waitlist_cancel_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint, /OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_REQUIRED/);
  assert.match(endpoint, /runWaitlistCancelPrepare\(/);
  assert.match(endpoint, /sourceMessageText: message/);

  const marker = "mode:'waitlist_cancel_prepare'";
  const start = endpoint.indexOf(marker);
  const response = start >= 0 ? endpoint.slice(start, start + 900) : '';
  assert.match(response, /message:probe\.persistedMessage/);
  assert.match(response, /recoveredAfterPersist:probe\.recoveredAfterPersist === true/);
  assert.doesNotMatch(response, /subjectRefs|privacy:|output:|studentId|studentName|waitlistId|targetTimeSlot/);
});

test('production waitlist cancel validates stored source before Agent execution', () => {
  const start = runtime.indexOf('async function runWaitlistCancelPrepare({');
  const end = runtime.indexOf('\n\nasync function runStudentProfileProbe({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';
  assert.match(block, /Number\.isSafeInteger\(sourceId\)/);
  assert.match(block, /validateWaitlistSourceMessage\(/);
  assert.ok(block.indexOf('validateWaitlistSourceMessage({') < block.indexOf('return runWaitlistCancelPrepareAgent({'));
  assert.match(block, /sourceMessageText/);
  assert.match(block, /requestId:'team-chat-message:' \+ sourceId/);
  assert.match(block, /replyToMessageId:sourceId/);
  assert.match(block, /requirePersistedMessage:true/);
});

test('production waitlist cancel recovers a persisted confirmation card after final model output fails', () => {
  const start = runtime.indexOf('async function runWaitlistCancelPrepareAgent({');
  const end = runtime.indexOf('\n\nasync function runWaitlistCancelPrepareProbe({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';
  assert.match(block, /replyToMessageId = null/);
  assert.match(block, /requirePersistedMessage = false/);
  assert.match(block, /capturePersistedMessage\(message\)/);
  assert.match(block, /pickupPersistedMessageForClient\(message\)/);
  assert.match(block, /catch \(error\) \{[\s\S]*runError = error;[\s\S]*!requirePersistedMessage \|\| !persistedMessage/);
  assert.match(block, /requirePersistedMessage && !persistedMessage/);
  assert.match(block, /recoveredAfterPersist:!!runError/);
});

test('waitlist cancel confirmation card keeps source linkage and internal ids outside the model schema', () => {
  assert.match(tool, /p_reply_to_message_id:replyId/);
  assert.match(tool, /capturePersistedMessage\(sent\.message\)/);
  const start = tool.indexOf('parameters:z.object({');
  const end = tool.indexOf('}),\n    async execute', start);
  const schema = tool.slice(start, end);
  assert.doesNotMatch(schema, /sourceMessageId|replyToMessageId|requestId|studentId|student_id|studentName|waitlistId|waitlist_id|timeSlot|time_slot|academyId|memberId|division/);
});

test('waitlist source binding accepts exact stored text and rejects a changed body', async () => {
  const requestContext = { sessionToken:'session-secret', academyId:'academy-a', memberId:'member-a' };
  const source = await validateWaitlistSourceMessage({
    requestContext,
    sourceMessageId:92,
    sourceMessageText:'학생A 금요일 4시 30분 대기 취소해줘',
    callRpc:async () => ({
      ok:true,
      current_member_id:'member-a',
      messages:[{ id:92, sender_member_id:'member-a', message_type:'text', body:'@올리 학생A 금요일 4시 30분 대기 취소해줘' }],
    }),
  });
  assert.equal(source.id,92);

  await assert.rejects(
    validateWaitlistSourceMessage({
      requestContext,
      sourceMessageId:92,
      sourceMessageText:'학생A 토요일 4시 30분 대기 취소해줘',
      callRpc:async () => ({
        ok:true,
        current_member_id:'member-a',
        messages:[{ id:92, sender_member_id:'member-a', message_type:'text', body:'학생A 금요일 4시 30분 대기 취소해줘' }],
      }),
    }),
    (error) => error?.code === 'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_BODY_MISMATCH'
  );
});

test('guest fallback is decided before Agents SDK execution', () => {
  const start = runtime.indexOf('async function runWaitlistCancelPrepareAgent({');
  const end = runtime.indexOf('\n\nasync function runWaitlistCancelPrepareProbe({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';
  assert.ok(block.indexOf('resolveWaitlistCancelPrepareScope(preparedPrivacy)') >= 0);
  assert.ok(block.indexOf('resolveWaitlistCancelPrepareScope(preparedPrivacy)') < block.indexOf('assertOpenAiKey()'));
});
