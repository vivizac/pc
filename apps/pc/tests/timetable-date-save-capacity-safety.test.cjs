'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');

function between(start, end) {
  const from = ui.indexOf(start);
  const to = ui.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing production section: ${start}`);
  return ui.slice(from, to);
}

test('calendar selection preserves the exact chosen date and rejects a weekday mismatch before save', () => {
  const handler = between("const effective = dialog.querySelector('[data-tt-effective-date]');", "bindAddStudentField(dialog);");
  assert.match(handler, /state\.dialog\.effectiveDate = dateKey\(selectedDate\)/);
  assert.doesNotMatch(handler, /selectedDate = alignDateToWeekdayOnOrAfter/);
  const save = between('  async function saveMove() {', '  async function withOpenDialogSaving(');
  assert.match(save, /parseDate\(selectedDate\)\.getDay\(\) !== Number\(dialog\.targetWeekday\)/);
  assert.match(save, /service\.postponeFirstClass\(source\.id, dialog\.effectiveDate\)/);
});

test('change of weekday aligns inside the previously selected week, not back to this week', () => {
  const handler = between("dialog.querySelectorAll('[data-tt-target-day]')", "dialog.querySelectorAll('[data-tt-target-time]')");
  assert.match(handler, /alignDateToWeekdayOnOrAfter\(\s*state\.dialog\.effectiveDate/);
  assert.doesNotMatch(handler, /state\.dialog\.effectiveDate = upcomingDateForWeekday/);
});

test('future capacity reads the target week instead of current visible week', () => {
  const count = between('  const capacityWeeks = new Map();', '  function weekRangeText() {');
  assert.match(count, /service\.loadWeek\(week\)/);
  assert.match(count, /if \(!data\) return null/);
  assert.match(count, /capacityWeekData\(date\)/);
  const dialog = between('  function moveDialogHtml(dialog) {', '  function isGuestAddType(');
  assert.match(dialog, /count === null \? '확인 중' : count/);
  assert.match(ui, /capacityWeeks\.clear\(\);\s*await refreshWeekAfterMutation/);
});

test('waitlist visibility honors requested effective date', () => {
  const block = between('  function slotWaitlist(', '  function slotMakeups(');
  assert.match(block, /desired_effective_date/);
  assert.match(block, /waitRequestedDate\(item\)/);
});

test('partial server failure requests authoritative refreshed data without erasing dialog edits', () => {
  const block = between('  async function withSaving(task) {', '  async function saveMove() {');
  assert.match(block, /await refreshWeekAfterMutation\(\)/);
  assert.match(block, /일부 변경은 저장되었을 수 있습니다/);
  assert.match(block, /if \(state\.dialog\) renderDialog\(\)/);
  assert.match(service, /async function changeSchedule\(options\)/);
});
