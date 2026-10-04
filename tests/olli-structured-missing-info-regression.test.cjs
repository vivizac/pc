'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const router=require('../packages/common/olli-command-router-common.js');
const root=path.resolve(__dirname,'..');

function restoreSchedule(previous){
  globalThis.OlliCommandSchedule=previous;
}

test('guest trial flows date -> division -> time -> A/B -> final confirmation without early mutation', async()=>{
  const previous=globalThis.OlliCommandSchedule;
  let prepareWriteCalls=0;

  globalThis.OlliCommandSchedule={
    async resolveStructuredStudentReference(options){
      return {
        ok:true,
        matched:false,
        guest:true,
        student:null,
        studentName:options.studentName,
        division:String(options.division || '')
      };
    },
    async prepareStructuredTimeChoices(options){
      if(!options.division){
        return {
          ok:false,
          code:'division_required',
          field:'division',
          choices:['kinder','elementary'],
          message:options.studentName+' 학생은 유치부인지 초등부인지 선택해 주세요.'
        };
      }
      return {
        ok:true,
        division:options.division,
        date:'2026-10-09',
        dateLabel:'10월 9일',
        timetableMode:'hourly',
        choices:[
          {timeSlot:5,label:'5시',status:'available',selectable:true,remaining:2,grouped:true}
        ],
        message:options.studentName+' · 10월 9일\n시간을 선택해 주세요.'
      };
    },
    async prepareWriteCommand(intent,options){
      prepareWriteCalls+=1;
      assert.equal(intent,'add_trial');
      assert.equal(options.studentName,'서준');
      assert.equal(options.division,'elementary');
      assert.equal(options.timeSlot,5);
      if(!options.classGroup){
        return {
          ok:false,
          code:'class_group_required',
          choices:['A','B'],
          commandDraft:{
            intent:'choose_trial_group',
            targetIntent:'add_trial',
            guestName:'서준',
            studentName:'서준',
            division:'elementary',
            sessionDate:'2026-10-09',
            timeSlot:5,
            classGroup:'',
            allowedClassGroups:['A','B']
          },
          message:'서준 · 10월 9일 5시\n반을 선택해 주세요.'
        };
      }
      return {
        ok:true,
        command:{
          intent:'add_trial',
          guestName:'서준',
          studentName:'서준',
          division:'elementary',
          sessionDate:'2026-10-09',
          timeSlot:5,
          classGroup:options.classGroup
        },
        message:'서준 · 10월 9일 5시 '+options.classGroup+'반\n체험수업으로 등록할까요?'
      };
    },
    writeConfirmationMessage(command){
      return command.studentName+' · 10월 9일 5시 '+command.classGroup+'반\n체험수업으로 등록할까요?';
    }
  };

  try{
    let result=await router.prepareStructuredAction({
      action:'add_trial',
      studentName:'서준',
      dateExpression:'',
      timeSlot:0,
      classGroup:''
    },{});
    assert.equal(result.kind,'action_needs_field');
    assert.equal(result.payload.field,'date');
    assert.equal(prepareWriteCalls,0);

    let draft=router.updateStructuredWriteDraft(result.payload.draft,'date','10월 9일');
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.kind,'action_needs_field');
    assert.equal(result.payload.field,'division');
    assert.deepEqual(result.payload.missingFields,['division','time']);
    assert.equal(prepareWriteCalls,0);

    draft=router.updateStructuredWriteDraft(result.payload.draft,'division','elementary');
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.kind,'action_needs_field');
    assert.equal(result.payload.field,'time');
    assert.equal(result.payload.choices[0].timeSlot,5);
    assert.equal(result.payload.choices[0].selectable,true);
    assert.equal(prepareWriteCalls,0);

    draft=router.updateStructuredWriteDraft(result.payload.draft,'time',5);
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.kind,'action_choice');
    assert.equal(result.intent,'choose_trial_group');
    assert.deepEqual(result.action.choices,['A','B']);
    assert.equal(prepareWriteCalls,1);

    draft=router.updateStructuredWriteDraft(draft,'class_group','B');
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.kind,'action_pending');
    assert.equal(result.intent,'add_trial');
    assert.equal(result.payload.classGroup,'B');
    assert.match(result.message,/등록할까요/);
    assert.equal(prepareWriteCalls,2);
  }finally{
    restoreSchedule(previous);
  }
});

