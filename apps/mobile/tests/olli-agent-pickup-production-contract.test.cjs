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
const { pickupPersistedMessageForClient } = require('../api/_lib/olli-agent/runtime.cjs');

test('production pickup_prepare is separate from pickup_prepare_probe and requires a source Team Chat message id', () => {
  assert.match(endpoint, /'pickup_prepare_probe', 'pickup_prepare'/);
  assert.match(endpoint, /mode === 'pickup_prepare_probe'/);
  assert.match(endpoint, /sourceMessageId = Number\(body\.sourceMessageId \|\| body\.source_message_id \|\| 0\)/);
  assert.match(endpoint, /OLLI_AGENT_PICKUP_SOURCE_MESSAGE_REQUIRED/);
  assert.match(endpoint, /runPickupPrepare\(/);
  assert.match(endpoint, /message:probe\.persistedMessage/);
  assert.doesNotMatch(
    endpoint.match(/mode:'pickup_prepare'[\s\S]*?\}\);/)?.[0] || '',
    /subjectRefs|privacy:|output:/
  );
});

test('production pickup prepare derives retry id and reply linkage from the same source message id', () => {
  const block = runtime.match(/async function runPickupPrepare\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(block, /Number\.isSafeInteger\(sourceId\)/);
  assert.match(block, /requestId:'team-chat-message:' \+ sourceId/);
  assert.match(block, /replyToMessageId:sourceId/);
  assert.match(block, /requirePersistedMessage:true/);

  assert.match(tool, /p_reply_to_message_id:replyId/);
  assert.match(tool, /capturePersistedMessage\(sent\.message\)/);
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
