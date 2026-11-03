'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const timetable = fs.readFileSync(path.join(__dirname, '..', 'pc-timetable.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '..', 'pc-timetable-service.js'), 'utf8');

function referenceFor(visibleMonday, currentSaturday) {
  const helper = timetable.match(/  function sessionOrderReferenceDate\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(helper, 'shared session-order reference date helper must exist');
  const context = {
    state: { weekStart: new Date(visibleMonday + 'T12:00:00') },
    currentWeekEndDate: () => new Date(currentSaturday + 'T12:00:00'),
    addDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }
  };
  const date = vm.runInNewContext(helper + '\nsessionOrderReferenceDate()', context);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

test('session-order reference uses week end so newly added Thursday is eligible on Tuesday', () => {
  assert.equal(referenceFor('2026-11-02', '2026-11-07'), '2026-11-07');
});

test('session-order reference follows the visible future week for upcoming registrations', () => {
  assert.equal(referenceFor('2026-11-09', '2026-11-07'), '2026-11-14');
  assert.equal(referenceFor('2026-10-26', '2026-11-07'), '2026-11-07');
});

test('popup and save use the same effective date, not today', () => {
  const setter = timetable.slice(timetable.indexOf('  async function setWeeklySessionOrder('), timetable.indexOf('  function cellMemoInfo('));
  const popup = timetable.slice(timetable.indexOf('  function moveDialogHtml('), timetable.indexOf('  function teacherControlsHtml(', timetable.indexOf('  function moveDialogHtml(')) === -1 ? undefined : timetable.indexOf('  function teacherControlsHtml(', timetable.indexOf('  function moveDialogHtml(')));
  assert.match(setter, /const date = sessionOrderReferenceDate\(\)/);
  assert.match(setter, /activeWeeklySessions\(studentId, date\)/);
  assert.match(setter, /service\.setSessionOrder\(studentId, enrollmentId, Number\(order\), dateKey\(date\)\)/);
  assert.doesNotMatch(setter, /todayKey\(\)/);
  assert.match(popup, /const weekReferenceDate = sessionOrderReferenceDate\(\)/);
  assert.match(popup, /enrollmentEffectiveOn\(item, weekReferenceDate\)/);
});

test('stale or invalid session selection reports a failure instead of silently doing nothing', () => {
  const setter = timetable.slice(timetable.indexOf('  async function setWeeklySessionOrder('), timetable.indexOf('  function cellMemoInfo('));
  assert.match(setter, /weeklySessions\.length !== 2\) throw new Error/);
  assert.match(setter, /if \(!selected\) throw new Error/);
  assert.match(service, /if \(data && data\.ok === false\) throw new Error/);
  assert.match(timetable, /alert\(error && \(error\.message \|\| error\) \|\| '수업 회차 저장에 실패했습니다\.'/);
});
