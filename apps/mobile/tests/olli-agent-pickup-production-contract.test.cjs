const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(mobileRoot, '../..');

const endpoint = fs.readFileSync(path.join(mobileRoot, 'api/olli-agent.js'), 'utf8');
const runtime = fs.readFileSync(path.join(mobileRoot, 'api/_lib/olli-agent/runtime.cjs'), 'utf8');
const tool = fs.readFileSync(path.join(mobileRoot, 'api/_lib/olli-agent/tools/pickup-prepare-tools.cjs'), 'utf8');
const pcProxy = fs.readFileSync(path.join(repoRoot, 'apps/pc/api/olli-agent.js'), 'utf8');
const {
  pickupPersistedMessageForClient,
  normalizePickupSourceMessageText,
  validatePickupSourceMessage,
} = require('../api/_lib/olli-agent/runtime.cjs');

test('production pickup_prepare is separate from pickup_prepare_probe and requires a source Team Chat message id', () => {
  assert.match(endpoint, /'pickup_prepare_probe'/);
  assert.match(endpoint, /'pickup_update_prepare_probe'/);
  assert.match(endpoint, /'pickup_prepare'/);
  assert.match(endpoint, /mode === 'pickup_prepare_probe'/);
  assert.match(endpoint, /sourceMessageId = Number\(body\.sourceMessageId \|\| body\.source_message_id \|\| 0\)/);
  assert.match(endpoint, /OLLI_AGENT_PICKUP_SOURCE_MESSAGE_REQUIRED/);
  assert.match(endpoint, /runPickupPrepare\(/);
  assert.match(endpoint, /sourceMessageText: message/);
  assert.match(endpoint, /message:probe\.persistedMessage/);
  assert.doesNotMatch(
    endpoint.match(/mode:'pickup_prepare'[\s\S]*?\}\);/)?.[0] || '',
    /subjectRefs|privacy:|output:/
  );
});

test('production pickup_update_prepare is source-bound and returns only the persisted action message', () => {
  assert.match(endpoint, /'pickup_update_prepare'/);
  assert.match(endpoint, /mode === 'pickup_update_prepare'/);
  assert.match(endpoint, /pickup_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint, /runPickupUpdatePrepare\(/);
  assert.match(endpoint, /sourceMessageText: message/);

  const response = endpoint.match(/mode:'pickup_update_prepare'[\s\S]*?\}\);/)?.[0] || '';
  assert.match(response, /message:probe\.persistedMessage/);
  assert.match(response, /recoveredAfterPersist:probe\.recoveredAfterPersist === true/);
  assert.doesNotMatch(response, /subjectRefs|privacy:|output:|pickupId|studentId|studentName/);
});

