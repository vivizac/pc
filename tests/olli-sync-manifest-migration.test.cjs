const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260925163000_add_olli_sync_manifest.sql'),
  'utf8'
);

function functionBody() {
  const match = sql.match(/create or replace function public\.olli_sync_manifest[\s\S]*?as \$function\$([\s\S]*?)\$function\$;/i);
  assert.ok(match, 'olli_sync_manifest function body must exist');
  return match[1];
}

test('sync manifest is additive and exposes only the new RPC plus one supporting index', () => {
  assert.match(sql, /create index if not exists olli_team_material_request_events_academy_id_desc_idx/i);
  assert.match(sql, /create or replace function public\.olli_sync_manifest/i);
  assert.doesNotMatch(sql, /drop\s+(table|column|function|trigger|index)/i);
  assert.doesNotMatch(sql, /alter\s+table[\s\S]*?(drop|rename)/i);
});

test('manifest function is STABLE, SECURITY DEFINER, and has an empty search path', () => {
  const header = sql.slice(0, sql.indexOf('as $function$'));
  assert.match(header, /language plpgsql\s+stable\s+security definer\s+set search_path to ''/i);
});

test('manifest validates the existing OLLI session and academy access helper', () => {
  const body = functionBody();
  assert.match(body, /private\.olli_realtime_can_access\(p_session_token, p_academy_id\)/i);
  assert.match(body, /'ok', false/i);
});

test('manifest function body is strictly read-only', () => {
  const body = functionBody();
  assert.doesNotMatch(body, /\binsert\s+into\b/i);
  assert.doesNotMatch(body, /\bupdate\s+[a-z0-9_."]+\s+set\b/i);
  assert.doesNotMatch(body, /\bdelete\s+from\b/i);
  assert.doesNotMatch(body, /\btruncate\b/i);
  assert.doesNotMatch(body, /olli_realtime_send_signal/i);
});

test('schedule marker reads revision directly and uses zero when no row exists', () => {
  const body = functionBody();
  assert.match(body, /from public\.olli_schedule_sync_revisions r/i);
  assert.match(body, /where r\.academy_id = p_academy_id/i);
  assert.match(body, /v_schedule_revision := coalesce\(v_schedule_revision, 0\)/i);
  assert.doesNotMatch(body, /olli_schedule_sync_revision\s*\(/i);
});

test('chat marker is explicitly insert-only and uses descending message id', () => {
  const body = functionBody();
  assert.match(body, /from public\.olli_team_chat_messages m/i);
  assert.match(body, /order by m\.id desc\s+limit 1/i);
  assert.match(body, /'coverage', 'message_insert_only'/i);
});

test('materials marker uses durable event id and does not use row revision as an academy cursor', () => {
  const body = functionBody();
  assert.match(body, /from public\.olli_team_material_request_events e/i);
  assert.match(body, /order by e\.id desc\s+limit 1/i);
  assert.match(body, /'coverage', 'create_and_status_change'/i);
  assert.match(sql, /on public\.olli_team_material_request_events \(academy_id, id desc\)/i);
});

test('domains without a durable academy checkpoint remain explicitly pending', () => {
  const body = functionBody();
  assert.match(body, /'students', 'no_independent_durable_checkpoint'/i);
  assert.match(body, /'observation', 'per_record_revision_only'/i);
  assert.match(body, /'feedback', 'no_durable_change_cursor'/i);
  assert.match(body, /'consultation', 'no_academy_checkpoint'/i);
  assert.match(body, /'chat_mutations', 'no_durable_change_cursor'/i);
});

test('function execution is not left open to PUBLIC', () => {
  assert.match(sql, /revoke all on function public\.olli_sync_manifest\(text, uuid\) from public/i);
  assert.match(sql, /grant execute on function public\.olli_sync_manifest\(text, uuid\) to anon, authenticated/i);
});

test('manifest payload has no generated timestamp that would change on every read', () => {
  const body = functionBody();
  assert.doesNotMatch(body, /generated_at|clock_timestamp|statement_timestamp|current_timestamp/i);
});
