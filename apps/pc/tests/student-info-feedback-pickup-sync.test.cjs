'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const repo=path.resolve(root,'..','..');
const card=fs.readFileSync(path.join(root,'pc-student-info-card-runtime.js'),'utf8');
const timetable=fs.readFileSync(path.join(root,'pc-timetable.js'),'utf8');
const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20261013163500_sync_feedback_teacher_and_student_pickup_context.sql'),'utf8');

test('student info retains dropoff when arrival is deleted',()=>{
 const a=card.indexOf('  function studentInfoPickupHtml(rows) {');
 const b=card.indexOf('  function syncPcSchoolUnit(',a);
 assert.ok(a>-1 && b>a);
 const render=new Function('NUM_DAY','clean','esc',card.slice(a,b)+'return studentInfoPickupHtml;')(
  {3:'수'},v=>String(v??'').trim(),v=>String(v??'')
 );
 const only=render([{weekday:3,class_time:5,pickup_label:'집앞',pickup_time:null,is_dropoff:true,dropoff_label:'집앞',dropoff_time:null,pickup_scope:'weekly'}]);
 assert.match(only,/수요일/);
 assert.match(only,/하원 · 집앞/);
 assert.doesNotMatch(only,/등원 ·/);
 const combined=render([{weekday:3,class_time:5,pickup_label:'유치원',pickup_time:'16:40',is_dropoff:false,dropoff_label:'집앞',dropoff_time:'18:30'}]);
 assert.match(combined,/등원 · 유치원 · 4:40/);
 assert.match(combined,/하원 · 집앞 · 6:30/);
});

test('timetable pickup card shows dropoff-only label',()=>{
 assert.match(timetable,/const onlyDropoff = item\.is_dropoff === true/);
 assert.match(timetable,/const pickupKind = onlyDropoff \? '하원 · ' : ''/);
 assert.match(timetable,/pickupTimeLabel\(item\.dropoff_time\)/);
});

test('student pickup RPC delivers full fields and current week precedence',()=>{
 for(const snippet of ["'is_dropoff', p.is_dropoff","'dropoff_label', p.dropoff_label","'dropoff_time', to_char(p.dropoff_time","'pickup_scope', p.pickup_scope","v_week_start + (p.weekday - 1)","d.pickup_scope='daily'"])assert.ok(migration.includes(snippet),snippet);
});

test('regular first session updates independently stored feedback teacher; no daily substitute trigger',()=>{
 assert.match(migration,/UPDATE public\.students s SET feedback_teacher=v_teacher/);
 assert.match(migration,/IF v_teacher IS NULL THEN RETURN/);
 assert.match(migration,/count\(\*\) FILTER \(WHERE session_order=1\)=1/);
 assert.match(migration,/CREATE TRIGGER olli_feedback_teacher_enrollment_trg/);
 assert.match(migration,/CREATE TRIGGER olli_feedback_teacher_class_trg/);
 assert.doesNotMatch(migration,/CREATE TRIGGER.*olli_schedule_teacher_overrides/);
 assert.match(card,/value="\$\{esc\(student\.feedback_teacher \|\| ''\)\}"/);
});
