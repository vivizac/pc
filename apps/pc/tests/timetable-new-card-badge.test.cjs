const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const css = fs.readFileSync('pc-timetable.css', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('../../supabase/migrations/20261104153500_olli_schedule_recent_card_badges.sql', 'utf8');
const registrationOnlyMigration = fs.readFileSync('../../supabase/migrations/20261104201500_olli_schedule_recent_card_badges_registration_only.sql', 'utf8');
const readdedSlotMigration = fs.readFileSync('../../supabase/migrations/20261105153800_olli_schedule_recent_card_badges_exclude_readded_slots.sql', 'utf8');

const helperMatch = ui.match(/  function isTimetableNewCard\(kind, cardId, sessionDate, nowMs = Date\.now\(\)\) \{[\s\S]*?\n  \}\n\n  function cellContentsHtml/);
assert.ok(helperMatch, 'exact production badge eligibility helper must exist');
const helperSource = helperMatch[0].replace(/\n\n  function cellContentsHtml$/, '');
const dateHelpers = ui.slice(ui.indexOf('  function pad('), ui.indexOf('  function koreanDate('));
const alignHelper = ui.match(/  function alignDateToWeekdayOnOrAfter\(value, weekday\) \{[\s\S]*?\n  \}/);
assert.ok(alignHelper, 'production weekday alignment must exist');
const badge = new Function('data', 'kind', 'id', 'sessionDate', 'nowMs',
  'const state = { data }; const clean = value => String(value == null ? "" : value).trim();\n'
    + dateHelpers + '\n' + alignHelper[0] + '\n' + helperSource
    + '\nreturn isTimetableNewCard(kind, id, sessionDate, nowMs);');

test('Nov 11 new student card appears only on Nov 11 and Nov 18, not Nov 25 or Dec 2', () => {
  const data = { recent_card_badges: { enrollments: [
    { id: 'juho', created_at: '2026-11-09T05:21:45.366Z', effective_from: '2026-11-09', weekday: 3 }
  ] } };
  const now = Date.parse('2026-11-10T09:00:00Z');
  assert.equal(badge(data, 'enrollments', 'juho', '2026-11-11', now), true);
  assert.equal(badge(data, 'enrollments', 'juho', '2026-11-18', now), true);
  assert.equal(badge(data, 'enrollments', 'juho', '2026-11-25', now), false);
  assert.equal(badge(data, 'enrollments', 'juho', '2026-12-02', now), false);
  assert.equal(badge(data, 'enrollments', 'juho', new Date(2026, 10, 18), now), true);
});

test('later revisiting prior weeks restores original N; future starts and retroactive adds are bounded correctly', () => {
  const data = { recent_card_badges: { enrollments: [
    { id: 'juho', created_at: '2026-11-09T05:21:45.366Z', effective_from: '2026-11-09', weekday: 3 },
    { id: 'future', created_at: '2026-11-09T05:21:45.366Z', effective_from: '2026-12-01', weekday: 3 },
    { id: 'retro', created_at: '2026-11-20T08:00:00Z', effective_from: '2026-11-09', weekday: 3 },
    { id: 'invalid', created_at: 'invalid', effective_from: '2026-11-09', weekday: 3 }
  ] } };
  const now = Date.parse('2026-12-15T09:00:00Z');
  assert.equal(badge(data, 'enrollments', 'juho', '2026-11-11', now), true);
  assert.equal(badge(data, 'enrollments', 'future', '2026-11-25', now), false);
  assert.equal(badge(data, 'enrollments', 'future', '2026-12-02', now), true);
  assert.equal(badge(data, 'enrollments', 'future', '2026-12-09', now), true);
  assert.equal(badge(data, 'enrollments', 'future', '2026-12-16', now), false);
  assert.equal(badge(data, 'enrollments', 'retro', '2026-11-18', now), false);
  assert.equal(badge(data, 'enrollments', 'retro', '2026-11-25', now), true);
  assert.equal(badge(data, 'enrollments', 'invalid', '2026-11-11', now), false);
  assert.equal(badge(data, 'enrollments', 'missing', '2026-11-11', now), false);
  assert.equal(badge({}, 'enrollments', 'juho', '2026-11-11', now), false);
});

test('pickup N keeps its original 14-day clock; the student date check does not leak to pickups', () => {
  const now = Date.parse('2026-11-04T06:00:00Z');
  const data = { recent_card_badges: { pickups: [
    { id: 'recent', created_at: new Date(now - 1000).toISOString() },
    { id: 'boundary', created_at: new Date(now - 14 * 86400000).toISOString() },
    { id: 'future', created_at: new Date(now + 1000).toISOString() },
    { id: 'invalid', created_at: 'bad timestamp' }
  ] } };
  assert.equal(badge(data, 'pickups', 'recent', undefined, now), true);
  assert.equal(badge(data, 'pickups', 'recent', '2027-01-01', now), true);
  assert.equal(badge(data, 'pickups', 'boundary', undefined, now), false);
  assert.equal(badge(data, 'pickups', 'future', undefined, now), false);
  assert.equal(badge(data, 'pickups', 'invalid', undefined, now), false);
  assert.equal(badge(data, 'enrollments', 'recent', '2026-11-04', now), false);
});

test('only registered regular student cards and pickup cards use the independent recent-card class', () => {
  assert.match(ui, /isTimetableNewCard\('enrollments', item\.id, date\) \? ' olliTtNewCard' : ''/);
  assert.match(ui, /isTimetableNewCard\('pickups', item\.id\) \? ' olliTtNewCard' : ''/);
  assert.match(ui, /class="olliTtStudent regular \$\{division\}\$\{newCardClass\}/);
  assert.match(ui, /class="olliTtPickupCard\$\{newCardClass\}"/);
  assert.doesNotMatch(ui, /isTimetableNewCard\('(waitlist|makeups|trials)'/);
});

test('regular student NEW renders as the same top-right N overlay as pickup, not a name capsule', () => {
  assert.match(ui, /const studentNameHtml = esc\(item\.student_name\);/);
  assert.match(ui, /isTimetableNewCard\('enrollments', item\.id, date\) \? ' olliTtNewCard' : ''/);
  assert.match(ui, /\$\{studentNameHtml\}\$\{pauseBadge\}/);
  assert.doesNotMatch(ui, /olliTtNewName(?:Text)?/);
  assert.doesNotMatch(css, /\.olliTtNewName(?:Text)?/);
  assert.doesNotMatch(css, /content: "NEW";/);
  assert.match(css, /#recordRoomScreen \.olliTtStudent\.regular\.olliTtNewCard,\s*#recordRoomScreen \.olliTtPickupCard\.olliTtNewCard \{/);
  assert.match(css, /#recordRoomScreen \.olliTtStudent\.regular\.olliTtNewCard::after,\s*#recordRoomScreen \.olliTtPickupCard\.olliTtNewCard::after \{/);
  const shared = css.match(/#recordRoomScreen \.olliTtStudent\.regular\.olliTtNewCard::after,\s*#recordRoomScreen \.olliTtPickupCard\.olliTtNewCard::after \{([^}]+)\}/);
  assert.ok(shared, 'both cards must use one identical N overlay style');
  for (const property of [
    'content: "N";', 'top: -4px;', 'right: -3px;', 'width: 15px;',
    'height: 15px;', 'border-radius: 50%;', 'background: #f04856;',
    'pointer-events: none;'
  ]) {
    assert.ok(shared[1].includes(property), property);
  }
});

test('both kinder and elementary NEW borders share uploaded #74AAF6; normal borders stay unchanged', () => {
  const suffix = '.olliTtNewCard:where(:not(.attended):not(.absent):not(.absenceUpcoming):not(.pausedStudent))';
  const selector = division => '#recordRoomScreen .olliTtCell:not(.holiday) .olliTtStudent.regular.' + division + suffix;
  const commonSelector = selector('elementary') + ',\n' + selector('kinder') + ' {';
  assert.ok(css.includes(commonSelector), 'both NEW division selectors share one source of truth');
  assert.equal(css.split(commonSelector).length, 2, 'only one shared NEW border rule');
  const newRule = css.split(commonSelector)[1].split('}')[0];
  assert.match(newRule, /border-color: #74AAF6;/);
  assert.match(newRule, /background: #fff;/);
  for (const [division, original] of [['elementary', '#bfdcf3'], ['kinder', '#f5c7d4']]) {
    const selector = '#recordRoomScreen .olliTtStudent.regular.' + division + ' {';
    assert.ok(css.includes(selector), 'normal ' + division + ' style still exists');
    assert.ok(css.split(selector)[1].split('}')[0].includes('border-color: ' + original + ';'),
      'normal ' + division + ' border color is unchanged');
  }
  assert.match(css, /\.olliTtStudent\.regular\.attended/);
  assert.match(css, /\.olliTtStudent\.regular\.absent/);
  assert.match(css, /\.olliTtStudent\.regular\.pausedStudent/);
  assert.match(css, /\.olliTtStudent\.regular\.absenceUpcoming/);
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
  assert.match(registrationOnlyMigration, /e\.source in \('add', 'manual'\)/);
  assert.match(registrationOnlyMigration, /e\.source = 'waitlist'[\s\S]*?added\.change_type = 'add'/);
  assert.match(registrationOnlyMigration, /e\.source = 'legacy'[\s\S]*?s\.created_at > now\(\) - interval '14 days'/);
  assert.match(registrationOnlyMigration, /and not exists \(\s*select 1 from public\.olli_schedule_changes moved/);
  assert.match(registrationOnlyMigration, /moved\.target_enrollment_id = e\.id/);
  assert.match(registrationOnlyMigration, /moved\.change_type = 'move'/);
  assert.match(registrationOnlyMigration, /e\.created_at > now\(\) - interval '14 days'/);
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
  assert.doesNotMatch(registrationOnlyMigration, /\b(?:insert into|update public\.|delete from|truncate table|drop table)\b/i);
});

test('existing weekly slot recreated via add must not receive NEW, even after deletion or class-group change', () => {
  // Matches two live regression examples: Thursday 4 (민형), Friday 4 (태양).
  const sql = readdedSlotMigration;
  assert.match(sql, /and not exists \(\s*select 1 from public\.olli_schedule_enrollments previous/);
  assert.match(sql, /previous\.academy_id = e\.academy_id/);
  assert.match(sql, /previous\.student_id = e\.student_id/);
  assert.match(sql, /previous\.id <> e\.id/);
  assert.match(sql, /previous\.created_at < e\.created_at/);
  assert.match(sql, /previous\.weekday = e\.weekday/);
  assert.match(sql, /previous\.time_slot = e\.time_slot/);
  const historicalCheck = sql.slice(sql.indexOf('-- Re-registering an old weekly seat'), sql.indexOf('    and s.academy_id = p_academy_id'));
  assert.doesNotMatch(historicalCheck, /previous\.status\s*=/, 'cancelled/expired old slots still count as historical seats');
  assert.doesNotMatch(historicalCheck, /previous\.class_group\s*=/, 'A-to-B groups must not restart NEW');
  assert.doesNotMatch(historicalCheck, /previous\.session_order\s*=/, '1st/2nd session reassignment must not restart NEW');
  assert.doesNotMatch(historicalCheck, /previous\.effective_to\s*=/, 'past schedules still count as historical slots');
});

test('read-only NEW correction preserves registration, 14-day clock, pickup N and security guards', () => {
  const sql = readdedSlotMigration;
  const pickupSection = source => source.slice(
    source.indexOf('  select coalesce(jsonb_agg', source.indexOf('  into v_enrollments')),
    source.indexOf('  return jsonb_build_object(', source.indexOf('  into v_enrollments'))
  );
  assert.equal(pickupSection(sql), pickupSection(registrationOnlyMigration), 'pickup N source/conditions unchanged');
  for (const condition of [
    'create or replace function public.olli_schedule_recent_card_badges(',
    'private.olli_schedule_can_access(p_session_token, p_academy_id)',
    "e.created_at > now() - interval '14 days'",
    "e.source in ('add', 'manual')",
    "added.change_type = 'add'",
    "moved.change_type = 'move'",
    "p.created_at > now() - interval '14 days'"
  ]) assert.ok(sql.includes(condition), condition);
  assert.doesNotMatch(sql, /\b(?:insert into|update public\.|delete from|truncate table|drop table|alter table)\b/i);
});

test('PC timetable cache-busts only the modified stylesheet and scripts', () => {
  for (const asset of ['pc-timetable.js', 'pc-timetable-service.js', 'pc-timetable.css']) {
    const version = asset === 'pc-timetable-service.js' ? '20261104-new-card-badge-1' : asset === 'pc-timetable.js' ? '20261110-new-card-calendar-week-1' : '20261105-new-border-74aaf6-1';
    assert.ok(html.includes(asset + '?v=' + version), asset);
  }
});

test('new calendar metadata RPC preserves authorization and move guards without filtering student N by the current day', () => {
  const sql = fs.readFileSync('../../supabase/migrations/20261110100000_pc_timetable_new_cards_by_session_date.sql', 'utf8');
  const enrollment = sql.slice(sql.indexOf('  into v_enrollments'), sql.indexOf('  into v_pickups'));
  const pickup = sql.slice(sql.indexOf('  into v_pickups'), sql.indexOf('  return jsonb_build_object('));
  assert.match(sql, /private\.olli_schedule_can_access\(p_session_token, p_academy_id\)/);
  assert.match(sql, /'effective_from', e\.effective_from/);
  assert.match(sql, /'weekday', e\.weekday/);
  assert.doesNotMatch(enrollment, /e\.created_at > now\(\) - interval '14 days'/);
  assert.match(enrollment, /moved\.change_type = 'move'/);
  assert.match(enrollment, /previous\.weekday = e\.weekday/);
  assert.match(enrollment, /previous\.time_slot = e\.time_slot/);
  assert.match(enrollment, /s\.created_at >= e\.created_at - interval '14 days'/);
  assert.match(pickup, /p\.created_at > now\(\) - interval '14 days'/);
  assert.doesNotMatch(sql, /\b(?:insert into|update public\.|delete from|truncate table|drop table|alter table)\b/i);
});
