'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ui=fs.readFileSync(path.join(__dirname,'../pc-timetable.js'),'utf8');
const helper=ui.slice(ui.indexOf('  function scheduledMoveRows('),ui.indexOf('  function movedSourceEnrollments('));
const drag=ui.slice(ui.indexOf('  async function saveDraggedTimetableMove('),ui.indexOf('  function onTimetableDrop('));
function fixture(groups=['B','A','B']){
 const enrollments=groups.map((group,i)=>({id:'e'+i,student_id:'s',division:'kinder',weekday:3,time_slot:5,class_group:group}));
 const rows=enrollments.slice(1).map((e,i)=>({id:'c'+i,student_id:'s',status:'applied',change_type:'move',source_enrollment_id:'e'+i,target_enrollment_id:e.id,effective_date:i===0?'2026-11-23':'2026-11-24'}));
 const data={move_source_enrollments:enrollments.slice(0,-1),enrollments:enrollments.slice(-1)};
 const calls=[];
 const ctx=vm.createContext({temporaryMoveForReturn:()=>null,state:{data},changes:()=>rows,clean:v=>String(v??'').trim(),todayKey:()=> '2026-11-24',
 parseDate:v=>new Date(v+'T12:00:00'),isMoveTransitionWeek:(a,b)=>[a,b].every(d=>String(d).slice(0,7)==='2026-11'),
 capacityWeekData:()=>data,isHalfHourMode:()=>false,classGroupOf:r=>r.class_group||'A',isClassSplit:()=>true,
 timeSlotMatches:(_d,_date,a,b)=>+a===+b,currentSyncAcademyId:()=> 'academy',shortDate:v=>v,scheduleSlotLabel:(_d,t)=>String(t),
 openOverlay:()=>calls.push('popup'),notify:()=>{},withSaving:async f=>f(),refreshStudentsFromServer:async()=>{},
 service:{changeSchedule:async p=>{calls.push(p);return {result:'cancelled'};}}});
 vm.runInContext(helper+drag+'\nthis.api={netRegularMoveFor,appliedMoveForReturn,saveDraggedTimetableMove};',ctx);
 return {api:ctx.api,rows,enrollments,data,calls};
}
const day='2026-11-25';
test('B to A to B has no moved source or blue target, even for existing historical records',()=>{
 const f=fixture(['B','A','B','A','B']);
 for(const e of f.enrollments) {
   assert.equal(f.api.netRegularMoveFor(e.id,day,'source'),null);
   assert.equal(f.api.netRegularMoveFor(e.id,day,'target'),null);
 }
});
test('B to A to different time keeps one original ghost linked to actual final card',()=>{
 const f=fixture();
 f.enrollments[2].time_slot=4;
 assert.equal(f.api.netRegularMoveFor('e0',day,'source').target_enrollment_id,'e2');
 assert.equal(f.api.netRegularMoveFor('e1',day,'source'),null);
 assert.equal(f.api.netRegularMoveFor('e1',day,'target'),null);
 assert.equal(f.api.netRegularMoveFor('e2',day,'target').source_enrollment_id,'e0');
});
test('applied same-week return uses the established mutation directly with no popup',async()=>{
 const f=fixture(['B','A']);
 const source={kind:'regular',id:'e1',row:f.enrollments[1],academyId:'academy',division:'kinder',weekday:3,time:5,classGroup:'A',date:day,name:'student'};
 const target={division:'kinder',weekday:3,time:5,classGroup:'B',date:day};
 assert.equal(f.api.appliedMoveForReturn(source,target).id,'c0');
 await f.api.saveDraggedTimetableMove(source,target);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].sourceEnrollmentId,'e1');
 assert.equal(f.calls[0].targetClassGroup,'B');
 assert.equal(f.calls[0].changeType,'move');
});
test('return detection never crosses students, separate enrollment lineages, or weeks',()=>{
 const f=fixture(['B','A']);
 const src={kind:'regular',id:'e1',row:f.enrollments[1],date:day};
 const dst={division:'kinder',weekday:3,time:5,classGroup:'B',date:day};
 assert.equal(f.api.appliedMoveForReturn({...src,row:{student_id:'different'}},dst),null);
 assert.equal(f.api.appliedMoveForReturn({...src,id:'other'},dst),null);
 assert.equal(f.api.appliedMoveForReturn(src,{...dst,date:'2026-12-02'}),null);
 assert.equal(f.api.appliedMoveForReturn(src,{...dst,time:4}),null);
});
