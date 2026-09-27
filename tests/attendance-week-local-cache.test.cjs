const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('olli-attendance-data.js', 'utf8');

test('attendance shared data exposes an academy-scoped week snapshot cache', () => {
  assert.match(source, /const WEEK_CACHE_PREFIX = 'olli_attendance_week_cache_v1'/);
  assert.match(source, /function weekCacheKey\(value\)[\s\S]*?currentAcademyId\(\)[\s\S]*?weekStart/);
  assert.match(source, /function getCachedWeek\(value\)/);
  assert.match(source, /function cacheWeek\(value, week\)/);
  assert.match(source, /function invalidateWeek\(value\)/);
  assert.match(source, /global\.OlliAttendanceData = Object\.freeze\([\s\S]*?getCachedWeek,[\s\S]*?invalidateWeek,[\s\S]*?loadWeek/);
});

test('server week reads refresh the local week snapshot', () => {
  assert.match(source, /async function loadWeek\(value\)[\s\S]*?await rpc\('olli_schedule_week'[\s\S]*?cacheWeek\(weekStart, week\);[\s\S]*?return week;/);
});

test('attendance writes invalidate the affected week snapshot', () => {
  const invalidations = source.match(/invalidateWeek\(options\.sessionDate\)/g) || [];
  assert.ok(invalidations.length >= 2);
  assert.match(source, /await execute\('add_one_time'[\s\S]*?invalidateWeek\(key\);/);
});


function createAttendanceSandbox() {
  const values = new Map([
    ['olli_current_academy_id', 'academy-a'],
    ['olli_account_session_token_v1', 'session-a']
  ]);
  const calls = [];
  const week = {
    enrollments: [
      { student_id:'student-1', weekday:1, time_slot:4, class_group:'A', status:'active', effective_from:'2026-01-01', effective_to:null },
      { student_id:'student-1', weekday:1, time_slot:5, class_group:'A', status:'active', effective_from:'2026-01-01', effective_to:null }
    ],
    one_time_sessions: [],
    attendance: []
  };
  const sandbox = {
    window: null,
    console,
    Date,
    localStorage: {
      getItem:key => values.get(key) || null,
      setItem:(key,value) => values.set(key, String(value)),
      removeItem:key => values.delete(key)
    },
    getOlliCurrentAcademyId: () => 'academy-a',
    async supabase(method, path, body) {
      calls.push({ method, path, body });
      if (path === 'rpc/olli_schedule_apply_due') return { ok:true };
      if (path === 'rpc/olli_schedule_week') return week;
      if (path === 'rpc/olli_schedule_execute') return { ok:true, result:'saved' };
      throw new Error('unexpected rpc: ' + path);
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename:'olli-attendance-data.js' });
  return { sandbox, calls };
}

test('explicit session target preserves the selected regular time slot', async () => {
  const env = createAttendanceSandbox();
  const result = await env.sandbox.OlliAttendanceData.setAttendancePresent({
    student:{ id:'student-1', lesson_day:'월', lesson_time:'월 4시' },
    sessionDate:'2026-09-28',
    sessionKind:'regular',
    timeSlot:5,
    classGroup:'A',
    present:true
  });

  const executeCall = env.calls.find(row => row.path === 'rpc/olli_schedule_execute' && row.body?.p_action === 'set_attendance');
  assert.ok(executeCall);
  assert.equal(executeCall.body.p_params.time_slot, 5);
  assert.equal(executeCall.body.p_params.class_group, 'A');
  assert.equal(result.target.timeSlot, 5);
});

test('legacy attendance callers keep existing target resolution when no explicit session is supplied', async () => {
  const env = createAttendanceSandbox();
  const result = await env.sandbox.OlliAttendanceData.setAttendancePresent({
    student:{ id:'student-1', lesson_day:'월', lesson_time:'월 4시' },
    sessionDate:'2026-09-28',
    sessionKind:'regular',
    present:true
  });

  const executeCall = env.calls.find(row => row.path === 'rpc/olli_schedule_execute' && row.body?.p_action === 'set_attendance');
  assert.ok(executeCall);
  assert.equal(executeCall.body.p_params.time_slot, 4);
  assert.equal(result.target.timeSlot, 4);
});
