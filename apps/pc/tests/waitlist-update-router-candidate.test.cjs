const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.resolve(__dirname,'../../../packages/common/olli-command-router-common.js'),
  'utf8'
);

function loadRouter() {
  const sandbox = { window:{}, console, Date };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.OlliCommandRouter;
}

test('waitlist update parser identifies update commands and rejects add/cancel wording', () => {
  const router = loadRouter();
  assert.equal(typeof router.parseWaitlistUpdateMutationIntent, 'function');

  const parsed = router.parseWaitlistUpdateMutationIntent(
    '최민기 금요일 4시 A반 대기를 토요일 1시 B반으로 변경해줘'
  );
  assert.equal(parsed?.intent, 'update_waitlist');
  assert.equal(parsed?.studentName, '최민기');

  assert.equal(
    router.parseWaitlistUpdateMutationIntent('최민기 월요일 4시 대기 넣어줘'),
    null
  );
  assert.equal(
    router.parseWaitlistUpdateMutationIntent('최민기 월요일 4시 대기 취소해줘'),
    null
  );
});

test('waitlist update parser stays candidate-only and is not added to legacy parseSingleWriteIntent', () => {
  const start = source.indexOf('function parseSingleWriteIntent');
  const end = source.indexOf('function parseMultiWriteIntent', start);
  assert.ok(start >= 0 && end > start);
  const legacyWriteBlock = source.slice(start, end);
  assert.doesNotMatch(legacyWriteBlock, /parseWaitlistUpdateMutationIntent/);
});
