const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('olli-command-schedule-common.js', 'utf8');

function loadSchedule(data) {
  const service = {
    async loadWeek() { return structuredClone(data); },
    async loadCalendarRange() { return []; },
    async loadAvailabilityHorizon() { return structuredClone(data); },
    async activeStudents() { return []; }
  };
  const sandbox = {
    window: { OlliTimetableService: service },
    Date,
    console
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.OlliCommandSchedule;
}

function groups(result, timeSlot = 2) {
  return result.allSlots
    .filter(slot => slot.division === 'elementary' && Number(slot.timeSlot) === Number(timeSlot))
    .map(slot => slot.classGroup)
    .sort();
}

function fixture() {
  return {
    class_layout_version: 2,
    elementary_capacity: 5,
    kinder_capacity: 5,
    class_splits: [],
    class_split_periods: [
      { weekday:2, time_slot:2, effective_from:'2026-09-01', effective_to:'2026-09-21' },
      { weekday:2, time_slot:2, effective_from:'2026-10-01', effective_to:null }
    ],
    class_teachers: [
      { division:'elementary', weekday:2, time_slot:2, class_group:'A', teacher_name:'A선생님' },
      { division:'elementary', weekday:2, time_slot:2, class_group:'B', teacher_name:'B선생님' }
    ],
    enrollments: [],
    one_time_sessions: [],
    attendance_overrides: [],
    calendar_days: []
  };
}

test('dated availability uses split period active on the requested date', async () => {
  const schedule = loadSchedule(fixture());

  const historicalSplit = await schedule.findAvailableSlots({
    date:'2026-09-15',
    division:'elementary',
    timeSlot:2
  });
  assert.deepEqual(groups(historicalSplit), ['A','B']);

  const mergedGap = await schedule.findAvailableSlots({
    date:'2026-09-29',
    division:'elementary',
    timeSlot:2
  });
  assert.deepEqual(groups(mergedGap), ['A']);

  const futureSplit = await schedule.findAvailableSlots({
    date:'2026-10-06',
    division:'elementary',
    timeSlot:2
  });
  assert.deepEqual(groups(futureSplit), ['A','B']);
});

test('week availability evaluates A/B layout separately for each actual date', async () => {
  const data = fixture();
  data.class_split_periods = [
    { weekday:2, time_slot:2, effective_from:'2026-09-01', effective_to:'2026-09-21' }
  ];
  const schedule = loadSchedule(data);
  const week = await schedule.findWeekAvailability({
    date:'2026-09-14',
    division:'elementary',
    timeSlot:2
  });
  const tuesday = week.days.find(day => day.date === '2026-09-15');
  assert.ok(tuesday);
  assert.deepEqual(groups(tuesday), ['A','B']);
});


test('canonical class_split_periods wins over the temporary legacy class_splits snapshot', async () => {
  const data = fixture();
  data.class_splits = [{ weekday:2, time_slot:2 }];
  data.class_split_periods = [
    { weekday:2, time_slot:2, effective_from:'2026-09-01', effective_to:'2026-09-21' }
  ];
  const schedule = loadSchedule(data);
  const mergedDate = await schedule.findAvailableSlots({
    date:'2026-09-29',
    division:'elementary',
    timeSlot:2
  });
  assert.deepEqual(groups(mergedDate), ['A']);
});
