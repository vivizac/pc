'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {parseDateKey,mondayKey}=require('./pickup-prepare-tools.cjs');
const {normalizeTimetableMode,timeLabel,weekdayLabel}=require('./schedule-tools.cjs');
const {loadPrivateMakeupStudent}=require('./makeup-prepare-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}

function moveCancelError(message,statusCode=400,code='OLLI_AGENT_MOVE_CANCEL_PREPARE_ERROR'){
  const error=new Error(message);
  error.statusCode=statusCode;
  error.code=code;
  return error;
}

function requestedTimeLabel(hour,minute){
  const h=Number(hour||0);
  const m=Number(minute||0);
  if(h===0&&m===0) return '';
  if(!Number.isInteger(h)||h<1||h>12||![0,30].includes(m)){
    throw moveCancelError('기존 수업 시간을 확인해 주세요.',400,'OLLI_AGENT_MOVE_CANCEL_TIME_INVALID');
  }
  return String(h)+'시'+(m===30?' 30분':'');
}

function stableMoveCancelActionClientMessageId({academyId,memberId,requestId}){
  const request=clean(requestId);
  if(!request||request.length>160){
    throw moveCancelError('수업 이동 취소 준비 요청 식별값이 없습니다.',400,'OLLI_AGENT_MOVE_CANCEL_REQUEST_ID_REQUIRED');
  }
  const hex=crypto.createHash('sha256')
    .update(['olli-agent-move-cancel-v1',clean(academyId),clean(memberId),request,'cancel_move'].join('|'))
    .digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}

function previousDateKey(dateKey){
  const parsed=parseDateKey(dateKey);
  if(!parsed) return '';
  return new Date(parsed.timestamp-86400000).toISOString().slice(0,10);
}

function dateLabel(dateKey){
  const parsed=parseDateKey(dateKey);
  if(!parsed) return dateKey;
  const date=new Date(parsed.timestamp);
  return String(date.getUTCMonth()+1)+'월 '+String(date.getUTCDate())+'일';
}

function enrollmentById(weekData,id){
  const wanted=clean(id);
  if(!wanted) return null;
  return (Array.isArray(weekData?.enrollments)?weekData.enrollments:[])
    .find(row=>clean(row?.id)===wanted)||null;
}

function scheduleText(row,division,mode){
  if(!row) return '';
  const weekday=Number(row?.weekday||0);
  const slot=Number(row?.time_slot||0);
  const label=timeLabel(division,weekday,slot,mode);
  if(!weekdayLabel(weekday)||!clean(label)) return '';
  const group=clean(row?.class_group).toUpperCase()==='B'?'B':'A';
  const groupText=group==='B'?' '+group+'반':'';
  return weekdayLabel(weekday)+' '+label+groupText;
}

async function loadWeek({requestContext,dateKey,callRpc,cache}){
  const monday=mondayKey(dateKey);
  if(!monday) throw moveCancelError('수업 이동 예약 조회 날짜를 확인하지 못했습니다.',500,'OLLI_AGENT_MOVE_CANCEL_WEEK_DATE_INVALID');
  if(cache.has(monday)) return cache.get(monday);
  const week=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:monday,
  });
  if(!week?.ok){
    throw moveCancelError(week?.message||'수업 이동 예약을 확인하지 못했습니다.',403,week?.code||'OLLI_AGENT_MOVE_CANCEL_WEEK_READ_FAILED');
  }
  cache.set(monday,week);
  return week;
}

async function resolveMoveRows({rows,requestContext,division,callRpc,currentWeek}){
  const cache=new Map();
  cache.set(mondayKey(currentWeek?.week_start||''),currentWeek);
  const resolved=[];
  for(const row of rows){
    const effectiveDate=clean(row?.effective_date).slice(0,10);
    const parsed=parseDateKey(effectiveDate);
    if(!parsed) continue;
    const sourceDate=previousDateKey(effectiveDate);
    const [sourceWeek,targetWeek]=await Promise.all([
      loadWeek({requestContext,dateKey:sourceDate,callRpc,cache}),
      loadWeek({requestContext,dateKey:effectiveDate,callRpc,cache}),
    ]);
    const mode=normalizeTimetableMode(targetWeek?.timetable_mode||sourceWeek?.timetable_mode||currentWeek?.timetable_mode);
    resolved.push({
      row,
      effectiveDate,
      mode,
      source:enrollmentById(sourceWeek,row?.source_enrollment_id),
      target:enrollmentById(targetWeek,row?.target_enrollment_id),
    });
  }
  return resolved;
}

