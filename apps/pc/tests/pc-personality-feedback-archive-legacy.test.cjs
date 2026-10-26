const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const pc = fs.readFileSync(path.join(root, 'pc-attendance.js'), 'utf8');
const feedback = fs.readFileSync(path.join(root, 'olli-data-attendance-feedback.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pc-attendance.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extract(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, 'expected source functions');
  return source.slice(first, last);
}

test('imported ISO dates and newly created dotted dates are both valid', () => {
  const functions = extract(feedback, 'function normalizeAttendanceFeedbackDate(', '\nfunction formatAttendanceFeedbackSheetDate(');
  const getDate = vm.runInNewContext(functions + '\ngetAttendanceFeedbackRowDate');
  assert.equal(getDate({ date: '2025-05-01', created_at: '2026-10-02T00:00:00Z' }), '2025-05-01');
  assert.equal(getDate({ date: '2026. 9. 22.' }), '2026-09-22');
});

test('archive month keys preserve different years and both labels', () => {
  const timestamp = extract(pc, '  function getPcAttendanceRecordTimestamp(', '  function renderUnifiedRecordCards(');
  const months = extract(pc, '  function archiveMonthKey(', '  function renderArchiveMonthButtons(');
  const helpers = vm.runInNewContext(timestamp + months + '\n({ archiveMonthKey, archiveMonthLabel, archiveYearLabel })');
  const imported = helpers.archiveMonthKey({ createdAt: '2025-05-01' });
  const recent = helpers.archiveMonthKey({ createdAt: '2026. 5. 19.' });
  assert.equal(imported, '2025-05');
  assert.equal(recent, '2026-05');
  assert.equal(helpers.archiveMonthLabel(imported), '5월');
  assert.equal(helpers.archiveYearLabel(imported), '2025년');
  assert.equal(helpers.archiveYearLabel(recent), '2026년');
});

test('year appears beneath month in the archive buttons, with accessible full dates', () => {
  assert.match(pc, /pcAttendanceArchiveMonthText/);
  assert.match(pc, /pcAttendanceArchiveYearText/);
  assert.match(pc, /aria-label/);
  assert.match(css, /\.pcAttendanceArchiveMonthBtn\{[^}]*flex-direction:column/);
  assert.match(css, /\.pcAttendanceArchiveYearText\{font:500 10px/);
  assert.match(html, /pc-attendance\.js\?v=20261023-personality-archive-year-1/);
  assert.match(html, /pc-attendance\.css\?v=20261026-month-unset-guide-1/);
});

test('a partial protected feedback query fails instead of returning incomplete cached data', async () => {
  const source = extract(feedback, 'async function loadAttendanceStudentFeedbackSheetItems(', '\nconst attendanceStudentFeedbackSheetState');
  const scope = {
    isSupabaseConfigured: () => true,
    loadAttendanceFeedbackRowsSecure: table => table === 'feedbacks'
      ? Promise.reject(new Error('network'))
      : Promise.resolve([]),
    normalizeAttendanceFeedbackRows: rows => rows,
    console: { warn: () => {} },
  };
  const load = vm.runInNewContext(source + '\nloadAttendanceStudentFeedbackSheetItems', scope);
  await assert.rejects(
    load({ id: 'student' }),
    error => error.code === 'PARTIAL_FEEDBACK_READ_FAILED' && error.tables.includes('feedbacks')
  );
  scope.loadAttendanceFeedbackRowsSecure = table => table === 'feedbacks'
    ? Promise.resolve([{ createdAt: '2025-05-01', content: 'imported' }])
    : Promise.resolve([]);
  const complete = await load({ id: 'student' });
  assert.equal(complete.feedbacks.length, 1);
  assert.equal(complete.feedbacks[0].content, 'imported');
});
