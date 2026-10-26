const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const migration = read('supabase/migrations/20261026093532_backfill_exact_consultation_links_and_capture_ai_sources.sql');

test('new provenance is additive: preserve legacy UUID failure-source references', () => {
  assert.match(migration, /add column if not exists source_general_feedback_ids bigint\[\]/);
  assert.doesNotMatch(migration, /alter column source_feedback_ids type/i);
  assert.match(migration, /p_source_general_feedback_ids bigint\[\], p_source_feedback_ids uuid\[\]/);
  assert.match(migration, /for update;/i);
  assert.match(migration, /and f.student_id=p_student_id/);
  assert.match(migration, /SERVICE_ROLE_REQUIRED/);
  assert.match(migration, /CLAIM_MISMATCH/);
  assert.match(migration, /from public,anon,authenticated/);
  assert.match(migration, /to service_role/);
  // Only the reviewed original month is assigned to the consultation.
  for (const id of [25, 27, 29, 30, 31, 33, 34]) {
    assert.match(migration, new RegExp('\\\\(' + id + '::bigint'));
  }
  assert.doesNotMatch(migration, /update public.summary_feedbacks\s+set content/i);
});

test('summary generator atomically saves the exact selected general feedback IDs', async () => {
  const prevKey = process.env.SUPABASE_SECRET_KEY;
  const prevEnv = process.env.VERCEL_ENV;
  const prevFetch = global.fetch;
  process.env.SUPABASE_SECRET_KEY = 'testing-service-role';
  process.env.VERCEL_ENV = 'production';
  const requests = [];
  const academyId = '00000000-0000-4000-8000-000000000001';
  const studentId = '00000000-0000-4000-8000-000000000002';
  const json = payload => ({ ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload });
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    requests.push({ path: u.pathname, body });
    if (u.pathname.endsWith('/rpc/olli_consultation_summary_job_access')) {
      if (body.p_action === 'read') return json({ ok: true, status: 'pending' });
      if (body.p_action === 'claim') return json({ ok: true, status: 'claimed', claim_token: '00000000-0000-4000-8000-000000000003' });
      throw new Error('Unexpected legacy mutation: ' + body.p_action);
    }
    if (u.pathname.endsWith('/rpc/olli_consultation_summary_finish_with_sources')) {
      return json({ ok: true, status: 'ready', feedback_id: 900 });
    }
    if (u.pathname.endsWith('/students')) {
      return json([{ id: studentId, name: '테스트학생', division: 'elementary', enrolled_at: '2026-01-01', status: 'active', is_deleted: false }]);
    }
    if (u.pathname.endsWith('/feedbacks')) {
      return json([
        { id: 101, date: '2026-04-04', feedback_type: 'growth', content: 'First historical observation', created_at: '2026-04-04T00:00:00Z' },
        { id: 102, date: '2026-05-05', feedback_type: 'growth', content: 'Second historical observation', created_at: '2026-05-05T00:00:00Z' }
      ]);
    }
    if (u.pathname.endsWith('/fail_feedbacks')) return json([]);
    if (u.pathname === '/api/chat') return json({ reply: 'Generated summary based on exact feedback inputs; '.repeat(3) });
    throw new Error('Unexpected request: ' + u.pathname);
  };
  try {
    const handler = require('../packages/common/api/_lib/consultation-summary-handler.cjs');
    const result = await handler.runScheduled({
      action: 'generate', academyId, studentId,
      taskKey: 'id:' + studentId + '|manual_6|2026-06',
      selectedFeedbackIds: [102, 101]
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.feedbackId, 900);
    const finish = requests.find(r => r.path.endsWith('/rpc/olli_consultation_summary_finish_with_sources'));
    assert.ok(finish, 'New finish RPC must save sources in same transaction as the summary');
    assert.deepEqual(finish.body.p_source_general_feedback_ids, [101, 102]);
    assert.deepEqual(finish.body.p_source_feedback_ids, []);
    assert.equal(finish.body.p_rule_key, 'manual_6');
    assert.ok(!requests.some(r => r.path === '/summary_feedbacks' && r.body));
  } finally {
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = prevKey;
    if (prevEnv == null) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = prevEnv;
  }
});