function cancelPrompt({studentName,effectiveDate,sourceText,targetText}){
  return [
    clean(studentName)+' · '+dateLabel(effectiveDate),
    (sourceText||'기존 수업')+' → '+(targetText||'변경 수업'),
    '예약된 수업 이동을 취소할까요?',
  ].join('\n');
}

async function prepareMoveCancelAction({
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  sourceWeekday=0,
  sourceHour=0,
  sourceMinute=0,
  changeId:selectedChangeId='',
  allowChoice=false,
  currentDate,
  requestId,
  replyToMessageId=null,
  capturePersistedMessage=null,
  sanitizePayload,
  callRpc=callSupabaseRpc,
}){
  if(typeof sanitizePayload!=='function'){
    throw moveCancelError('Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_MOVE_CANCEL_PRIVACY_MISSING');
  }

  const label=clean(studentLabel);
  const subject=subjectAccess?.resolve?.(label);
  if(!subject?.studentId){
    throw moveCancelError('현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',400,'OLLI_AGENT_SUBJECT_NOT_AVAILABLE');
  }

  const fixedDivision=clean(division).toLowerCase();
  if(!['elementary','kinder'].includes(fixedDivision)||clean(subject.division).toLowerCase()!==fixedDivision){
    throw moveCancelError('수업 이동 취소 학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_MOVE_CANCEL_DIVISION_MISMATCH');
  }

  const today=parseDateKey(currentDate);
  if(!today){
    throw moveCancelError('수업 이동 취소 기준 날짜를 확인하지 못했습니다.',500,'OLLI_AGENT_MOVE_CANCEL_CURRENT_DATE_INVALID');
  }

  const requestedWeekday=Number(sourceWeekday||0);
  if(!Number.isInteger(requestedWeekday)||requestedWeekday<0||requestedWeekday>6){
    throw moveCancelError('기존 수업 요일을 확인해 주세요.',400,'OLLI_AGENT_MOVE_CANCEL_WEEKDAY_INVALID');
  }
  const requestedTime=requestedTimeLabel(sourceHour,sourceMinute);
  const requestedChangeId=clean(selectedChangeId);

  const student=await loadPrivateMakeupStudent({
    requestContext,
    studentId:subject.studentId,
    expectedDivision:fixedDivision,
    callRpc,
  });

  const cache=new Map();
  const currentWeek=await loadWeek({
    requestContext,
    dateKey:today.key,
    callRpc,
    cache,
  });

  let rows=(Array.isArray(currentWeek?.changes)?currentWeek.changes:[])
    .filter(row=>
      clean(row?.student_id)===clean(subject.studentId) &&
      clean(row?.status).toLowerCase()==='scheduled' &&
      clean(row?.change_type).toLowerCase()==='move' &&
      clean(row?.effective_date).slice(0,10)>today.key
    )
    .sort((a,b)=>clean(a?.effective_date).localeCompare(clean(b?.effective_date)));

  if(!rows.length){
    throw moveCancelError('취소 가능한 수업 이동 예약을 찾지 못했습니다.',404,'OLLI_AGENT_MOVE_CANCEL_NOT_FOUND');
  }

  let resolved=await resolveMoveRows({
    rows,
    requestContext,
    division:fixedDivision,
    callRpc,
    currentWeek,
  });

  if(requestedWeekday){
    resolved=resolved.filter(item=>Number(item?.source?.weekday||0)===requestedWeekday);
  }
  if(requestedTime){
    resolved=resolved.filter(item=>{
      const source=item?.source;
      if(!source) return false;
      return clean(timeLabel(
        fixedDivision,
        Number(source?.weekday||0),
        Number(source?.time_slot||0),
        item.mode
      ))===requestedTime;
    });
  }
  if(requestedChangeId){
    resolved=resolved.filter(item=>clean(item?.row?.id)===requestedChangeId);
  }

  if(!resolved.length){
    throw moveCancelError('입력한 기존 수업과 일치하는 이동 예약을 찾지 못했습니다.',404,'OLLI_AGENT_MOVE_CANCEL_SOURCE_NOT_FOUND');
  }
  if(resolved.length>1){
    if(allowChoice===true){
      const choices=resolved.slice(0,8).map(item=>{
        const id=clean(item?.row?.id);
        const sourceText=scheduleText(item?.source,fixedDivision,item?.mode);
        const targetText=scheduleText(item?.target,fixedDivision,item?.mode);
        if(!id||!parseDateKey(item?.effectiveDate)) return null;
        return {
          id,
          label:dateLabel(item.effectiveDate)+' · '+(sourceText||'기존 수업')+' → '+(targetText||'변경 수업')
        };
      }).filter(Boolean);
      if(choices.length>1){
        return {
          ok:false,
          code:'target_choice_required',
          field:'target_choice',
          choiceKey:'changeId',
          studentName:student.name,
          choices,
          message:student.name+' 학생의 취소할 수업 이동 예약을 선택해 주세요.'
        };
      }
    }
    throw moveCancelError('취소할 수업 이동 예약이 여러 개 있습니다. 기존 수업 요일과 시간을 함께 알려 주세요.',409,'OLLI_AGENT_MOVE_CANCEL_AMBIGUOUS');
  }

  const item=resolved[0];
  const changeId=clean(item?.row?.id);
  if(!changeId||!parseDateKey(item.effectiveDate)){
    throw moveCancelError('취소할 수업 이동 예약을 서버에서 확정하지 못했습니다.',500,'OLLI_AGENT_MOVE_CANCEL_TARGET_INVALID');
  }

  const sourceWeekdayValue=Number(item?.source?.weekday||0);
  const sourceTimeSlot=Number(item?.source?.time_slot||0);
  const targetWeekday=Number(item?.target?.weekday||0);
  const targetTimeSlot=Number(item?.target?.time_slot||0);
  const sourceText=scheduleText(item.source,fixedDivision,item.mode);
  const targetText=scheduleText(item.target,fixedDivision,item.mode);

  const replyId=replyToMessageId==null?null:Number(replyToMessageId);
  if(replyId!=null&&(!Number.isSafeInteger(replyId)||replyId<=0)){
    throw moveCancelError('수업 이동 취소 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_MOVE_SOURCE_MESSAGE_INVALID');
  }

  const actionPayload={
    intent:'cancel_move',
    studentId:clean(subject.studentId),
    studentName:student.name,
    changeId,
    effectiveDate:item.effectiveDate,
    sourceWeekday:sourceWeekdayValue,
    sourceTimeSlot,
    targetWeekday,
    targetTimeSlot,
  };

  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:cancelPrompt({
      studentName:student.name,
      effectiveDate:item.effectiveDate,
      sourceText,
      targetText,
    }),
    p_action_type:'cancel_move',
    p_action_payload:actionPayload,
    p_client_message_id:stableMoveCancelActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if(!sent?.ok||!sent?.message?.action){
    throw moveCancelError(sent?.message||'수업 이동 취소 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_MOVE_CANCEL_ACTION_STORE_FAILED');
  }
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'cancel_move',
    student_label:label,
    effective_date:item.effectiveDate,
    source_weekday:sourceWeekdayValue,
    source_time_label:sourceText?sourceText.replace(/^\S+요일\s+/,'').replace(/\s+[AB]반$/,''):'',
    target_weekday:targetWeekday,
    target_time_label:targetText?targetText.replace(/^\S+요일\s+/,'').replace(/\s+[AB]반$/,''):'',
  });
}

