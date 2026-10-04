'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const scheduleSource=fs.readFileSync(path.join(root,'packages/common/olli-command-schedule-common.js'),'utf8');
const routerSource=fs.readFileSync(path.join(root,'packages/common/olli-command-router-common.js'),'utf8');
const pcSource=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobileSource=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const migration=fs.readFileSync(
  path.join(root,'supabase/migrations/20261004121500_team_chat_structured_trial_update_choices.sql'),
  'utf8'
);

function loadSchedule(service){
  const context={
    console,Date,Math,Map,Set,Object,Array,String,Number,Boolean,RegExp,JSON,Promise,
    OlliTimetableService:service
  };
  context.window=context;
  vm.runInNewContext(scheduleSource,context,{filename:'olli-command-schedule-common.js'});
  return context.OlliCommandSchedule;
}

function trialRow(id,date,timeSlot,division='elementary',group='A'){
  return {
    id,
    student_id:null,
    student_name:'민서',
    division,
    is_guest:true,
    session_type:'trial',
    session_date:date,
    time_slot:timeSlot,
    class_group:group,
    status:'scheduled'
  };
}

test('common trial update SOT finds future guest trials and returns source choice buttons',async()=>{
  const service={
    loadAvailabilityHorizon:async()=>({
      timetable_mode:'half_hour',
      one_time_sessions:[
        trialRow('trial-1','2026-10-06',4,'kinder','A'),
        trialRow('trial-2','2026-10-08',5,'elementary','A')
      ]
    })
  };
  const schedule=loadSchedule(service);
  const result=await schedule.prepareWriteCommand('update_trial',{
    guestName:'민서',
    effectiveDate:new Date('2026-10-04T12:00:00Z')
  });

  assert.equal(result.ok,false);
  assert.equal(result.code,'target_choice_required');
  assert.equal(result.choiceKey,'oneTimeSessionId');
  assert.equal(result.choices.length,2);
  assert.equal(result.choices[0].id,'trial-1');
  assert.equal(result.choices[1].id,'trial-2');
  assert.match(result.choices[0].label,/유치부/);
  assert.match(result.choices[1].label,/초등부/);
  assert.match(result.message,/선택해 주세요/);
  assert.doesNotMatch(result.message,/다시 알려/);
});

test('common trial update SOT converts visible half-hour time and prepares existing update_trial confirmation',async()=>{
  const source=trialRow('trial-1','2026-10-06',4,'elementary','A');
  const service={
    loadAvailabilityHorizon:async()=>({
      timetable_mode:'half_hour',
      elementary_capacity:5,
      one_time_sessions:[source]
    }),
    loadWeek:async()=>({
      timetable_mode:'half_hour',
      elementary_capacity:5,
      one_time_sessions:[source],
      enrollments:[],
      attendance_overrides:[],
      class_teachers:[],
      calendar_days:[]
    })
  };
  const schedule=loadSchedule(service);
  const result=await schedule.prepareWriteCommand('update_trial',{
    guestName:'민서',
    oneTimeSessionId:'trial-1',
    targetDate:new Date('2026-10-08T12:00:00Z'),
    targetTimeSlot:4,
    targetMinute:30,
    effectiveDate:new Date('2026-10-04T12:00:00Z')
  });

  assert.equal(result.ok,true);
  assert.equal(result.command.intent,'update_trial');
  assert.equal(result.command.guestName,'민서');
  assert.equal(result.command.oneTimeSessionId,'trial-1');
  assert.equal(result.command.division,'elementary');
  assert.equal(result.command.targetSessionDate,'2026-10-08');
  assert.equal(result.command.targetTimeSlot,10);
  assert.equal(result.command.targetClassGroup,'A');
  assert.equal(result.command.isGuest,true);
  assert.match(result.message,/4시 30분/);
  assert.match(result.message,/이렇게 변경할까요/);
});

test('common trial update local fallback delegates to existing updateOneTimeSession SOT',async()=>{
  let observed=null;
  const service={
    updateOneTimeSession:async(id,options)=>{
      observed={id,options};
      return {ok:true};
    }
  };
  const schedule=loadSchedule(service);
  await schedule.executePreparedWrite({
    intent:'update_trial',
    guestName:'민서',
    studentName:'민서',
    division:'elementary',
    oneTimeSessionId:'trial-1',
    targetSessionDate:'2026-10-08',
    targetTimeSlot:10,
    targetClassGroup:'A'
  });

  assert.equal(observed.id,'trial-1');
  assert.equal(observed.options.sessionDate,'2026-10-08');
  assert.equal(observed.options.timeSlot,10);
  assert.equal(observed.options.classGroup,'A');
});

test('PC and Mobile route structured update_trial through common router and retain legacy fallback helper',()=>{
  assert.match(routerSource,/supported = new Set\([^\n]*'update_trial'/);
  for(const source of [pcSource,mobileSource]){
    assert.match(source,/\[[^\]]*'update_trial'[^\]]*\]/);
    assert.doesNotMatch(
      source,
      /structuredCommand\?\.action[^\n]*update_trial[\s\S]{0,300}resolve(?:OlliTalk)?StructuredTrialUpdateTurn/
    );
  }
  assert.match(pcSource,/async function resolveStructuredTrialUpdateTurn/);
  assert.match(mobileSource,/async function resolveOlliTalkStructuredTrialUpdateTurn/);
});

test('trial update choice migration persists only draft fields for source, target date, target time and group',()=>{
  assert.match(migration,/'update_trial'/);
  assert.match(migration,/'oneTimeSessionId'/);
  assert.match(migration,/'targetClassGroup'/);
  assert.match(migration,/'target_date'/);
  assert.match(migration,/'target_time'/);
  assert.match(migration,/targetDateExpression/);
  assert.match(migration,/targetTimeSlot/);
  assert.match(migration,/targetTimeStored/);

  assert.doesNotMatch(migration,/public\.olli_schedule_update_one_time_session\s*\(/);
  assert.doesNotMatch(migration,/public\.olli_team_chat_action_execute\s*\(/);
  assert.doesNotMatch(migration,/update\s+public\.olli_schedule_one_time_sessions/i);
});
