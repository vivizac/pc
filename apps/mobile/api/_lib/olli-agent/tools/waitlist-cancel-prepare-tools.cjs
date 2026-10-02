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

function waitlistCancelError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_WAITLIST_CANCEL_PREPARE_ERROR'
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeRequestedGroup(value) {
  const group = clean(value).toUpperCase() || 'AUTO';
  if (!['AUTO', 'A', 'B'].includes(group)) {
    throw waitlistCancelError(
      '취소할 대기 반을 확인해 주세요.',
      400,
      'OLLI_AGENT_WAITLIST_CANCEL_GROUP_INVALID'
    );
  }
  return group;
}

function requestedTimeLabel(hour, minute) {
  const h = Number(hour || 0);
  const m = Number(minute || 0);
  if (h === 0 && m === 0) return '';
  if (!Number.isInteger(h) || h < 1 || h > 12 || ![0, 30].includes(m)) {
    throw waitlistCancelError(
      '취소할 대기 시간을 확인해 주세요.',
      400,
      'OLLI_AGENT_WAITLIST_CANCEL_TIME_INVALID'
    );
  }
  return String(h) + '시' + (m === 30 ? ' 30분' : '');
}

function stableWaitlistCancelActionClientMessageId({ academyId, memberId, requestId }) {
  const request = clean(requestId);
  if (!request || request.length > 160) {
    throw waitlistCancelError(
      '대기 취소 준비 요청 식별값이 없습니다.',
      400,
      'OLLI_AGENT_WAITLIST_CANCEL_REQUEST_ID_REQUIRED'
    );
  }
  const hex = crypto
    .createHash('sha256')
    .update([
      'olli-agent-waitlist-cancel-v1',
      clean(academyId),
      clean(memberId),
      request,
      'cancel_waitlist',
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

function weekdayFromDateKey(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return 0;
  const day = new Date(parsed.timestamp).getUTCDay();
  return day === 0 ? 7 : day;
}

function weekdayLabel(weekday) {
  return ['', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'][Number(weekday || 0)] || '';
}

function rowGroup(row) {
  return clean(row?.target_class_group).toUpperCase() === 'B' ? 'B' : 'A';
}

function cancelPrompt({ studentName, targetWeekday, timeText, classGroup, grouped }) {
  const groupText = grouped ? ' ' + classGroup + '반' : '';
  return [
    clean(studentName) + ' · ' + weekdayLabel(targetWeekday) + ' ' + clean(timeText) + groupText,
    '대기를 취소할까요?',
  ].join('\n');
}

async function prepareWaitlistCancelAction({
  requestContext,
  subjectAccess,
  guestAccess = null,
  studentLabel,
  division,
  classGroup = 'AUTO',
  waitlistDate = '',
  classHour = 0,
  classMinute = 0,
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  sanitizePayload,
  callRpc = callSupabaseRpc,
}) {
  if (typeof sanitizePayload !== 'function') {
    throw waitlistCancelError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_WAITLIST_CANCEL_PRIVACY_MISSING'
    );
  }

  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label) || null;
  const guest = guestAccess?.resolve?.(label) || null;
  const isGuest = !subject?.studentId && !!clean(guest?.guestName);
  if (!subject?.studentId && !isGuest) {
    throw waitlistCancelError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }

  const requestedDivision = clean(division || guest?.division).toLowerCase();
  if (requestedDivision && !['elementary', 'kinder'].includes(requestedDivision)) {
    throw waitlistCancelError(
      '취소할 대기 학생의 수업 구분을 확인해 주세요.',
      400,
      'OLLI_AGENT_WAITLIST_CANCEL_DIVISION_INVALID'
    );
  }
  if (!isGuest && (!requestedDivision || clean(subject.division).toLowerCase() !== requestedDivision)) {
    throw waitlistCancelError(
      '취소할 대기 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_WAITLIST_CANCEL_DIVISION_MISMATCH'
    );
  }

  const today = parseDateKey(currentDate);
  if (!today) {
    throw waitlistCancelError(
      '대기 취소 기준 날짜를 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_WAITLIST_CANCEL_CURRENT_DATE_INVALID'
    );
  }

  const explicitDate = clean(waitlistDate);
  const sourceDate = explicitDate ? parseDateKey(explicitDate) : null;
  if (explicitDate && !sourceDate) {
    throw waitlistCancelError(
      '취소할 대기 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',
      400,
      'OLLI_AGENT_WAITLIST_CANCEL_DATE_INVALID'
    );
  }

  const requestedWeekday = sourceDate ? weekdayFromDateKey(sourceDate.key) : 0;
  if (requestedWeekday > 6) {
    throw waitlistCancelError(
      '일요일 대기 수업은 지원하지 않습니다.',
      400,
      'OLLI_AGENT_WAITLIST_CANCEL_WEEKDAY_INVALID'
    );
  }

  const requestedGroup = normalizeRequestedGroup(classGroup);
  const requestedTime = requestedTimeLabel(classHour, classMinute);

  const student = isGuest ? null : await loadPrivateMakeupStudent({
    requestContext,
    studentId:subject.studentId,
    expectedDivision:requestedDivision,
    callRpc,
  });
  const subjectStudentId = isGuest ? '' : clean(subject.studentId);
  const subjectName = isGuest ? clean(guest.guestName) : clean(student?.name);

  const weekData = await callRpc('olli_schedule_week', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(today.key),
  });
  if (!weekData?.ok) {
    throw waitlistCancelError(
      weekData?.message || '현재 대기 정보를 확인하지 못했습니다.',
      403,
      weekData?.code || 'OLLI_AGENT_WAITLIST_CANCEL_WEEK_READ_FAILED'
    );
  }

  const mode = normalizeTimetableMode(weekData?.timetable_mode);
  let rows = (Array.isArray(weekData?.waitlist) ? weekData.waitlist : [])
    .filter((row) => {
      const sameSubject = isGuest
        ? row?.is_guest === true && clean(row?.guest_name || row?.student_name).toLowerCase() === subjectName.toLowerCase()
        : clean(row?.student_id) === subjectStudentId && row?.is_guest !== true;
      if (!sameSubject || !['waiting', 'offered'].includes(clean(row?.status).toLowerCase())) return false;
      if (!requestedDivision) return true;
      return clean(row?.target_division || row?.division || row?.guest_division).toLowerCase() === requestedDivision;
    });

  if (requestedWeekday) {
    rows = rows.filter((row) => Number(row?.target_weekday || 0) === requestedWeekday);
  }

  if (requestedTime) {
    rows = rows.filter((row) => {
      const rowWeekday = Number(row?.target_weekday || 0);
      const rowSlot = Number(row?.target_time_slot || 0);
      if (rowWeekday < 1 || rowWeekday > 6 || rowSlot <= 0) return false;
      const rowDivision = clean(row?.target_division || row?.division || row?.guest_division || requestedDivision).toLowerCase();
      return clean(timeLabel(rowDivision, rowWeekday, rowSlot, mode)) === requestedTime;
    });
  }

  if (requestedGroup !== 'AUTO') {
    rows = rows.filter((row) => rowGroup(row) === requestedGroup);
  }

  rows.sort((a, b) =>
    Number(a?.target_weekday || 0) - Number(b?.target_weekday || 0) ||
    Number(a?.target_time_slot || 0) - Number(b?.target_time_slot || 0) ||
    rowGroup(a).localeCompare(rowGroup(b)) ||
    clean(a?.desired_effective_date).localeCompare(clean(b?.desired_effective_date))
  );

  if (!rows.length) {
    throw waitlistCancelError(
      '취소할 대기 정보를 찾지 못했습니다.',
      404,
      'OLLI_AGENT_WAITLIST_CANCEL_NOT_FOUND'
    );
  }
  if (rows.length > 1) {
    throw waitlistCancelError(
      '취소할 대기가 여러 개 있습니다. 요일과 시간을 함께 알려 주세요.',
      409,
      'OLLI_AGENT_WAITLIST_CANCEL_AMBIGUOUS'
    );
  }

  const row = rows[0];
  const fixedDivision = requestedDivision || clean(row?.target_division || row?.division || row?.guest_division).toLowerCase();
  if (!['elementary','kinder'].includes(fixedDivision)) {
    throw waitlistCancelError(
      '취소할 대기의 수업 구분을 서버에서 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_WAITLIST_CANCEL_SOURCE_DIVISION_INVALID'
    );
  }
  const waitlistId = clean(row?.id);
  const targetWeekday = Number(row?.target_weekday || 0);
  const targetTimeSlot = Number(row?.target_time_slot || 0);
  const targetClassGroup = rowGroup(row);
  const timeText = timeLabel(fixedDivision, targetWeekday, targetTimeSlot, mode);

  if (
    !waitlistId ||
    targetWeekday < 1 ||
    targetWeekday > 6 ||
    !Number.isInteger(targetTimeSlot) ||
    targetTimeSlot <= 0 ||
    !clean(timeText)
  ) {
    throw waitlistCancelError(
      '취소할 대기 정보를 서버에서 확정하지 못했습니다.',
      500,
      'OLLI_AGENT_WAITLIST_CANCEL_TARGET_INVALID'
    );
  }

  const replyId = replyToMessageId == null ? null : Number(replyToMessageId);
  if (replyId != null && (!Number.isSafeInteger(replyId) || replyId <= 0)) {
    throw waitlistCancelError(
      '대기 원문 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_INVALID'
    );
  }

  const actionPayload = {
    intent:'cancel_waitlist',
    studentId:subjectStudentId,
    studentName:subjectName,
    guestName:isGuest ? subjectName : '',
    division:fixedDivision,
    waitlistId,
    targetWeekday,
    targetTimeSlot,
    targetClassGroup,
    effectiveDate:today.key,
    isGuest,
  };

  const grouped = requestedGroup !== 'AUTO' || targetClassGroup === 'B';
  const sent = await callRpc('olli_team_chat_send_action', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:cancelPrompt({
      studentName:subjectName,
      targetWeekday,
      timeText,
      classGroup:targetClassGroup,
      grouped,
    }),
    p_action_type:'cancel_waitlist',
    p_action_payload:actionPayload,
    p_client_message_id:stableWaitlistCancelActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if (!sent?.ok || !sent?.message?.action) {
    throw waitlistCancelError(
      sent?.message || '대기 취소 확인 카드를 저장하지 못했습니다.',
      500,
      'OLLI_AGENT_WAITLIST_CANCEL_ACTION_STORE_FAILED'
    );
  }

  if (typeof capturePersistedMessage === 'function') {
    capturePersistedMessage(sent.message);
  }

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'cancel_waitlist',
    student_label:label,
    target_weekday:targetWeekday,
    weekday_label:weekdayLabel(targetWeekday),
    time_label:timeText,
    class_group:targetClassGroup,
    timetable_mode:mode,
  });
}

function createPrepareWaitlistCancelTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  guestAccess = null,
  studentLabel,
  division,
  classGroup,
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw waitlistCancelError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'prepare_waitlist_cancel',
    description:
      '재원생의 현재 대기 항목을 실제 취소하지 않고 Team Chat 확인 대기 카드로 준비합니다. 서버가 현재 waitlist row를 다시 조회해 정확한 항목을 확정하며, 확인 전에는 대기 데이터가 변경되지 않습니다.',
    parameters:z.object({
      waitlist_date:z.string(),
      class_hour:z.number().int().min(0).max(12),
      class_minute:z.union([z.literal(0), z.literal(30)]),
    }),
    async execute({ waitlist_date, class_hour, class_minute }) {
      const payload = await prepareWaitlistCancelAction({
        requestContext,
        subjectAccess,
        guestAccess,
        studentLabel,
        division,
        classGroup,
        waitlistDate:waitlist_date,
        classHour:class_hour,
        classMinute:class_minute,
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
  stableWaitlistCancelActionClientMessageId,
  weekdayFromDateKey,
  prepareWaitlistCancelAction,
  createPrepareWaitlistCancelTool,
};
