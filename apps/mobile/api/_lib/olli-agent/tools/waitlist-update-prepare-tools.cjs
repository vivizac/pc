'use strict';

const crypto = require('node:crypto');
const { callSupabaseRpc } = require('../supabase-rpc.cjs');
const { readScheduleAvailability } = require('./availability-tools.cjs');
const { normalizeTimetableMode, timeLabel } = require('./schedule-tools.cjs');
const { parseDateKey, mondayKey } = require('./pickup-prepare-tools.cjs');
const { loadPrivateMakeupStudent } = require('./makeup-prepare-tools.cjs');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function waitlistUpdateError(message, statusCode=400, code='OLLI_AGENT_WAITLIST_UPDATE_PREPARE_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeGroup(value, label='대기 반') {
  const group = clean(value).toUpperCase() || 'AUTO';
  if (!['AUTO','A','B'].includes(group)) {
    throw waitlistUpdateError(label + '을 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_UPDATE_GROUP_INVALID');
  }
  return group;
}

function visibleTime(hour, minute, label='대기 시간') {
  const h=Number(hour||0);
  const m=Number(minute||0);
  if(h===0&&m===0) return '';
  if(!Number.isInteger(h)||h<1||h>12||![0,30].includes(m)){
    throw waitlistUpdateError(label + '을 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_UPDATE_TIME_INVALID');
  }
  return String(h)+'시'+(m===30?' 30분':'');
}

function weekdayFromDateKey(value) {
  const parsed=parseDateKey(value);
  if(!parsed) return 0;
  const day=new Date(parsed.timestamp).getUTCDay();
  return day===0?7:day;
}

function weekdayLabel(value) {
  return ['', '월요일','화요일','수요일','목요일','금요일','토요일'][Number(value||0)] || '';
}

function rowGroup(row) {
  return clean(row?.target_class_group).toUpperCase()==='B'?'B':'A';
}

function rowDivision(row) {
  return clean(row?.target_division || row?.division).toLowerCase();
}

function rowTimeLabel(row, division, mode) {
  return timeLabel(division,Number(row?.target_weekday||0),Number(row?.target_time_slot||0),mode);
}

function nextOccurrenceOnOrAfter(dateKey, weekday) {
  const parsed=parseDateKey(dateKey);
  const target=Number(weekday||0);
  if(!parsed||target<1||target>6) return '';
  const current=weekdayFromDateKey(parsed.key);
  if(current<1||current>7) return '';
  const delta=(target-current+7)%7;
  return new Date(parsed.timestamp + delta*86400000).toISOString().slice(0,10);
}

function stableWaitlistUpdateActionClientMessageId({academyId,memberId,requestId}) {
  const request=clean(requestId);
  if(!request||request.length>160){
    throw waitlistUpdateError('대기 변경 준비 요청 식별값이 없습니다.',400,'OLLI_AGENT_WAITLIST_UPDATE_REQUEST_ID_REQUIRED');
  }
  const hex=crypto.createHash('sha256')
    .update(['olli-agent-waitlist-update-v1',clean(academyId),clean(memberId),request,'update_waitlist'].join('|'))
    .digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}

