'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ui = fs.readFileSync(path.join(__dirname, '../pc-timetable.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../pc-timetable.css'), 'utf8');
const segment = (start, end) => ui.slice(ui.indexOf('  function ' + start), ui.indexOf('  function ' + end));
const helper = segment('scheduledMoveRows(', 'movedSourceEnrollments(');
const drag = ui.slice(ui.indexOf('  async function saveDraggedTimetableMove('), ui.indexOf('  function onTimetableDrop('));
const cancel = ui.slice(ui.indexOf('  async function cancelScheduledChange('), ui.indexOf('  async function removeSelectedEnrollment('));

function fixture() {
  const original = { id:'old', student_id:'s1', division:'kinder', weekday:1, time_slot:4, class_group:'B' };
  const moved = { id:'new', student_id:'s1', division:'kinder', weekday:4, time_slot:5, class_group:'A' };
  const reservation = {id:'c1', student_id:'s1', student_name:'학생', source_enrollment_id:'old', target_enrollment_id:'new', change_type:'move', status:'scheduled', effective_date:'2026-12-03'};
  const rows = [reservation];
  const weekData = {enrollments:[moved], move_source_enrollments:[original]};
  const source = {kind:'regular', id:'new', row:moved, date:'2026-12-03', academyId:'a', division:'kinder', weekday:4, time:5, classGroup:'A', name:'학생'};
  const target = {division:'kinder', date:'2026-11-30', weekday:1, time:4, classGroup:'B'};
  const calls = [];
  let halfHour = false;
  let split = true;
  const parseDate = value => new Date(value + 'T00:00:00Z');
  const mondayOf = value => { const d = parseDate(value); d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7); return d.toISOString().slice(0,10); };
  const ctx = vm.createContext({
    state:{data:weekData}, changes:()=>rows, clean:v=>String(v??'').trim(), todayKey:()=> '2026-11-24',
    parseDate, capacityWeekData:()=>weekData, isMoveTransitionWeek:(a,b)=>mondayOf(a)===mondayOf(b),
    timeSlotMatches:(_d,_date,a,b)=>Number(a)===Number(b),
    isHalfHourMode:()=>halfHour, isClassSplit:()=>split, classGroupOf:r=>r.class_group==='B'?'B':'A',
    currentSyncAcademyId:()=> 'a', notify:()=>{}, withSaving:async fn=>fn(),
    service:{cancelChange:async id=>{calls.push(['cancel',id]);return {result:'cancelled'};},changeSchedule:async()=>{calls.push(['new-move']);}},
    global:{confirm:()=>{calls.push(['confirm']);return false;}}
  });
  vm.runInContext(helper + drag + cancel + '\nthis.api = {scheduledMoveForReturn, saveDraggedTimetableMove, cancelScheduledChange, moveReservationEnrollment};',ctx);
  return {api:ctx.api,source,target,rows,reservation,calls,weekData,setHalfHour:v=>{halfHour=v;},setSplit:v=>{split=v;}};
}

test('a future moved target dropped on its exact original slot cancels the existing reservation only', async ()=>{
  const f=fixture();
  assert.equal(f.api.scheduledMoveForReturn(f.source,f.target).id,'c1');
  await f.api.saveDraggedTimetableMove(f.source,f.target);
  assert.deepEqual(f.calls,[['cancel','c1']]);
});

test('do not cancel for the other class, time, week, student, or one-time card', ()=>{
  const f=fixture();
  for(const change of [{classGroup:'A'},{time:5},{date:'2026-12-07'}]){
    assert.equal(f.api.scheduledMoveForReturn(f.source,{...f.target,...change}),null);
  }
  assert.equal(f.api.scheduledMoveForReturn({...f.source,row:{...f.source.row,student_id:'s2'}},f.target),null);
  assert.equal(f.api.scheduledMoveForReturn({...f.source,kind:'makeup'},f.target),null);
  f.setSplit(false);
  assert.equal(f.api.scheduledMoveForReturn(f.source,{...f.target,classGroup:'A'}).id,'c1');
});

test('an already applied or due reservation is not auto-cancelled', ()=>{
  const f=fixture();
  f.reservation.status='applied';
  assert.equal(f.api.scheduledMoveForReturn(f.source,f.target),null);
  f.reservation.status='scheduled';f.reservation.effective_date='2026-11-24';
  assert.equal(f.api.scheduledMoveForReturn(f.source,f.target),null);
});

test('button uses the same server cancellation and a linked later reservation is protected', async ()=>{
  const f=fixture();
  await f.api.cancelScheduledChange('c1');
  assert.deepEqual(f.calls,[['cancel','c1']]);
  f.rows.push({...f.reservation,id:'c2',source_enrollment_id:'new',target_enrollment_id:'later',effective_date:'2026-12-10'});
  await assert.rejects(f.api.cancelScheduledChange('c1'),/연결된 다른 이동 예약/);
  assert.equal(f.calls.length,1);
});

test('original enrollment is looked up using the reservation week metadata and not another weekly enrollment', ()=>{
  const f=fixture();
  f.weekData.enrollments.push({...f.source.row,id:'other',weekday:2});
  assert.equal(f.api.moveReservationEnrollment(f.reservation,'source').id,'old');
  assert.equal(f.api.moveReservationEnrollment(f.reservation,'target').id,'new');
  f.weekData.move_source_enrollments=[];
  assert.equal(f.api.scheduledMoveForReturn(f.source,f.target),null);
});

test('before/after slots and independent cancel button share one grid row', ()=>{
  assert.match(ui,/class="olliTtMoveReservationRow"[\s\S]*?이동 전[\s\S]*?이동 후[\s\S]*?data-tt-cancel-change="[\s\S]*?이동 예약 취소/);
  assert.match(css,/\.olliTtMoveReservationRow \{ display:grid; grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\) auto;/);
  assert.match(ui,/button\.dataset\.ttCancelChange/);
});
