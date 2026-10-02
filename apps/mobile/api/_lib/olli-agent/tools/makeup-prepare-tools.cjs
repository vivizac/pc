'use strict';

const crypto = require('node:crypto');
const { callSupabaseRpc } = require('../supabase-rpc.cjs');
const { readScheduleAvailability } = require('./availability-tools.cjs');
const {
  parseDateKey,
  mondayKey,
} = require('./pickup-prepare-tools.cjs');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function makeupPrepareError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_MAKEUP_PREPARE_ERROR'
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeRequestedGroup(value) {
  const group = clean(value).toUpperCase() || 'AUTO';
  if (!['AUTO', 'A', 'B'].includes(group)) {
    throw makeupPrepareError(
      '보강 수업 반을 확인해 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_GROUP_INVALID'
    );
  }
  return group;
}

function requestedTimeLabel(hour, minute) {
  const h = Number(hour || 0);
  const m = Number(minute || 0);
  if (!Number.isInteger(h) || h < 1 || h > 12 || ![0, 30].includes(m)) {
    throw makeupPrepareError(
      '보강 시간을 확인해 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_TIME_INVALID'
    );
  }
  return String(h) + '시' + (m === 30 ? ' 30분' : '');
}

function stableMakeupActionClientMessageId({ academyId, memberId, requestId }) {
  const request = clean(requestId);
  if (!request || request.length > 160) {
    throw makeupPrepareError(
      '보강 준비 요청 식별값이 없습니다.',
      400,
      'OLLI_AGENT_MAKEUP_REQUEST_ID_REQUIRED'
    );
  }
  const hex = crypto
    .createHash('sha256')
    .update([
      'olli-agent-makeup-add-v1',
      clean(academyId),
      clean(memberId),
      request,
      'add_makeup',
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

async function loadPrivateMakeupStudent({
  requestContext,
  studentId,
  expectedDivision,
  callRpc,
}) {
  const result = await callRpc('olli_student_data_access', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_action:'read',
    p_operation:'get',
    p_identity:{ id:studentId },
    p_payload:{},
    p_limit:1,
  });

  if (!result?.ok) {
    throw makeupPrepareError(
      result?.message || '학생 정보를 확인하지 못했습니다.',
      403,
      result?.code || 'OLLI_AGENT_MAKEUP_STUDENT_READ_FAILED'
    );
  }

  const row = Array.isArray(result.rows) ? result.rows[0] : null;
  const division = clean(row?.division).toLowerCase();
  if (
    !row ||
    clean(row.id) !== clean(studentId) ||
    !['elementary', 'kinder'].includes(division) ||
    division !== clean(expectedDivision).toLowerCase() ||
    clean(row.status).toLowerCase() !== 'active' ||
    row.is_deleted === true
  ) {
    throw makeupPrepareError(
      '보강 등록은 현재 재원 중인 학생만 지원해요.',
      400,
      'OLLI_AGENT_MAKEUP_ACTIVE_STUDENT_REQUIRED'
    );
  }

  const name = clean(row.name);
  if (!name) {
    throw makeupPrepareError(
      '학생 이름을 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_MAKEUP_STUDENT_NAME_MISSING'
    );
  }

  return { name, division };
}

function duplicateMakeup(weekData, studentId, sessionDate, timeSlot) {
  return (Array.isArray(weekData?.one_time_sessions) ? weekData.one_time_sessions : [])
    .some((row) =>
      clean(row?.student_id) === clean(studentId) &&
      clean(row?.session_date).slice(0, 10) === sessionDate &&
      Number(row?.time_slot || 0) === Number(timeSlot) &&
      clean(row?.status).toLowerCase() !== 'cancelled'
    );
}

function dateLabel(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const date = new Date(parsed.timestamp);
  return String(date.getUTCMonth() + 1) + '월 ' + String(date.getUTCDate()) + '일';
}

function actionPrompt({
  studentName,
  sessionDate,
  timeText,
  classGroup,
  grouped,
}) {
  const groupText = grouped ? ' ' + classGroup + '반' : '';
  return [
    clean(studentName) + ' · ' + dateLabel(sessionDate) + ' ' + clean(timeText) + groupText,
    '보강을 등록할까요?',
  ].join('\n');
}

async function prepareMakeupAction({
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  sessionDate,
  classHour,
  classMinute,
  classGroup = 'AUTO',
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  sanitizePayload,
  callRpc = callSupabaseRpc,
}) {
  if (typeof sanitizePayload !== 'function') {
    throw makeupPrepareError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_MAKEUP_PRIVACY_MISSING'
    );
  }

  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label);
  if (!subject?.studentId) {
    throw makeupPrepareError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }

  const fixedDivision = clean(division).toLowerCase();
  const subjectDivision = clean(subject.division).toLowerCase();
  if (!['elementary', 'kinder'].includes(fixedDivision) || subjectDivision !== fixedDivision) {
    throw makeupPrepareError(
      '지정한 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MAKEUP_DIVISION_MISMATCH'
    );
  }

  const date = parseDateKey(sessionDate);
  const today = parseDateKey(currentDate);
  if (!date || !today) {
    throw makeupPrepareError(
      '보강 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_DATE_INVALID'
    );
  }
  if (date.timestamp < today.timestamp) {
    throw makeupPrepareError(
      '지난 날짜에는 보강을 등록할 수 없습니다.',
      400,
      'OLLI_AGENT_MAKEUP_DATE_PAST'
    );
  }

  const timeText = requestedTimeLabel(classHour, classMinute);
  const requestedGroup = normalizeRequestedGroup(classGroup);
  const student = await loadPrivateMakeupStudent({
    requestContext,
    studentId:subject.studentId,
    expectedDivision:fixedDivision,
    callRpc,
  });

  const availability = await readScheduleAvailability({
    requestContext,
    division:fixedDivision,
    purpose:'makeup',
    startDate:date.key,
    endDate:date.key,
    timeSlot:0,
    classGroup:'ALL',
    sanitizePayload(payload) {
      return payload;
    },
    callRpc,
  });

  if ((availability.closed_dates || []).some((row) => row.date === date.key)) {
    throw makeupPrepareError(
      '공휴일에는 보강을 등록할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.',
      409,
      'OLLI_AGENT_MAKEUP_CLOSED_DAY'
    );
  }

  let candidates = (Array.isArray(availability.slots) ? availability.slots : [])
    .filter((slot) => slot.date === date.key && clean(slot.time_label) === timeText);

  if (!candidates.length) {
    throw makeupPrepareError(
      '해당 날짜에는 요청한 보강 시간이 운영되지 않습니다.',
      404,
      'OLLI_AGENT_MAKEUP_TIME_NOT_AVAILABLE'
    );
  }

  if (requestedGroup !== 'AUTO') {
    candidates = candidates.filter((slot) => clean(slot.class_group).toUpperCase() === requestedGroup);
    if (!candidates.length) {
      throw makeupPrepareError(
        '해당 날짜와 시간에는 요청한 반이 운영되지 않습니다.',
        404,
        'OLLI_AGENT_MAKEUP_GROUP_NOT_AVAILABLE'
      );
    }
  } else if (candidates.length > 1) {
    throw makeupPrepareError(
      '이 시간은 A반과 B반으로 나뉘어 있습니다. 보강할 반을 함께 알려 주세요.',
      409,
      'OLLI_AGENT_MAKEUP_GROUP_REQUIRED'
    );
  }

  if (candidates.length !== 1) {
    throw makeupPrepareError(
      '보강 대상을 하나로 확정하지 못했습니다.',
      409,
      'OLLI_AGENT_MAKEUP_TARGET_AMBIGUOUS'
    );
  }

  const target = candidates[0];
  if (target.available !== true || Number(target.remaining || 0) <= 0) {
    throw makeupPrepareError(
      '선택한 날짜와 시간의 정원이 가득 찼습니다.',
      409,
      'OLLI_AGENT_MAKEUP_FULL'
    );
  }

  const timeSlot = Number(target.time_slot || 0);
  const targetGroup = clean(target.class_group).toUpperCase() === 'B' ? 'B' : 'A';
  if (!Number.isInteger(timeSlot) || timeSlot <= 0) {
    throw makeupPrepareError(
      '보강 수업 시간을 서버 시간표에서 확정하지 못했습니다.',
      500,
      'OLLI_AGENT_MAKEUP_SLOT_INVALID'
    );
  }

  const commonParams = {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
  };
  const weekData = await callRpc('olli_schedule_week', {
    ...commonParams,
    p_week_start:mondayKey(date.key),
  });
  if (!weekData?.ok) {
    throw makeupPrepareError(
      weekData?.message || '기존 보강 일정을 확인하지 못했습니다.',
      403,
      weekData?.code || 'OLLI_AGENT_MAKEUP_WEEK_READ_FAILED'
    );
  }
  if (duplicateMakeup(weekData, subject.studentId, date.key, timeSlot)) {
    throw makeupPrepareError(
      '같은 학생에게 같은 날짜와 시간의 보강이 이미 등록되어 있습니다.',
      409,
      'OLLI_AGENT_MAKEUP_ALREADY_EXISTS'
    );
  }

  const replyId = replyToMessageId == null ? null : Number(replyToMessageId);
  if (replyId != null && (!Number.isSafeInteger(replyId) || replyId <= 0)) {
    throw makeupPrepareError(
      '보강 원문 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_INVALID'
    );
  }

  const actionPayload = {
    intent:'add_makeup',
    studentId:clean(subject.studentId),
    studentName:student.name,
    division:fixedDivision,
    sessionDate:date.key,
    timeSlot,
    classGroup:targetGroup,
  };

  const sent = await callRpc('olli_team_chat_send_action', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:actionPrompt({
      studentName:student.name,
      sessionDate:date.key,
      timeText,
      classGroup:targetGroup,
      grouped:target.grouped === true,
    }),
    p_action_type:'add_makeup',
    p_action_payload:actionPayload,
    p_client_message_id:stableMakeupActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if (!sent?.ok || !sent?.message?.action) {
    throw makeupPrepareError(
      sent?.message || '보강 확인 카드를 저장하지 못했습니다.',
      500,
      'OLLI_AGENT_MAKEUP_ACTION_STORE_FAILED'
    );
  }

  if (typeof capturePersistedMessage === 'function') {
    capturePersistedMessage(sent.message);
  }

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'add_makeup',
    student_label:label,
    session_date:date.key,
    time_label:timeText,
    class_group:targetGroup,
    timetable_mode:clean(availability.timetable_mode),
    remaining:Number(target.remaining || 0),
  });
}

function createPrepareMakeupTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  classGroup,
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  capturePrepareError = null,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw makeupPrepareError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'prepare_makeup',
    description:
      '재원생 보강을 실제 실행하지 않고 Team Chat 확인 대기 카드로 준비합니다. 보이는 날짜·시간을 서버의 현재 가용성 시간표와 대조해 실제 저장 슬롯을 확정하며, 확인 전에는 보강 데이터가 변경되지 않습니다.',
    parameters:z.object({
      session_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      class_hour:z.number().int().min(1).max(12),
      class_minute:z.union([z.literal(0), z.literal(30)]),
    }),
    async execute({ session_date, class_hour, class_minute }) {
      try {
        const payload = await prepareMakeupAction({
          requestContext,
          subjectAccess,
          studentLabel,
          division,
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
      } catch (error) {
        if (typeof capturePrepareError === 'function') {
          capturePrepareError(error);
        }
        throw error;
      }
    },
  });
}

module.exports = {
  normalizeRequestedGroup,
  requestedTimeLabel,
  stableMakeupActionClientMessageId,
  loadPrivateMakeupStudent,
  duplicateMakeup,
  prepareMakeupAction,
  createPrepareMakeupTool,
};
