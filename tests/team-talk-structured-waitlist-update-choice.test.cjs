'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const {
  prepareWaitlistUpdateAction,
}=require(path.join(root,'apps/mobile/api/_lib/olli-agent/tools/waitlist-update-prepare-tools.cjs'));

const runtimeSource=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const apiSource=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
const pcSource=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobileSource=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const migration=fs.readFileSync(
  path.join(root,'supabase/migrations/20261004130000_team_chat_structured_waitlist_update_choices.sql'),
  'utf8'
);

function waitRow(id,weekday,timeSlot,group='A'){
  return {
    id,
    is_guest:true,
    guest_name:'민서',
    student_name:'민서',
    target_division:'elementary',
    target_weekday:weekday,
    target_time_slot:timeSlot,
    target_class_group:group,
    desired_effective_date:'2026-10-05',
    status:'waiting'
  };
}

function options(callRpc,extra={}){
  return Object.assign({
    requestContext:{sessionToken:'session',academyId:'academy',memberId:'member'},
    subjectAccess:{resolve(){return null;}},
    guestAccess:{resolve(label){
      return label==='학생A' ? {guestName:'민서',division:'elementary'} : null;
    }},
    studentLabel:'학생A',
    division:'elementary',
    currentDate:'2026-10-04',
    requestId:'waitlist-update-choice-test',
    sanitizePayload(payload){return payload;},
    callRpc,
  },extra);
}

test('waitlist update source ambiguity returns finite existing-waitlist choices without mutation',async()=>{
  const calls=[];
  const result=await prepareWaitlistUpdateAction(options(async(name)=>{
    calls.push(name);
    if(name==='olli_schedule_week'){
      return {
        ok:true,
        timetable_mode:'hourly',
        waitlist:[
          waitRow('wait-1',2,4,'A'),
          waitRow('wait-2',3,5,'B')
        ]
      };
    }
    throw new Error('unexpected rpc '+name);
  },{
    allowChoice:true,
  }));

  assert.equal(result.ok,false);
  assert.equal(result.code,'target_choice_required');
  assert.equal(result.field,'target_choice');
  assert.equal(result.choiceKey,'waitlistId');
  assert.deepEqual(result.choices.map(item=>item.id),['wait-1','wait-2']);
  assert.match(result.choices[0].label,/화요일/);
  assert.match(result.choices[1].label,/수요일/);
  assert.match(result.message,/선택해 주세요/);
  assert.doesNotMatch(result.message,/다시 알려/);
  assert.equal(calls.includes('olli_team_chat_send_action'),false);
});

test('selected waitlist id is re-read inside the existing server SOT before final pending confirmation',async()=>{
  const calls=[];
  const result=await prepareWaitlistUpdateAction(options(async(name,args)=>{
    calls.push(name);
    if(name==='olli_schedule_week'){
      if(args.p_week_start==='2026-09-28'){
        return {
          ok:true,
          timetable_mode:'hourly',
          waitlist:[
            waitRow('wait-1',2,4,'A'),
            waitRow('wait-2',3,5,'B')
          ]
        };
      }
      return {ok:true,timetable_mode:'hourly',waitlist:[]};
    }
    if(name==='olli_schedule_availability_slots'){
      return {
        ok:true,
        timetable_mode:'hourly',
        capacity:5,
        slots:[{
          date:'2026-10-08',
          weekday:4,
          time_slot:5,
          class_group:'B',
          grouped:false,
          capacity:5,
          occupancy:1,
          remaining:4,
          available:true
        }],
        closed_dates:[]
      };
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'pending',
          action:{id:'action-1',action_type:'update_waitlist',status:'pending'}
        }
      };
    }
    throw new Error('unexpected rpc '+name);
  },{
    waitlistId:'wait-2',
    targetWeekday:4,
    allowChoice:true,
    replyToMessageId:77,
  }));

  assert.equal(result.ok,true);
  assert.equal(result.action_type,'update_waitlist');
  assert.equal(result.source_weekday,3);
  assert.equal(result.target_weekday,4);
  assert.equal(result.source_class_group,'B');
  assert.equal(result.target_class_group,'B');
  assert.ok(calls.includes('olli_schedule_availability_slots'));
  assert.ok(calls.includes('olli_team_chat_send_action'));
});

test('structured waitlist update bridge persists target choice and resumes with original source binding on PC and Mobile',()=>{
  assert.match(runtimeSource,/allowChoice:true/);
  assert.match(runtimeSource,/choiceRequired/);
  assert.match(apiSource,/choiceRequired:result\?\.choiceRequired \|\| null/);

  for(const source of [pcSource,mobileSource]){
    assert.match(source,/choiceRequired\?\.payload/);
    assert.match(source,/draft\?\.action[^\n]*update_waitlist/);
    assert.match(source,/source_message_id/);
    assert.match(source,/source_message_text/);
  }
});

test('waitlist update target-choice migration only persists draft selection and never mutates waitlist data',()=>{
  assert.match(migration,/'update_waitlist'/);
  assert.match(migration,/'waitlistId'/);
  assert.match(migration,/'targetClassGroup'/);
  assert.match(migration,/source_message_id/);
  assert.match(migration,/source_message_text/);

  assert.doesNotMatch(migration,/public\.olli_schedule_update_waitlist\s*\(/);
  assert.doesNotMatch(migration,/public\.olli_team_chat_action_execute\s*\(/);
  assert.doesNotMatch(migration,/update\s+public\.olli_schedule_waitlist/i);
});
