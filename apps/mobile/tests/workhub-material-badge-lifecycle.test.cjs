const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const talk = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');
const materials = fs.readFileSync(path.join(root, 'olli-talk-material-orders-mobile.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261002065000_material_badge_until_ordered.sql'),
  'utf8'
);

test('material badge lifecycle is based on pending order status instead of read state', () => {
  assert.match(migration, /from public\.olli_team_material_requests r[\s\S]*?r\.status in \('requested','on_hold'\)/);
  assert.match(migration, /'material_unread_count', coalesce\(v_material_unread, 0\)/);
  const summaryStart = migration.indexOf('create or replace function public.olli_mobile_work_notification_summary');
  const summaryEnd = migration.indexOf('comment on function public.olli_mobile_work_notification_summary', summaryStart);
  const summary = migration.slice(summaryStart, summaryEnd);
  assert.doesNotMatch(summary, /last_read_material_event_id/);
});

test('opening or confirming material notifications may keep read state without controlling badges', () => {
  assert.match(talk, /olli_mobile_work_mark_material_read_to/);
  assert.match(talk, /olli_mobile_work_mark_material_read/);
  assert.match(talk, /refreshOlliTalkMentionBadge/);
  assert.doesNotMatch(
    migration.match(/create or replace function public\.olli_mobile_work_notification_summary[\s\S]*?\$function\$;/)?.[0] || '',
    /last_read_material_event_id/
  );
});

test('material create, status changes, and delete refresh Work badges immediately', () => {
  assert.match(materials, /function refreshWorkNotificationBadge\(\)/);
  const createStart = materials.indexOf('async function submitCreate');
  const statusStart = materials.indexOf('async function setStatus');
  const deleteStart = materials.indexOf('async function deleteRequest');
  const filterStart = materials.indexOf('function setFilter', deleteStart);
  const create = materials.slice(createStart, statusStart);
  const status = materials.slice(statusStart, deleteStart);
  const remove = materials.slice(deleteStart, filterStart);
  assert.match(create, /refreshWorkNotificationBadge\(\)/);
  assert.match(status, /refreshWorkNotificationBadge\(\)/);
  assert.match(remove, /refreshWorkNotificationBadge\(\)/);
});

test('ordered and arrived requests are excluded from the badge count', () => {
  assert.match(migration, /status in \('requested','on_hold'\)/);
  assert.doesNotMatch(
    migration.match(/select count\(\*\)::integer[\s\S]*?into v_material_unread[\s\S]*?;/)?.[0] || '',
    /'ordered'|'arrived'/
  );
});

test('material badge lifecycle bundle is cache-busted', () => {
  assert.match(html, /olli-talk-material-orders-mobile\.js\?v=20261002-material-badge-until-ordered-1/);
});
