'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {readScheduleAvailability}=require('./availability-tools.cjs');
const {parseDateKey,mondayKey,nextOccurrenceKey}=require('./pickup-prepare-tools.cjs');
const {normalizeTimetableMode,timeLabel,weekdayLabel}=require('./schedule-tools.cjs');
const {loadPrivateMakeupStudent}=require('./makeup-prepare-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}

function movePrepareError(message,statusCode=400,code='OLLI_AGENT_MOVE_PREPARE_ERROR'){
  const error=new Error(message);
  error.statusCode=statusCode;
  error.code=code;
  return error;
}

function visibleTime(hour,minute,label){
  const h=Number(hour||0);
  const m=Number(minute||0);
  if(!Number.isInteger(h)||h<1||h>12||![0,30].includes(m)){
    throw movePrepareError((label||'수업')+' 시간을 확인해 주세요.',400,'OLLI_AGENT_MOVE_TIME_INVALID');
  }
  return String(h)+'시'+(m===30?' 30분':'');
}

function normalizeTargetGroup(value){
  const group=clean(value).toUpperCase()||'AUTO';
  if(!['AUTO','A','B'].includes(group)){
    throw movePrepareError('이동할 반을 확인해 주세요.',400,'OLLI_AGENT_MOVE_GROUP_INVALID');
  }
  return group;
}

function stableMoveActionClientMessageId({academyId,memberId,requestId}){
  const request=clean(requestId);
  if(!request||request.length>160){
    throw movePrepareError('수업 이동 준비 요청 식별값이 없습니다.',400,'OLLI_AGENT_MOVE_REQUEST_ID_REQUIRED');
  }
  const hex=crypto.createHash('sha256')
    .update(['olli-agent-move-v1',clean(academyId),clean(memberId),request,'move_class'].join('|'))
    .digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}

function effectiveOn(row,dateKey){
  const from=clean(row?.effective_from).slice(0,10);
  const to=clean(row?.effective_to).slice(0,10);
  return (!from||from<=dateKey)&&(!to||to>=dateKey);
}

function rowGroup(row){
  return clean(row?.class_group).toUpperCase()==='B'?'B':'A';
}

function actionPrompt({studentName,sourceWeekday,sourceTime,targetWeekday,targetTime,targetGroup,grouped}){
  const groupText=grouped?' '+targetGroup+'반':'';
  return [
    clean(studentName)+' · '+weekdayLabel(sourceWeekday)+' '+clean(sourceTime)+' → '+weekdayLabel(targetWeekday)+' '+clean(targetTime)+groupText,
    '정규수업 시간을 변경할까요?',
  ].join('\n');
}

async function prepareMoveAction({
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  sourceWeekday,
  sourceHour,
  sourceMinute,
  targetWeekday,
  targetHour,
  targetMinute,
  targetClassGroup='AUTO',
  currentDate,
  requestId,
  replyToMessageId=null,
  capturePersistedMessage=null,
  sanitizePayload,
  callRpc=callSupabaseRpc,
}){
  if(typeof sanitizePayload!=='function'){
    throw movePrepareError('Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_MOVE_PRIVACY_MISSING');
  }

  const label=clean(studentLabel);
  const subject=subjectAccess?.resolve?.(label);
  if(!subject?.studentId){
    throw movePrepareError('현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',400,'OLLI_AGENT_SUBJECT_NOT_AVAILABLE');
  }

  const fixedDivision=clean(division).toLowerCase();
  if(!['elementary','kinder'].includes(fixedDivision)||clean(subject.division).toLowerCase()!==fixedDivision){
    throw movePrepareError('수업 이동 학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_MOVE_DIVISION_MISMATCH');
  }

  const today=parseDateKey(currentDate);
  if(!today){
    throw movePrepareError('수업 이동 기준 날짜를 확인하지 못했습니다.',500,'OLLI_AGENT_MOVE_CURRENT_DATE_INVALID');
  }

  const sourceDay=Number(sourceWeekday||0);
  const targetDay=Number(targetWeekday||0);
  if(!Number.isInteger(sourceDay)||sourceDay<1||sourceDay>6||!Number.isInteger(targetDay)||targetDay<1||targetDay>6){
    throw movePrepareError('이동할 기존 요일과 새 요일을 확인해 주세요.',400,'OLLI_AGENT_MOVE_WEEKDAY_INVALID');
  }

  const sourceTime=visibleTime(sourceHour,sourceMinute,'기존 수업');
  const targetTime=visibleTime(targetHour,targetMinute,'새 수업');
  const requestedGroup=normalizeTargetGroup(targetClassGroup);

  const student=await loadPrivateMakeupStudent({
    requestContext,
    studentId:subject.studentId,
    expectedDivision:fixedDivision,
    callRpc,
  });

  const week=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(today.key),
  });
  if(!week?.ok){
    throw movePrepareError(week?.message||'현재 학생 시간표를 확인하지 못했습니다.',403,week?.code||'OLLI_AGENT_MOVE_WEEK_READ_FAILED');
  }

  const mode=normalizeTimetableMode(week?.timetable_mode);
  let sources=(Array.isArray(week?.enrollments)?week.enrollments:[])
    .filter(row=>
      clean(row?.student_id)===clean(subject.studentId) &&
      effectiveOn(row,today.key) &&
      Number(row?.weekday||0)===sourceDay
    )
    .filter(row=>clean(timeLabel(fixedDivision,sourceDay,Number(row?.time_slot||0),mode))===sourceTime);

  if(!sources.length){
    throw movePrepareError('입력한 기존 정규수업을 찾지 못했습니다.',404,'OLLI_AGENT_MOVE_SOURCE_NOT_FOUND');
  }
  if(sources.length>1){
    throw movePrepareError('같은 요일과 시간의 기존 수업이 여러 개 있습니다. 학생 시간표를 확인해 주세요.',409,'OLLI_AGENT_MOVE_SOURCE_AMBIGUOUS');
  }

  const source=sources[0];
  const sourceSlot=Number(source?.time_slot||0);
  const sourceGroup=rowGroup(source);
  if(!clean(source?.id)||!Number.isInteger(sourceSlot)||sourceSlot<=0){
    throw movePrepareError('기존 정규수업을 서버에서 확정하지 못했습니다.',500,'OLLI_AGENT_MOVE_SOURCE_INVALID');
  }

  const activeEnrollments=(Array.isArray(week?.enrollments)?week.enrollments:[])
    .filter(row=>clean(row?.student_id)===clean(subject.studentId)&&effectiveOn(row,today.key));

  const targetDate=nextOccurrenceKey(today.key,targetDay);
  if(!parseDateKey(targetDate)){
    throw movePrepareError('새 수업 적용 요일을 계산하지 못했습니다.',500,'OLLI_AGENT_MOVE_TARGET_DATE_INVALID');
  }

  const availability=await readScheduleAvailability({
    requestContext,
    division:fixedDivision,
    purpose:'regular',
    startDate:targetDate,
    endDate:targetDate,
    timeSlot:0,
    classGroup:'ALL',
    sanitizePayload(payload){return payload;},
    callRpc,
  });

  if((availability.closed_dates||[]).some(row=>clean(row?.date)===targetDate)){
    throw movePrepareError('휴원일에는 정규수업을 이동할 수 없습니다.',409,'OLLI_AGENT_MOVE_CLOSED_DAY');
  }

  const allCandidates=(Array.isArray(availability.slots)?availability.slots:[])
    .filter(slot=>
      clean(slot?.date)===targetDate &&
      Number(slot?.weekday||0)===targetDay &&
      clean(slot?.time_label)===targetTime
    );

  if(!allCandidates.length){
    throw movePrepareError('요청한 새 수업 시간은 현재 운영하지 않습니다.',404,'OLLI_AGENT_MOVE_TARGET_NOT_OPERATING');
  }

  const targetSlotValues=[...new Set(allCandidates.map(slot=>Number(slot?.time_slot||0)).filter(v=>Number.isInteger(v)&&v>0))];
  if(targetSlotValues.length!==1){
    throw movePrepareError('새 수업 시간을 서버 시간표에서 하나로 확정하지 못했습니다.',409,'OLLI_AGENT_MOVE_TARGET_SLOT_AMBIGUOUS');
  }
  const targetSlot=targetSlotValues[0];

  if(sourceDay===targetDay&&sourceSlot===targetSlot){
    throw movePrepareError('현재 수업과 같은 요일·시간입니다.',409,'OLLI_AGENT_MOVE_SAME_SLOT');
  }

  const existingTarget=activeEnrollments.some(row=>
    clean(row?.id)!==clean(source?.id) &&
    Number(row?.weekday||0)===targetDay &&
    Number(row?.time_slot||0)===targetSlot
  );
  if(existingTarget){
    throw movePrepareError('이미 같은 요일과 시간에 다른 정규수업이 있습니다.',409,'OLLI_AGENT_MOVE_TARGET_ALREADY_ENROLLED');
  }

  const openCandidates=allCandidates.filter(slot=>slot?.available===true&&Number(slot?.remaining||0)>0);
  let target=null;

  if(requestedGroup!=='AUTO'){
    target=openCandidates.find(slot=>clean(slot?.class_group).toUpperCase()===requestedGroup)||null;
    if(!target){
      const operating=allCandidates.some(slot=>clean(slot?.class_group).toUpperCase()===requestedGroup);
      throw movePrepareError(
        operating?'요청한 반은 현재 정원이 가득 찼습니다.':'요청한 반은 현재 운영하지 않습니다.',
        409,
        operating?'OLLI_AGENT_MOVE_TARGET_FULL':'OLLI_AGENT_MOVE_GROUP_NOT_AVAILABLE'
      );
    }
  }else if(openCandidates.length===1){
    target=openCandidates[0];
  }else if(openCandidates.length>1){
    target=openCandidates.find(slot=>clean(slot?.class_group).toUpperCase()===sourceGroup)||null;
    if(!target){
      throw movePrepareError('새 수업 시간이 A/B반으로 나뉘어 있습니다. 이동할 반을 함께 알려 주세요.',409,'OLLI_AGENT_MOVE_GROUP_REQUIRED');
    }
  }else{
    throw movePrepareError('요청한 새 수업 시간은 현재 정원이 가득 찼습니다.',409,'OLLI_AGENT_MOVE_TARGET_FULL');
  }

  const targetGroup=clean(target?.class_group).toUpperCase()==='B'?'B':'A';
  const replyId=replyToMessageId==null?null:Number(replyToMessageId);
  if(replyId!=null&&(!Number.isSafeInteger(replyId)||replyId<=0)){
    throw movePrepareError('수업 이동 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_MOVE_SOURCE_MESSAGE_INVALID');
  }

  const actionPayload={
    intent:'move_class',
    studentId:clean(subject.studentId),
    studentName:student.name,
    division:fixedDivision,
    sourceEnrollmentId:clean(source.id),
    sourceWeekday:sourceDay,
    sourceTimeSlot:sourceSlot,
    targetWeekday:targetDay,
    targetTimeSlot:targetSlot,
    targetClassGroup:targetGroup,
    targetCheckDate:targetDate,
    effectiveDate:today.key,
  };

  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:actionPrompt({
      studentName:student.name,
      sourceWeekday:sourceDay,
      sourceTime,
      targetWeekday:targetDay,
      targetTime,
      targetGroup,
      grouped:target?.grouped===true,
    }),
    p_action_type:'move_class',
    p_action_payload:actionPayload,
    p_client_message_id:stableMoveActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if(!sent?.ok||!sent?.message?.action){
    throw movePrepareError(sent?.message||'수업 이동 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_MOVE_ACTION_STORE_FAILED');
  }
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'move_class',
    student_label:label,
    source_weekday:sourceDay,
    source_time_label:sourceTime,
    source_class_group:sourceGroup,
    target_weekday:targetDay,
    target_time_label:targetTime,
    target_class_group:targetGroup,
    effective_date:today.key,
    target_check_date:targetDate,
    timetable_mode:availability.timetable_mode,
  });
}

