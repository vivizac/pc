'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {parseDateKey,mondayKey}=require('./pickup-prepare-tools.cjs');
const {normalizeTimetableMode,timeLabel}=require('./schedule-tools.cjs');
const {loadPrivateMakeupStudent}=require('./makeup-prepare-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}

function absenceError(message,statusCode=400,code='OLLI_AGENT_ABSENCE_PREPARE_ERROR'){
  const error=new Error(message);
  error.statusCode=statusCode;
  error.code=code;
  return error;
}

function normalizeAbsenceReason(value){
  const reason=clean(value)
    .replace(/^(?:사유|이유)\s*(?:는|은)?\s*[:：-]?\s*/i,'')
    .replace(/[.!?]+$/g,'')
    .trim();
  if(!reason||reason.length>300){
    throw absenceError('결석 사유를 확인해 주세요.',400,'OLLI_AGENT_ABSENCE_REASON_REQUIRED');
  }
  if(/^(?:결석|결석처리|처리|확인|취소)$/i.test(reason.replace(/\s+/g,''))){
    throw absenceError('결석 사유를 구체적으로 알려 주세요.',400,'OLLI_AGENT_ABSENCE_REASON_REQUIRED');
  }
  return reason;
}

function normalizeGroup(value){
  const group=clean(value).toUpperCase()||'AUTO';
  if(!['AUTO','A','B'].includes(group)){
    throw absenceError('결석 처리할 반을 확인해 주세요.',400,'OLLI_AGENT_ABSENCE_GROUP_INVALID');
  }
  return group;
}

function visibleTime(hour,minute){
  const h=Number(hour||0);
  const m=Number(minute||0);
  if(h===0&&m===0) return '';
  if(!Number.isInteger(h)||h<1||h>12||![0,30].includes(m)){
    throw absenceError('결석 처리할 수업 시간을 확인해 주세요.',400,'OLLI_AGENT_ABSENCE_TIME_INVALID');
  }
  return String(h)+'시'+(m===30?' 30분':'');
}

function rowEffectiveOn(row,dateKey){
  const from=clean(row?.effective_from).slice(0,10);
  const to=clean(row?.effective_to).slice(0,10);
  return (!from||from<=dateKey)&&(!to||to>=dateKey);
}

function stableAbsenceActionClientMessageId({academyId,memberId,requestId}){
  const request=clean(requestId);
  if(!request||request.length>180){
    throw absenceError('결석 준비 요청 식별값이 없습니다.',400,'OLLI_AGENT_ABSENCE_REQUEST_ID_REQUIRED');
  }
  const hex=crypto.createHash('sha256')
    .update(['olli-agent-absence-v1',clean(academyId),clean(memberId),request,'mark_absent'].join('|'))
    .digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}

function dateLabel(dateKey){
  const parsed=parseDateKey(dateKey);
  if(!parsed) return dateKey;
  const d=new Date(parsed.timestamp);
  return String(d.getUTCMonth()+1)+'월 '+String(d.getUTCDate())+'일';
}

function actionPrompt({studentName,sessionDate,timeText,reason}){
  return [
    clean(studentName)+' · '+dateLabel(sessionDate)+' '+clean(timeText),
    '결석 사유: '+clean(reason),
    '결석 처리할까요?',
  ].join('\n');
}

async function prepareAbsenceAction({
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  sessionDate='',
  classHour=0,
  classMinute=0,
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
    throw absenceError('Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_ABSENCE_PRIVACY_MISSING');
  }

  const label=clean(studentLabel);
  const subject=subjectAccess?.resolve?.(label);
  if(!subject?.studentId){
    throw absenceError('현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',400,'OLLI_AGENT_SUBJECT_NOT_AVAILABLE');
  }

  const fixedDivision=clean(division).toLowerCase();
  if(!['elementary','kinder'].includes(fixedDivision)||clean(subject.division).toLowerCase()!==fixedDivision){
    throw absenceError('결석 처리 학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_ABSENCE_DIVISION_MISMATCH');
  }

  const today=parseDateKey(currentDate);
  const targetDate=parseDateKey(clean(sessionDate)||currentDate);
  if(!today||!targetDate){
    throw absenceError('결석 처리 날짜를 확인해 주세요.',400,'OLLI_AGENT_ABSENCE_DATE_INVALID');
  }
  const weekday=new Date(targetDate.timestamp).getUTCDay() || 7;
  if(weekday<1||weekday>6){
    throw absenceError('일요일에는 정규수업 결석 처리를 할 수 없습니다.',400,'OLLI_AGENT_ABSENCE_WEEKDAY_INVALID');
  }

  const requestedTime=visibleTime(classHour,classMinute);
  const requestedGroup=normalizeGroup(classGroup);
  const normalizedReason=normalizeAbsenceReason(reason);

  const student=await loadPrivateMakeupStudent({
    requestContext,
    studentId:subject.studentId,
    expectedDivision:fixedDivision,
    callRpc,
  });

  const week=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(targetDate.key),
  });
  if(!week?.ok){
    throw absenceError(week?.message||'학생의 정규수업을 확인하지 못했습니다.',403,week?.code||'OLLI_AGENT_ABSENCE_WEEK_READ_FAILED');
  }

  const mode=normalizeTimetableMode(week?.timetable_mode);
  let rows=(Array.isArray(week?.enrollments)?week.enrollments:[])
    .filter(row=>
      clean(row?.student_id)===clean(subject.studentId) &&
      Number(row?.weekday||0)===weekday &&
      clean(row?.status).toLowerCase()==='active' &&
      rowEffectiveOn(row,targetDate.key)
    );

  if(requestedTime){
    rows=rows.filter(row=>
      clean(timeLabel(
        fixedDivision,
        weekday,
        Number(row?.time_slot||0),
        mode
      ))===requestedTime
    );
  }

  if(requestedGroup!=='AUTO'){
    rows=rows.filter(row=>clean(row?.class_group).toUpperCase()===requestedGroup);
  }

  rows.sort((a,b)=>Number(a?.time_slot||0)-Number(b?.time_slot||0));

  if(!rows.length){
    throw absenceError(
      '입력한 날짜와 시간의 정규수업을 찾지 못했습니다.',
      404,
      'OLLI_AGENT_ABSENCE_SESSION_NOT_FOUND'
    );
  }
  if(rows.length>1){
    throw absenceError(
      '해당 날짜에 정규수업이 여러 개 있습니다. 결석 처리할 시간을 함께 알려 주세요.',
      409,
      'OLLI_AGENT_ABSENCE_SESSION_AMBIGUOUS'
    );
  }

  const target=rows[0];
  const timeSlot=Number(target?.time_slot||0);
  const targetGroup=clean(target?.class_group).toUpperCase()==='B'?'B':'A';
  const targetTime=clean(timeLabel(fixedDivision,weekday,timeSlot,mode));
  if(!Number.isInteger(timeSlot)||timeSlot<=0||!targetTime){
    throw absenceError('정규수업 시간을 서버에서 확정하지 못했습니다.',500,'OLLI_AGENT_ABSENCE_SLOT_INVALID');
  }

  const replyId=replyToMessageId==null?null:Number(replyToMessageId);
  if(replyId!=null&&(!Number.isSafeInteger(replyId)||replyId<=0)){
    throw absenceError('결석 사유 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_ABSENCE_REASON_MESSAGE_INVALID');
  }

  const actionPayload={
    intent:'mark_absent',
    studentId:clean(subject.studentId),
    studentName:student.name,
    division:fixedDivision,
    sessionDate:targetDate.key,
    timeSlot,
    classGroup:targetGroup,
    reason:normalizedReason,
  };

  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:actionPrompt({
      studentName:student.name,
      sessionDate:targetDate.key,
      timeText:targetTime,
      reason:normalizedReason,
    }),
    p_action_type:'mark_absent',
    p_action_payload:actionPayload,
    p_client_message_id:stableAbsenceActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if(!sent?.ok||!sent?.message?.action){
    throw absenceError(sent?.message||'결석 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_ABSENCE_ACTION_STORE_FAILED');
  }
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'mark_absent',
    student_label:label,
    division:fixedDivision,
    session_date:targetDate.key,
    time_label:targetTime,
    class_group:targetGroup,
    timetable_mode:mode,
  });
}

