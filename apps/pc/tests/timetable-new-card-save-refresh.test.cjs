'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'pc-timetable.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '..', 'pc-timetable-service.js'), 'utf8');
function section(text, start, end) {
  const i = text.indexOf(start), j = text.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, 'missing original function: ' + start);
  return text.slice(i, j);
}
const load = section(ui, '  async function loadWeek(realtimeContext, options = {}) {', '\n  function enrollments()');
const refresh = section(ui, '  async function refreshWeekAfterMutation() {', '\n  async function withSaving(task)');
const save = section(ui, '  async function withSaving(task) {', '\n  async function saveMove()');

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function harness(options = {}) {
  const week = options.week || '2026-11-16';
  const state = {
    active: true, view: 'schedule', pane: 'schedule',
    weekStart: new Date(week + 'T00:00:00Z'),
    data: { enrollments: [], pickups: [], recent_card_badges: { enrollments: [], pickups: [] } },
    dataWeek: week, dataAcademyId: 'academy-a',
    loading: false, loadingWeek: '', loadToken: 0, saving: false
  };
  let academy = 'academy-a', session = 'session-a';
  const reads = [], draws = [], warnings = [];
  const serviceStub = {
    currentAcademyId: () => academy,
    getCachedWeek: () => null,
    loadWeek: (target) => {
      reads.push(target);
      return options.read ? options.read(target, reads.length) : Promise.resolve(options.data || {});
    }
  };
  const create = new Function(
    'state','service','localStorage','document','dateKey','currentSyncAcademyId',
    'renderSidebar','renderTimetable','refreshOpenStudentInfoPanel',
    'syncBeforeScheduleMutation','closeDialog','capacityWeeks','alert','console',
    load + '\n' + refresh + '\n' + save
      + '\nreturn { loadWeek, refreshWeekAfterMutation, withSaving };'
  );
  const api = create(
    state, serviceStub, { getItem: () => session },
    { querySelector: () => ({ disabled: false, textContent: '' }) },
    date => date.toISOString().slice(0, 10),
    () => academy,
    () => {},
    () => draws.push(JSON.parse(JSON.stringify(state.data))),
    () => {}, async () => {},
    () => { state.dialog = null; },
    { clear: () => {} },
    () => {},
    { warn: (...args) => warnings.push(args) }
  );
  return {
    ...api, state, reads, draws, warnings,
    setAcademy: value => { academy = value; },
    setSession: value => { session = value; }
  };
}
function snapshot(type, id) {
  return {
    enrollments: type === 'enrollments' ? [{ id }] : [],
    pickups: type === 'pickups' ? [{ id }] : [],
    recent_card_badges: {
      enrollments: type === 'enrollments' ? [{ id }] : [],
      pickups: type === 'pickups' ? [{ id }] : []
    }
  };
}

test('save beats a pre-save Realtime fetch and immediately paints the confirmed student NEW badge', async () => {
  const oldRead = deferred(), savedRead = deferred();
  const ctx = harness({ read: (_, n) => n === 1 ? oldRead.promise : savedRead.promise });
  const old = ctx.loadWeek();
  ctx.state.data = null;
  const afterSave = ctx.refreshWeekAfterMutation();
  assert.deepEqual(ctx.reads, ['2026-11-16', '2026-11-16'], 'committed save must bypass busy-week short circuit');
  savedRead.resolve(snapshot('enrollments', 'new-student'));
  assert.equal(await afterSave, true);
  oldRead.resolve(snapshot('enrollments', 'old-student'));
  assert.equal(await old, false, 'outdated in-flight request must not overwrite new data');
  assert.equal(ctx.state.data.recent_card_badges.enrollments[0].id, 'new-student');
  assert.equal(ctx.draws.at(-1).enrollments[0].id, 'new-student');
});

test('daily and weekly pickup additions use the same immediate server-confirmed badge repaint', async () => {
  for (const kind of ['daily', 'weekly']) {
    const pending = deferred();
    const ctx = harness({ read: (_, n) => n === 1 ? pending.promise : Promise.resolve(snapshot('pickups', kind + '-pickup')) });
    const stale = ctx.loadWeek();
    ctx.state.data = null;
    assert.equal(await ctx.refreshWeekAfterMutation(), true);
    assert.equal(ctx.state.data.recent_card_badges.pickups[0].id, kind + '-pickup');
    assert.equal(ctx.draws.at(-1).pickups[0].id, kind + '-pickup');
    pending.resolve(snapshot('pickups', 'stale'));
    assert.equal(await stale, false);
  }
});

