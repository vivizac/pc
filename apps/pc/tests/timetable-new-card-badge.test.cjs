const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const css = fs.readFileSync('pc-timetable.css', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('../../supabase/migrations/20261104153500_olli_schedule_recent_card_badges.sql', 'utf8');
const registrationOnlyMigration = fs.readFileSync('../../supabase/migrations/20261104201500_olli_schedule_recent_card_badges_registration_only.sql', 'utf8');

const helperMatch = ui.match(/  function isTimetableNewCard\(kind, cardId, nowMs = Date\.now\(\)\) \{[\s\S]*?\n  \}\n\n  function cellContentsHtml/);
assert.ok(helperMatch, 'exact production badge eligibility helper must exist');
const helperSource = helperMatch[0].replace(/\n\n  function cellContentsHtml$/, '');
const badge = new Function('data', 'kind', 'id', 'nowMs', `
  const state = { data };
  const clean = value => String(value == null ? '' : value).trim();
  ${helperSource}
  return isTimetableNewCard(kind, id, nowMs);
`);

test('new enrollment and pickup IDs display N for fewer than 14 days', () => {
  const now = Date.parse('2026-11-04T06:00:00.000Z');
  const data = { recent_card_badges: {
    enrollments: [{ id: 'enroll-1', created_at: new Date(now - 1000).toISOString() }],
    pickups: [{ id: 'pickup-1', created_at: new Date(now - (13 * 86400000 + 86399999)).toISOString() }]
  } };
  assert.equal(badge(data, 'enrollments', 'enroll-1', now), true);
  assert.equal(badge(data, 'pickups', 'pickup-1', now), true);
  assert.equal(badge(data, 'enrollments', 'pickup-1', now), false, 'card categories must not leak');
});

test('N expires at exactly 14 days, and unknown or future timestamps never show N', () => {
  const now = Date.parse('2026-11-04T06:00:00.000Z');
  const data = { recent_card_badges: { enrollments: [
    { id: 'expired', created_at: new Date(now - 14 * 86400000).toISOString() },
    { id: 'future', created_at: new Date(now + 1000).toISOString() },
    { id: 'invalid', created_at: 'not a timestamp' }
  ] } };
  assert.equal(badge(data, 'enrollments', 'expired', now), false);
  assert.equal(badge(data, 'enrollments', 'future', now), false);
  assert.equal(badge(data, 'enrollments', 'invalid', now), false);
  assert.equal(badge(data, 'enrollments', 'unknown', now), false);
  assert.equal(badge({}, 'enrollments', 'expired', now), false, 'legacy cache');
});

test('only registered regular student cards and pickup cards use the independent recent-card class', () => {
  assert.match(ui, /isTimetableNewCard\('enrollments', item\.id\) \? ' olliTtNewCard' : ''/);
  assert.match(ui, /isTimetableNewCard\('pickups', item\.id\) \? ' olliTtNewCard' : ''/);
  assert.match(ui, /class="olliTtStudent regular \$\{division\}\$\{newCardClass\}/);
  assert.match(ui, /class="olliTtPickupCard\$\{newCardClass\}"/);
  assert.doesNotMatch(ui, /isTimetableNewCard\('(waitlist|makeups|trials)'/);
});

test('regular NEW badge is next to the name, pickup keeps original N corner badge', () => {
  assert.match(ui, /const studentNameHtml = newCardClass/);
  assert.match(ui, /class="olliTtNewName"/);
  assert.match(ui, /class="olliTtNewNameText"/);
  assert.match(ui, /\$\{studentNameHtml\}\$\{pauseBadge\}/);
  assert.match(css, /\.olliTtStudent\.regular\.olliTtNewCard \.olliTtNewName::after/);
  assert.match(css, /content: "NEW";/);
  assert.match(css, /\.olliTtPickupCard\.olliTtNewCard::after/);
  assert.match(css, /content: "N";/);
  assert.doesNotMatch(css, /\.olliTtStudent\.olliTtNewCard::after/);
  assert.match(css, /position: absolute;/);
  assert.match(css, /pointer-events: none;/);
  assert.match(css, /isolation: isolate;/);
});

test('regular NEW student card uses Olli blue border and white background without overriding status colors', () => {
  assert.match(css, /\.olliTtCell:not\(\.holiday\) \.olliTtStudent\.regular\.olliTtNewCard:where\(:not\(\.attended\):not\(\.absent\):not\(\.absenceUpcoming\):not\(\.pausedStudent\)\)/);
  assert.match(css, /border-color: #0A84FF;/);
  assert.match(css, /background: #fff;/);
  assert.match(css, /\.olliTtNewName::after \{[\s\S]*?right: 0;/);
  assert.match(css, /\.olliTtNewName::after \{[\s\S]*?content: "NEW";/);
  assert.match(css, /\.olliTtNewName \{[\s\S]*?padding-right: 32px;/);
});

test('week service fetches authenticated badge metadata, retaining existing schedule writes and cached week', () => {
  assert.match(service, /rpc\('olli_schedule_recent_card_badges', contextPayload\(\)\)/);
  assert.match(service, /data\.recent_card_badges = \{/);
  assert.match(service, /cacheWeek\(weekStart, data\)/);
  assert.match(service, /savePickup\(/);
  assert.match(service, /loadWeek\(/);
});

test('badge RPC is scoped to the authenticated academy and actual insert timestamps', () => {
  assert.match(migration, /private\.olli_schedule_can_access\(p_session_token, p_academy_id\)/);
  assert.match(migration, /from public\.olli_schedule_enrollments e/);
  assert.match(migration, /from public\.olli_schedule_pickups p/);
  assert.match(migration, /e\.academy_id = p_academy_id/);
  assert.match(migration, /p\.academy_id = p_academy_id/);
  assert.match(migration, /e\.created_at > now\(\) - interval '14 days'/);
  assert.match(migration, /p\.created_at > now\(\) - interval '14 days'/);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from/i);
});

test('new registration and added sessions qualify, but move-created enrollment rows do not', () => {
  // The live schedule_change RPC writes source='add' for new slots, and
  // source='move' for a moved destination. The badge RPC must use that fact.
  assert.match(registrationOnlyMigration, /e\\.source in \\('add', 'manual'\\)/);
  assert.match(registrationOnlyMigration, /e\\.source = 'waitlist'[\\s\\S]*?added\\.change_type = 'add'/);
  assert.match(registrationOnlyMigration, /e\\.source = 'legacy'[\\s\\S]*?s\\.created_at > now\\(\\) - interval '14 days'/);
  assert.match(registrationOnlyMigration, /and not exists \\(\\s*select 1 from public\\.olli_schedule_changes moved/);
  assert.match(registrationOnlyMigration, /moved\\.target_enrollment_id = e\\.id/);
  assert.match(registrationOnlyMigration, /moved\\.change_type = 'move'/);
  assert.match(registrationOnlyMigration, /e\\.created_at > now\\(\\) - interval '14 days'/);
});

test('badge correction preserves pickup N, access policy and prior RPC signature exactly', () => {
  const pickupSection = source => source.slice(source.indexOf('  select coalesce(jsonb_agg', source.indexOf('  into v_enrollments')), source.indexOf('  return jsonb_build_object(', source.indexOf('  into v_enrollments')));
  assert.equal(pickupSection(registrationOnlyMigration), pickupSection(migration),
    'pickup card rules must stay exactly as before');
  for (const expression of [
    'public.olli_schedule_recent_card_badges(', 'private.olli_schedule_can_access(p_session_token, p_academy_id)',
    'security definer', 'set search_path to',
    'revoke all on function public.olli_schedule_recent_card_badges(text, uuid)',
    'grant execute on function public.olli_schedule_recent_card_badges(text, uuid) to anon, authenticated'
  ]) {
    assert.ok(registrationOnlyMigration.includes(expression), expression);
  }
  assert.doesNotMatch(registrationOnlyMigration, /\\b(?:insert into|update public\\.|delete from|truncate table|drop table)\\b/i);
});

test('PC timetable cache-busts only the modified stylesheet and scripts', () => {
  for (const asset of ['pc-timetable.js', 'pc-timetable-service.js', 'pc-timetable.css']) {
    const version = asset === 'pc-timetable-service.js' ? '20261104-new-card-badge-1' : '20261104-new-card-badge-2';
    assert.ok(html.includes(asset + '?v=' + version), asset);
  }
});