function createPrepareAbsenceTool({
  tool,z,requestContext,subjectAccess,studentLabel,division,classGroup,reason,currentDate,requestId,
  replyToMessageId=null,capturePersistedMessage=null,sanitizePayload,
}){
  if(typeof tool!=='function'||!z){
    throw absenceError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  }

  return tool({
    name:'prepare_absence',
    description:'재원생의 정규수업 결석을 실제 실행하지 않고 Team Chat 확인 카드로 준비합니다. 서버가 현재 정규수업을 다시 확인하고 결석 사유는 서버에만 보관하며, 확인 전에는 출결과 메모가 변경되지 않습니다.',
    parameters:z.object({
      session_date:z.string(),
      class_hour:z.number().int().min(0).max(12),
      class_minute:z.union([z.literal(0),z.literal(30)]),
    }),
    async execute({session_date,class_hour,class_minute}){
      const payload=await prepareAbsenceAction({
        requestContext,
        subjectAccess,
        studentLabel,
        division,
        sessionDate:session_date,
        classHour:class_hour,
        classMinute:class_minute,
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
  normalizeAbsenceReason,
  normalizeGroup,
  visibleTime,
  rowEffectiveOn,
  stableAbsenceActionClientMessageId,
  prepareAbsenceAction,
  createPrepareAbsenceTool,
};
