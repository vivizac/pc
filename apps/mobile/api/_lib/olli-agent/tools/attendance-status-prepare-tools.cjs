'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {normalizeTimetableMode,timeLabel}=require('./schedule-tools.cjs');
const {resolveDateSpec,mondayKey,isoWeekday}=require('./timetable-read-tools.cjs');
const {encodeVisibleSlot}=require('./timetable-admin-prepare-tools.cjs');
const {finalSessionStatus}=require('./attendance-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}
function attendanceStatusError(message,statusCode=400,code='OLLI_AGENT_ATTENDANCE_STATUS_ERROR'){
  const error=new Error(message);error.statusCode=statusCode;error.code=code;return error;
}
function effectiveOn(row,dateKey){
  const from=clean(row?.effective_from).slice(0,10);
  const to=clean(row?.effective_to).slice(0,10);
  return (!from||from<=dateKey)&&(!to||to>=dateKey);
}
function dateDisplay(value){
  const m=clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?Number(m[2])+'월 '+Number(m[3])+'일':clean(value);
}
function parseDateKey(value){
  const raw=clean(value);
  const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match) return null;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const timestamp=Date.UTC(year,month-1,day);
  const date=new Date(timestamp);
  if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day) return null;
  return {key:raw,year,month,day,timestamp};
}
function resolveAttendanceDateSpec(spec,todayKey){
  const today=parseDateKey(todayKey);
  if(!today) return '';
  if(!spec||typeof spec!=='object') return today.key;
  const mode=clean(spec.mode);
  if(mode==='today') return today.key;
  if(mode==='tomorrow') return new Date(today.timestamp+86400000).toISOString().slice(0,10);
  if(mode==='month_day'){
    const month=Number(spec.month||0),day=Number(spec.day||0);
    const key=String(today.year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    return parseDateKey(key)?.key||'';
  }
  if(mode==='day_of_month'){
    const day=Number(spec.day||0);
    const key=String(today.year).padStart(4,'0')+'-'+String(today.month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    return parseDateKey(key)?.key||'';
  }
  return resolveDateSpec(spec,today.key);
}
function statusLabel(status){
  if(status==='present') return '출석';
  if(status==='absent') return '결석';
  if(status==='makeup') return '보강';
  return '빈칸';
}
function stableAttendanceStatusClientMessageId({academyId,memberId,requestId}){
  const request=clean(requestId);
  if(!request) throw attendanceStatusError('출석부 변경 요청 식별값이 없습니다.',400,'OLLI_AGENT_ATTENDANCE_STATUS_REQUEST_ID_REQUIRED');
  const hex=crypto.createHash('sha256').update([
    'olli-agent-attendance-status-v1',clean(academyId),clean(memberId),request,'set_attendance_status'
  ].join('|')).digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}
function normalizedGroup(value){
  const group=clean(value).toUpperCase();
  if(!group) return '';
  if(!['A','B'].includes(group)) throw attendanceStatusError('출석부를 변경할 A/B반을 확인해 주세요.',400,'OLLI_AGENT_ATTENDANCE_STATUS_GROUP_INVALID');
  return group;
}
function normalizedStatus(value){
  const status=clean(value).toLowerCase();
  if(!['present','absent','makeup','blank'].includes(status)) throw attendanceStatusError('출석부 변경 상태를 확인해 주세요.',400,'OLLI_AGENT_ATTENDANCE_STATUS_VALUE_INVALID');
  return status;
}
function targetKind(value,status){
  const kind=clean(value);
  if(status==='present'||status==='absent') return 'regular';
  if(status==='makeup') return 'makeup';
  if(kind==='regular'||kind==='makeup') return kind;
  return 'AUTO';
}
async function prepareAttendanceStatusAction({
  requestContext,intent,subjectAccess,studentLabel,currentDate,requestId,replyToMessageId,
  capturePersistedMessage=null,sanitizePayload,callRpc=callSupabaseRpc,
}){
  if(typeof sanitizePayload!=='function') throw attendanceStatusError('Agent Tool 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_ATTENDANCE_STATUS_PRIVACY_MISSING');
  const label=clean(studentLabel);
  const subject=subjectAccess?.resolve?.(label);
  if(!subject?.studentId) throw attendanceStatusError('출석부를 변경할 학생을 확인하지 못했습니다.',400,'OLLI_AGENT_ATTENDANCE_STATUS_STUDENT_REQUIRED');

  const status=normalizedStatus(intent?.status);
  const kind=targetKind(intent?.sessionKind,status);
  const today=clean(currentDate);
  const sessionDate=resolveAttendanceDateSpec(intent?.dateSpec,today);
  if(!sessionDate) throw attendanceStatusError('출석부를 변경할 날짜를 확인해 주세요.',400,'OLLI_AGENT_ATTENDANCE_STATUS_DATE_INVALID');

  const weekday=isoWeekday(sessionDate);
  const week=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(sessionDate),
  });
  if(!week?.ok) throw attendanceStatusError(week?.message||'학생의 수업을 확인하지 못했습니다.',403,week?.code||'OLLI_AGENT_ATTENDANCE_STATUS_WEEK_READ_FAILED');
  const mode=normalizeTimetableMode(week?.timetable_mode);
  const division=clean(subject.division).toLowerCase();
  if(!['elementary','kinder'].includes(division)) throw attendanceStatusError('학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_ATTENDANCE_STATUS_DIVISION_INVALID');

  const sessions=[];
  if(kind==='AUTO'||kind==='regular'){
    (Array.isArray(week?.enrollments)?week.enrollments:[]).forEach(row=>{
      if(clean(row?.student_id)!==clean(subject.studentId)||Number(row?.weekday||0)!==weekday||clean(row?.status).toLowerCase()!=='active'||!effectiveOn(row,sessionDate)) return;
      sessions.push({sessionKind:'regular',timeSlot:Number(row?.time_slot||0),classGroup:clean(row?.class_group).toUpperCase()==='B'?'B':'A',studentName:clean(row?.student_name)});
    });
  }
  if(kind==='AUTO'||kind==='makeup'){
    (Array.isArray(week?.one_time_sessions)?week.one_time_sessions:[]).forEach(row=>{
      if(clean(row?.student_id)!==clean(subject.studentId)||clean(row?.session_date).slice(0,10)!==sessionDate||clean(row?.status).toLowerCase()==='cancelled') return;
      sessions.push({sessionKind:'makeup',timeSlot:Number(row?.time_slot||0),classGroup:clean(row?.class_group).toUpperCase()==='B'?'B':'A',studentName:clean(row?.student_name)});
    });
  }

  const hour=Number(intent?.classHour||0);
  const minute=Number(intent?.classMinute||0);
  if(minute&&![0,30].includes(minute)) throw attendanceStatusError('출석부를 변경할 수업 시간을 확인해 주세요.',400,'OLLI_AGENT_ATTENDANCE_STATUS_TIME_INVALID');
  let requestedSlot=0;
  if(hour){
    requestedSlot=encodeVisibleSlot(division,weekday,mode,hour,minute);
    if(!requestedSlot) throw attendanceStatusError('출석부를 변경할 수업 시간을 확인해 주세요.',400,'OLLI_AGENT_ATTENDANCE_STATUS_TIME_INVALID');
  }
  const group=normalizedGroup(intent?.classGroup);
  let candidates=sessions.filter(row=>Number.isInteger(row.timeSlot)&&row.timeSlot>0);
  if(requestedSlot) candidates=candidates.filter(row=>row.timeSlot===requestedSlot);
  if(group) candidates=candidates.filter(row=>row.classGroup===group);
  if(candidates.length===0) throw attendanceStatusError('입력한 날짜와 시간의 수업을 찾지 못했습니다.',404,'OLLI_AGENT_ATTENDANCE_STATUS_SESSION_NOT_FOUND');
  if(candidates.length>1) throw attendanceStatusError('해당 날짜에 변경할 수업이 여러 개 있습니다. 정규/보강 여부나 수업 시간을 함께 알려 주세요.',409,'OLLI_AGENT_ATTENDANCE_STATUS_SESSION_AMBIGUOUS');

  const target=candidates[0];
  if(target.sessionKind==='regular'&&!['present','absent','blank'].includes(status)) throw attendanceStatusError('정규수업 출석부는 출석·결석·빈칸으로만 변경할 수 있습니다.',400,'OLLI_AGENT_ATTENDANCE_STATUS_REGULAR_VALUE_INVALID');
  if(target.sessionKind==='makeup'&&!['makeup','blank'].includes(status)) throw attendanceStatusError('보강수업 출석부는 보강·빈칸으로만 변경할 수 있습니다.',400,'OLLI_AGENT_ATTENDANCE_STATUS_MAKEUP_VALUE_INVALID');

  const month=await callRpc('olli_schedule_attendance_month',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_month:sessionDate.slice(0,7)+'-01',
  });
  if(!month?.ok) throw attendanceStatusError(month?.message||'현재 출석부 상태를 확인하지 못했습니다.',403,month?.code||'OLLI_AGENT_ATTENDANCE_STATUS_MONTH_READ_FAILED');
  const dateRows=(Array.isArray(month?.attendance)?month.attendance:[]).filter(row=>
    clean(row?.student_id)===clean(subject.studentId)&&clean(row?.session_date).slice(0,10)===sessionDate
  );
  const current=finalSessionStatus(dateRows,sessionDate,target.sessionKind,target.timeSlot,target.classGroup,true,today);
  if(current===status) throw attendanceStatusError('이미 요청한 출석부 상태로 표시되어 있습니다.',409,'OLLI_AGENT_ATTENDANCE_STATUS_UNCHANGED');

  const replyId=Number(replyToMessageId||0);
  if(!Number.isSafeInteger(replyId)||replyId<=0) throw attendanceStatusError('원문 Team Chat 메시지를 확인하지 못했습니다.',400,'OLLI_AGENT_ATTENDANCE_STATUS_SOURCE_MESSAGE_INVALID');
  const studentName=target.studentName||'학생';
  const body=[
    studentName+' · '+dateDisplay(sessionDate)+' '+timeLabel(division,weekday,target.timeSlot,mode)+(target.classGroup==='B'?' B반':''),
    '출석부 상태 · '+statusLabel(current)+' → '+statusLabel(status),
    '변경할까요?'
  ].join('\n');
  const payload={
    intent:'set_attendance_status',
    studentId:subject.studentId,
    studentName,
    division,
    sessionDate,
    sessionKind:target.sessionKind,
    timeSlot:target.timeSlot,
    classGroup:target.classGroup,
    status,
  };
  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:body,
    p_action_type:'set_attendance_status',
    p_action_payload:payload,
    p_client_message_id:stableAttendanceStatusClientMessageId({
      academyId:requestContext.academyId,memberId:requestContext.memberId,requestId
    }),
    p_reply_to_message_id:replyId,
  });
  if(!sent?.ok||!sent?.message?.action) throw attendanceStatusError(sent?.message||'출석부 변경 확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_ATTENDANCE_STATUS_ACTION_STORE_FAILED');
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);
  return sanitizePayload({ok:true,status:'pending',requires_confirmation:true,action_type:'set_attendance_status'});
}
function createPrepareAttendanceStatusTool({
  tool,z,requestContext,intent,subjectAccess,studentLabel,currentDate,requestId,
  replyToMessageId,capturePersistedMessage,sanitizePayload,
}){
  if(typeof tool!=='function'||!z) throw attendanceStatusError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  return tool({
    name:'prepare_attendance_status',
    description:'저장된 원문에서 서버가 확정한 출석부 상태 변경을 실제 실행하지 않고 확인 카드로만 준비합니다.',
    parameters:z.object({}),
    async execute(){
      const result=await prepareAttendanceStatusAction({
        requestContext,intent,subjectAccess,studentLabel,currentDate,requestId,
        replyToMessageId,capturePersistedMessage,sanitizePayload,
      });
      return JSON.stringify(result);
    },
  });
}
module.exports={
  resolveAttendanceDateSpec,
  stableAttendanceStatusClientMessageId,
  prepareAttendanceStatusAction,
  createPrepareAttendanceStatusTool,
};
