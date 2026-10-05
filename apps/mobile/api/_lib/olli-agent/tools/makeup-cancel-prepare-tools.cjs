'use strict';

const crypto = require('node:crypto');
const { callSupabaseRpc } = require('../supabase-rpc.cjs');
const {
  normalizeTimetableMode,
  timeLabel,
} = require('./schedule-tools.cjs');
const {
  parseDateKey,
  mondayKey,
} = require('./pickup-prepare-tools.cjs');
const {
  loadPrivateMakeupStudent,
} = require('./makeup-prepare-tools.cjs');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function makeupCancelError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_MAKEUP_CANCEL_PREPARE_ERROR'
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeRequestedGroup(value) {
  const group = clean(value).toUpperCase() || 'AUTO';
  if (!['AUTO', 'A', 'B'].includes(group)) {
    throw makeupCancelError(
      '취소할 보강 수업 반을 확인해 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_GROUP_INVALID'
    );
  }
  return group;
}

function requestedTimeLabel(hour, minute) {
  const h = Number(hour || 0);
  const m = Number(minute || 0);
  if (h === 0 && m === 0) return '';
  if (!Number.isInteger(h) || h < 1 || h > 12 || ![0, 30].includes(m)) {
    throw makeupCancelError(
      '취소할 보강 시간을 확인해 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_TIME_INVALID'
    );
  }
  return String(h) + '시' + (m === 30 ? ' 30분' : '');
}

