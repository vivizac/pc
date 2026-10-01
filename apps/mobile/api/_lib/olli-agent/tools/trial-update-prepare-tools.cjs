'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {readScheduleAvailability}=require('./availability-tools.cjs');
const {normalizeTimetableMode,timeLabel}=require('./schedule-tools.cjs');
const {parseDateKey,mondayKey}=require('./pickup-prepare-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}

function trialUpdateError(message,statusCode=400,code='OLLI_AGENT_TRIAL_UPDATE_PREPARE_ERROR'){
  const error=new Error(message);
  error.statusCode=statusCode;
  error.code=code;
  return error;
}

function normalizeGroup(value,label='체험 반'){
  const group=clean(value).toUpperCase()||'AUTO';
  if(!['AUTO','A','B'].includes(group)){
    throw trialUpdateError(label+'을 확인해 주세요.',400,'OLLI_AGENT_TRIAL_UPDATE_GROUP_INVALID');
  }
  return group;
}

function optionalTimeLabel(hour,minute,label='체험 시간'){
  const h=Number(hour||0);
  const m=Number(minute||0);
  if(h===0&&m===0) return '';
  if(!Number.isInteger(h)||h<1||h>12||![0,30].includes(m)){
    throw trialUpdateError(label+'을 확인해 주세요.',400,'OLLI_AGENT_TRIAL_UPDATE_TIME_INVALID');
  }
  return String(h)+'시'+(m===30?' 30분':'');
}

function rowGroup(row){
  return clean(row?.class_group).toUpperCase()==='B'?'B':'A';
}

function sameGuest(a,b){
  return clean(a).toLocaleLowerCase('ko-KR')===clean(b).toLocaleLowerCase('ko-KR');
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

function chooseTargetCandidate(candidates,requestedGroup,sourceGroup){
  if(requestedGroup!=='AUTO'){
    const matches=candidates.filter(slot=>clean(slot?.class_group).toUpperCase()===requestedGroup);
    if(!matches.length){
      throw trialUpdateError('변경할 날짜와 시간에는 요청한 반이 운영되지 않습니다.',404,'OLLI_AGENT_TRIAL_UPDATE_TARGET_GROUP_NOT_AVAILABLE');
    }
    if(matches.length!==1){
      throw trialUpdateError('변경할 체험 반을 하나로 확정하지 못했습니다.',409,'OLLI_AGENT_TRIAL_UPDATE_TARGET_AMBIGUOUS');
    }
    return matches[0];
  }
  if(candidates.length===1) return candidates[0];
  const preserved=candidates.filter(slot=>clean(slot?.class_group).toUpperCase()===sourceGroup);
  if(preserved.length===1) return preserved[0];
  throw trialUpdateError('변경할 시간은 A반과 B반으로 나뉘어 있습니다. 변경할 반을 함께 알려 주세요.',409,'OLLI_AGENT_TRIAL_UPDATE_TARGET_GROUP_REQUIRED');
}

function stableTrialUpdateActionClientMessageId({academyId,memberId,requestId}){
  const request=clean(requestId);
  if(!request||request.length>160){
    throw trialUpdateError('체험 변경 준비 요청 식별값이 없습니다.',400,'OLLI_AGENT_TRIAL_UPDATE_REQUEST_ID_REQUIRED');
  }
  const hex=crypto.createHash('sha256')
    .update(['olli-agent-trial-update-v1',clean(academyId),clean(memberId),request,'update_trial'].join('|'))
    .digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}

function updatePrompt({guestName,sourceDate,sourceTime,sourceGroup,targetDate,targetTime,targetGroup,showGroup}){
  const oldGroup=showGroup?' '+sourceGroup+'반':'';
  const newGroup=showGroup?' '+targetGroup+'반':'';
  return [
    clean(guestName)+' 체험수업 변경',
    '현재: '+dateLabel(sourceDate)+' '+clean(sourceTime)+oldGroup,
    '변경: '+dateLabel(targetDate)+' '+clean(targetTime)+newGroup,
    '이렇게 변경할까요?',
  ].join('\n');
}

async function prepareTrialUpdateAction({
  requestContext,
  trialAccess,
  guestLabel,
  sourceDate,
  sourceHour=0,
  sourceMinute=0,
  sourceGroup='AUTO',
  targetDate='',
  targetHour=0,
  targetMinute=0,
  targetGroup='AUTO',
  currentDate,
  requestId,
  replyToMessageId=null,
  capturePersistedMessage=null,
  sanitizePayload,
  callRpc=callSupabaseRpc,
}){
  if(typeof sanitizePayload!=='function'){
    throw trialUpdateError('Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_TRIAL_UPDATE_PRIVACY_MISSING');
  }

  const label=clean(guestLabel);
  const guest=trialAccess?.resolve?.(label);
  const guestName=clean(guest?.guestName);
  if(!guestName){
    throw trialUpdateError('현재 Agent 대화에서 확인할 수 없는 체험 학생 참조입니다.',400,'OLLI_AGENT_TRIAL_GUEST_NOT_AVAILABLE');
  }

  const today=parseDateKey(currentDate);
  const sourceDateValue=parseDateKey(sourceDate);
  if(!today||!sourceDateValue){
    throw trialUpdateError('기존 체험 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',400,'OLLI_AGENT_TRIAL_UPDATE_SOURCE_DATE_INVALID');
  }
  if(sourceDateValue.timestamp<today.timestamp){
    throw trialUpdateError('지난 날짜의 체험수업은 이 Agent에서 변경할 수 없습니다.',400,'OLLI_AGENT_TRIAL_UPDATE_SOURCE_DATE_PAST');
  }

  const explicitTargetDate=clean(targetDate);
  const targetDateValue=explicitTargetDate?parseDateKey(explicitTargetDate):sourceDateValue;
  if(!targetDateValue){
    throw trialUpdateError('변경할 체험 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',400,'OLLI_AGENT_TRIAL_UPDATE_TARGET_DATE_INVALID');
  }
  if(targetDateValue.timestamp<today.timestamp){
    throw trialUpdateError('지난 날짜로는 체험수업을 변경할 수 없습니다.',400,'OLLI_AGENT_TRIAL_UPDATE_TARGET_DATE_PAST');
  }

  const requestedSourceTime=optionalTimeLabel(sourceHour,sourceMinute,'기존 체험 시간');
  const requestedTargetTime=optionalTimeLabel(targetHour,targetMinute,'변경할 체험 시간');
  const requestedSourceGroup=normalizeGroup(sourceGroup,'기존 체험 반');
  const requestedTargetGroup=normalizeGroup(targetGroup,'변경할 체험 반');

  const commonParams={
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
  };
  const sourceWeek=await callRpc('olli_schedule_week',{
    ...commonParams,
    p_week_start:mondayKey(sourceDateValue.key),
  });
  if(!sourceWeek?.ok){
    throw trialUpdateError(sourceWeek?.message||'기존 체험 일정을 확인하지 못했습니다.',403,sourceWeek?.code||'OLLI_AGENT_TRIAL_UPDATE_SOURCE_WEEK_READ_FAILED');
  }

  const sourceMode=normalizeTimetableMode(sourceWeek?.timetable_mode);
  let sourceRows=activeTrialRows(sourceWeek,guestName)
    .filter(row=>clean(row?.session_date).slice(0,10)===sourceDateValue.key);

  if(requestedSourceTime){
    sourceRows=sourceRows.filter(row=>clean(rowVisibleTime(row,clean(row?.division).toLowerCase(),sourceMode))===requestedSourceTime);
  }
  if(requestedSourceGroup!=='AUTO'){
    sourceRows=sourceRows.filter(row=>rowGroup(row)===requestedSourceGroup);
  }
  sourceRows.sort((a,b)=>Number(a?.time_slot||0)-Number(b?.time_slot||0)||rowGroup(a).localeCompare(rowGroup(b)));

  if(!sourceRows.length){
    throw trialUpdateError('변경할 기존 체험 일정을 찾지 못했습니다.',404,'OLLI_AGENT_TRIAL_UPDATE_SOURCE_NOT_FOUND');
  }
  if(sourceRows.length>1){
    throw trialUpdateError('해당 날짜에 같은 이름의 체험이 여러 개 있습니다. 기존 시간과 반을 함께 알려 주세요.',409,'OLLI_AGENT_TRIAL_UPDATE_SOURCE_AMBIGUOUS');
  }

  const sourceRow=sourceRows[0];
  const oneTimeSessionId=clean(sourceRow?.id);
  const division=clean(sourceRow?.division).toLowerCase();
  const sourceSlot=Number(sourceRow?.time_slot||0);
  const actualSourceGroup=rowGroup(sourceRow);
  const sourceTimeText=rowVisibleTime(sourceRow,division,sourceMode);
  if(!oneTimeSessionId||!['elementary','kinder'].includes(division)||!Number.isInteger(sourceSlot)||sourceSlot<=0||!sourceTimeText){
    throw trialUpdateError('기존 체험 정보를 서버에서 확정하지 못했습니다.',500,'OLLI_AGENT_TRIAL_UPDATE_SOURCE_INVALID');
  }

  const requestedDivision=clean(guest?.division).toLowerCase();
  if(requestedDivision&&['elementary','kinder'].includes(requestedDivision)&&requestedDivision!==division){
    throw trialUpdateError('요청한 체험 수업 구분과 기존 체험 정보가 다릅니다.',409,'OLLI_AGENT_TRIAL_UPDATE_DIVISION_MISMATCH');
  }

  const targetTimeText=requestedTargetTime||sourceTimeText;
  const availability=await readScheduleAvailability({
    requestContext,
    division,
    purpose:'trial',
    startDate:targetDateValue.key,
    endDate:targetDateValue.key,
    timeSlot:0,
    classGroup:'ALL',
    sanitizePayload(payload){return payload;},
    callRpc,
  });

  if((availability.closed_dates||[]).some(row=>row.date===targetDateValue.key)){
    throw trialUpdateError('공휴일에는 체험수업을 변경할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.',409,'OLLI_AGENT_TRIAL_UPDATE_CLOSED_DAY');
  }

  const targetCandidates=(Array.isArray(availability.slots)?availability.slots:[])
    .filter(slot=>clean(slot?.date)===targetDateValue.key&&clean(slot?.time_label)===targetTimeText);
  if(!targetCandidates.length){
    throw trialUpdateError('변경할 날짜에는 요청한 체험 시간이 운영되지 않습니다.',404,'OLLI_AGENT_TRIAL_UPDATE_TARGET_TIME_NOT_AVAILABLE');
  }

  const target=chooseTargetCandidate(targetCandidates,requestedTargetGroup,actualSourceGroup);
  const targetSlot=Number(target?.time_slot||0);
  const actualTargetGroup=clean(target?.class_group).toUpperCase()==='B'?'B':'A';
  if(!Number.isInteger(targetSlot)||targetSlot<=0){
    throw trialUpdateError('변경할 체험 시간을 서버 시간표에서 확정하지 못했습니다.',500,'OLLI_AGENT_TRIAL_UPDATE_TARGET_SLOT_INVALID');
  }

  if(targetDateValue.key===sourceDateValue.key&&targetSlot===sourceSlot&&actualTargetGroup===actualSourceGroup){
    throw trialUpdateError('현재 체험 일정과 변경할 일정이 같습니다.',409,'OLLI_AGENT_TRIAL_UPDATE_NO_CHANGE');
  }

  if(target.available!==true||Number(target.remaining||0)<=0){
    throw trialUpdateError('변경할 날짜와 시간의 정원이 가득 찼습니다.',409,'OLLI_AGENT_TRIAL_UPDATE_TARGET_FULL');
  }

  const targetWeek=mondayKey(targetDateValue.key)===mondayKey(sourceDateValue.key)
    ? sourceWeek
    : await callRpc('olli_schedule_week',{...commonParams,p_week_start:mondayKey(targetDateValue.key)});
  if(!targetWeek?.ok){
    throw trialUpdateError(targetWeek?.message||'변경할 날짜의 시간표를 확인하지 못했습니다.',403,targetWeek?.code||'OLLI_AGENT_TRIAL_UPDATE_TARGET_WEEK_READ_FAILED');
  }

  const duplicate=(Array.isArray(targetWeek?.one_time_sessions)?targetWeek.one_time_sessions:[])
    .some(row=>
      clean(row?.id)!==oneTimeSessionId &&
      row?.is_guest===true &&
      clean(row?.session_type).toLowerCase()==='trial' &&
      sameGuest(row?.student_name,guestName) &&
      clean(row?.session_date).slice(0,10)===targetDateValue.key &&
      Number(row?.time_slot||0)===targetSlot &&
      rowGroup(row)===actualTargetGroup &&
      clean(row?.status).toLowerCase()!=='cancelled'
    );
  if(duplicate){
    throw trialUpdateError('같은 이름의 체험수업이 변경할 날짜와 시간에 이미 등록되어 있습니다.',409,'OLLI_AGENT_TRIAL_UPDATE_TARGET_DUPLICATE');
  }

  const replyId=replyToMessageId==null?null:Number(replyToMessageId);
  if(replyId!=null&&(!Number.isSafeInteger(replyId)||replyId<=0)){
    throw trialUpdateError('체험 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_TRIAL_SOURCE_MESSAGE_INVALID');
  }

  const actionPayload={
    intent:'update_trial',
    guestName,
    studentName:guestName,
    division,
    oneTimeSessionId,
    sourceSessionDate:sourceDateValue.key,
    sourceTimeSlot:sourceSlot,
    sourceClassGroup:actualSourceGroup,
    targetSessionDate:targetDateValue.key,
    targetTimeSlot:targetSlot,
    targetClassGroup:actualTargetGroup,
    isGuest:true,
  };
  const showGroup=requestedSourceGroup!=='AUTO'||requestedTargetGroup!=='AUTO'||actualSourceGroup!==actualTargetGroup||target?.grouped===true||actualSourceGroup==='B'||actualTargetGroup==='B';

  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:updatePrompt({
      guestName,
      sourceDate:sourceDateValue.key,
      sourceTime:sourceTimeText,
      sourceGroup:actualSourceGroup,
      targetDate:targetDateValue.key,
      targetTime:targetTimeText,
      targetGroup:actualTargetGroup,
      showGroup,
    }),
    p_action_type:'update_trial',
    p_action_payload:actionPayload,
    p_client_message_id:stableTrialUpdateActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });
  if(!sent?.ok||!sent?.message?.action){
    throw trialUpdateError(sent?.message||'체험 변경 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_TRIAL_UPDATE_ACTION_STORE_FAILED');
  }
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'update_trial',
    guest_label:label,
    division,
    source_date:sourceDateValue.key,
    source_time_label:sourceTimeText,
    source_class_group:actualSourceGroup,
    target_date:targetDateValue.key,
    target_time_label:targetTimeText,
    target_class_group:actualTargetGroup,
    timetable_mode:availability.timetable_mode,
  });
}

