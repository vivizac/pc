'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const routerSource=fs.readFileSync(path.join(root,'packages/common/olli-command-router-common.js'),'utf8');
const scheduleSource=fs.readFileSync(path.join(root,'packages/common/olli-command-schedule-common.js'),'utf8');
const pcSource=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobileSource=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const migration=fs.readFileSync(
  path.join(root,'supabase/migrations/20261004113000_team_chat_structured_makeup_update_choices.sql'),
  'utf8'
);

function loadSchedule(service){
  const context={
    console,Date,Math,Map,Set,Object,Array,String,Number,Boolean,RegExp,JSON,Promise,
    OlliTimetableService:service,
    getAllStudents:()=>service.activeStudents()
  };
  context.window=context;
  vm.runInNewContext(scheduleSource,context,{filename:'olli-command-schedule-common.js'});
  return context.OlliCommandSchedule;
}

function sourceRow(id,date,timeSlot,group='A'){
  return {
    id,
    student_id:'student-1',
    student_name:'민서',
    division:'elementary',
    session_type:'makeup',
    session_date:date,
    time_slot:timeSlot,
    class_group:group,
    status:'scheduled'
  };
}

test('common makeup update SOT returns stable source choices instead of asking for typed source details',async()=>{
  const service={
    activeStudents:()=>[{id:'student-1',name:'민서',division:'elementary'}],
    loadAvailabilityHorizon:async()=>({
      timetable_mode:'half_hour',
      one_time_sessions:[
        sourceRow('makeup-1','2026-10-06',4,'A'),
        sourceRow('makeup-2','2026-10-08',5,'A')
      ]
    })
  };
  const schedule=loadSchedule(service);
  const result=await schedule.prepareWriteCommand('update_makeup',{
    studentName:'민서',
    effectiveDate:new Date('2026-10-04T12:00:00Z')
  });

  assert.equal(result.ok,false);
  assert.equal(result.code,'target_choice_required');
  assert.equal(result.choiceKey,'oneTimeSessionId');
  assert.deepEqual(
    Array.from(result.choices,item=>item.id),
    ['makeup-1','makeup-2']
  );
  assert.match(result.message,/선택해 주세요/);
  assert.doesNotMatch(result.message,/함께 적어 주세요/);
});

test('common makeup update SOT converts visible half-hour target time and builds confirmation payload',async()=>{
  const source=sourceRow('makeup-1','2026-10-06',4,'A');
  const service={
    activeStudents:()=>[{id:'student-1',name:'민서',division:'elementary'}],
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
      class_teachers:[
        {division:'elementary',weekday:4,time_slot:10,class_group:'A'}
      ],
      calendar_days:[]
    })
  };
  const schedule=loadSchedule(service);
  const result=await schedule.prepareWriteCommand('update_makeup',{
    studentName:'민서',
    oneTimeSessionId:'makeup-1',
    targetDate:new Date('2026-10-08T12:00:00Z'),
    targetTimeSlot:4,
    targetMinute:30,
    effectiveDate:new Date('2026-10-04T12:00:00Z')
  });

  assert.equal(result.ok,true);
  assert.equal(result.command.intent,'update_makeup');
  assert.equal(result.command.oneTimeSessionId,'makeup-1');
  assert.equal(result.command.sourceTimeSlot,4);
  assert.equal(result.command.targetSessionDate,'2026-10-08');
  assert.equal(result.command.targetTimeSlot,10);
  assert.equal(result.command.targetClassGroup,'A');
  assert.equal(result.command.timetableMode,'half_hour');
  assert.match(result.message,/4시 30분/);
  assert.match(result.message,/이렇게 변경할까요/);
});

test('common schedule local fallback delegates update_makeup to existing updateOneTimeSession SOT',async()=>{
  let observed=null;
  const service={
    activeStudents:()=>[{id:'student-1',name:'민서',division:'elementary'}],
    updateOneTimeSession:async(id,options)=>{
      observed={id,options};
      return {ok:true};
    }
  };
  const schedule=loadSchedule(service);
  await schedule.executePreparedWrite({
    intent:'update_makeup',
    studentId:'student-1',
    studentName:'민서',
    division:'elementary',
    oneTimeSessionId:'makeup-1',
    targetSessionDate:'2026-10-08',
    targetTimeSlot:10,
    targetClassGroup:'A'
  });
  assert.deepEqual(observed,{
    id:'makeup-1',
    options:{sessionDate:'2026-10-08',timeSlot:10,classGroup:'A'}
  });
});

test('PC and Mobile route structured update_makeup through common router while keeping legacy fallback helpers',()=>{
  assert.match(routerSource,/supported = new Set\([^\n]*'update_makeup'/);
  for(const source of [pcSource,mobileSource]){
    assert.match(source,/\[[^\]]*'update_makeup'[^\]]*\]/);
    assert.doesNotMatch(
      source,
      /structuredCommand\?\.action[^\n]*update_makeup[\s\S]{0,300}resolve(?:OlliTalk)?StructuredMakeupUpdateTurn/
    );
  }
  assert.match(pcSource,/async function resolveStructuredMakeupUpdateTurn/);
  assert.match(mobileSource,/async function resolveOlliTalkStructuredMakeupUpdateTurn/);
  assert.match(pcSource,/\['date','target_date'\]/);
  assert.match(pcSource,/\['time','target_time'\]/);
  assert.match(mobileSource,/\['date','target_date'\]/);
  assert.match(mobileSource,/\['time','target_time'\]/);
});

test('makeup update choice migration only persists draft selections and supports all choice stages',()=>{
  assert.match(migration,/'update_makeup'/);
  assert.match(migration,/'oneTimeSessionId'/);
  assert.match(migration,/'targetClassGroup'/);
  assert.match(migration,/'target_date'/);
  assert.match(migration,/'target_time'/);
  assert.match(migration,/'targetDateExpression'/);
  assert.match(migration,/'targetTimeSlot'/);
  assert.match(migration,/'targetTimeStored'/);

  assert.doesNotMatch(migration,/olli_schedule_update_one_time_session\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
  assert.doesNotMatch(migration,/update\s+public\.olli_schedule_one_time_sessions/i);
});