test('enrolled decorated-name makeup skips division choice and keeps canonical stored name through confirmation', async()=>{
  const previous=globalThis.OlliCommandSchedule;
  let prepareWriteCalls=0;

  globalThis.OlliCommandSchedule={
    async resolveStructuredStudentReference(options){
      assert.ok(['김채원','토)김채원'].includes(options.studentName));
      return {
        ok:true,
        matched:true,
        student:{id:'student-1',name:'토)김채원',division:'elementary'},
        studentName:'토)김채원',
        division:'elementary'
      };
    },
    async prepareStructuredTimeChoices(options){
      assert.equal(options.studentName,'토)김채원');
      assert.equal(options.division,'elementary');
      return {
        ok:true,
        division:'elementary',
        date:'2026-10-07',
        dateLabel:'10월 7일',
        timetableMode:'half_hour',
        choices:[
          {timeSlot:10,label:'4시 30분',status:'available',selectable:true,remaining:1,grouped:true}
        ],
        message:'토)김채원 · 10월 7일\n시간을 선택해 주세요.'
      };
    },
    async prepareWriteCommand(intent,options){
      prepareWriteCalls+=1;
      assert.equal(intent,'add_makeup');
      assert.equal(options.studentName,'토)김채원');
      assert.equal(options.division,'elementary');
      assert.equal(options.timeSlot,10);
      if(!options.classGroup){
        return {
          ok:false,
          code:'class_group_required',
          choices:['A','B'],
          commandDraft:{
            intent:'choose_makeup_group',
            targetIntent:'add_makeup',
            studentId:'student-1',
            studentName:'토)김채원',
            division:'elementary',
            sessionDate:'2026-10-07',
            timeSlot:10,
            classGroup:'',
            allowedClassGroups:['A','B']
          },
          message:'토)김채원 · 10월 7일 4시 30분\n반을 선택해 주세요.'
        };
      }
      return {
        ok:true,
        command:{
          intent:'add_makeup',
          studentId:'student-1',
          studentName:'토)김채원',
          division:'elementary',
          sessionDate:'2026-10-07',
          timeSlot:10,
          classGroup:options.classGroup
        },
        message:'토)김채원 · 10월 7일 4시 30분 '+options.classGroup+'반\n보강으로 등록할까요?'
      };
    },
    writeConfirmationMessage(command){
      return command.studentName+' · 10월 7일 4시 30분 '+command.classGroup+'반\n보강으로 등록할까요?';
    }
  };

  try{
    let result=await router.prepareStructuredAction({
      action:'add_makeup',
      studentName:'김채원',
      dateExpression:'',
      timeSlot:0,
      classGroup:''
    },{});
    assert.equal(result.payload.field,'date');
    assert.equal(result.payload.draft.studentName,'토)김채원');
    assert.equal(result.payload.draft.division,'elementary');

    let draft=router.updateStructuredWriteDraft(result.payload.draft,'date','10월 7일');
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.payload.field,'time');
    assert.notEqual(result.payload.field,'division');
    assert.equal(result.payload.draft.studentName,'토)김채원');

    draft=router.updateStructuredWriteDraft(result.payload.draft,'time',10);
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.kind,'action_choice');
    assert.equal(result.intent,'choose_makeup_group');
    assert.equal(prepareWriteCalls,1);

    draft=router.updateStructuredWriteDraft(draft,'class_group','A');
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.kind,'action_pending');
    assert.equal(result.payload.studentName,'토)김채원');
    assert.equal(result.payload.classGroup,'A');
    assert.equal(prepareWriteCalls,2);
  }finally{
    restoreSchedule(previous);
  }
});

