const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
