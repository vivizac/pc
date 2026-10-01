'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {normalizeTimetableMode,timeLabel}=require('./schedule-tools.cjs');
const {parseDateKey,mondayKey}=require('./pickup-prepare-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}

function trialCancelError(message,statusCode=400,code='OLLI_AGENT_TRIAL_CANCEL_PREPARE_ERROR'){
  const error=new Error(message);
  error.statusCode=statusCode;
  error.code=code;
  return error;
}

function normalizeGroup(value){
  const group=clean(value).toUpperCase()||'AUTO';
  if(!['AUTO','A','B'].includes(group)){
    throw trialCancelError('취소할 체험 반을 확인해 주세요.',400,'OLLI_AGENT_TRIAL_CANCEL_GROUP_INVALID');
  }
  return group;
}

function optionalTimeLabel(hour,minute){
  const h=Number(hour||0);
  const m=Number(minute||0);
  if(h===0&&m===0) return '';
  if(!Number.isInteger(h)||h<1||h>12||![0,30].includes(m)){
    throw trialCancelError('취소할 체험 시간을 확인해 주세요.',400,'OLLI_AGENT_TRIAL_CANCEL_TIME_INVALID');
  }
  return String(h)+'시'+(m===30?' 30분':'');
}

function normalizeTrialCancelReason(value){
  const reason=clean(value)
    .replace(/^(?:사유|이유)\s*(?:는|은)?\s*[:：-]?\s*/i,'')
    .replace(/\s+/g,' ')
    .trim();
  if(!reason){
    throw trialCancelError('체험 취소 사유를 함께 알려 주세요.',400,'OLLI_AGENT_TRIAL_CANCEL_REASON_REQUIRED');
  }
  if(reason.length>300){
    throw trialCancelError('체험 취소 사유는 300자 이내로 알려 주세요.',400,'OLLI_AGENT_TRIAL_CANCEL_REASON_TOO_LONG');
  }
  const generic=reason.replace(/[\s.,!?~"'“”‘’()[\]{}:;·_-]+/g,'').toLowerCase();
  if(/^(?:체험|체험수업|체험클래스|취소|삭제|지워|지우|제거|빼|해제|없애|취소해줘|취소해주세요|삭제해줘|삭제해주세요)$/.test(generic)){
    throw trialCancelError('체험 취소 사유를 함께 알려 주세요.',400,'OLLI_AGENT_TRIAL_CANCEL_REASON_REQUIRED');
  }
  return reason;
}

function stableTrialCancelActionClientMessageId({academyId,memberId,requestId}){
  const request=clean(requestId);
  if(!request||request.length>200){
    throw trialCancelError('체험 취소 준비 요청 식별값이 없습니다.',400,'OLLI_AGENT_TRIAL_CANCEL_REQUEST_ID_REQUIRED');
  }
  const hex=crypto.createHash('sha256')
    .update(['olli-agent-trial-cancel-v1',clean(academyId),clean(memberId),request,'cancel_trial'].join('|'))
    .digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}

function sameGuest(a,b){
  return clean(a).toLocaleLowerCase('ko-KR')===clean(b).toLocaleLowerCase('ko-KR');
}

function rowGroup(row){
  return clean(row?.class_group).toUpperCase()==='B'?'B':'A';
}

function dateLabel(dateKey){
  const parsed=parseDateKey(dateKey);
  if(!parsed) return dateKey;
  const date=new Date(parsed.timestamp);
  return String(date.getUTCMonth()+1)+'월 '+String(date.getUTCDate())+'일';
}

function rowVisibleTime(row,division,timetableMode){
  const dateKey=clean(row?.session_date).slice(0,10);
  const parsed=parseDateKey(dateKey);
  if(!parsed) return '';
  const date=new Date(parsed.timestamp);
  const weekday=date.getUTCDay()===0?7:date.getUTCDay();
  return timeLabel(division,weekday,Number(row?.time_slot||0),timetableMode);
}

function activeTrialRows(weekData,guestName){
  return (Array.isArray(weekData?.one_time_sessions)?weekData.one_time_sessions:[])
    .filter(row=>
      row?.is_guest===true &&
      clean(row?.session_type).toLowerCase()==='trial' &&
      clean(row?.status).toLowerCase()!=='cancelled' &&
      sameGuest(row?.student_name,guestName)
    );
}

function cancelPrompt({guestName,sessionDate,timeText,classGroup,showGroup,reason}){
  const groupText=showGroup?' '+classGroup+'반':'';
  return [
    clean(guestName)+' · '+dateLabel(sessionDate)+' '+clean(timeText)+groupText,
    '체험 취소 사유: '+clean(reason),
    '이 체험수업을 취소할까요?',
  ].join('\n');
}

async function prepareTrialCancelAction({
  requestContext,
  trialAccess,
  guestLabel,
  sourceDate='',
  sourceHour=0,
  sourceMinute=0,
  classGroup='AUTO',
  reason,
  currentDate,
  requestId,
  replyToMessageId=null,
  capturePersistedMessage=null,
  sanitizePayload,
  callRpc=callSupabaseRpc,
}){
  if(typeof sanitizePayload!=='function'){
    throw trialCancelError('Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_TRIAL_CANCEL_PRIVACY_MISSING');
  }

  const label=clean(guestLabel);
  const guest=trialAccess?.resolve?.(label);
  const guestName=clean(guest?.guestName);
  if(!guestName){
    throw trialCancelError('현재 Agent 대화에서 확인할 수 없는 체험 학생 참조입니다.',400,'OLLI_AGENT_TRIAL_GUEST_NOT_AVAILABLE');
  }

  const today=parseDateKey(currentDate);
  if(!today){
    throw trialCancelError('체험 취소 기준 날짜를 확인하지 못했습니다.',500,'OLLI_AGENT_TRIAL_CANCEL_CURRENT_DATE_INVALID');
  }

  const explicitDate=clean(sourceDate);
  const requestedDate=explicitDate?parseDateKey(explicitDate):null;
  if(explicitDate&&!requestedDate){
    throw trialCancelError('취소할 체험 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',400,'OLLI_AGENT_TRIAL_CANCEL_DATE_INVALID');
  }
  if(requestedDate&&requestedDate.timestamp<today.timestamp){
    throw trialCancelError('지난 날짜의 체험수업은 이 Agent에서 취소할 수 없습니다.',400,'OLLI_AGENT_TRIAL_CANCEL_DATE_PAST');
  }

  const requestedTime=optionalTimeLabel(sourceHour,sourceMinute);
  const requestedGroup=normalizeGroup(classGroup);
  const safeReason=normalizeTrialCancelReason(reason);
  const lookupDate=requestedDate?requestedDate.key:today.key;

  const weekData=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(lookupDate),
  });
  if(!weekData?.ok){
    throw trialCancelError(weekData?.message||'기존 체험 일정을 확인하지 못했습니다.',403,weekData?.code||'OLLI_AGENT_TRIAL_CANCEL_WEEK_READ_FAILED');
  }

  const mode=normalizeTimetableMode(weekData?.timetable_mode);
  let rows=activeTrialRows(weekData,guestName);
  if(requestedDate){
    rows=rows.filter(row=>clean(row?.session_date).slice(0,10)===requestedDate.key);
  }else{
    rows=rows.filter(row=>clean(row?.session_date).slice(0,10)>=today.key);
  }

  if(requestedTime){
    rows=rows.filter(row=>{
      const division=clean(row?.division).toLowerCase();
      if(!['elementary','kinder'].includes(division)) return false;
      return clean(rowVisibleTime(row,division,mode))===requestedTime;
    });
  }
  if(requestedGroup!=='AUTO'){
    rows=rows.filter(row=>rowGroup(row)===requestedGroup);
  }

  rows.sort((a,b)=>
    clean(a?.session_date).localeCompare(clean(b?.session_date)) ||
    Number(a?.time_slot||0)-Number(b?.time_slot||0) ||
    rowGroup(a).localeCompare(rowGroup(b))
  );

  if(!rows.length){
    throw trialCancelError('취소할 체험수업을 찾지 못했습니다.',404,'OLLI_AGENT_TRIAL_CANCEL_NOT_FOUND');
  }
  if(rows.length>1){
    throw trialCancelError('취소 가능한 체험수업이 여러 개 있습니다. 날짜와 시간을 함께 알려 주세요.',409,'OLLI_AGENT_TRIAL_CANCEL_AMBIGUOUS');
  }

  const row=rows[0];
  const oneTimeSessionId=clean(row?.id);
  const sessionDate=clean(row?.session_date).slice(0,10);
  const division=clean(row?.division).toLowerCase();
  const timeSlot=Number(row?.time_slot||0);
  const actualGroup=rowGroup(row);
  const timeText=rowVisibleTime(row,division,mode);
  if(!oneTimeSessionId||!parseDateKey(sessionDate)||!['elementary','kinder'].includes(division)||!Number.isInteger(timeSlot)||timeSlot<=0||!timeText){
    throw trialCancelError('취소할 체험 정보를 서버에서 확정하지 못했습니다.',500,'OLLI_AGENT_TRIAL_CANCEL_TARGET_INVALID');
  }

  const requestedDivision=clean(guest?.division).toLowerCase();
  if(requestedDivision&&['elementary','kinder'].includes(requestedDivision)&&requestedDivision!==division){
    throw trialCancelError('요청한 체험 수업 구분과 기존 체험 정보가 다릅니다.',409,'OLLI_AGENT_TRIAL_CANCEL_DIVISION_MISMATCH');
  }

  const replyId=replyToMessageId==null?null:Number(replyToMessageId);
  if(replyId!=null&&(!Number.isSafeInteger(replyId)||replyId<=0)){
    throw trialCancelError('체험 사유 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_TRIAL_REASON_MESSAGE_INVALID');
  }

  const actionPayload={
    intent:'cancel_trial',
    guestName,
    studentName:guestName,
    division,
    oneTimeSessionId,
    sessionDate,
    timeSlot,
    classGroup:actualGroup,
    reason:safeReason,
  };

  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:cancelPrompt({
      guestName,
      sessionDate,
      timeText,
      classGroup:actualGroup,
      showGroup:requestedGroup!=='AUTO'||actualGroup==='B',
      reason:safeReason,
    }),
    p_action_type:'cancel_trial',
    p_action_payload:actionPayload,
    p_client_message_id:stableTrialCancelActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if(!sent?.ok||!sent?.message?.action){
    throw trialCancelError(sent?.message||'체험 취소 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_TRIAL_CANCEL_ACTION_STORE_FAILED');
  }
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'cancel_trial',
    guest_label:label,
    division,
    session_date:sessionDate,
    time_label:timeText,
    class_group:actualGroup,
    timetable_mode:mode,
  });
}

