'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ui = fs.readFileSync(path.join(__dirname,'../pc-timetable.js'),'utf8');
const service = fs.readFileSync(path.join(__dirname,'../pc-timetable-service.js'),'utf8');
const css = fs.readFileSync(path.join(__dirname,'../pc-timetable.css'),'utf8');
const migration = fs.readFileSync(path.join(__dirname,'../../../supabase/migrations/20261124065715_pc_timetable_temporary_move.sql'),'utf8');
const slice = (a,b) => ui.slice(ui.indexOf(a),ui.indexOf(b));
const drag = slice('  async function saveDraggedTimetableMove(', '  function onTimetableDrop(');
const temporary = slice('  function isTemporaryMoveSession(', '  function cellContentsHtml(');
const popup = slice('  function dragMoveChoiceHtml(', '  function renderDialog(');

function fixture() {
  const calls = [];
  const state = {saving:false,dialog:null};
  const ctx = vm.createContext({
    state, clean:v=>String(v??'').trim(), scheduledMoveForReturn:()=>null,
    currentSyncAcademyId:()=> 'academy', todayKey:()=> '2026-11-24',
    dateKey:v=>v, mondayOf:()=> '2026-11-23',
    isMoveTransitionWeek:(a,b)=>a.slice(0,7)===b.slice(0,7),
    shortDate:v=>v, scheduleSlotLabel:(_d,t)=>t+'시', isClassSplit:()=>true,
    withSaving:async fn=>fn(), refreshStudentsFromServer:async()=>{calls.push(['refresh']);},
    notify:()=>{}, openOverlay:()=>{calls.push(['popup']);},
    dialogHead:(_icon,title,sub)=>title+sub,
    service:{
      temporaryMove:async p=>{calls.push(['temporary',p]);return {result:'scheduled'};},
      changeSchedule:async p=>{calls.push(['permanent',p]);return {result:'applied'};},
      updateOneTimeSession:async(id,p)=>{calls.push(['one-time',id,p]);return {result:'updated'};}
    },
    global:{confirm:()=>{calls.push(['confirm']);return true;}}
  });
  vm.runInContext(drag+temporary+popup+'\nthis.api={saveDraggedTimetableMove,isTemporaryMoveSession,dragMoveChoiceHtml};',ctx);
  const source = {kind:'regular',id:'enrollment',date:'2026-11-25',weekday:3,time:4,classGroup:'B',academyId:'academy',division:'kinder',name:'학생',row:{student_id:'student'}};
  const target = {date:'2026-11-24',weekday:2,time:4,classGroup:'A',division:'kinder'};
  return {api:ctx.api,state,calls,source,target};
}

test('dragging a regular card opens the two-mode popup without writing anything',async()=>{
  const f=fixture();
  await f.api.saveDraggedTimetableMove(f.source,f.target);
  assert.deepEqual(f.calls,[['popup']]);
  assert.equal(f.state.dialog.kind,'dragMoveChoice');
  const html=f.api.dragMoveChoiceHtml(f.state.dialog);
  assert.match(html,/한 주만 이동/);
  assert.match(html,/완전 이동/);
  assert.match(html,/data-tt-dialog-close/);
});

test('temporary selection uses one atomic mutation, passing the exact original session date and A/B class',async()=>{
  const f=fixture();
  await f.api.saveDraggedTimetableMove(f.source,f.target,'temporary');
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0][0],'temporary');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][1])),{
    studentId:'student',sourceEnrollmentId:'enrollment',sourceDate:'2026-11-25',
    sourceTime:4,sourceGroup:'B',targetDate:'2026-11-24',targetTime:4,targetGroup:'A'
  });
});

test('permanent selection preserves the established schedule-change path',async()=>{
  const f=fixture();
  await f.api.saveDraggedTimetableMove(f.source,f.target,'permanent');
  assert.equal(f.calls[0][0],'permanent');
  assert.equal(f.calls[0][1].sourceEnrollmentId,'enrollment');
  assert.equal(f.calls[0][1].changeType,'move');
  assert.equal(f.calls[1][0],'refresh');
});

test('nonregular drag still uses its own confirmation and RPC',async()=>{
  const f=fixture();
  await f.api.saveDraggedTimetableMove({...f.source,kind:'makeup'},f.target);
  assert.equal(f.calls[0][0],'confirm');
  assert.equal(f.calls[1][0],'one-time');
});

test('historical and different-week temporary destinations are rejected before a write',async()=>{
  const f=fixture();
  await assert.rejects(f.api.saveDraggedTimetableMove(f.source,{...f.target,date:'2026-11-23'},'temporary'),/같은 주/);
  await assert.rejects(f.api.saveDraggedTimetableMove(f.source,{...f.target,date:'2026-12-01'},'temporary'),/같은 주/);
  assert.equal(f.calls.length,0);
});

test('only the reserved persisted marker changes the makeup card label, while attendance kind remains makeup',()=>{
  const f=fixture();
  const note='일시변경 [olli:temporary-move-v1:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:2026-11-25]';
  assert.equal(f.api.isTemporaryMoveSession({session_type:'makeup',note}),true);
  assert.equal(f.api.isTemporaryMoveSession({session_type:'makeup',note:'일시변경'}),false);
  assert.equal(f.api.isTemporaryMoveSession({session_type:'trial',note}),false);
  assert.match(ui,/temporary \? '일시변경' : '보강'/);
  assert.match(ui,/data-tt-attendance="makeup"/);
  assert.match(ui,/attendanceStatus === 'absent'/);
  assert.match(css,/\.olliTtStudent\.regular\.absenceUpcoming/);
});

test('service invalidates affected attendance months only after server success',()=>{
  const body=service.slice(service.indexOf('  async function temporaryMove('),service.indexOf('  async function addWaitlist('));
  assert.match(body,/await rpc\('olli_schedule_temporary_move_v1'/);
  assert.match(body,/invalidateAttendanceMonth\(options.sourceDate\)/);
  assert.match(body,/invalidateAttendanceMonth\(options.targetDate\)/);
});

test('SQL uses established absence and makeup mutations without rewriting regular enrollments',()=>{
  assert.match(migration,/olli_schedule_set_attendance_session_status_v2\(/);
  assert.match(migration,/olli_schedule_execute\(p_session_token,p_academy_id,'add_one_time'/);
  assert.match(migration,/raise exception using message=coalesce\(v_makeup/);
  assert.match(migration,/raise exception '해당 시간에 이미 보강 또는 체험수업/);
  assert.doesNotMatch(migration,/\b(update|insert into|delete from)\s+public\.olli_schedule_enrollments/i);
});