test('guest waitlist keeps a full operating time selectable and still requires final confirmation', async()=>{
  const previous=globalThis.OlliCommandSchedule;

  globalThis.OlliCommandSchedule={
    async resolveStructuredStudentReference(options){
      return {
        ok:true,
        matched:false,
        guest:true,
        student:null,
        studentName:options.studentName,
        division:String(options.division || '')
      };
    },
    async prepareStructuredTimeChoices(options){
      if(!options.division){
        return {
          ok:false,
          code:'division_required',
          field:'division',
          choices:['kinder','elementary'],
          message:'지우 학생은 유치부인지 초등부인지 선택해 주세요.'
        };
      }
      return {
        ok:true,
        division:options.division,
        date:'2026-10-08',
        dateLabel:'10월 8일',
        timetableMode:'hourly',
        choices:[
          {timeSlot:4,label:'4시',status:'full',selectable:true,remaining:0,grouped:true}
        ],
        message:'지우 · 10월 8일\n시간을 선택해 주세요.'
      };
    },
    async prepareWriteCommand(intent,options){
      assert.equal(intent,'add_waitlist');
      if(!options.classGroup){
        return {
          ok:false,
          code:'class_group_required',
          choices:['A','B'],
          commandDraft:{
            intent:'choose_waitlist_group',
            targetIntent:'add_waitlist',
            studentId:'',
            studentName:'지우',
            guestName:'지우',
            isGuest:true,
            division:'kinder',
            sessionDate:'2026-10-08',
            timeSlot:4,
            classGroup:'',
            allowedClassGroups:['A','B']
          },
          message:'지우 (비재원) · 10월 8일 4시\n반을 선택해 주세요.'
        };
      }
      return {
        ok:true,
        command:{
          intent:'add_waitlist',
          studentId:'',
          studentName:'지우',
          guestName:'지우',
          isGuest:true,
          division:'kinder',
          sessionDate:'2026-10-08',
          timeSlot:4,
          classGroup:options.classGroup
        },
        message:'지우 (비재원) · 10월 8일 4시 '+options.classGroup+'반\n대기로 등록할까요?'
      };
    },
    writeConfirmationMessage(command){
      return command.studentName+' (비재원) · 10월 8일 4시 '+command.classGroup+'반\n대기로 등록할까요?';
    }
  };

  try{
    let result=await router.prepareStructuredAction({
      action:'add_waitlist',
      studentName:'지우',
      dateExpression:'10월 8일',
      timeSlot:0,
      classGroup:''
    },{});
    assert.equal(result.payload.field,'division');

    let draft=router.updateStructuredWriteDraft(result.payload.draft,'division','kinder');
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.payload.field,'time');
    assert.equal(result.payload.choices[0].status,'full');
    assert.equal(result.payload.choices[0].selectable,true);

    draft=router.updateStructuredWriteDraft(result.payload.draft,'time',4);
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.kind,'action_choice');
    assert.equal(result.intent,'choose_waitlist_group');

    draft=router.updateStructuredWriteDraft(draft,'class_group','B');
    result=await router.prepareStructuredAction(draft,{});
    assert.equal(result.kind,'action_pending');
    assert.equal(result.payload.intent,'add_waitlist');
    assert.equal(result.payload.classGroup,'B');
    assert.match(result.message,/대기로 등록할까요/);
  }finally{
    restoreSchedule(previous);
  }
});

test('all persisted missing-info choice stages remain draft-only and are wired on both PC and Mobile',()=>{
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const choiceTypes=[
    'choose_structured_student',
    'choose_structured_date',
    'choose_structured_division',
    'choose_structured_time'
  ];
  for(const source of [pc,mobile]){
    for(const type of choiceTypes) assert.match(source,new RegExp(type));
    assert.match(source,/continue(?:OlliTalk)?StructuredWriteDraft/);
  }

  const migrations=[
    '20261003141000_team_chat_structured_date_choice.sql',
    '20261004073600_team_chat_structured_time_choice.sql',
    '20261004081500_team_chat_structured_student_choice.sql',
    '20261004084500_team_chat_structured_division_choice.sql'
  ];
  for(const file of migrations){
    const source=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
    assert.doesNotMatch(source,/olli_schedule_execute\s*\(/);
    assert.doesNotMatch(source,/olli_schedule_add_guest_entry\s*\(/);
    assert.doesNotMatch(source,/olli_team_chat_action_execute\s*\(/);
  }
});
