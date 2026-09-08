const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const storage = new Map();
global.window = global;
global.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
global.getOlliCurrentAcademyId = () => 'academy-test';
global.saveFeedbackRowVerified = async () => { throw new Error('legacy path must not run'); };

let queue = [];
let queueSeq = 0;
global.OlliStorageCore = {
  SyncQueue: {
    read() { return queue.map(item => JSON.parse(JSON.stringify(item))); },
    enqueue(item) {
      const next = { queue_id: `q${++queueSeq}`, ...JSON.parse(JSON.stringify(item)) };
      queue.push(next);
      return JSON.parse(JSON.stringify(next));
    },
    update(_academyId, queueId, patch) {
      const index = queue.findIndex(item => item.queue_id === queueId);
      if (index < 0) return null;
      queue[index] = { ...queue[index], ...JSON.parse(JSON.stringify(patch)) };
      return JSON.parse(JSON.stringify(queue[index]));
    },
    remove(_academyId, queueId) {
      queue = queue.filter(item => item.queue_id !== queueId);
      return true;
    }
  }
};

let mode = 'loss-then-success';
let calls = [];
global.supabase = async (_method, path, body) => {
  assert.strictEqual(path, 'rpc/olli_feedback_insert_idempotent');
  const payload = JSON.parse(JSON.stringify(body.p_payload));
  calls.push(payload);
  if (mode === 'loss-then-success' && calls.length === 1) throw new Error('simulated response loss');
  if (mode === 'always-fail') throw new Error('simulated offline');
  return [{
    id: 'feedback-test',
    academy_id: payload.academy_id,
    student_id: payload.student_id,
    student_name: payload.student_name,
    content: payload.content,
    feedback_type: payload.feedback_type,
    client_mutation_id: payload.client_mutation_id
  }];
};

vm.runInThisContext(fs.readFileSync('olli-operations-feedback-policy.js', 'utf8'), {
  filename: 'olli-operations-feedback-policy.js'
});

(async () => {
  const payload = {
    academy_id: 'academy-test',
    student_id: 'student-test',
    student_name: '테스트',
    content: '응답 유실 테스트',
    feedback_type: 'general'
  };

  const first = await global.saveFeedbackRowVerified('feedbacks', payload, '일반 피드백');
  assert.strictEqual(first.content, payload.content);
  assert.strictEqual(calls.length, 2, 'response loss should retry once');
  assert.ok(calls[0].client_mutation_id, 'mutation id must exist');
  assert.strictEqual(calls[0].client_mutation_id, calls[1].client_mutation_id, 'automatic retry must reuse mutation id');
  assert.strictEqual(queue.length, 0, 'successful save must clear sync queue');

  mode = 'always-fail';
  calls = [];
  const secondPayload = { ...payload, content: '오프라인 재전송 테스트' };
  let failed = false;
  try {
    await global.saveFeedbackRowVerified('feedbacks', secondPayload, '일반 피드백');
  } catch (_) {
    failed = true;
  }
  assert.strictEqual(failed, true, 'offline save should fail after retries');
  assert.strictEqual(calls.length, 3, 'offline save should use bounded retries');
  assert.strictEqual(new Set(calls.map(call => call.client_mutation_id)).size, 1, 'all failed attempts must reuse mutation id');
  assert.strictEqual(queue.length, 1, 'failed save must remain in sync queue');
  const queuedMutation = queue[0].client_mutation_id;
  assert.ok(queuedMutation, 'queued save must preserve mutation id');
  assert.strictEqual(queue[0].operation, 'create');
  assert.strictEqual(queue[0].feature, 'general_feedback');

  mode = 'success';
  calls = [];
  const retried = await global.retryPendingFeedbackIdempotentWrite(queue[0]);
  assert.strictEqual(retried.serverSaved, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].client_mutation_id, queuedMutation, 'manual retry must reuse queued mutation id');
  assert.strictEqual(queue.length, 0, 'manual retry success must clear sync queue');
  assert.strictEqual(global.getPendingFeedbackIdempotentWrites().length, 0, 'manual retry success must clear private pending list');

  console.log('feedback retry bridge test: passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