function createPrepareTrialCancelTool({
  tool,z,requestContext,trialAccess,guestLabel,classGroup,reason,currentDate,requestId,
  replyToMessageId=null,capturePersistedMessage=null,sanitizePayload,
}){
  if(typeof tool!=='function'||!z){
    throw trialCancelError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  }

  return tool({
    name:'prepare_trial_cancel',
    description:'비재원 체험수업 취소를 실제 실행하지 않고 Team Chat 확인 대기 카드로 준비합니다. 서버가 현재 체험 row를 다시 조회해 실제 one-time session을 확정하며 확인 전에는 체험 데이터가 변경되지 않습니다.',
    parameters:z.object({
      source_date:z.string(),
      source_hour:z.number().int().min(0).max(12),
      source_minute:z.union([z.literal(0),z.literal(30)]),
    }),
    async execute({source_date,source_hour,source_minute}){
      const payload=await prepareTrialCancelAction({
        requestContext,
        trialAccess,
        guestLabel,
        sourceDate:source_date,
        sourceHour:source_hour,
        sourceMinute:source_minute,
        classGroup,
        reason,
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
  optionalTimeLabel,
  normalizeTrialCancelReason,
  stableTrialCancelActionClientMessageId,
  activeTrialRows,
  prepareTrialCancelAction,
  createPrepareTrialCancelTool,
};
