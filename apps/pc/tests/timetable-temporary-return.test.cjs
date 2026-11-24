'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ui=fs.readFileSync(path.join(__dirname,'../pc-timetable.js'),'utf8');
const helpers=ui.slice(ui.indexOf('  function temporaryMoveOrigin('),ui.indexOf('  function cellContentsHtml('));
const drag=ui.slice(ui.indexOf('  async function saveDraggedTimetableMove('),ui.indexOf('  function onTimetableDrop('));
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function fixture(version='1',suffix='') {
 const original={id,student_id:'s',division:'kinder',weekday:3,time_slot:4,class_group:'B'};
 const item={id:'temp',student_id:'s',division:'kinder',session_type:'makeup',session_date:'2026-12-03',time_slot:5,class_group:'A',note:'일시변경 [olli:temporary-move-v'+version+':'+id+':2026-12-02'+suffix+']'};
 const source={kind:'makeup',id:'temp',row:item,academyId:'academy',division:'kinder',weekday:4,time:5,classGroup:'A',date:item.session_date,name:'student'};
 const target={division:'kinder',date:'2026-12-02',weekday:3,time:4,classGroup:'B'};
 const calls=[];
 const ctx=vm.createContext({state:{saving:false},clean:v=>String(v??'').trim(),todayKey:()=> '2026-11-24',
 parseDate:v=>new Date(v+'T12:00:00'),isMoveTransitionWeek:(a,b)=>[a,b].every(x=>x.startsWith('2026-12-0')),
 enrollments:()=>[original],oneTimeSessions:()=>[item],enrollmentActiveOn:()=>true,
 timeSlotMatches:(_d,_date,a,b)=>+a===+b,isHalfHourMode:()=>false,isClassSplit:()=>true,classGroupOf:r=>r.class_group||'A',
 scheduledMoveForReturn:()=>null,appliedMoveForReturn:()=>null,
 currentSyncAcademyId:()=> 'academy',withSaving:async f=>f(),notify:()=>{},
 shortDate:v=>v,scheduleSlotLabel:(_d,t)=>String(t),global:{confirm:()=>true},
 service:{cancelTemporaryMove:async p=>{calls.push(['cancel',p]);return {result:'cancelled'};},updateOneTimeSession:async(id,p)=>{calls.push(['move',id,p]);return {result:'updated'};}}});
 vm.runInContext(helpers+drag+'\nthis.api={temporaryMoveOrigin,temporaryMoveForReturn,isTemporaryMoveSession,saveDraggedTimetableMove};',ctx);
 return {api:ctx.api,source,target,item,original,calls};
}
test('legacy and new temporary cards return directly to the exact original dated slot',async()=>{
 for(const [version,suffix] of [['1',''],['2',':blank'],['2',':keep']]){
  const f=fixture(version,suffix);
  assert.equal(f.api.isTemporaryMoveSession(f.item),true);
  await f.api.saveDraggedTimetableMove(f.source,f.target);
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0][0],'cancel');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][1])),{sessionId:'temp',sourceDate:'2026-12-02',sourceTime:4,sourceGroup:'B',targetDate:'2026-12-03'});
 }
});
test('same student but wrong time, date, group, or enrollment is not cancelled',()=>{
 const f=fixture();
 for(const changes of [{time:5},{classGroup:'A'},{date:'2026-12-09'},{division:'elementary'}]){
  assert.equal(f.api.temporaryMoveForReturn(f.source,{...f.target,...changes}),null);
 }
 f.original.student_id='other';
 assert.equal(f.api.temporaryMoveForReturn(f.source,f.target),null);
});
test('ordinary makeup keeps its normal drag behavior',async()=>{
 const f=fixture();f.item.note='ordinary makeup';
 await f.api.saveDraggedTimetableMove(f.source,f.target);
 assert.equal(f.calls[0][0],'move');
});
test('temporary move to a different cell retains normal one-time relocation',async()=>{
 const f=fixture();
 await f.api.saveDraggedTimetableMove(f.source,{...f.target,time:6});
 assert.equal(f.calls[0][0],'move');
});
