const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scheduleSource = fs.readFileSync('packages/common/olli-command-schedule-common.js', 'utf8');
const routerSource = fs.readFileSync('packages/common/olli-command-router-common.js', 'utf8');

function loadSchedule(weekData, students = []) {
  const calls = {};
  const sandbox = {
    window:{
      OlliTimetableService:{
        activeStudents(){ return students; },
        async loadWeek(){ return JSON.parse(JSON.stringify(weekData)); },
        async loadCalendarRange(){ return []; },
        async savePickup(options) {
          calls.savePickup = JSON.parse(JSON.stringify(options));
          return {ok:true,result:'saved'};
        },
      },
      dispatchEvent(){},
    },
    CustomEvent:function CustomEvent(){},
    Date,
    console,
  };
  vm.runInNewContext(scheduleSource, sandbox);
  return {schedule:sandbox.window.OlliCommandSchedule,calls};
}

test('pickup parser keeps the 30-minute class component separate from pickup time', () => {
  const sandbox = {window:{},console,Date};
  vm.runInNewContext(routerSource, sandbox);
  const parsed = sandbox.window.OlliCommandRouter.parsePickupMutationIntent(
    '김민서 월요일 4시 30분 수업 리슈빌 3시 20분 픽업 등록해줘'
  );

  assert.equal(parsed.intent,'add_pickup');
  assert.equal(parsed.weekday,1);
  assert.equal(parsed.classTime,4);
  assert.equal(parsed.classMinute,30);
  assert.equal(parsed.pickupLabel,'리슈빌');
  assert.equal(parsed.pickupTime,'15:20');
});

test('half-hour pickup prepare maps 4:30 to stored kinder slot 8', async () => {
  const student = {id:'student-k1',name:'김민서',division:'kinder'};
  const week = {
    timetable_mode:'half_hour',
    pickups:[],
    enrollments:[],
    one_time_sessions:[],
    class_split_periods:[],
    kinder_class_merges:[],
  };
  const {schedule,calls} = loadSchedule(week,[student]);

  const prepared = await schedule.prepareWriteCommand('add_pickup',{
    studentName:'김민서',
    weekday:1,
    classTime:4,
    classMinute:30,
    pickupLabel:'리슈빌',
    pickupTime:'15:20',
    effectiveDate:new Date(2026,9,5,12,0,0),
  });

  assert.equal(prepared.ok,true);
  assert.equal(prepared.command.classTime,8);
  assert.equal(prepared.command.timetableMode,'half_hour');
  assert.match(prepared.message,/4시 30분 수업/);

  await schedule.executePreparedWrite(prepared.command);
  assert.equal(calls.savePickup.classTime,8);
});

test('half-hour stored slot input remains valid for server-side prepared callers', async () => {
  const student = {id:'student-k1',name:'김민서',division:'kinder'};
  const week = { timetable_mode:'half_hour', pickups:[], enrollments:[], one_time_sessions:[] };
  const {schedule} = loadSchedule(week,[student]);

  const prepared = await schedule.prepareWriteCommand('add_pickup',{
    studentName:'김민서',
    weekday:1,
    classTime:7,
    pickupLabel:'정문',
    pickupTime:'15:00',
    effectiveDate:new Date(2026,9,5,12,0,0),
  });

  assert.equal(prepared.ok,true);
  assert.equal(prepared.command.classTime,7);
  assert.match(prepared.message,/3시 30분 수업/);
});

test('hourly pickup rejects a 30-minute class request', async () => {
  const student = {id:'student-k1',name:'김민서',division:'kinder'};
  const week = { timetable_mode:'hourly', pickups:[], enrollments:[], one_time_sessions:[] };
  const {schedule} = loadSchedule(week,[student]);

  const prepared = await schedule.prepareWriteCommand('add_pickup',{
    studentName:'김민서',
    weekday:1,
    classTime:4,
    classMinute:30,
    pickupLabel:'리슈빌',
    pickupTime:'15:20',
    effectiveDate:new Date(2026,9,5,12,0,0),
  });

  assert.equal(prepared.ok,false);
  assert.match(prepared.message,/현재 시간표 모드/);
});

test('half-hour pickup update and cancel resolve 4:30 to the same stored slot', async () => {
  const student = {id:'student-k1',name:'김민서',division:'kinder'};
  const week = {
    timetable_mode:'half_hour',
    pickups:[{
      id:'pickup-1',
      student_id:'student-k1',
      weekday:1,
      class_time:8,
      pickup_label:'리슈빌',
      pickup_time:'15:20',
      effective_from:'2026-01-01',
      effective_to:null,
      is_dropoff:false,
      dropoff_label:'',
    }],
    enrollments:[],
    one_time_sessions:[],
  };
  const {schedule} = loadSchedule(week,[student]);

  const update = await schedule.prepareWriteCommand('update_pickup',{
    studentName:'김민서',
    weekday:1,
    classTime:4,
    classMinute:30,
    pickupKind:'arrival',
    pickupLabel:'센트럴',
    pickupTime:'15:10',
    effectiveDate:new Date(2026,9,5,12,0,0),
  });
  assert.equal(update.ok,true);
  assert.equal(update.command.classTime,8);
  assert.match(update.message,/4시 30분/);

  const cancel = await schedule.prepareWriteCommand('cancel_pickup',{
    studentName:'김민서',
    weekday:1,
    classTime:4,
    classMinute:30,
    pickupKind:'all',
    effectiveDate:new Date(2026,9,5,12,0,0),
  });
  assert.equal(cancel.ok,true);
  assert.equal(cancel.command.classTime,8);
  assert.match(cancel.message,/4시 30분/);
});