test('post-save refresh keeps a selected future week rather than loading the current week', async () => {
  const ctx = harness({ week: '2026-12-07', data: snapshot('enrollments', 'future-student') });
  ctx.state.data = null;
  assert.equal(await ctx.refreshWeekAfterMutation(), true);
  assert.deepEqual(ctx.reads, ['2026-12-07']);
  assert.equal(ctx.state.dataWeek, '2026-12-07');
  assert.equal(ctx.draws.at(-1).enrollments[0].id, 'future-student');
});

test('old academy/session response is ignored after changing the active account context', async () => {
  const pending = deferred(), ctx = harness({ read: () => pending.promise });
  const read = ctx.refreshWeekAfterMutation();
  ctx.setAcademy('academy-b');
  ctx.setSession('session-b');
  pending.resolve(snapshot('enrollments', 'wrong-academy'));
  assert.equal(await read, false);
  assert.equal(ctx.draws.some(row => row?.enrollments?.some(e => e.id === 'wrong-academy')), false);
  assert.equal(ctx.state.data.enrollments.some(e => e.id === 'wrong-academy'), false);
});

test('original save flow waits for fresh repaint and does not accept stale in-flight rows', async () => {
  const stale = deferred(), fresh = deferred();
  const ctx = harness({ read: (_, n) => n === 1 ? stale.promise : fresh.promise });
  const running = ctx.loadWeek();
  const saving = ctx.withSaving(async () => ({ result: 'saved' }));
  for (let i = 0; i < 12 && ctx.reads.length < 2; i++) await Promise.resolve();
  assert.deepEqual(ctx.reads, ['2026-11-16','2026-11-16']);
  fresh.resolve(snapshot('enrollments', 'saved-class'));
  assert.deepEqual(await saving, { result: 'saved' });
  stale.resolve(snapshot('enrollments', 'outdated'));
  await running;
  assert.equal(ctx.draws.at(-1).recent_card_badges.enrollments[0].id, 'saved-class');
});

test('read-only NEW metadata is retried once without replacing the good cache with an empty error result', async () => {
  const helper = section(service, '  async function loadRecentCardBadges() {', '\n  async function loadWeek(weekStart)');
  const make = new Function('rpc','contextPayload','console',helper + '\nreturn loadRecentCardBadges;');
  let calls = 0, warnings = 0;
  const fetch = make(async (name, payload) => {
    calls++;
    assert.equal(name,'olli_schedule_recent_card_badges');
    assert.deepEqual(payload, { academy: 'academy-a' });
    if (calls === 1) throw new Error('brief interruption');
    return { enrollments: [{ id: 'new-student' }], pickups: [{ id: 'new-pickup' }] };
  }, () => ({ academy:'academy-a' }), { warn: () => warnings++ });
  assert.equal((await fetch()).enrollments[0].id, 'new-student');
  assert.equal(calls, 2);
  assert.equal(warnings, 1);
  const failed = make(async () => { throw new Error('offline'); }, () => ({}), { warn: () => {} });
  assert.equal((await failed()).load_failed, true);
  assert.match(service,/if \(!data\.recent_card_badges_unavailable\) cacheWeek\(weekStart, data\)/);
});

test('fix preserves original authenticated write, read-revision and rendering guards', () => {
  assert.match(ui, /const result = await task\(\);[\s\S]*?closeDialog\(\);[\s\S]*?state\.data = null;[\s\S]*?await refreshWeekAfterMutation\(\)/);
  assert.match(load,/if \(!options\.force && state\.loading/);
  assert.match(load,/const token = \+\+state\.loadToken/);
  assert.match(load,/if \(token !== state\.loadToken\) return false/);
  assert.match(refresh,/return loadWeek\(null, \{ force: true \}\)/);
  assert.doesNotMatch(refresh,/service\.loadWeek|state\.data\s*=|mondayOf/);
});