function createPrepareTrialUpdateTool({
  tool,z,requestContext,trialAccess,guestLabel,currentDate,requestId,
  replyToMessageId=null,capturePersistedMessage=null,sanitizePayload,
}){
  if(typeof tool!=='function'||!z){
    throw trialUpdateError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  }
  return tool({
    name:'prepare_trial_update',
    description:'비재원 체험수업의 날짜·시간·A/B반 변경을 실제 실행하지 않고 확인 카드로 준비합니다. 서버가 기존 체험 row와 대상 시간표를 다시 확인하며 확인 전에는 체험 데이터가 변경되지 않습니다.',
    parameters:z.object({
      source_date:z.string(),
      source_hour:z.number().int().min(0).max(12),
      source_minute:z.union([z.literal(0),z.literal(30)]),
      source_group:z.enum(['AUTO','A','B']),
      target_date:z.string(),
      target_hour:z.number().int().min(0).max(12),
      target_minute:z.union([z.literal(0),z.literal(30)]),
      target_group:z.enum(['AUTO','A','B']),
    }),
    async execute(args){
      const payload=await prepareTrialUpdateAction({
        requestContext,trialAccess,guestLabel,currentDate,requestId,
        replyToMessageId,capturePersistedMessage,sanitizePayload,
        sourceDate:args.source_date,
        sourceHour:args.source_hour,
        sourceMinute:args.source_minute,
        sourceGroup:args.source_group,
        targetDate:args.target_date,
        targetHour:args.target_hour,
        targetMinute:args.target_minute,
        targetGroup:args.target_group,
      });
      return JSON.stringify(payload);
    },
  });
}

module.exports={
  normalizeGroup,
  optionalTimeLabel,
  activeTrialRows,
  stableTrialUpdateActionClientMessageId,
  prepareTrialUpdateAction,
  createPrepareTrialUpdateTool,
};
