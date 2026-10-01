'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {readScheduleAvailability}=require('./availability-tools.cjs');
const {parseDateKey,mondayKey}=require('./pickup-prepare-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}

function trialAddError(message,statusCode=400,code='OLLI_AGENT_TRIAL_ADD_PREPARE_ERROR'){
  const error=new Error(message);
  error.statusCode=statusCode;
  error.code=code;
  return error;
}

function normalizeRequestedGroup(value){
  const group=clean(value).toUpperCase()||'AUTO';
  if(!['AUTO','A','B'].includes(group)){
    throw trialAddError('체험 수업 반을 확인해 주세요.',400,'OLLI_AGENT_TRIAL_ADD_GROUP_INVALID');
  }
  return group;
}

function requestedTimeLabel(hour,minute){
  const h=Number(hour||0);
  const m=Number(minute||0);
  if(!Number.isInteger(h)||h<1||h>12||![0,30].includes(m)){
    throw trialAddError('체험 시간을 확인해 주세요.',400,'OLLI_AGENT_TRIAL_ADD_TIME_INVALID');
  }
  return String(h)+'시'+(m===30?' 30분':'');
}

function stableTrialAddActionClientMessageId({academyId,memberId,requestId}){
  const request=clean(requestId);
  if(!request||request.length>160){
    throw trialAddError('체험 등록 준비 요청 식별값이 없습니다.',400,'OLLI_AGENT_TRIAL_ADD_REQUEST_ID_REQUIRED');
  }
  const hex=crypto.createHash('sha256')
    .update(['olli-agent-trial-add-v1',clean(academyId),clean(memberId),request,'add_trial'].join('|'))
    .digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}

function sameGuest(a,b){
  return clean(a).toLocaleLowerCase('ko-KR')===clean(b).toLocaleLowerCase('ko-KR');
}

function duplicateTrial(weekData,guestName,sessionDate,timeSlot,classGroup){
  return (Array.isArray(weekData?.one_time_sessions)?weekData.one_time_sessions:[])
    .some(row=>
      row?.is_guest===true &&
      clean(row?.session_type).toLowerCase()==='trial' &&
      clean(row?.status).toLowerCase()!=='cancelled' &&
      sameGuest(row?.student_name,guestName) &&
      clean(row?.session_date).slice(0,10)===sessionDate &&
      Number(row?.time_slot||0)===Number(timeSlot) &&
      (clean(row?.class_group).toUpperCase()==='B'?'B':'A')===classGroup
    );
}

function dateLabel(dateKey){
  const parsed=parseDateKey(dateKey);
  if(!parsed) return dateKey;
  const date=new Date(parsed.timestamp);
  return String(date.getUTCMonth()+1)+'월 '+String(date.getUTCDate())+'일';
}

function actionPrompt({guestName,sessionDate,timeText,classGroup,grouped}){
  const groupText=grouped?' '+classGroup+'반':'';
  return [
    clean(guestName)+' · '+dateLabel(sessionDate)+' '+clean(timeText)+groupText,
    '체험수업으로 등록할까요?',
  ].join('\n');
}

async function prepareTrialAddAction({
  requestContext,
  trialAccess,
  guestLabel,
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
    throw trialAddError('Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_TRIAL_ADD_PRIVACY_MISSING');
  }

  const label=clean(guestLabel);
  const guest=trialAccess?.resolve?.(label);
  const guestName=clean(guest?.guestName);
  if(!guestName){
    throw trialAddError('현재 Agent 대화에서 확인할 수 없는 체험 학생 참조입니다.',400,'OLLI_AGENT_TRIAL_GUEST_NOT_AVAILABLE');
  }

  const fixedDivision=clean(division).toLowerCase();
  const subjectDivision=clean(guest?.division).toLowerCase();
  if(!['elementary','kinder'].includes(fixedDivision)||subjectDivision!==fixedDivision){
    throw trialAddError('체험 학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_TRIAL_ADD_DIVISION_MISMATCH');
  }

  const date=parseDateKey(sessionDate);
  const today=parseDateKey(currentDate);
  if(!date||!today){
    throw trialAddError('체험 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',400,'OLLI_AGENT_TRIAL_ADD_DATE_INVALID');
  }
  if(date.timestamp<today.timestamp){
    throw trialAddError('지난 날짜에는 체험수업을 등록할 수 없습니다.',400,'OLLI_AGENT_TRIAL_ADD_DATE_PAST');
  }

  const timeText=requestedTimeLabel(classHour,classMinute);
  const requestedGroup=normalizeRequestedGroup(classGroup);
  const availability=await readScheduleAvailability({
    requestContext,
    division:fixedDivision,
    purpose:'trial',
    startDate:date.key,
    endDate:date.key,
    timeSlot:0,
    classGroup:'ALL',
    sanitizePayload(payload){return payload;},
    callRpc,
  });

  if((availability.closed_dates||[]).some(row=>row.date===date.key)){
    throw trialAddError('공휴일에는 체험수업을 등록할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.',409,'OLLI_AGENT_TRIAL_ADD_CLOSED_DAY');
  }

  let candidates=(Array.isArray(availability.slots)?availability.slots:[])
    .filter(slot=>clean(slot?.date)===date.key&&clean(slot?.time_label)===timeText);

  if(!candidates.length){
    throw trialAddError('해당 날짜에는 요청한 체험 시간이 운영되지 않습니다.',404,'OLLI_AGENT_TRIAL_ADD_TIME_NOT_AVAILABLE');
  }

  if(requestedGroup!=='AUTO'){
    candidates=candidates.filter(slot=>clean(slot?.class_group).toUpperCase()===requestedGroup);
    if(!candidates.length){
      throw trialAddError('해당 날짜와 시간에는 요청한 반이 운영되지 않습니다.',404,'OLLI_AGENT_TRIAL_ADD_GROUP_NOT_AVAILABLE');
    }
  }else if(candidates.length>1){
    throw trialAddError('이 시간은 A반과 B반으로 나뉘어 있습니다. 체험할 반을 함께 알려 주세요.',409,'OLLI_AGENT_TRIAL_ADD_GROUP_REQUIRED');
  }

  if(candidates.length!==1){
    throw trialAddError('체험 대상을 하나로 확정하지 못했습니다.',409,'OLLI_AGENT_TRIAL_ADD_TARGET_AMBIGUOUS');
  }

  const target=candidates[0];
  if(target.available!==true||Number(target.remaining||0)<=0){
    throw trialAddError('선택한 날짜와 시간의 정원이 가득 찼습니다.',409,'OLLI_AGENT_TRIAL_ADD_FULL');
  }

  const timeSlot=Number(target.time_slot||0);
  const targetGroup=clean(target.class_group).toUpperCase()==='B'?'B':'A';
  if(!Number.isInteger(timeSlot)||timeSlot<=0){
    throw trialAddError('체험 수업 시간을 서버 시간표에서 확정하지 못했습니다.',500,'OLLI_AGENT_TRIAL_ADD_SLOT_INVALID');
  }

  const weekData=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(date.key),
  });
  if(!weekData?.ok){
    throw trialAddError(weekData?.message||'기존 체험 일정을 확인하지 못했습니다.',403,weekData?.code||'OLLI_AGENT_TRIAL_ADD_WEEK_READ_FAILED');
  }
  if(duplicateTrial(weekData,guestName,date.key,timeSlot,targetGroup)){
    throw trialAddError('같은 이름의 체험수업이 같은 날짜와 시간에 이미 등록되어 있습니다.',409,'OLLI_AGENT_TRIAL_ADD_ALREADY_EXISTS');
  }

  const replyId=replyToMessageId==null?null:Number(replyToMessageId);
  if(replyId!=null&&(!Number.isSafeInteger(replyId)||replyId<=0)){
    throw trialAddError('체험 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_TRIAL_SOURCE_MESSAGE_INVALID');
  }

  const actionPayload={
    intent:'add_trial',
    guestName,
    studentName:guestName,
    division:fixedDivision,
    sessionDate:date.key,
    timeSlot,
    classGroup:targetGroup,
  };

  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:actionPrompt({
      guestName,
      sessionDate:date.key,
      timeText,
      classGroup:targetGroup,
      grouped:target.grouped===true,
    }),
    p_action_type:'add_trial',
    p_action_payload:actionPayload,
    p_client_message_id:stableTrialAddActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if(!sent?.ok||!sent?.message?.action){
    throw trialAddError(sent?.message||'체험 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_TRIAL_ADD_ACTION_STORE_FAILED');
  }
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'add_trial',
    guest_label:label,
    division:fixedDivision,
    session_date:date.key,
    time_label:timeText,
    class_group:targetGroup,
    timetable_mode:clean(availability.timetable_mode),
    remaining:Number(target.remaining||0),
  });
}

function createPrepareTrialAddTool({
  tool,z,requestContext,trialAccess,guestLabel,division,classGroup,currentDate,requestId,
  replyToMessageId=null,capturePersistedMessage=null,sanitizePayload,
}){
  if(typeof tool!=='function'||!z){
    throw trialAddError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  }

  return tool({
    name:'prepare_trial_add',
    description:'비재원 체험수업 등록을 실제 실행하지 않고 Team Chat 확인 대기 카드로 준비합니다. 서버가 현재 가용성을 다시 확인해 실제 저장 슬롯을 확정하며 확인 전에는 체험 데이터가 변경되지 않습니다.',
    parameters:z.object({
      session_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      class_hour:z.number().int().min(1).max(12),
      class_minute:z.union([z.literal(0),z.literal(30)]),
    }),
    async execute({session_date,class_hour,class_minute}){
      const payload=await prepareTrialAddAction({
        requestContext,
        trialAccess,
        guestLabel,
        division,
        classGroup,
        sessionDate:session_date,
        classHour:class_hour,
        classMinute:class_minute,
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
  stableTrialAddActionClientMessageId,
  duplicateTrial,
  prepareTrialAddAction,
  createPrepareTrialAddTool,
};
