'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {readScheduleAvailability}=require('./availability-tools.cjs');
const {parseDateKey}=require('./pickup-prepare-tools.cjs');
const {loadPrivateMakeupStudent}=require('./makeup-prepare-tools.cjs');
const {weekdayFromDateKey,visibleTime}=require('./waitlist-update-prepare-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}

function waitlistAddError(message,statusCode=400,code='OLLI_AGENT_WAITLIST_ADD_PREPARE_ERROR'){
  const error=new Error(message);
  error.statusCode=statusCode;
  error.code=code;
  return error;
}

function normalizeGroup(value){
  const group=clean(value).toUpperCase()||'AUTO';
  if(!['AUTO','A','B'].includes(group)){
    throw waitlistAddError('대기 반을 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_ADD_GROUP_INVALID');
  }
  return group;
}

function stableWaitlistAddActionClientMessageId({academyId,memberId,requestId}){
  const request=clean(requestId);
  if(!request||request.length>160){
    throw waitlistAddError('대기 등록 준비 요청 식별값이 없습니다.',400,'OLLI_AGENT_WAITLIST_ADD_REQUEST_ID_REQUIRED');
  }
  const hex=crypto.createHash('sha256')
    .update(['olli-agent-waitlist-add-v1',clean(academyId),clean(memberId),request,'add_waitlist'].join('|'))
    .digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}

function dateLabel(dateKey){
  const parsed=parseDateKey(dateKey);
  if(!parsed) return dateKey;
  const date=new Date(parsed.timestamp);
  return String(date.getUTCMonth()+1)+'월 '+String(date.getUTCDate())+'일';
}

function actionPrompt({studentName,sessionDate,timeText,classGroup,grouped}){
  const groupText=grouped?' '+classGroup+'반':'';
  return [
    clean(studentName)+' · '+dateLabel(sessionDate)+' '+clean(timeText)+groupText,
    '대기로 등록할까요?',
  ].join('\n');
}

async function prepareWaitlistAddAction({
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  sessionDate,
  classHour,
  classMinute,
  classGroup='AUTO',
  currentDate,
  requestId,
  replyToMessageId=null,
  capturePersistedMessage=null,
  sanitizePayload,
  callRpc=callSupabaseRpc,
}){
  if(typeof sanitizePayload!=='function'){
    throw waitlistAddError('Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_WAITLIST_ADD_PRIVACY_MISSING');
  }

  const label=clean(studentLabel);
  const subject=subjectAccess?.resolve?.(label);
  if(!subject?.studentId){
    throw waitlistAddError('현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',400,'OLLI_AGENT_SUBJECT_NOT_AVAILABLE');
  }

  const fixedDivision=clean(division).toLowerCase();
  if(!['elementary','kinder'].includes(fixedDivision)||clean(subject.division).toLowerCase()!==fixedDivision){
    throw waitlistAddError('대기 등록 학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_WAITLIST_ADD_DIVISION_MISMATCH');
  }

  const date=parseDateKey(sessionDate);
  const today=parseDateKey(currentDate);
  if(!date||!today){
    throw waitlistAddError('대기 등록 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_ADD_DATE_INVALID');
  }
  if(date.timestamp<today.timestamp){
    throw waitlistAddError('지난 날짜에는 대기를 등록할 수 없습니다.',400,'OLLI_AGENT_WAITLIST_ADD_DATE_PAST');
  }

  const weekday=weekdayFromDateKey(date.key);
  if(weekday<1||weekday>6){
    throw waitlistAddError('일요일에는 대기를 등록할 수 없습니다.',400,'OLLI_AGENT_WAITLIST_ADD_WEEKDAY_INVALID');
  }

  const timeText=visibleTime(classHour,classMinute,'대기 시간');
  if(!timeText){
    throw waitlistAddError('대기 시간을 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_ADD_TIME_REQUIRED');
  }
  const requestedGroup=normalizeGroup(classGroup);

  const student=await loadPrivateMakeupStudent({
    requestContext,
    studentId:subject.studentId,
    expectedDivision:fixedDivision,
    callRpc,
  });

  const availability=await readScheduleAvailability({
    requestContext,
    division:fixedDivision,
    purpose:'wait',
    startDate:date.key,
    endDate:date.key,
    timeSlot:0,
    classGroup:'ALL',
    sanitizePayload(payload){return payload;},
    callRpc,
  });

  if((availability.closed_dates||[]).some(row=>row.date===date.key)){
    throw waitlistAddError('휴원일에는 대기를 등록할 수 없습니다.',409,'OLLI_AGENT_WAITLIST_ADD_CLOSED_DAY');
  }

  let candidates=(Array.isArray(availability.slots)?availability.slots:[])
    .filter(slot=>
      clean(slot?.date)===date.key &&
      Number(slot?.weekday||0)===weekday &&
      clean(slot?.time_label)===timeText
    );

  if(!candidates.length){
    throw waitlistAddError('해당 날짜에는 요청한 대기 시간이 운영되지 않습니다.',404,'OLLI_AGENT_WAITLIST_ADD_TIME_NOT_AVAILABLE');
  }

  if(requestedGroup!=='AUTO'){
    candidates=candidates.filter(slot=>clean(slot?.class_group).toUpperCase()===requestedGroup);
    if(!candidates.length){
      throw waitlistAddError('해당 날짜와 시간에는 요청한 반이 운영되지 않습니다.',404,'OLLI_AGENT_WAITLIST_ADD_GROUP_NOT_AVAILABLE');
    }
  }else if(candidates.length>1){
    throw waitlistAddError('이 시간은 A반과 B반으로 나뉘어 있습니다. 대기할 반을 함께 알려 주세요.',409,'OLLI_AGENT_WAITLIST_ADD_GROUP_REQUIRED');
  }

  if(candidates.length!==1){
    throw waitlistAddError('대기 대상을 하나로 확정하지 못했습니다.',409,'OLLI_AGENT_WAITLIST_ADD_TARGET_AMBIGUOUS');
  }

  const target=candidates[0];
  const targetSlot=Number(target?.time_slot||0);
  const targetGroup=clean(target?.class_group).toUpperCase()==='B'?'B':'A';
  if(!Number.isInteger(targetSlot)||targetSlot<=0){
    throw waitlistAddError('대기 시간을 서버 시간표에서 확정하지 못했습니다.',500,'OLLI_AGENT_WAITLIST_ADD_SLOT_INVALID');
  }

  if(target.waitlist_open!==true||Number(target.waitlist_count||0)>0){
    throw waitlistAddError('이 반에는 이미 대기 학생이 있습니다.',409,'OLLI_AGENT_WAITLIST_ADD_SLOT_OCCUPIED');
  }

  const week=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:require('./pickup-prepare-tools.cjs').mondayKey(date.key),
  });
  if(!week?.ok){
    throw waitlistAddError(week?.message||'현재 학생 시간표와 대기 정보를 확인하지 못했습니다.',403,week?.code||'OLLI_AGENT_WAITLIST_ADD_WEEK_READ_FAILED');
  }

  const duplicateEnrollment=(Array.isArray(week?.enrollments)?week.enrollments:[]).some(row=>
    clean(row?.student_id)===clean(subject.studentId) &&
    Number(row?.weekday||0)===weekday &&
    Number(row?.time_slot||0)===targetSlot &&
    clean(row?.status).toLowerCase()==='active'
  );
  if(duplicateEnrollment){
    throw waitlistAddError('이미 같은 요일과 시간에 등록된 학생입니다.',409,'OLLI_AGENT_WAITLIST_ADD_ALREADY_ENROLLED');
  }

  const duplicateWaitlist=(Array.isArray(week?.waitlist)?week.waitlist:[]).some(row=>
    clean(row?.student_id)===clean(subject.studentId) &&
    Number(row?.target_weekday||0)===weekday &&
    Number(row?.target_time_slot||0)===targetSlot &&
    clean(row?.target_class_group).toUpperCase()===targetGroup &&
    ['waiting','offered'].includes(clean(row?.status).toLowerCase())
  );
  if(duplicateWaitlist){
    throw waitlistAddError('이미 같은 요일과 시간에 대기가 등록되어 있습니다.',409,'OLLI_AGENT_WAITLIST_ADD_DUPLICATE');
  }

  const replyId=replyToMessageId==null?null:Number(replyToMessageId);
  if(replyId!=null&&(!Number.isSafeInteger(replyId)||replyId<=0)){
    throw waitlistAddError('대기 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_INVALID');
  }

  const actionPayload={
    intent:'add_waitlist',
    studentId:clean(subject.studentId),
    studentName:student.name,
    guestName:'',
    isGuest:false,
    division:fixedDivision,
    effectiveDate:date.key,
    sessionDate:date.key,
    targetWeekday:weekday,
    targetTimeSlot:targetSlot,
    targetClassGroup:targetGroup,
  };

  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:actionPrompt({
      studentName:student.name,
      sessionDate:date.key,
      timeText,
      classGroup:targetGroup,
      grouped:target.grouped===true,
    }),
    p_action_type:'add_waitlist',
    p_action_payload:actionPayload,
    p_client_message_id:stableWaitlistAddActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if(!sent?.ok||!sent?.message?.action){
    throw waitlistAddError(sent?.message||'대기 등록 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_WAITLIST_ADD_ACTION_STORE_FAILED');
  }
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'add_waitlist',
    student_label:label,
    division:fixedDivision,
    session_date:date.key,
    target_weekday:weekday,
    target_time_label:timeText,
    target_class_group:targetGroup,
    timetable_mode:availability.timetable_mode,
  });
}

