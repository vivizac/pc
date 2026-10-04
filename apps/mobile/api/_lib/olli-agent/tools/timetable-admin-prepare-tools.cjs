'use strict';

const crypto=require('node:crypto');
const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {normalizeTimetableMode,timeLabel,weekdayLabel}=require('./schedule-tools.cjs');
const {resolveDateSpec,mondayKey,isoWeekday}=require('./timetable-read-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}
function adminError(message,statusCode=400,code='OLLI_AGENT_TIMETABLE_ADMIN_ERROR'){
  const error=new Error(message);error.statusCode=statusCode;error.code=code;return error;
}
function normalizeDivision(value){
  const d=clean(value).toLowerCase();
  if(!['elementary','kinder'].includes(d)) throw adminError('초등부 또는 유치부를 함께 알려 주세요.',400,'OLLI_AGENT_TIMETABLE_ADMIN_DIVISION_REQUIRED');
  return d;
}
function divisionLabel(value){return value==='kinder'?'유치부':'초등부';}
function dateDisplay(value){
  const m=clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?Number(m[2])+'월 '+Number(m[3])+'일':clean(value);
}
function effectiveOn(row,dateKey){
  const from=clean(row?.effective_from).slice(0,10);
  const to=clean(row?.effective_to).slice(0,10);
  return (!from||from<=dateKey)&&(!to||to>=dateKey);
}
function encodeVisibleSlot(division,weekday,mode,hour,minute){
  const d=normalizeDivision(division);
  const day=Number(weekday||0),h=Number(hour||0),m=Number(minute||0);
  if(day<1||day>6||!Number.isInteger(h)||h<1||h>12||![0,30].includes(m)) return 0;
  if(d==='elementary'&&day===6){
    if(m!==0||h<1||h>3) return 0;
    return h+9;
  }
  if(normalizeTimetableMode(mode)==='half_hour'){
    const key=h+':'+m;
    const elementary={'1:0':1,'1:30':7,'2:0':2,'2:30':8,'3:0':3,'3:30':9,'4:0':4,'4:30':10,'5:0':5,'5:30':11,'6:0':6};
    const kinder={'3:30':7,'4:0':4,'4:30':8,'5:0':5,'5:30':9};
    return Number((d==='kinder'?kinder:elementary)[key]||0);
  }
  if(m!==0) return 0;
  if(d==='kinder') return [4,5].includes(h)?h:0;
  return h>=1&&h<=6?h:0;
}
function stableAdminActionClientMessageId({academyId,memberId,requestId,actionType}){
  const request=clean(requestId);
  if(!request) throw adminError('관리 작업 요청 식별값이 없습니다.',400,'OLLI_AGENT_TIMETABLE_ADMIN_REQUEST_ID_REQUIRED');
  const hex=crypto.createHash('sha256').update([
    'olli-agent-timetable-admin-v1',clean(academyId),clean(memberId),request,clean(actionType)
  ].join('|')).digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}
async function readWeek(requestContext,dateKey,callRpc){
  const data=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(dateKey),
  });
  if(!data?.ok) throw adminError(data?.message||'시간표를 확인하지 못했습니다.',403,data?.code||'OLLI_AGENT_TIMETABLE_ADMIN_WEEK_READ_FAILED');
  return data;
}
function splitActive(weekData,weekday,timeSlot,dateKey){
  return (Array.isArray(weekData?.class_split_periods)?weekData.class_split_periods:[]).some(row=>
    Number(row?.weekday||0)===Number(weekday)&&
    Number(row?.time_slot||0)===Number(timeSlot)&&effectiveOn(row,dateKey)
  );
}
async function availableGroups({requestContext,division,dateKey,weekday,timeSlot,mode,weekData,callRpc}){
  if(normalizeTimetableMode(mode)==='half_hour') return ['A'];
  if(division==='elementary') return splitActive(weekData,weekday,timeSlot,dateKey)?['A','B']:['A'];
  const layouts=await callRpc('olli_schedule_kinder_class_layouts',{
    p_session_token:requestContext.sessionToken,p_academy_id:requestContext.academyId
  });
  if(!layouts?.ok) throw adminError(layouts?.message||'유치부 분반 상태를 확인하지 못했습니다.',403,'OLLI_AGENT_TIMETABLE_ADMIN_KINDER_LAYOUT_READ_FAILED');
  const merged=(Array.isArray(layouts?.merged_slots)?layouts.merged_slots:[]).some(row=>
    Number(row?.weekday||0)===Number(weekday)&&Number(row?.time_slot||0)===Number(timeSlot)
  );
  return merged?['A']:['A','B'];
}
function resolveGroup(requested,groups){
  const g=clean(requested).toUpperCase();
  if(g){
    if(!['A','B'].includes(g)||!groups.includes(g)) throw adminError('해당 수업의 A/B반 구성을 확인해 주세요.',409,'OLLI_AGENT_TIMETABLE_ADMIN_GROUP_INVALID');
    return g;
  }
  if(groups.length>1) throw adminError('A반인지 B반인지 함께 알려 주세요.',409,'OLLI_AGENT_TIMETABLE_ADMIN_GROUP_REQUIRED');
  return 'A';
}
function teacherKey(value){
  return clean(value).toLowerCase().replace(/\s+/g,'').replace(/t$/i,'');
}
async function loadTeacherContext(requestContext,callRpc){
  const data=await callRpc('olli_schedule_class_teacher_context',{
    p_session_token:requestContext.sessionToken,p_academy_id:requestContext.academyId
  });
  if(!data?.ok) throw adminError(data?.message||'선생님 정보를 확인하지 못했습니다.',403,'OLLI_AGENT_TIMETABLE_ADMIN_TEACHER_READ_FAILED');
  return data;
}
function resolveTeacher(context,name){
  const key=teacherKey(name);
  const matches=(Array.isArray(context?.teachers)?context.teachers:[]).filter(row=>teacherKey(row?.display_name)===key);
  if(matches.length===0) throw adminError('요청한 선생님을 찾지 못했습니다.',404,'OLLI_AGENT_TIMETABLE_ADMIN_TEACHER_NOT_FOUND');
  if(matches.length>1) throw adminError('같은 이름의 선생님이 여러 명입니다. 시간표에서 직접 선택해 주세요.',409,'OLLI_AGENT_TIMETABLE_ADMIN_TEACHER_AMBIGUOUS');
  return matches[0];
}
async function sendAction({requestContext,requestId,replyToMessageId,actionType,body,payload,capturePersistedMessage,callRpc}){
  const replyId=Number(replyToMessageId||0);
  if(!Number.isSafeInteger(replyId)||replyId<=0) throw adminError('원문 Team Chat 메시지를 확인하지 못했습니다.',400,'OLLI_AGENT_TIMETABLE_ADMIN_SOURCE_MESSAGE_INVALID');
  const sent=await callRpc('olli_team_chat_send_action',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:body,
    p_action_type:actionType,
    p_action_payload:payload,
    p_client_message_id:stableAdminActionClientMessageId({
      academyId:requestContext.academyId,memberId:requestContext.memberId,requestId,actionType
    }),
    p_reply_to_message_id:replyId,
  });
  if(!sent?.ok||!sent?.message?.action) throw adminError(sent?.message||'확인 카드를 저장하지 못했습니다.',500,'OLLI_AGENT_TIMETABLE_ADMIN_ACTION_STORE_FAILED');
  if(typeof capturePersistedMessage==='function') capturePersistedMessage(sent.message);
  return sent.message;
}
async function prepareTimetableAdminAction({
  requestContext,intent,subjectAccess=null,studentLabel='',currentDate,requestId,replyToMessageId,
  selectedEnrollmentId='',selectedClassGroup='',allowChoice=false,
  capturePersistedMessage=null,sanitizePayload,callRpc=callSupabaseRpc,
}){
  if(typeof sanitizePayload!=='function') throw adminError('Agent Tool 개인정보 필터가 준비되지 않았습니다.',500,'OLLI_AGENT_TIMETABLE_ADMIN_PRIVACY_MISSING');
  const type=clean(intent?.intent);
  const today=clean(currentDate);
  let actionType='',body='',payload={};

  if(type==='set_class_layout'){
    const division=normalizeDivision(intent?.division);
    const effectiveDate=resolveDateSpec(intent?.dateSpec,today);
    if(!effectiveDate) throw adminError('분반·합반 적용 날짜를 확인해 주세요.',400,'OLLI_AGENT_CLASS_LAYOUT_DATE_REQUIRED');
    const weekday=isoWeekday(effectiveDate);
    if(weekday<1||weekday>6) throw adminError('일요일에는 분반·합반을 설정할 수 없습니다.',400,'OLLI_AGENT_CLASS_LAYOUT_WEEKDAY_INVALID');
    const week=await readWeek(requestContext,effectiveDate,callRpc);
    const mode=normalizeTimetableMode(week?.timetable_mode);
    if(mode==='half_hour') throw adminError('30분 시간표 모드에서는 A/B 분반·합반을 사용하지 않습니다.',409,'OLLI_AGENT_CLASS_LAYOUT_HALF_HOUR_UNSUPPORTED');
    const timeSlot=encodeVisibleSlot(division,weekday,mode,intent?.timeSlot,intent?.timeMinute);
    if(!timeSlot) throw adminError('분반·합반할 수업 시간을 확인해 주세요.',400,'OLLI_AGENT_CLASS_LAYOUT_TIME_INVALID');
    const split=intent?.split===true;
    if(division==='elementary'){
      const current=splitActive(week,weekday,timeSlot,effectiveDate);
      if(current===split) throw adminError(split?'이미 분반으로 운영 중입니다.':'이미 합반으로 운영 중입니다.',409,'OLLI_AGENT_CLASS_LAYOUT_UNCHANGED');
    }else{
      const layouts=await callRpc('olli_schedule_kinder_class_layouts',{
        p_session_token:requestContext.sessionToken,p_academy_id:requestContext.academyId
      });
      if(!layouts?.ok) throw adminError(layouts?.message||'유치부 분반 상태를 확인하지 못했습니다.',403,'OLLI_AGENT_CLASS_LAYOUT_READ_FAILED');
      const merged=(Array.isArray(layouts?.merged_slots)?layouts.merged_slots:[]).some(row=>Number(row?.weekday||0)===weekday&&Number(row?.time_slot||0)===timeSlot);
      const current=!merged;
      if(current===split) throw adminError(split?'이미 분반으로 운영 중입니다.':'이미 합반으로 운영 중입니다.',409,'OLLI_AGENT_CLASS_LAYOUT_UNCHANGED');
    }
    actionType='set_class_layout';
    payload={intent:actionType,division,split,weekday,timeSlot,effectiveDate};
    body=[
      divisionLabel(division)+' · '+weekdayLabel(weekday)+' '+timeLabel(division,weekday,timeSlot,mode),
      division==='elementary'?'적용일 · '+dateDisplay(effectiveDate):'유치부 반복 시간표 설정',
      split?'A/B 분반으로 변경할까요?':'합반으로 변경할까요?'
    ].join('\n');
  }else if(type==='set_class_teacher'||type==='set_teacher_override'){
    const division=normalizeDivision(intent?.division);
    const dateSpecific=type==='set_teacher_override';
    const targetDate=dateSpecific?resolveDateSpec(intent?.dateSpec,today):resolveDateSpec({mode:'upcoming_weekday',weekday:Number(intent?.weekday||0)},today);
    if(!targetDate) throw adminError('선생님을 배정할 수업 날짜·요일을 확인해 주세요.',400,'OLLI_AGENT_TEACHER_TARGET_DATE_REQUIRED');
    const weekday=isoWeekday(targetDate);
    const week=await readWeek(requestContext,targetDate,callRpc);
    const mode=normalizeTimetableMode(week?.timetable_mode);
    const timeSlot=encodeVisibleSlot(division,weekday,mode,intent?.timeSlot,intent?.timeMinute);
    if(!timeSlot) throw adminError('선생님을 배정할 수업 시간을 확인해 주세요.',400,'OLLI_AGENT_TEACHER_TIME_INVALID');
    const groups=await availableGroups({requestContext,division,dateKey:targetDate,weekday,timeSlot,mode,weekData:week,callRpc});
    const requestedClassGroup=clean(selectedClassGroup||intent?.classGroup).toUpperCase();
    if(!requestedClassGroup&&groups.length>1&&allowChoice===true){
      return {
        ok:false,
        code:'target_choice_required',
        field:'target_choice',
        targetIntent:type,
        choiceKey:'targetClassGroup',
        choices:groups.slice(0,8).map(group=>({id:group,label:group+'반'})),
        message:'담당 선생님을 변경할 반을 선택해 주세요.'
      };
    }
    const classGroup=resolveGroup(requestedClassGroup,groups);
    const teacherContext=await loadTeacherContext(requestContext,callRpc);
    const teacher=resolveTeacher(teacherContext,intent?.teacherName);
    if(!dateSpecific){
      const current=(teacherContext.assignments||[]).find(row=>
        clean(row?.division)===division&&Number(row?.weekday||0)===weekday&&Number(row?.time_slot||0)===timeSlot&&clean(row?.class_group).toUpperCase()===classGroup
      );
      if(clean(current?.teacher_member_id)===clean(teacher.id)) throw adminError('이미 해당 선생님이 담당하고 있습니다.',409,'OLLI_AGENT_CLASS_TEACHER_UNCHANGED');
      actionType='set_class_teacher';
      payload={intent:actionType,division,weekday,timeSlot,classGroup,teacherMemberId:teacher.id,teacherName:clean(teacher.display_name)};
      body=[
        divisionLabel(division)+' · '+weekdayLabel(weekday)+' '+timeLabel(division,weekday,timeSlot,mode)+(groups.length>1?' '+classGroup+'반':''),
        '담당 선생님 · '+clean(teacher.display_name),
        '반복 담당 선생님을 변경할까요?'
      ].join('\n');
    }else{
      const overrides=await callRpc('olli_schedule_teacher_overrides_range',{
        p_session_token:requestContext.sessionToken,p_academy_id:requestContext.academyId,
        p_start_date:targetDate,p_end_date:targetDate
      });
      if(!overrides?.ok) throw adminError(overrides?.message||'날짜별 선생님 정보를 확인하지 못했습니다.',403,'OLLI_AGENT_TEACHER_OVERRIDE_READ_FAILED');
      const current=(overrides.overrides||[]).find(row=>
        clean(row?.session_date).slice(0,10)===targetDate&&clean(row?.division)===division&&Number(row?.time_slot||0)===timeSlot&&clean(row?.class_group).toUpperCase()===classGroup
      );
      if(clean(current?.teacher_member_id)===clean(teacher.id)) throw adminError('이미 해당 날짜에 같은 선생님이 배정되어 있습니다.',409,'OLLI_AGENT_TEACHER_OVERRIDE_UNCHANGED');
      actionType='set_teacher_override';
      payload={intent:actionType,sessionDate:targetDate,division,weekday,timeSlot,classGroup,teacherMemberId:teacher.id,teacherName:clean(teacher.display_name),reason:'agent_override'};
      body=[
        divisionLabel(division)+' · '+dateDisplay(targetDate)+' '+timeLabel(division,weekday,timeSlot,mode)+(groups.length>1?' '+classGroup+'반':''),
        '수업 선생님 · '+clean(teacher.display_name),
        '이 날짜의 담당 선생님만 변경할까요?'
      ].join('\n');
    }
  }else if(type==='set_session_order'){
    const label=clean(studentLabel);
    const subject=subjectAccess?.resolve?.(label);
    if(!subject?.studentId) throw adminError('수업 순서를 변경할 학생을 확인하지 못했습니다.',400,'OLLI_AGENT_SESSION_ORDER_STUDENT_REQUIRED');
    const effectiveDate=intent?.dateSpec?resolveDateSpec(intent.dateSpec,today):today;
    if(!effectiveDate) throw adminError('수업 순서 적용 날짜를 확인해 주세요.',400,'OLLI_AGENT_SESSION_ORDER_DATE_INVALID');
    const division=normalizeDivision(subject.division);
    const week=await readWeek(requestContext,effectiveDate,callRpc);
    const mode=normalizeTimetableMode(week?.timetable_mode);
    const active=(Array.isArray(week?.enrollments)?week.enrollments:[]).filter(row=>
      clean(row?.student_id)===clean(subject.studentId)&&effectiveOn(row,effectiveDate)
    );
    if(active.length!==2) throw adminError('주 2회 정규수업인 학생만 수업 순서를 변경할 수 있습니다.',409,'OLLI_AGENT_SESSION_ORDER_TWO_CLASSES_REQUIRED');
    const weekday=Number(intent?.weekday||0);
    let candidates=active.filter(row=>Number(row?.weekday||0)===weekday);
    const requestedTime=Number(intent?.timeSlot||0);
    if(requestedTime){
      const slot=encodeVisibleSlot(division,weekday,mode,requestedTime,intent?.timeMinute);
      if(!slot) throw adminError('수업 순서를 변경할 시간을 확인해 주세요.',400,'OLLI_AGENT_SESSION_ORDER_TIME_INVALID');
      candidates=candidates.filter(row=>Number(row?.time_slot||0)===slot);
    }
    const requestedGroup=clean(intent?.classGroup).toUpperCase();
    if(requestedGroup) candidates=candidates.filter(row=>clean(row?.class_group).toUpperCase()===requestedGroup);
    const requestedEnrollmentId=clean(selectedEnrollmentId);
    if(requestedEnrollmentId) candidates=candidates.filter(row=>clean(row?.id)===requestedEnrollmentId);
    if(candidates.length===0) throw adminError('해당 학생의 정규수업을 찾지 못했습니다.',404,'OLLI_AGENT_SESSION_ORDER_CLASS_NOT_FOUND');
    if(candidates.length>1){
      if(allowChoice===true){
        const choices=candidates.slice(0,8).map(row=>{
          const id=clean(row?.id);
          const rowWeekday=Number(row?.weekday||0);
          const rowSlot=Number(row?.time_slot||0);
          const group=clean(row?.class_group).toUpperCase()==='B'?'B':'A';
          const labelText=weekdayLabel(rowWeekday)+' '+timeLabel(division,rowWeekday,rowSlot,mode)+' '+group+'반';
          return id ? {id,label:labelText} : null;
        }).filter(Boolean);
        if(choices.length>1){
          return {
            ok:false,
            code:'target_choice_required',
            field:'target_choice',
            choiceKey:'enrollmentId',
            choices,
            message:'수업 순서를 변경할 수업을 선택해 주세요.'
          };
        }
      }
      throw adminError('변경할 수업이 여러 개입니다. 수업 시간을 함께 알려 주세요.',409,'OLLI_AGENT_SESSION_ORDER_CLASS_AMBIGUOUS');
    }
    const selected=candidates[0];
    const order=Number(intent?.sessionOrder||0);
    if(![1,2].includes(order)) throw adminError('수업 순서를 1회차 또는 2회차로 알려 주세요.',400,'OLLI_AGENT_SESSION_ORDER_VALUE_INVALID');
    if(Number(selected?.session_order||0)===order) throw adminError('이미 요청한 회차로 설정되어 있습니다.',409,'OLLI_AGENT_SESSION_ORDER_UNCHANGED');
    const name=clean(selected?.student_name)||'학생';
    actionType='set_session_order';
    payload={intent:actionType,studentId:subject.studentId,studentName:name,enrollmentId:clean(selected?.id),sessionOrder:order,effectiveDate,division,weekday:Number(selected?.weekday||0),timeSlot:Number(selected?.time_slot||0),classGroup:clean(selected?.class_group).toUpperCase()==='B'?'B':'A'};
    body=[
      name+' · '+weekdayLabel(Number(selected?.weekday||0))+' '+timeLabel(division,Number(selected?.weekday||0),Number(selected?.time_slot||0),mode),
      String(order)+'회차로 변경할까요?'
    ].join('\n');
  }else if(type==='set_normal_class_day'){
    const sessionDate=resolveDateSpec(intent?.dateSpec,today);
    if(!sessionDate) throw adminError('휴원일·정상수업 변경 날짜를 확인해 주세요.',400,'OLLI_AGENT_NORMAL_DAY_DATE_REQUIRED');
    const calendar=await callRpc('olli_schedule_calendar_range',{
      p_session_token:requestContext.sessionToken,p_academy_id:requestContext.academyId,
      p_start_date:sessionDate,p_end_date:sessionDate
    });
    if(!calendar?.ok) throw adminError(calendar?.message||'수업일 정보를 확인하지 못했습니다.',403,'OLLI_AGENT_NORMAL_DAY_READ_FAILED');
    const day=(Array.isArray(calendar?.days)?calendar.days:[]).find(row=>clean(row?.session_date).slice(0,10)===sessionDate);
    if(!day?.default_holiday) throw adminError('공휴일로 등록된 날짜만 휴원일 ↔ 정상수업을 전환할 수 있습니다.',409,'OLLI_AGENT_NORMAL_DAY_NOT_HOLIDAY');
    const normalClass=intent?.normalClass===true;
    if(normalClass&&day?.normal_class_override===true) throw adminError('이미 정상수업으로 설정되어 있습니다.',409,'OLLI_AGENT_NORMAL_DAY_UNCHANGED');
    if(!normalClass&&day?.is_holiday===true&&day?.normal_class_override!==true) throw adminError('이미 휴원일로 설정되어 있습니다.',409,'OLLI_AGENT_NORMAL_DAY_UNCHANGED');
    actionType='set_normal_class_day';
    payload={intent:actionType,sessionDate,normalClass,holidayName:clean(day?.name)};
    body=[
      dateDisplay(sessionDate)+(clean(day?.name)?' · '+clean(day.name):''),
      normalClass?'정상수업일로 변경할까요?':'휴원일로 변경할까요?'
    ].join('\n');
  }else{
    throw adminError('지원하지 않는 시간표 관리 작업입니다.',400,'OLLI_AGENT_TIMETABLE_ADMIN_INTENT_UNSUPPORTED');
  }

  await sendAction({
    requestContext,requestId,replyToMessageId,actionType,body,payload,capturePersistedMessage,callRpc
  });
  return sanitizePayload({ok:true,status:'pending',requires_confirmation:true,action_type:actionType});
}
function createPrepareTimetableAdminTool({
  tool,z,requestContext,intent,subjectAccess=null,studentLabel='',currentDate,requestId,
  replyToMessageId,capturePersistedMessage,captureChoiceRequired=null,allowChoice=false,sanitizePayload,
}){
  if(typeof tool!=='function'||!z) throw adminError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  return tool({
    name:'prepare_timetable_admin',
    description:'서버가 저장된 원문에서 확정한 시간표 관리 작업을 실제 실행하지 않고 확인 카드로만 준비합니다.',
    parameters:z.object({}),
    async execute(){
      const result=await prepareTimetableAdminAction({
        requestContext,intent,subjectAccess,studentLabel,currentDate,requestId,
        replyToMessageId,allowChoice,capturePersistedMessage,sanitizePayload,
      });
      if(result?.code==='target_choice_required'){
        if(typeof captureChoiceRequired==='function') captureChoiceRequired(result);
        return JSON.stringify({
          ok:false,
          status:'choice_required',
          message:clean(result.message)||'수업을 선택해 주세요.'
        });
      }
      return JSON.stringify(result);
    },
  });
}
module.exports={
  encodeVisibleSlot,
  stableAdminActionClientMessageId,
  prepareTimetableAdminAction,
  createPrepareTimetableAdminTool,
};
