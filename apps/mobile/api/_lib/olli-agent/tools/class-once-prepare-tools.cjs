'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {readScheduleAvailability}=require('./availability-tools.cjs');
const {parseDateKey,mondayKey}=require('./pickup-prepare-tools.cjs');
const {loadPrivateMakeupStudent}=require('./makeup-prepare-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}

function classOnceError(message,statusCode=400,code='OLLI_AGENT_CLASS_ONCE_PREPARE_ERROR'){
  const error=new Error(message);
  error.statusCode=statusCode;
  error.code=code;
  return error;
}

function normalizeRequestedGroup(value){
  const group=clean(value).toUpperCase()||'AUTO';
  if(!['AUTO','A','B'].includes(group)){
    throw classOnceError('수업 반을 확인해 주세요.',400,'OLLI_AGENT_CLASS_ONCE_GROUP_INVALID');
  }
  return group;
}

function requestedTimeLabel(hour,minute){
  const h=Number(hour||0);
  const m=Number(minute||0);
  if(!Number.isInteger(h)||h<1||h>12||![0,30].includes(m)){
    throw classOnceError('수업 시간을 확인해 주세요.',400,'OLLI_AGENT_CLASS_ONCE_TIME_INVALID');
  }
  return String(h)+'시'+(m===30?' 30분':'');
}

function stableClassOnceActionClientMessageId({academyId,memberId,requestId}){
  const request=clean(requestId);
  if(!request||request.length>160){
    throw classOnceError('1회 수업 준비 요청 식별값이 없습니다.',400,'OLLI_AGENT_CLASS_ONCE_REQUEST_ID_REQUIRED');
  }
  const hex=crypto.createHash('sha256')
    .update(['olli-agent-class-once-v1',clean(academyId),clean(memberId),request,'add_class_once'].join('|'))
    .digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}

function duplicateOneTime(weekData,studentId,sessionDate,timeSlot){
  return (Array.isArray(weekData?.one_time_sessions)?weekData.one_time_sessions:[])
    .some(row=>
      clean(row?.student_id)===clean(studentId) &&
      clean(row?.session_date).slice(0,10)===sessionDate &&
      Number(row?.time_slot||0)===Number(timeSlot) &&
      clean(row?.status).toLowerCase()!=='cancelled'
    );
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
    '이 수업에 1회 등록할까요?',
  ].join('\n');
}