test('production pickup update validates the source before running the update Agent and reuses the source id for retry and reply linkage', () => {
  const start = runtime.indexOf('async function runPickupUpdatePrepare({');
  const end = runtime.indexOf('\n\nasync function runStudentProfileProbe({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';

  assert.match(block, /Number\.isSafeInteger\(sourceId\)/);
  assert.match(block, /validatePickupSourceMessage\(/);
  assert.ok(block.indexOf('validatePickupSourceMessage({') < block.indexOf('return runPickupUpdatePrepareAgent({'));
  assert.match(block, /sourceMessageText/);
  assert.match(block, /requestId:'team-chat-message:' \+ sourceId/);
  assert.match(block, /replyToMessageId:sourceId/);
  assert.match(block, /requirePersistedMessage:true/);
});

test('production pickup update can recover the persisted confirmation card when model finalization fails', () => {
  const start = runtime.indexOf('async function runPickupUpdatePrepareAgent({');
  const end = runtime.indexOf('\n\nasync function runPickupUpdatePrepareProbe({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';

  assert.match(block, /capturePersistedMessage\(message\)/);
  assert.match(block, /pickupPersistedMessageForClient\(message\)/);
  assert.match(block, /catch \(error\) \{[\s\S]*runError = error;[\s\S]*!requirePersistedMessage \|\| !persistedMessage/);
  assert.match(block, /requirePersistedMessage && !persistedMessage/);
  assert.match(block, /recoveredAfterPersist:!!runError/);
});

test('production pickup prepare derives retry id and reply linkage from the same source message id', () => {
  const start = runtime.indexOf('async function runPickupPrepare({');
  const end = runtime.indexOf('\n\nasync function runStudentProfileProbe({', start);
  const block = start >= 0 && end > start ? runtime.slice(start, end) : '';
  assert.match(block, /Number\.isSafeInteger\(sourceId\)/);
  assert.match(block, /validatePickupSourceMessage\(/);
  assert.ok(block.indexOf('validatePickupSourceMessage({') < block.indexOf('return runPickupPrepareAgent({'));
  assert.match(block, /sourceMessageText/);
  assert.match(block, /requestId:'team-chat-message:' \+ sourceId/);
  assert.match(block, /replyToMessageId:sourceId/);
  assert.match(block, /requirePersistedMessage:true/);

  assert.match(tool, /p_reply_to_message_id:replyId/);
  assert.match(tool, /capturePersistedMessage\(sent\.message\)/);
});

test('pickup source normalization accepts direct @올리 and reply-suggestion forms', () => {
  assert.equal(normalizePickupSourceMessageText('@올리 학생A 목요일 4시 30분 픽업 등록해줘'), '학생A 목요일 4시 30분 픽업 등록해줘');
  assert.equal(normalizePickupSourceMessageText('학생A 목요일 4시 30분 픽업 등록해줘'), '학생A 목요일 4시 30분 픽업 등록해줘');
});

test('pickup source validation binds the request to the current member text message and exact normalized body', async () => {
  const calls = [];
  const requestContext = {
    sessionToken:'session-secret',
    academyId:'academy-a',
    memberId:'member-a',
  };
  const source = await validatePickupSourceMessage({
    requestContext,
    sourceMessageId:77,
    sourceMessageText:'학생A 목요일 4시 30분 픽업 등록해줘',
    callRpc:async (name, params) => {
      calls.push({name, params});
      return {
        ok:true,
        current_member_id:'member-a',
        messages:[{
          id:77,
          sender_member_id:'member-a',
          message_type:'text',
          body:'@올리 학생A 목요일 4시 30분 픽업 등록해줘',
        }],
      };
    },
  });

  assert.equal(source.id, 77);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'olli_team_chat_list');
  assert.deepEqual(calls[0].params, {
    p_session_token:'session-secret',
    p_academy_id:'academy-a',
    p_before_message_id:78,
    p_limit:1,
  });
});

test('pickup source validation also preserves the existing own-message reply suggestion flow', async () => {
  const source = await validatePickupSourceMessage({
    requestContext:{
      sessionToken:'session-secret',
      academyId:'academy-a',
      memberId:'member-a',
    },
    sourceMessageId:88,
    sourceMessageText:'학생A 금요일 5시 픽업 등록해줘',
    callRpc:async () => ({
      ok:true,
      current_member_id:'member-a',
      messages:[{
        id:88,
        sender_member_id:'member-a',
        message_type:'text',
        body:'학생A 금요일 5시 픽업 등록해줘',
      }],
    }),
  });
  assert.equal(source.id, 88);
});

test('pickup source validation rejects another member, non-text, missing, and body-mismatch sources', async () => {
  const requestContext = {
    sessionToken:'session-secret',
    academyId:'academy-a',
    memberId:'member-a',
  };
  async function expectCode(message, expectedCode) {
    await assert.rejects(
      validatePickupSourceMessage({
        requestContext,
        sourceMessageId:77,
        sourceMessageText:'학생A 목요일 4시 픽업 등록해줘',
        callRpc:async () => message,
      }),
      (error) => error?.code === expectedCode
    );
  }

  await expectCode({
    ok:true,
    current_member_id:'member-a',
    messages:[{id:77,sender_member_id:'member-b',message_type:'text',body:'학생A 목요일 4시 픽업 등록해줘'}],
  }, 'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_OWNER_MISMATCH');

  await expectCode({
    ok:true,
    current_member_id:'member-a',
    messages:[{id:77,sender_member_id:'member-a',message_type:'ai',body:'학생A 목요일 4시 픽업 등록해줘'}],
  }, 'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_TYPE_INVALID');

  await expectCode({
    ok:true,
    current_member_id:'member-a',
    messages:[],
  }, 'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_NOT_FOUND');

  await expectCode({
    ok:true,
    current_member_id:'member-a',
    messages:[{id:77,sender_member_id:'member-a',message_type:'text',body:'학생A 금요일 5시 픽업 등록해줘'}],
  }, 'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_BODY_MISMATCH');
});

test('pickup source validation rejects a request-context member mismatch before source use', async () => {
  await assert.rejects(
    validatePickupSourceMessage({
      requestContext:{
        sessionToken:'session-secret',
        academyId:'academy-a',
        memberId:'member-a',
      },
      sourceMessageId:77,
      sourceMessageText:'학생A 목요일 4시 픽업 등록해줘',
      callRpc:async () => ({
        ok:true,
        current_member_id:'member-b',
        messages:[{
          id:77,
          sender_member_id:'member-a',
          message_type:'text',
          body:'학생A 목요일 4시 픽업 등록해줘',
        }],
      }),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_SOURCE_CONTEXT_MISMATCH'
  );
});

test('persisted Team Chat action message returned to UI excludes internal payload and academy identifiers', () => {
  const projection = runtime.match(/function pickupPersistedMessageForClient\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(projection, /message_type:'ai'/);
  assert.match(projection, /reply_to_message_id:/);
  assert.match(projection, /action_type:/);
  assert.match(projection, /status:/);
  assert.doesNotMatch(projection, /action_payload|studentId|studentName|academy_id|client_message_id|sessionToken/);
});

test('persisted message projection strips server-only identifiers and action payload data', () => {
  const projected = pickupPersistedMessageForClient({
    id:901,
    academy_id:'academy-secret',
    sender_member_id:'member-secret',
    sender_name:'올리',
    message_type:'ai',
    body:'픽업을 등록할까요?',
    reply_to_message_id:77,
    client_message_id:'client-secret',
    created_at:'2026-10-01T00:00:00Z',
    action:{
      id:'action-ui-id',
      action_type:'add_pickup',
      status:'pending',
      revision:0,
      action_payload:{
        studentId:'student-secret',
        studentName:'실명',
      },
    },
  });

  assert.equal(projected.id, 901);
  assert.equal(projected.reply_to_message_id, 77);
  assert.equal(projected.action.id, 'action-ui-id');
  assert.equal(projected.action.action_type, 'add_pickup');
  assert.equal(projected.sender_member_id, null);
  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(serialized, /academy-secret|member-secret|client-secret|student-secret|실명|action_payload/);
});

test('production runtime can return the already-persisted action if the model finalization fails afterwards', () => {
  const block = runtime.match(/async function runPickupPrepareAgent\([\s\S]*?async function runPickupPrepareProbe/)?.[0] || '';
  assert.match(block, /catch \(error\) \{[\s\S]*runError = error;[\s\S]*!requirePersistedMessage \|\| !persistedMessage/);
  assert.match(block, /recoveredAfterPersist:!!runError/);
  assert.match(block, /requirePersistedMessage && !persistedMessage/);
});

test('PC Agent endpoint is only a thin proxy to the mobile Production Agent server', () => {
  assert.match(pcProxy, /https:\/\/vivizac-feedback\.vercel\.app\/api\/olli-agent/);
  assert.match(pcProxy, /body:JSON\.stringify\(req\.body \|\| \{\}\)/);
  assert.doesNotMatch(pcProxy, /@openai\/agents|pickup-prepare-tools|request-context|prepareAgentPrivacyInput/);
});