function normalizeReason(value) {
  return clean(value)
    .replace(/^(?:사유|이유)\s*(?:는|은)?\s*[:：-]?\s*/i, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMakeupCancelReason(reasonValue) {
  const reason = normalizeReason(reasonValue);
  if (!reason) {
    throw makeupCancelError(
      '보강 취소 사유를 함께 알려 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_REASON_REQUIRED'
    );
  }
  if (reason.length > 300) {
    throw makeupCancelError(
      '보강 취소 사유는 300자 이내로 알려 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_REASON_TOO_LONG'
    );
  }

  const generic = reason
    .replace(/[\s.,!?~"'“”‘’()[\]{}:;·_-]+/g, '')
    .toLowerCase();
  if (/^(?:보강|보충|취소|삭제|지워|지우|제거|빼|해제|없애|취소해줘|취소해주세요|삭제해줘|삭제해주세요)$/.test(generic)) {
    throw makeupCancelError(
      '보강 취소 사유를 함께 알려 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_REASON_REQUIRED'
    );
  }
  return reason;
}

function validateReasonFromSource(reasonValue, sourceText) {
  const reason = normalizeMakeupCancelReason(reasonValue);
  const source = normalizeReason(sourceText);
  if (!source || !source.includes(reason)) {
    throw makeupCancelError(
      '취소 사유는 사용자가 입력한 내용 그대로 사용해야 합니다.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_REASON_NOT_FROM_SOURCE'
    );
  }
  return reason;
}

function stableMakeupCancelActionClientMessageId({ academyId, memberId, requestId }) {
  const request = clean(requestId);
  if (!request || request.length > 160) {
    throw makeupCancelError(
      '보강 취소 준비 요청 식별값이 없습니다.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_REQUEST_ID_REQUIRED'
    );
  }
  const hex = crypto
    .createHash('sha256')
    .update([
      'olli-agent-makeup-cancel-v1',
      clean(academyId),
      clean(memberId),
      request,
      'cancel_makeup',
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

function dateLabel(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const date = new Date(parsed.timestamp);
  return String(date.getUTCMonth() + 1) + '월 ' + String(date.getUTCDate()) + '일';
}

function cancelPrompt({ studentName, sessionDate, timeText, classGroup, grouped, reason }) {
  const groupText = grouped ? ' ' + classGroup + '반' : '';
  return [
    clean(studentName) + ' · ' + dateLabel(sessionDate) + ' ' + clean(timeText) + groupText,
    '보강 취소 사유: ' + clean(reason),
    '이 보강을 취소할까요?',
  ].join('\n');
}

function rowGroup(row) {
  return clean(row?.class_group).toUpperCase() === 'B' ? 'B' : 'A';
}

async function prepareMakeupCancelAction({
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  classGroup = 'AUTO',
  sessionDate = '',
  classHour = 0,
  classMinute = 0,
  oneTimeSessionId:selectedOneTimeSessionId = '',
  allowChoice = false,
  reason,
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  sanitizePayload,
  callRpc = callSupabaseRpc,
}) {
  if (typeof sanitizePayload !== 'function') {
    throw makeupCancelError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_MAKEUP_CANCEL_PRIVACY_MISSING'
    );
  }

  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label);
  if (!subject?.studentId) {
    throw makeupCancelError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }

  const fixedDivision = clean(division).toLowerCase();
  if (!['elementary', 'kinder'].includes(fixedDivision) || clean(subject.division).toLowerCase() !== fixedDivision) {
    throw makeupCancelError(
      '취소할 보강 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_DIVISION_MISMATCH'
    );
  }

  const today = parseDateKey(currentDate);
  if (!today) {
    throw makeupCancelError(
      '보강 취소 기준 날짜를 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_MAKEUP_CANCEL_CURRENT_DATE_INVALID'
    );
  }

  const explicitDate = clean(sessionDate);
  const targetDate = explicitDate ? parseDateKey(explicitDate) : null;
  if (explicitDate && !targetDate) {
    throw makeupCancelError(
      '취소할 보강 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_DATE_INVALID'
    );
  }
  if (targetDate && targetDate.timestamp < today.timestamp) {
    throw makeupCancelError(
      '지난 날짜의 보강은 이 Agent에서 취소할 수 없습니다.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_DATE_PAST'
    );
  }

  const requestedGroup = normalizeRequestedGroup(classGroup);
  const requestedTime = requestedTimeLabel(classHour, classMinute);
  const requestedOneTimeSessionId = clean(selectedOneTimeSessionId);
  const safeReason = normalizeMakeupCancelReason(reason);

  const student = await loadPrivateMakeupStudent({
    requestContext,
    studentId:subject.studentId,
    expectedDivision:fixedDivision,
    callRpc,
  });

  const lookupDate = targetDate ? targetDate.key : today.key;
  const weekData = await callRpc('olli_schedule_week', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(lookupDate),
  });
  if (!weekData?.ok) {
    throw makeupCancelError(
      weekData?.message || '기존 보강 일정을 확인하지 못했습니다.',
      403,
      weekData?.code || 'OLLI_AGENT_MAKEUP_CANCEL_WEEK_READ_FAILED'
    );
  }

  const mode = normalizeTimetableMode(weekData?.timetable_mode);
  let rows = (Array.isArray(weekData?.one_time_sessions) ? weekData.one_time_sessions : [])
    .filter((row) =>
      clean(row?.student_id) === clean(subject.studentId) &&
      clean(row?.session_type).toLowerCase() === 'makeup' &&
      clean(row?.status).toLowerCase() !== 'cancelled'
    );

  if (targetDate) {
    rows = rows.filter((row) => clean(row?.session_date).slice(0, 10) === targetDate.key);
  } else {
    rows = rows.filter((row) => clean(row?.session_date).slice(0, 10) >= today.key);
  }

  if (requestedTime) {
    rows = rows.filter((row) => {
      const rowDate = parseDateKey(clean(row?.session_date).slice(0, 10));
      if (!rowDate) return false;
      const date = new Date(rowDate.timestamp);
      const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
      const labelText = timeLabel(fixedDivision, weekday, Number(row?.time_slot || 0), mode);
      return clean(labelText) === requestedTime;
    });
  }

  if (requestedGroup !== 'AUTO') {
    rows = rows.filter((row) => rowGroup(row) === requestedGroup);
  }
  if (requestedOneTimeSessionId) {
    rows = rows.filter((row) => clean(row?.id) === requestedOneTimeSessionId);
  }

  rows.sort((a, b) =>
    clean(a?.session_date).localeCompare(clean(b?.session_date)) ||
    Number(a?.time_slot || 0) - Number(b?.time_slot || 0) ||
    rowGroup(a).localeCompare(rowGroup(b))
  );

  if (!rows.length) {
    throw makeupCancelError(
      '취소할 보강 일정을 찾지 못했습니다.',
      404,
      'OLLI_AGENT_MAKEUP_CANCEL_NOT_FOUND'
    );
  }
  if (rows.length > 1) {
    if (allowChoice === true) {
      const choices = rows.slice(0, 8).map((item) => {
        const itemId = clean(item?.id);
        const itemDateKey = clean(item?.session_date).slice(0, 10);
        const itemDate = parseDateKey(itemDateKey);
        const itemSlot = Number(item?.time_slot || 0);
        if (!itemId || !itemDate || !Number.isInteger(itemSlot) || itemSlot <= 0) return null;
        const itemDateObj = new Date(itemDate.timestamp);
        const itemWeekday = itemDateObj.getUTCDay() === 0 ? 7 : itemDateObj.getUTCDay();
        const itemTimeText = clean(timeLabel(fixedDivision, itemWeekday, itemSlot, mode));
        if (!itemTimeText) return null;
        return {
          id:itemId,
          label:[dateLabel(itemDateKey), itemTimeText, rowGroup(item) + '반'].join(' · '),
        };
      }).filter(Boolean);
      if (choices.length > 1) {
        return {
          ok:false,
          code:'target_choice_required',
          field:'target_choice',
          choiceKey:'oneTimeSessionId',
          choices,
          message:student.name + ' 학생의 취소 가능한 보강이 여러 개 있어요. 취소할 보강을 선택해 주세요.',
        };
      }
    }
    throw makeupCancelError(
      '취소할 보강이 여러 개 있습니다. 날짜와 시간을 함께 알려 주세요.',
      409,
      'OLLI_AGENT_MAKEUP_CANCEL_AMBIGUOUS'
    );
  }

  const row = rows[0];
  const oneTimeSessionId = clean(row?.id);
  const rowDateKey = clean(row?.session_date).slice(0, 10);
  const rowDate = parseDateKey(rowDateKey);
  const rowSlot = Number(row?.time_slot || 0);
  const targetGroup = rowGroup(row);
  if (!oneTimeSessionId || !rowDate || !Number.isInteger(rowSlot) || rowSlot <= 0) {
    throw makeupCancelError(
      '취소할 보강 정보를 서버에서 확정하지 못했습니다.',
      500,
      'OLLI_AGENT_MAKEUP_CANCEL_TARGET_INVALID'
    );
  }

  const rowDateObj = new Date(rowDate.timestamp);
  const rowWeekday = rowDateObj.getUTCDay() === 0 ? 7 : rowDateObj.getUTCDay();
  const rowTimeText = timeLabel(fixedDivision, rowWeekday, rowSlot, mode);
  if (!clean(rowTimeText)) {
    throw makeupCancelError(
      '취소할 보강 시간을 표시하지 못했습니다.',
      500,
      'OLLI_AGENT_MAKEUP_CANCEL_TIME_LABEL_MISSING'
    );
  }

  const replyId = replyToMessageId == null ? null : Number(replyToMessageId);
  if (replyId != null && (!Number.isSafeInteger(replyId) || replyId <= 0)) {
    throw makeupCancelError(
      '보강 원문 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_INVALID'
    );
  }

  const actionPayload = {
    intent:'cancel_makeup',
    studentId:clean(subject.studentId),
    studentName:student.name,
    division:fixedDivision,
    oneTimeSessionId,
    sessionDate:rowDateKey,
    timeSlot:rowSlot,
    classGroup:targetGroup,
    reason:safeReason,
  };

  const grouped = requestedGroup !== 'AUTO' || rows.some((item) => rowGroup(item) === 'B') || targetGroup === 'B';
  const sent = await callRpc('olli_team_chat_send_action', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:cancelPrompt({
      studentName:student.name,
      sessionDate:rowDateKey,
      timeText:rowTimeText,
      classGroup:targetGroup,
      grouped,
      reason:safeReason,
    }),
    p_action_type:'cancel_makeup',
    p_action_payload:actionPayload,
    p_client_message_id:stableMakeupCancelActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if (!sent?.ok || !sent?.message?.action) {
    throw makeupCancelError(
      sent?.message || '보강 취소 확인 카드를 저장하지 못했습니다.',
      500,
      'OLLI_AGENT_MAKEUP_CANCEL_ACTION_STORE_FAILED'
    );
  }

  if (typeof capturePersistedMessage === 'function') {
    capturePersistedMessage(sent.message);
  }

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'cancel_makeup',
    student_label:label,
    session_date:rowDateKey,
    time_label:rowTimeText,
    class_group:targetGroup,
    timetable_mode:mode,
  });
}

function createPrepareMakeupCancelTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  classGroup,
  reason,
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw makeupCancelError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'prepare_makeup_cancel',
    description:
      '재원생의 기존 보강을 실제 취소하지 않고 Team Chat 확인 대기 카드로 준비합니다. 서버가 현재 보강 row를 다시 조회해 실제 one-time session을 확정하며, 확인 전에는 보강 데이터가 변경되지 않습니다.',
    parameters:z.object({
      session_date:z.string(),
      class_hour:z.number().int().min(0).max(12),
      class_minute:z.union([z.literal(0), z.literal(30)]),
    }),
    async execute({ session_date, class_hour, class_minute }) {
      const payload = await prepareMakeupCancelAction({
        requestContext,
        subjectAccess,
        studentLabel,
        division,
        classGroup,
        sessionDate:session_date,
        classHour:class_hour,
        classMinute:class_minute,
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

module.exports = {
  requestedTimeLabel,
  normalizeMakeupCancelReason,
  validateReasonFromSource,
  stableMakeupCancelActionClientMessageId,
  prepareMakeupCancelAction,
  createPrepareMakeupCancelTool,
};