async function prepareClassOnceAction({
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  requestedDivision='',
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
    throw classOnceError('Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_CLASS_ONCE_PRIVACY_MISSING');
  }

  const label=clean(studentLabel);
  const subject=subjectAccess?.resolve?.(label);
  if(!subject?.studentId){
    throw classOnceError('현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',400,'OLLI_AGENT_SUBJECT_NOT_AVAILABLE');
  }

  const fixedDivision=clean(division).toLowerCase();
  const subjectDivision=clean(subject.division).toLowerCase();
  if(!['elementary','kinder'].includes(fixedDivision)||subjectDivision!==fixedDivision){
    throw classOnceError('지정한 학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_CLASS_ONCE_DIVISION_MISMATCH');
  }
  const requested=clean(requestedDivision).toLowerCase();
  if(requested&&requested!==fixedDivision){
    throw classOnceError('학생의 소속과 요청한 수업 구분이 다릅니다.',409,'OLLI_AGENT_CLASS_ONCE_REQUESTED_DIVISION_MISMATCH');
  }

  const date=parseDateKey(sessionDate);
  const today=parseDateKey(currentDate);
  if(!date||!today){
    throw classOnceError('수업 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',400,'OLLI_AGENT_CLASS_ONCE_DATE_INVALID');
  }
  if(date.timestamp<today.timestamp){
    throw classOnceError('지난 날짜에는 1회 수업을 등록할 수 없습니다.',400,'OLLI_AGENT_CLASS_ONCE_DATE_PAST');
  }

  const timeText=requestedTimeLabel(classHour,classMinute);
  const requestedGroup=normalizeRequestedGroup(classGroup);
  const student=await loadPrivateMakeupStudent({
    requestContext,
    studentId:subject.studentId,
    expectedDivision:fixedDivision,
    callRpc,
  });

  const availability=await readScheduleAvailability({
    requestContext,
    division:fixedDivision,
    purpose:'makeup',
    startDate:date.key,
    endDate:date.key,
    timeSlot:0,
    classGroup:'ALL',
    sanitizePayload(payload){return payload;},
    callRpc,
  });

  if((availability.closed_dates||[]).some(row=>row.date===date.key)){
    throw classOnceError(
      '공휴일에는 1회 수업을 등록할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.',
      409,
      'OLLI_AGENT_CLASS_ONCE_CLOSED_DAY'
    );
  }

  let candidates=(Array.isArray(availability.slots)?availability.slots:[])
    .filter(slot=>slot.date===date.key&&clean(slot.time_label)===timeText);

  if(!candidates.length){
    throw classOnceError('해당 날짜에는 요청한 수업 시간이 운영되지 않습니다.',404,'OLLI_AGENT_CLASS_ONCE_TIME_NOT_AVAILABLE');
  }

  if(requestedGroup!=='AUTO'){
    candidates=candidates.filter(slot=>clean(slot.class_group).toUpperCase()===requestedGroup);
    if(!candidates.length){
      throw classOnceError('해당 날짜와 시간에는 요청한 반이 운영되지 않습니다.',404,'OLLI_AGENT_CLASS_ONCE_GROUP_NOT_AVAILABLE');
    }
  }else if(candidates.length>1){
    throw classOnceError('이 시간은 A반과 B반으로 나뉘어 있습니다. 등록할 반을 함께 알려 주세요.',409,'OLLI_AGENT_CLASS_ONCE_GROUP_REQUIRED');
  }

  if(candidates.length!==1){
    throw classOnceError('등록할 수업을 하나로 확정하지 못했습니다.',409,'OLLI_AGENT_CLASS_ONCE_TARGET_AMBIGUOUS');
  }

  const target=candidates[0];
  if(target.available!==true||Number(target.remaining||0)<=0){
    throw classOnceError('선택한 날짜와 시간의 정원이 가득 찼습니다.',409,'OLLI_AGENT_CLASS_ONCE_FULL');
  }

  const timeSlot=Number(target.time_slot||0);
  const targetGroup=clean(target.class_group).toUpperCase()==='B'?'B':'A';
  if(!Number.isInteger(timeSlot)||timeSlot<=0){
    throw classOnceError('수업 시간을 서버 시간표에서 확정하지 못했습니다.',500,'OLLI_AGENT_CLASS_ONCE_SLOT_INVALID');
  }

  const weekData=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(date.key),
  });
  if(!weekData?.ok){
    throw classOnceError(weekData?.message||'기존 1회 수업 일정을 확인하지 못했습니다.',403,weekData?.code||'OLLI_AGENT_CLASS_ONCE_WEEK_READ_FAILED');
  }
  if(duplicateOneTime(weekData,subject.studentId,date.key,timeSlot)){
    throw classOnceError('같은 학생에게 같은 날짜와 시간의 1회 수업이 이미 등록되어 있습니다.',409,'OLLI_AGENT_CLASS_ONCE_ALREADY_EXISTS');
  }

  const replyId=replyToMessageId==null?null:Number(replyToMessageId);
  if(replyId!=null&&(!Number.isSafeInteger(replyId)||replyId<=0)){
    throw classOnceError('1회 수업 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_CLASS_ONCE_SOURCE_MESSAGE_INVALID');
  }

  const actionPayload={
    intent:'add_class_once',
    studentId:clean(subject.studentId),
    studentName:student.name,
    division:fixedDivision,
    sessionDate:date.key,
    timeSlot,
    classGroup:targetGroup,
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
    p_action_type:'add_class_once',
    p_action_payload:actionPayload,
    p_client_message_id:stableClassOnceActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if(!sent?.ok||!sent?.message?.action){
    throw classOnceError(sent?.message||'1회 수업 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_CLASS_ONCE_ACTION_STORE_FAILED');
  }
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'add_class_once',
    student_label:label,
    division:fixedDivision,
    session_date:date.key,
    time_label:timeText,
    class_group:targetGroup,
    timetable_mode:clean(availability.timetable_mode),
    remaining:Number(target.remaining||0),
  });
}

function createPrepareClassOnceTool({
  tool,z,requestContext,subjectAccess,studentLabel,division,requestedDivision,classGroup,currentDate,requestId,
  replyToMessageId=null,capturePersistedMessage=null,sanitizePayload,
}){
  if(typeof tool!=='function'||!z){
    throw classOnceError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  }

  return tool({
    name:'prepare_class_once',
    description:'재원생의 특정 날짜 1회 수업 추가를 실제 실행하지 않고 Team Chat 확인 카드로 준비합니다. 서버가 학생 소속, 운영 시간, A/B반, 정원, 중복 1회 수업을 다시 확인하며 확인 전에는 수업 데이터가 변경되지 않습니다.',
    parameters:z.object({
      session_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      class_hour:z.number().int().min(1).max(12),
      class_minute:z.union([z.literal(0),z.literal(30)]),
    }),
    async execute({session_date,class_hour,class_minute}){
      const payload=await prepareClassOnceAction({
        requestContext,
        subjectAccess,
        studentLabel,
        division,
        requestedDivision,
        sessionDate:session_date,
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
  normalizeRequestedGroup,
  requestedTimeLabel,
  stableClassOnceActionClientMessageId,
  duplicateOneTime,
  prepareClassOnceAction,
  createPrepareClassOnceTool,
};
