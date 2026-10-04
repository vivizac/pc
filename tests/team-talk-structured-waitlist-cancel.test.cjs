'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const router=fs.readFileSync(path.join(root,'packages/common/olli-command-router-common.js'),'utf8');
const scheduleSource=fs.readFileSync(path.join(root,'packages/common/olli-command-schedule-common.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261004101500_team_chat_structured_student_choice_cancel_waitlist.sql'),'utf8');

function loadSchedule(data){
  const context={
    console,Date,Math,Map,Set,Object,Array,String,Number,Boolean,RegExp,JSON,Promise,
    OlliTimetableService:{loadWeek:async()=>data}
  };
  context.window=context;
  vm.runInNewContext(scheduleSource,context,{filename:'olli-command-schedule-common.js'});
  return context.OlliCommandSchedule;
}

test('structured waitlist cancellation is routed through common router while legacy Agent fallback remains',()=>{
  assert.match(router,/supported = new Set\([^\n]*'cancel_waitlist'/);
  for(const source of [pc,mobile]){
    assert.match(source,/\[[^\]]*'cancel_waitlist'[^\]]*\]/);
    assert.doesNotMatch(source,/structuredCommand\?\.action\)==='cancel_waitlist'[\s\S]{0,260}structured_waitlist_cancel_prepare/);
  }
  assert.match(pc,/async function resolveWaitlistCancelAgentTurn/);
  assert.match(pc,/structured_waitlist_cancel_prepare/);
  assert.match(mobile,/async function resolveOlliTalkWaitlistCancelAgentTurn/);
  assert.match(mobile,/structured_waitlist_cancel_prepare/);
});

test('common waitlist cancellation maps visible 4:30 to the half-hour stored slot',async()=>{
  const schedule=loadSchedule({
    settings:{timetable_mode:'half_hour'},
    waitlist:[{
      id:'wait-1',
      student_id:'student-1',
      student_name:'민서',
      division:'elementary',
      target_weekday:2,
      target_time_slot:10,
      target_class_group:'A',
      status:'waiting',
      is_guest:false
    }]
  });

  const result=await schedule.prepareWriteCommand('cancel_waitlist',{
    studentName:'민서',
    date:new Date('2026-10-06T12:00:00Z'),
    classHour:4,
    classMinute:30,
    classGroup:'A',
    effectiveDate:new Date('2026-10-04T12:00:00Z')
  });

  assert.equal(result.ok,true);
  assert.equal(result.command.waitlistId,'wait-1');
  assert.equal(result.command.targetTimeSlot,10);
  assert.match(result.message,/4시 30분/);
});

test('student disambiguation persistence allows waitlist cancellation but never cancels data',()=>{
  assert.match(migration,/'cancel_waitlist'/);
  assert.doesNotMatch(migration,/olli_schedule_execute\s*\(/);
  assert.doesNotMatch(migration,/resolveWaitlist\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
});