function createPrepareMoveTool({
  tool,z,requestContext,subjectAccess,studentLabel,division,currentDate,requestId,
  replyToMessageId=null,capturePersistedMessage=null,sanitizePayload,
}){
  if(typeof tool!=='function'||!z){
    throw movePrepareError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  }

  return tool({
    name:'prepare_move_class',
    description:'재원생의 정규수업 이동을 실제 실행하지 않고 Team Chat 확인 카드로 준비합니다. 서버가 현재 source enrollment와 대상 시간의 운영·정원·A/B반을 다시 확인하며 확인 전에는 시간표가 변경되지 않습니다.',
    parameters:z.object({
      source_weekday:z.number().int().min(1).max(6),
      source_hour:z.number().int().min(1).max(12),
      source_minute:z.union([z.literal(0),z.literal(30)]),
      target_weekday:z.number().int().min(1).max(6),
      target_hour:z.number().int().min(1).max(12),
      target_minute:z.union([z.literal(0),z.literal(30)]),
      target_class_group:z.enum(['AUTO','A','B']),
    }),
    async execute({
      source_weekday,source_hour,source_minute,
      target_weekday,target_hour,target_minute,target_class_group,
    }){
      const payload=await prepareMoveAction({
        requestContext,
        subjectAccess,
        studentLabel,
        division,
        sourceWeekday:source_weekday,
        sourceHour:source_hour,
        sourceMinute:source_minute,
        targetWeekday:target_weekday,
        targetHour:target_hour,
        targetMinute:target_minute,
        targetClassGroup:target_class_group,
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
  visibleTime,
  normalizeTargetGroup,
  stableMoveActionClientMessageId,
  effectiveOn,
  prepareMoveAction,
  createPrepareMoveTool,
};
