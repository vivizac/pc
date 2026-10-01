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
        async saveCellMemo(division, sessionDate, timeSlot, note, classGroup, memoId) {
          calls.saveCellMemo = {division,sessionDate,timeSlot,note,classGroup,memoId};
          return {ok:true};
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

test('common memo parser keeps the 30-minute component', () => {
  const sandbox = {window:{},console,Date};
  vm.runInNewContext(routerSource, sandbox);
  const parsed = sandbox.window.OlliCommandRouter.parseTimetableMemoAddMutationIntent(
    '초등부 10/2일 4시 30분 메모에 준비물 주문 등록해줘'
  );
  assert.equal(parsed.timeSlot, 4);
  assert.equal(parsed.timeMinute, 30);
  assert.equal(parsed.memoNote, '준비물 주문');
});

test('half-hour student memo resolves 4:30 to stored slot 10 and A group', async () => {
  const student = {id:'student-1',name:'김태리',division:'elementary'};
  const week = {
    timetable_mode:'half_hour',
    enrollments:[{
      student_id:'student-1',
      division:'elementary',
      weekday:3,
      time_slot:10,
      class_group:'B',
      effective_from:'2026-01-01',
      effective_to:null,
    }],
    one_time_sessions:[],
    class_split_periods:[],
    kinder_class_merges:[],
    cell_memos:[],
  };
  const {schedule,calls} = loadSchedule(week,[student]);
  const prepared = await schedule.prepareWriteCommand('add_timetable_memo',{
    studentName:'김태리',
    date:new Date(2026,8,30,12,0,0),
    timeSlot:4,
    timeMinute:30,
    memoNote:'준비물 확인',
  });

  assert.equal(prepared.ok,true);
  assert.equal(prepared.command.timeSlot,10);
  assert.equal(prepared.command.classGroup,'A');
  assert.equal(prepared.command.timetableMode,'half_hour');
  assert.match(prepared.message,/4시 30분/);

  await schedule.executePreparedWrite(prepared.command);
  assert.equal(calls.saveCellMemo.timeSlot,10);
  assert.equal(calls.saveCellMemo.classGroup,'A');
});

test('half-hour cell memo accepts 4:30 and rejects unsupported 6:30', async () => {
  const week = {
    timetable_mode:'half_hour',
    enrollments:[],
    one_time_sessions:[],
    class_split_periods:[],
    kinder_class_merges:[],
    cell_memos:[],
  };
  const {schedule} = loadSchedule(week,[]);
  const prepared = await schedule.prepareWriteCommand('add_timetable_memo',{
    division:'elementary',
    date:new Date(2026,8,30,12,0,0),
    timeSlot:4,
    timeMinute:30,
    memoNote:'준비물 확인',
  });
  assert.equal(prepared.ok,true);
  assert.equal(prepared.command.timeSlot,10);
  assert.equal(prepared.command.classGroup,'A');
  assert.match(prepared.message,/4시 30분/);

  const rejected = await schedule.prepareWriteCommand('add_timetable_memo',{
    division:'elementary',
    date:new Date(2026,8,30,12,0,0),
    timeSlot:6,
    timeMinute:30,
    memoNote:'잘못된 시간',
  });
  assert.equal(rejected.ok,false);
  assert.match(rejected.message,/사용할 수 있는 시간/);
});