function createPrepareWaitlistAddTool({
  tool,z,requestContext,subjectAccess,studentLabel,division,classGroup,currentDate,requestId,
  replyToMessageId=null,capturePersistedMessage=null,sanitizePayload,
}){
  if(typeof tool!=='function'||!z){
    throw waitlistAddError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  }

  return tool({
    name:'prepare_waitlist_add',
    description:'재원생의 대기 등록을 실제 실행하지 않고 Team Chat 확인 대기 카드로 준비합니다. 서버가 학생 상태, 수업 시간, A/B반, 기존 등록, 현재 대기 점유를 다시 확인하며 확인 전에는 대기 데이터가 변경되지 않습니다.',
    parameters:z.object({
      target_date:z.string(),
      class_hour:z.number().int().min(1).max(12),
      class_minute:z.union([z.literal(0),z.literal(30)]),
    }),
    async execute({target_date,class_hour,class_minute}){
      const payload=await prepareWaitlistAddAction({
        requestContext,
        subjectAccess,
        studentLabel,
        division,
        sessionDate:target_date,
        classHour:class_hour,
        classMinute:class_minute,
        classGroup,
        currentDate,
        requestId,
        replyToMessageId,
        capturePersistedMessage,
        sanitizePayload,
      });
      return JSON.stringify(payload);
    },
  });
}

module.exports={
  normalizeGroup,
  stableWaitlistAddActionClientMessageId,
  prepareWaitlistAddAction,
  createPrepareWaitlistAddTool,
};