function chooseTarget(candidates, requestedGroup, sourceGroup) {
  if(!candidates.length){
    throw waitlistUpdateError('변경할 날짜에는 요청한 대기 시간이 운영되지 않습니다.',404,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_TIME_NOT_AVAILABLE');
  }
  if(requestedGroup!=='AUTO'){
    const rows=candidates.filter(row=>clean(row?.class_group).toUpperCase()===requestedGroup);
    if(rows.length!==1){
      throw waitlistUpdateError('변경할 대기 반을 하나로 확정하지 못했습니다.',409,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_AMBIGUOUS');
    }
    return rows[0];
  }
  if(candidates.length===1) return candidates[0];
  const preserved=candidates.filter(row=>clean(row?.class_group).toUpperCase()===sourceGroup);
  if(preserved.length===1) return preserved[0];
  throw waitlistUpdateError('변경할 시간은 A반과 B반으로 나뉘어 있습니다. 변경할 반을 함께 알려 주세요.',409,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_GROUP_REQUIRED');
}

function updatePrompt({studentName,sourceWeekday,sourceTime,sourceGroup,targetWeekday,targetTime,targetGroup,desiredEffectiveDate,showGroup}) {
  const sourceGroupText=showGroup?' '+sourceGroup+'반':'';
  const targetGroupText=showGroup?' '+targetGroup+'반':'';
  return [
    clean(studentName)+' · '+weekdayLabel(sourceWeekday)+' '+sourceTime+sourceGroupText,
    '→ '+weekdayLabel(targetWeekday)+' '+targetTime+targetGroupText,
    desiredEffectiveDate ? '적용일 · '+desiredEffectiveDate : '',
    '대기를 변경할까요?'
  ].filter(Boolean).join('\n');
}

async function prepareWaitlistUpdateAction({
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  sourceDate='',
  sourceWeekday=0,
  sourceHour=0,
  sourceMinute=0,
  sourceGroup='AUTO',
  targetDate='',
  targetWeekday=0,
  targetHour=0,
  targetMinute=0,
  targetGroup='AUTO',
  currentDate,
  requestId,
  replyToMessageId=null,
  capturePersistedMessage=null,
  sanitizePayload,
  callRpc=callSupabaseRpc,
}) {
  if(typeof sanitizePayload!=='function'){
    throw waitlistUpdateError('Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_WAITLIST_UPDATE_PRIVACY_MISSING');
  }
  const label=clean(studentLabel);
  const subject=subjectAccess?.resolve?.(label);
  if(!subject?.studentId){
    throw waitlistUpdateError('현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',400,'OLLI_AGENT_SUBJECT_NOT_AVAILABLE');
  }
  const fixedDivision=clean(division).toLowerCase();
  if(!['elementary','kinder'].includes(fixedDivision)||clean(subject.division).toLowerCase()!==fixedDivision){
    throw waitlistUpdateError('변경할 대기 학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_WAITLIST_UPDATE_DIVISION_MISMATCH');
  }

  const today=parseDateKey(currentDate);
  if(!today) throw waitlistUpdateError('대기 변경 기준 날짜를 확인하지 못했습니다.',500,'OLLI_AGENT_WAITLIST_UPDATE_CURRENT_DATE_INVALID');

  const parsedSourceDate=clean(sourceDate)?parseDateKey(sourceDate):null;
  if(clean(sourceDate)&&!parsedSourceDate) throw waitlistUpdateError('기존 대기 날짜를 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_UPDATE_SOURCE_DATE_INVALID');
  const parsedTargetDate=clean(targetDate)?parseDateKey(targetDate):null;
  if(clean(targetDate)&&!parsedTargetDate) throw waitlistUpdateError('변경할 대기 날짜를 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_DATE_INVALID');
  if(parsedTargetDate&&parsedTargetDate.timestamp<today.timestamp){
    throw waitlistUpdateError('지난 날짜로는 대기를 변경할 수 없습니다.',400,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_DATE_PAST');
  }

  const explicitSourceWeekday=Number(sourceWeekday||0);
  const sourceDateWeekday=parsedSourceDate?weekdayFromDateKey(parsedSourceDate.key):0;
  const wantedSourceWeekday=sourceDateWeekday||explicitSourceWeekday;
  if(wantedSourceWeekday===7||wantedSourceWeekday<0||wantedSourceWeekday>6){
    throw waitlistUpdateError('기존 대기 요일을 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_UPDATE_SOURCE_WEEKDAY_INVALID');
  }

  const explicitTargetWeekday=Number(targetWeekday||0);
  const targetDateWeekday=parsedTargetDate?weekdayFromDateKey(parsedTargetDate.key):0;
  if(targetDateWeekday===7){
    throw waitlistUpdateError('일요일 대기 수업은 지원하지 않습니다.',400,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_WEEKDAY_INVALID');
  }
  if(explicitTargetWeekday<0||explicitTargetWeekday>6){
    throw waitlistUpdateError('변경할 대기 요일을 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_WEEKDAY_INVALID');
  }

  const requestedSourceTime=visibleTime(sourceHour,sourceMinute,'기존 대기 시간');
  const requestedTargetTime=visibleTime(targetHour,targetMinute,'변경할 대기 시간');
  const requestedSourceGroup=normalizeGroup(sourceGroup,'기존 대기 반');
  const requestedTargetGroup=normalizeGroup(targetGroup,'변경할 대기 반');

  const student=await loadPrivateMakeupStudent({
    requestContext,
    studentId:subject.studentId,
    expectedDivision:fixedDivision,
    callRpc,
  });

  const weekData=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(today.key),
  });
  if(!weekData?.ok){
    throw waitlistUpdateError(weekData?.message||'현재 대기 정보를 확인하지 못했습니다.',403,weekData?.code||'OLLI_AGENT_WAITLIST_UPDATE_WEEK_READ_FAILED');
  }
  const sourceMode=normalizeTimetableMode(weekData?.timetable_mode);
  let rows=(Array.isArray(weekData?.waitlist)?weekData.waitlist:[]).filter(row=>
    clean(row?.student_id)===clean(subject.studentId) &&
    row?.is_guest!==true &&
    ['waiting','offered'].includes(clean(row?.status).toLowerCase())
  );

  if(wantedSourceWeekday) rows=rows.filter(row=>Number(row?.target_weekday||0)===wantedSourceWeekday);
  if(requestedSourceTime) rows=rows.filter(row=>clean(rowTimeLabel(row,fixedDivision,sourceMode))===requestedSourceTime);
  if(requestedSourceGroup!=='AUTO') rows=rows.filter(row=>rowGroup(row)===requestedSourceGroup);

  rows.sort((a,b)=>
    Number(a?.target_weekday||0)-Number(b?.target_weekday||0) ||
    Number(a?.target_time_slot||0)-Number(b?.target_time_slot||0) ||
    rowGroup(a).localeCompare(rowGroup(b))
  );
  if(!rows.length) throw waitlistUpdateError('변경할 기존 대기를 찾지 못했습니다.',404,'OLLI_AGENT_WAITLIST_UPDATE_SOURCE_NOT_FOUND');
  if(rows.length>1) throw waitlistUpdateError('변경할 대기가 여러 개 있습니다. 기존 요일과 시간을 함께 알려 주세요.',409,'OLLI_AGENT_WAITLIST_UPDATE_SOURCE_AMBIGUOUS');

  const sourceRow=rows[0];
  const waitlistId=clean(sourceRow?.id);
  const actualSourceWeekday=Number(sourceRow?.target_weekday||0);
  const sourceSlot=Number(sourceRow?.target_time_slot||0);
  const actualSourceGroup=rowGroup(sourceRow);
  const sourceTimeText=rowTimeLabel(sourceRow,fixedDivision,sourceMode);
  if(!waitlistId||actualSourceWeekday<1||actualSourceWeekday>6||!Number.isInteger(sourceSlot)||sourceSlot<=0||!sourceTimeText){
    throw waitlistUpdateError('기존 대기 정보를 서버에서 확정하지 못했습니다.',500,'OLLI_AGENT_WAITLIST_UPDATE_SOURCE_INVALID');
  }

  const resolvedTargetWeekday=targetDateWeekday||explicitTargetWeekday||actualSourceWeekday;
  if(resolvedTargetWeekday<1||resolvedTargetWeekday>6){
    throw waitlistUpdateError('변경할 대기 요일을 확인해 주세요.',400,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_WEEKDAY_REQUIRED');
  }

  const sourceEffective=clean(sourceRow?.desired_effective_date).slice(0,10);
  const validSourceEffective=parseDateKey(sourceEffective);
  const desiredEffectiveDate=parsedTargetDate
    ? parsedTargetDate.key
    : (validSourceEffective&&validSourceEffective.timestamp>=today.timestamp ? validSourceEffective.key : today.key);
  const targetCheckDate=parsedTargetDate
    ? parsedTargetDate.key
    : nextOccurrenceOnOrAfter(desiredEffectiveDate,resolvedTargetWeekday);
  if(!targetCheckDate){
    throw waitlistUpdateError('변경할 대기 날짜를 서버에서 확정하지 못했습니다.',500,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_DATE_RESOLVE_FAILED');
  }

  const targetTimeText=requestedTargetTime||sourceTimeText;
  const availability=await readScheduleAvailability({
    requestContext,
    division:fixedDivision,
    purpose:'wait',
    startDate:targetCheckDate,
    endDate:targetCheckDate,
    timeSlot:0,
    classGroup:'ALL',
    sanitizePayload(payload){return payload;},
    callRpc,
  });
  if((availability.closed_dates||[]).some(row=>row.date===targetCheckDate)){
    throw waitlistUpdateError('휴원일에는 대기 일정을 변경할 수 없습니다.',409,'OLLI_AGENT_WAITLIST_UPDATE_CLOSED_DAY');
  }
  const candidates=(Array.isArray(availability.slots)?availability.slots:[]).filter(slot=>
    clean(slot?.date)===targetCheckDate &&
    Number(slot?.weekday||0)===resolvedTargetWeekday &&
    clean(slot?.time_label)===targetTimeText
  );
  const target=chooseTarget(candidates,requestedTargetGroup,actualSourceGroup);
  const targetSlot=Number(target?.time_slot||0);
  const actualTargetGroup=clean(target?.class_group).toUpperCase()==='B'?'B':'A';
  if(!Number.isInteger(targetSlot)||targetSlot<=0){
    throw waitlistUpdateError('변경할 대기 시간을 서버 시간표에서 확정하지 못했습니다.',500,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_SLOT_INVALID');
  }

  const targetWeek=mondayKey(targetCheckDate)===mondayKey(today.key)
    ? weekData
    : await callRpc('olli_schedule_week',{
        p_session_token:requestContext.sessionToken,
        p_academy_id:requestContext.academyId,
        p_week_start:mondayKey(targetCheckDate),
      });
  if(!targetWeek?.ok){
    throw waitlistUpdateError(targetWeek?.message||'변경할 날짜의 대기 정보를 확인하지 못했습니다.',403,targetWeek?.code||'OLLI_AGENT_WAITLIST_UPDATE_TARGET_WEEK_READ_FAILED');
  }

  const conflicting=(Array.isArray(targetWeek?.waitlist)?targetWeek.waitlist:[]).some(row=>
    clean(row?.id)!==waitlistId &&
    ['waiting','offered'].includes(clean(row?.status).toLowerCase()) &&
    rowDivision(row)===fixedDivision &&
    Number(row?.target_weekday||0)===resolvedTargetWeekday &&
    Number(row?.target_time_slot||0)===targetSlot &&
    rowGroup(row)===actualTargetGroup
  );
  if(conflicting){
    throw waitlistUpdateError('변경할 시간에는 이미 다른 대기 학생이 있습니다.',409,'OLLI_AGENT_WAITLIST_UPDATE_TARGET_OCCUPIED');
  }

  if(
    actualSourceWeekday===resolvedTargetWeekday &&
    sourceSlot===targetSlot &&
    actualSourceGroup===actualTargetGroup &&
    clean(sourceEffective)===desiredEffectiveDate
  ){
    throw waitlistUpdateError('현재 대기 정보와 변경할 정보가 같습니다.',409,'OLLI_AGENT_WAITLIST_UPDATE_NO_CHANGE');
  }

  const replyId=replyToMessageId==null?null:Number(replyToMessageId);
  if(replyId!=null&&(!Number.isSafeInteger(replyId)||replyId<=0)){
    throw waitlistUpdateError('대기 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_INVALID');
  }

  const actionPayload={
    intent:'update_waitlist',
    studentId:clean(subject.studentId),
    studentName:student.name,
    division:fixedDivision,
    waitlistId,
    sourceWeekday:actualSourceWeekday,
    sourceTimeSlot:sourceSlot,
    sourceClassGroup:actualSourceGroup,
    targetWeekday:resolvedTargetWeekday,
    targetTimeSlot:targetSlot,
    targetClassGroup:actualTargetGroup,
    desiredEffectiveDate,
    isGuest:false,
  };
  const showGroup=requestedSourceGroup!=='AUTO'||requestedTargetGroup!=='AUTO'||actualSourceGroup!==actualTargetGroup||target?.grouped===true||actualSourceGroup==='B'||actualTargetGroup==='B';
  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:updatePrompt({
      studentName:student.name,
      sourceWeekday:actualSourceWeekday,
      sourceTime:sourceTimeText,
      sourceGroup:actualSourceGroup,
      targetWeekday:resolvedTargetWeekday,
      targetTime:targetTimeText,
      targetGroup:actualTargetGroup,
      desiredEffectiveDate,
      showGroup,
    }),
    p_action_type:'update_waitlist',
    p_action_payload:actionPayload,
    p_client_message_id:stableWaitlistUpdateActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });
  if(!sent?.ok||!sent?.message?.action){
    throw waitlistUpdateError(sent?.message||'대기 변경 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_WAITLIST_UPDATE_ACTION_STORE_FAILED');
  }
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'update_waitlist',
    student_label:label,
    source_weekday:actualSourceWeekday,
    source_weekday_label:weekdayLabel(actualSourceWeekday),
    source_time_label:sourceTimeText,
    source_class_group:actualSourceGroup,
    target_weekday:resolvedTargetWeekday,
    target_weekday_label:weekdayLabel(resolvedTargetWeekday),
    target_time_label:targetTimeText,
    target_class_group:actualTargetGroup,
    desired_effective_date:desiredEffectiveDate,
    timetable_mode:availability.timetable_mode,
  });
}

function createPrepareWaitlistUpdateTool({
  tool,z,requestContext,subjectAccess,studentLabel,division,currentDate,requestId,
  replyToMessageId=null,capturePersistedMessage=null,sanitizePayload,
}) {
  if(typeof tool!=='function'||!z){
    throw waitlistUpdateError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  }
  return tool({
    name:'prepare_waitlist_update',
    description:'재원생의 기존 대기 날짜·요일·시간·A/B반 변경을 실제 실행하지 않고 확인 카드로 준비합니다. 서버가 기존 대기 row와 대상 시간표를 다시 확인하며 확인 전에는 대기 데이터가 변경되지 않습니다.',
    parameters:z.object({
      source_date:z.string(),
      source_weekday:z.number().int().min(0).max(6),
      source_hour:z.number().int().min(0).max(12),
      source_minute:z.union([z.literal(0),z.literal(30)]),
      source_group:z.enum(['AUTO','A','B']),
      target_date:z.string(),
      target_weekday:z.number().int().min(0).max(6),
      target_hour:z.number().int().min(0).max(12),
      target_minute:z.union([z.literal(0),z.literal(30)]),
      target_group:z.enum(['AUTO','A','B']),
    }),
    async execute(args){
      const payload=await prepareWaitlistUpdateAction({
        requestContext,subjectAccess,studentLabel,division,currentDate,requestId,
        replyToMessageId,capturePersistedMessage,sanitizePayload,
        sourceDate:args.source_date,
        sourceWeekday:args.source_weekday,
        sourceHour:args.source_hour,
        sourceMinute:args.source_minute,
        sourceGroup:args.source_group,
        targetDate:args.target_date,
        targetWeekday:args.target_weekday,
        targetHour:args.target_hour,
        targetMinute:args.target_minute,
        targetGroup:args.target_group,
      });
      return JSON.stringify(payload);
    }
  });
}

module.exports={
  visibleTime,
  weekdayFromDateKey,
  nextOccurrenceOnOrAfter,
  stableWaitlistUpdateActionClientMessageId,
  chooseTarget,
  prepareWaitlistUpdateAction,
  createPrepareWaitlistUpdateTool,
};
