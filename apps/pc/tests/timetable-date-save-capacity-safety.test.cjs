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


test('real countAt helper never reuses a different week and includes future makeup counts', async () => {
  const capacitySource = between('  const capacityWeeks = new Map();', '  function weekRangeText() {');
  const clean = value => String(value ?? '').trim();
  const dateKey = date => [
    date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')
  ].join('-');
  const parseDate = value => {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const mondayOf = value => {
    const d = new Date(value);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  };
  const state = {
    dataWeek: '2026-11-16', dataAcademyId: 'academy-A',
    data: { enrollments: Array(9).fill({ student_id:'old', division:'kinder', weekday:3, time_slot:4, effective_from:'2026-11-01' }) },
    dialog: null
  };
  let loadCount = 0;
  const service = { loadWeek: async week => {
    loadCount++;
    assert.equal(week, '2026-11-23');
    return {
      enrollments: [
        { student_id:'one', division:'kinder', weekday:3, time_slot:4, class_group:'A', effective_from:'2026-11-01' },
        { student_id:'two', division:'kinder', weekday:3, time_slot:4, class_group:'A', effective_from:'2026-11-01' }
      ],
      one_time_sessions: [{ student_id:'three', division:'kinder', session_date:'2026-11-25', time_slot:4, class_group:'A' }],
      attendance_overrides: []
    };
  }};
  const ctx = { state, service, dateKey, parseDate, mondayOf, clean,
    currentSyncAcademyId:()=>'academy-A',
    timeSlotMatches:(_division,_date,expected,actual)=>Number(expected)===Number(actual),
    enrollmentActiveOn:(item,date)=>Number(item.weekday)===date.getDay() && item.effective_from<=dateKey(date),
    // This regression isolates future-week capacity; transition-week projection
    // is exercised with the real helper in timetable-move-week-visual.test.cjs.
    regularMoveInWeek: () => false,
    classGroupOf:item=>item.class_group || 'A',
    renderDialog:()=>{}
  };
  const helpers = new Function(...Object.keys(ctx),
    capacitySource + '\nreturn { countAt, fetchCapacityWeek };'
  )(...Object.values(ctx));
  assert.equal(helpers.countAt('kinder',3,4,'2026-11-25','A',false),null);
  helpers.fetchCapacityWeek('2026-11-25');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(helpers.countAt('kinder',3,4,'2026-11-25','A',false),3);
  assert.equal(loadCount,1);
  assert.equal(state.data.enrollments.length,9,'visible week must not be overwritten');
});

test('real waitlist helper hides future starts even when the request was made earlier', () => {
  const source = between('  function slotWaitlist(', '  function slotMakeups(');
  const rows = [
    { id:'future', division:'kinder', target_weekday:3, target_time_slot:4, desired_effective_date:'2026-12-02', requested_at:'2026-11-01T09:00:00+09:00' },
    { id:'present', division:'kinder', target_weekday:3, target_time_slot:4, desired_effective_date:'2026-11-25', requested_at:'2026-11-01T09:00:00+09:00' }
  ];
  const dateKey = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const list = new Function('waitlist','dateKey','clean','timeSlotMatches','waitRequestedDate','classGroupOf',
    source + '\nreturn slotWaitlist;'
  )(()=>rows,dateKey,value=>String(value??'').trim(),(_division,_date,expected,actual)=>Number(expected)===Number(actual),
    ()=>'2026-11-01',item=>item.target_class_group||'A');
  assert.deepEqual(list('kinder',new Date(2026,10,25),4,'A').map(item=>item.id),['present']);
  assert.deepEqual(list('kinder',new Date(2026,11,2),4,'A').map(item=>item.id),['future','present']);
});
