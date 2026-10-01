'use strict';

const crypto = require('node:crypto');
const { callSupabaseRpc } = require('../supabase-rpc.cjs');
const {
  normalizeTimetableMode,
  weekdayLabel,
  timeLabel,
} = require('./schedule-tools.cjs');
const {
  parseDateKey,
  nextOccurrenceKey,
  mondayKey,
  loadPrivateStudent,
} = require('./pickup-prepare-tools.cjs');
const {
  resolveTargetClassTime,
  activePickupCandidates,
  pickupDropoffLabel,
} = require('./pickup-update-prepare-tools.cjs');

const VALID_CANCEL_KINDS = new Set(['all', 'dropoff']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function pickupCancelError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_PICKUP_CANCEL_PREPARE_ERROR'
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeCancelKind(value) {
  const kind = clean(value).toLowerCase();
  if (!VALID_CANCEL_KINDS.has(kind)) {
    throw pickupCancelError(
      '픽업 삭제 종류를 확인해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_CANCEL_KIND_INVALID'
    );
  }
  return kind;
}

function stablePickupCancelClientMessageId({ academyId, memberId, requestId }) {
  const request = clean(requestId);
  if (!request || request.length > 160) {
    throw pickupCancelError(
      '픽업 삭제 준비 요청 식별값이 없습니다.',
      400,
      'OLLI_AGENT_PICKUP_CANCEL_REQUEST_ID_REQUIRED'
    );
  }
  const hex = crypto
    .createHash('sha256')
    .update([
      'olli-agent-pickup-cancel-v1',
      clean(academyId),
      clean(memberId),
      request,
      'pickup_cancel',
    ].join('|'))
    .digest('hex')
    .slice(0, 32);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function cancelPrompt({ studentName, weekday, classTimeText, cancelKind }) {
  const lines = [
    clean(studentName) + ' · ' + weekdayLabel(weekday) + ' ' + clean(classTimeText) + ' 수업',
  ];
  lines.push(cancelKind === 'dropoff'
    ? '하원 픽업만 삭제할까요?'
    : '픽업 일정을 삭제할까요?');
  return lines.join('\n');
}

async function preparePickupCancelAction({
  requestContext,
  subjectAccess,
  studentLabel,
  cancelKind,
  weekday = 0,
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
    throw pickupCancelError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_PICKUP_CANCEL_PRIVACY_MISSING'
    );
  }

  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label);
  if (!subject?.studentId) {
    throw pickupCancelError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }
  if (clean(subject.division).toLowerCase() !== 'kinder') {
    throw pickupCancelError(
      '픽업 삭제는 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_CANCEL_KINDER_ONLY'
    );
  }

  const kind = normalizeCancelKind(cancelKind);
  const targetWeekday = Number(weekday || 0);
  if (!Number.isInteger(targetWeekday) || targetWeekday < 0 || targetWeekday > 6) {
    throw pickupCancelError(
      '픽업 수업 요일은 월요일부터 토요일까지 지정하거나 생략해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_CANCEL_WEEKDAY_INVALID'
    );
  }

  const baseDate = parseDateKey(currentDate);
  if (!baseDate) {
    throw pickupCancelError(
      '픽업 삭제 기준 날짜를 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_PICKUP_CANCEL_CURRENT_DATE_INVALID'
    );
  }

  const effectiveDate = baseDate.key;
  const lookupDate = targetWeekday
    ? nextOccurrenceKey(baseDate.key, targetWeekday)
    : baseDate.key;
  const weekStart = mondayKey(lookupDate);
  const commonParams = {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
  };

  const student = await loadPrivateStudent({
    requestContext,
    studentId:subject.studentId,
    callRpc,
  });

  const weekData = await callRpc('olli_schedule_week', {
    ...commonParams,
    p_week_start:weekStart,
  });
  if (!weekData?.ok) {
    throw pickupCancelError(
      weekData?.message || '기존 픽업 일정을 확인하지 못했습니다.',
      403,
      weekData?.code || 'OLLI_AGENT_PICKUP_CANCEL_WEEK_READ_FAILED'
    );
  }

  const mode = normalizeTimetableMode(weekData?.timetable_mode);
  const classTime = resolveTargetClassTime({
    timetableMode:mode,
    classHour,
    classMinute,
  });

  let rows = activePickupCandidates({
    weekData,
    studentId:subject.studentId,
    lookupDate,
    weekday:targetWeekday,
    classTime,
  });
  if (kind === 'dropoff') {
    rows = rows.filter((row) =>
      row?.is_dropoff === true || !!pickupDropoffLabel(row)
    );
  }

  if (!rows.length) {
    throw pickupCancelError(
      '삭제할 픽업 일정을 찾지 못했습니다.',
      404,
      'OLLI_AGENT_PICKUP_CANCEL_NOT_FOUND'
    );
  }
  if (rows.length > 1) {
    throw pickupCancelError(
      '삭제할 픽업 일정이 여러 개 있습니다. 수업 요일과 시간을 함께 알려 주세요.',
      409,
      'OLLI_AGENT_PICKUP_CANCEL_AMBIGUOUS'
    );
  }

  const row = rows[0];
  const rowWeekday = Number(row?.weekday || 0);
  const rowClassTime = Number(row?.class_time || 0);
  const pickupId = clean(row?.id);
  if (
    !pickupId ||
    rowWeekday < 1 || rowWeekday > 6 ||
    !Number.isInteger(rowClassTime) || rowClassTime <= 0
  ) {
    throw pickupCancelError(
      '삭제할 픽업 일정 정보를 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_PICKUP_CANCEL_TARGET_INVALID'
    );
  }

  const classTimeText = timeLabel('kinder', rowWeekday, rowClassTime, mode);
  const actionType = kind === 'dropoff'
    ? 'cancel_pickup_dropoff'
    : 'cancel_pickup';
  const actionPayload = {
    intent:actionType,
    studentId:clean(subject.studentId),
    studentName:student.name,
    pickupId,
    weekday:rowWeekday,
    classTime:rowClassTime,
    effectiveDate,
  };

  const replyId = replyToMessageId == null ? null : Number(replyToMessageId);
  if (replyId != null && (!Number.isSafeInteger(replyId) || replyId <= 0)) {
    throw pickupCancelError(
      '픽업 원문 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_INVALID'
    );
  }

  const sent = await callRpc('olli_team_chat_send_action', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:cancelPrompt({
      studentName:student.name,
      weekday:rowWeekday,
      classTimeText,
      cancelKind:kind,
    }),
    p_action_type:actionType,
    p_action_payload:actionPayload,
    p_client_message_id:stablePickupCancelClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if (!sent?.ok || !sent?.message?.action) {
    throw pickupCancelError(
      sent?.message || '픽업 삭제 확인 카드를 저장하지 못했습니다.',
      500,
      'OLLI_AGENT_PICKUP_CANCEL_ACTION_STORE_FAILED'
    );
  }

  if (typeof capturePersistedMessage === 'function') {
    capturePersistedMessage(sent.message);
  }

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:actionType,
    student_label:label,
    weekday:rowWeekday,
    weekday_label:weekdayLabel(rowWeekday),
    class_time_label:classTimeText,
    timetable_mode:mode,
    cancel_kind:kind,
    effective_date:kind === 'all' ? effectiveDate : '',
  });
}

function createPreparePickupCancelTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  studentLabel,
  cancelKind,
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw pickupCancelError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'prepare_pickup_cancel',
    description:
      '유치부 학생의 기존 픽업 삭제를 실제 실행하지 않고 Team Chat 확인 대기 카드로 준비합니다. 서버가 삭제 종류와 적용일을 고정하고 기존 픽업 row를 다시 찾아 pickupId를 확정합니다.',
    parameters:z.object({
      weekday:z.number().int().min(0).max(6),
      class_hour:z.number().int().min(0).max(12),
      class_minute:z.union([z.literal(0), z.literal(30)]),
    }),
    async execute({ weekday, class_hour, class_minute }) {
      const payload = await preparePickupCancelAction({
        requestContext,
        subjectAccess,
        studentLabel,
        cancelKind,
        weekday,
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
  normalizeCancelKind,
  stablePickupCancelClientMessageId,
  preparePickupCancelAction,
  createPreparePickupCancelTool,
};