function createPrepareMoveCancelTool({
  tool,z,requestContext,subjectAccess,studentLabel,division,currentDate,requestId,
  replyToMessageId=null,capturePersistedMessage=null,captureChoiceRequired=null,
  allowChoice=false,sanitizePayload,
}){
  if(typeof tool!=='function'||!z){
    throw moveCancelError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  }

  return tool({
    name:'prepare_move_cancel',
    description:'재원생의 미래 scheduled 정규수업 이동 예약을 실제 취소하지 않고 Team Chat 확인 카드로 준비합니다. 서버가 현재 예약과 source/target enrollment를 다시 확인하며 확인 전에는 시간표가 변경되지 않습니다.',
    parameters:z.object({
      source_weekday:z.number().int().min(0).max(6),
      source_hour:z.number().int().min(0).max(12),
      source_minute:z.union([z.literal(0),z.literal(30)]),
    }),
    async execute({source_weekday,source_hour,source_minute}){
      const payload=await prepareMoveCancelAction({
        requestContext,
        subjectAccess,
        studentLabel,
        division,
        sourceWeekday:source_weekday,
        sourceHour:source_hour,
        sourceMinute:source_minute,
        allowChoice,
        currentDate,
        requestId,
        replyToMessageId,
        capturePersistedMessage,
        sanitizePayload,
      });
      if(payload?.code==='target_choice_required'){
        if(typeof captureChoiceRequired==='function') captureChoiceRequired(payload);
        return JSON.stringify({
          ok:false,
          status:'choice_required',
          message:clean(payload.message)||'취소할 수업 이동 예약을 선택해 주세요.'
        });
      }
      return JSON.stringify(payload);
    },
  });
}

module.exports={
  requestedTimeLabel,
  stableMoveCancelActionClientMessageId,
  previousDateKey,
  enrollmentById,
  prepareMoveCancelAction,
  createPrepareMoveCancelTool,
};
