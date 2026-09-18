const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('olli-command-schedule-common.js', 'utf8');

function loadSchedule(weekData, calendarDays = []) {
  const sandbox = {
    window: {
      OlliTimetableService: {
        async loadWeek() { return weekData; },
        async loadCalendarRange() { return calendarDays; }
      }
    },
    Date,
    console
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.OlliCommandSchedule;
}

test('available slots count regular, makeup, and trial sessions against the same capacity', async () => {
  const week = {
    elementary_capacity: 5,
    kinder_capacity: 5,
    class_splits: [{ weekday: 5, time_slot: 5 }],
    kinder_class_merges: [{ weekday: 5, time_slot: 5 }],
    enrollments: [
      { division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'B', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'B', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'B', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions: [
      { division:'elementary', session_date:'2026-09-18', time_slot:4, class_group:'A', session_type:'trial', status:'scheduled' },
      { division:'elementary', session_date:'2026-09-18', time_slot:5, class_group:'A', session_type:'makeup', status:'scheduled' }
    ],
    class_teachers: [
      { division:'elementary', weekday:5, time_slot:6, class_group:'A', teacher_name:'김다미' }
    ]
  };

  const schedule = loadSchedule(week);
  const result = await schedule.findAvailableSlots({ date:'2026-09-18' });
  const key = slot => `${slot.division}|${slot.timeSlot}|${slot.classGroup}`;
  const byKey = new Map(result.slots.map(slot => [key(slot), slot]));

  assert.equal(byKey.get('elementary|4|A').remaining, 1);
  assert.equal(byKey.get('elementary|5|A').remaining, 3);
  assert.equal(byKey.get('elementary|5|B').remaining, 1);
  assert.equal(byKey.get('elementary|6|A').remaining, 5);
  assert.equal(byKey.get('kinder|4|A').remaining, 1);
  assert.equal(byKey.has('kinder|4|B'), false);
  assert.equal(byKey.get('kinder|5|A').remaining, 3);
});

test('closed calendar day returns no available classes', async () => {
  const schedule = loadSchedule({ elementary_capacity:5, kinder_capacity:5 }, [
    { session_date:'2026-09-18', is_holiday:true, name:'휴원' }
  ]);
  const result = await schedule.findAvailableSlots({ date:'2026-09-18' });
  assert.equal(result.closedDay, true);
  assert.equal(result.slots.length, 0);
  assert.match(schedule.describeAvailableSlots(result), /정상 수업이 없어요/);
});


test('availability response uses the requested date label instead of always saying today', async () => {
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { division:'elementary', weekday:1, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[],
    class_teachers:[]
  };
  const schedule = loadSchedule(week);
  const result = await schedule.findAvailableSlots({
    date:'2026-09-21',
    dateLabel:'다음주월요일',
    division:'elementary',
    purpose:'makeup'
  });
  const message = schedule.describeAvailableSlots(result);
  assert.match(message, /^다음주월요일 보강 가능한 클래스예요\./);
  assert.doesNotMatch(message, /^오늘/);
});
