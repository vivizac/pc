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
  normalizeClockTime,
  encodePickupClassTime,
  effectiveOn,
  loadPrivateStudent,
} = require('./pickup-prepare-tools.cjs');

const VALID_UPDATE_KINDS = new Set(['arrival', 'dropoff']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function pickupUpdateError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_PICKUP_UPDATE_PREPARE_ERROR'
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeUpdateKind(value) {
  const kind = clean(value).toLowerCase();
  if (!VALID_UPDATE_KINDS.has(kind)) {
    throw pickupUpdateError(
      '픽업 수정 종류를 확인해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_KIND_INVALID'
    );
  }
  return kind;
}

function normalizeStoredTime(value) {
  const match = clean(value).match(/^(\d{2}):(\d{2})/);
  if (!match) return '';
  return normalizeClockTime(match[1] + ':' + match[2]);
}

function pickupArrivalLabel(row) {
  return row?.is_dropoff === true ? '' : clean(row?.pickup_label).slice(0, 80);
}

function pickupArrivalTime(row) {
  return row?.is_dropoff === true ? '' : normalizeStoredTime(row?.pickup_time);
}

function pickupDropoffLabel(row) {
  const dedicated = clean(row?.dropoff_label).slice(0, 80);
  if (dedicated) return dedicated;
  return row?.is_dropoff === true ? clean(row?.pickup_label).slice(0, 80) : '';
}

function stablePickupUpdateClientMessageId({ academyId, memberId, requestId }) {
  const request = clean(requestId);
  if (!request || request.length > 160) {
    throw pickupUpdateError(
      '픽업 수정 준비 요청 식별값이 없습니다.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_REQUEST_ID_REQUIRED'
    );
  }
  const hex = crypto
    .createHash('sha256')
    .update([
      'olli-agent-pickup-update-v1',
      clean(academyId),
      clean(memberId),
      request,
      'pickup_update',
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

function resolveTargetClassTime({
  timetableMode,
  classHour,
  classMinute,
}) {
  const hour = Number(classHour || 0);
  const minute = Number(classMinute || 0);

  if (!Number.isInteger(hour) || hour < 0 || hour > 12) {
    throw pickupUpdateError(
      '수업 시간을 확인해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_CLASS_TIME_INVALID'
    );
  }
  if (![0, 30].includes(minute)) {
    throw pickupUpdateError(
      '수업 분은 정시 또는 30분으로 지정해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_CLASS_TIME_INVALID'
    );
  }
  if (hour === 0) {
    if (minute !== 0) {
      throw pickupUpdateError(
        '수업 시간이 없을 때는 분도 0으로 지정해 주세요.',
        400,
        'OLLI_AGENT_PICKUP_UPDATE_CLASS_TIME_INVALID'
      );
    }
    return 0;
  }

  const stored = encodePickupClassTime(timetableMode, hour, minute);
  if (!stored) {
    throw pickupUpdateError(
      '현재 시간표 모드에서 사용할 수 있는 유치부 수업 시간을 확인해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_CLASS_TIME_INVALID'
    );
  }
  return stored;
}

function activePickupCandidates({
  weekData,
  studentId,
  lookupDate,
  weekday,
  classTime,
}) {
  return (Array.isArray(weekData?.pickups) ? weekData.pickups : [])
    .filter((row) => {
      const status = clean(row?.status).toLowerCase();
      if (status && status !== 'active') return false;
      if (clean(row?.student_id) !== clean(studentId)) return false;
      if (!effectiveOn(row, lookupDate)) return false;
      if (Number(weekday || 0) && Number(row?.weekday || 0) !== Number(weekday)) return false;
      if (Number(classTime || 0) && Number(row?.class_time || 0) !== Number(classTime)) return false;
      return true;
    });
}

function updatePrompt({
  studentName,
  weekday,
  classTimeText,
  updateKind,
  arrivalLabel,
  arrivalTime,
  dropoffLabel,
}) {
  const lines = [
    clean(studentName) + ' · ' + weekdayLabel(weekday) + ' ' + clean(classTimeText) + ' 수업',
  ];
  if (updateKind === 'dropoff') {
    lines.push('하원: ' + clean(dropoffLabel));
  } else {
    lines.push('등원: ' + clean(arrivalLabel) + ' · ' + clean(arrivalTime));
  }
  lines.push('수정할까요?');
  return lines.join('\n');
}

async function preparePickupUpdateAction({
  requestContext,
  subjectAccess,
  studentLabel,
  updateKind,
  weekday = 0,
  classHour = 0,
  classMinute = 0,
  arrivalLabel = '',
  arrivalTime = '',
  dropoffLabel = '',
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  sanitizePayload,
  callRpc = callSupabaseRpc,
}) {
  if (typeof sanitizePayload !== 'function') {
    throw pickupUpdateError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_PICKUP_UPDATE_PRIVACY_MISSING'
    );
  }

  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label);
  if (!subject?.studentId) {
    throw pickupUpdateError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }
  if (clean(subject.division).toLowerCase() !== 'kinder') {
    throw pickupUpdateError(
      '픽업 수정은 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_KINDER_ONLY'
    );
  }

  const kind = normalizeUpdateKind(updateKind);
  const targetWeekday = Number(weekday || 0);
  if (!Number.isInteger(targetWeekday) || targetWeekday < 0 || targetWeekday > 6) {
    throw pickupUpdateError(
      '픽업 수업 요일은 월요일부터 토요일까지 지정하거나 생략해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_WEEKDAY_INVALID'
    );
  }

  const baseDate = parseDateKey(currentDate);
  if (!baseDate) {
    throw pickupUpdateError(
      '픽업 수정 기준 날짜를 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_PICKUP_UPDATE_CURRENT_DATE_INVALID'
    );
  }

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
    throw pickupUpdateError(
      weekData?.message || '기존 픽업 일정을 확인하지 못했습니다.',
      403,
      weekData?.code || 'OLLI_AGENT_PICKUP_UPDATE_WEEK_READ_FAILED'
    );
  }

  const mode = normalizeTimetableMode(weekData?.timetable_mode);
  const classTime = resolveTargetClassTime({
    timetableMode:mode,
    classHour,
    classMinute,
  });

  const rows = activePickupCandidates({
    weekData,
    studentId:subject.studentId,
    lookupDate,
    weekday:targetWeekday,
    classTime,
  });

  if (!rows.length) {
    throw pickupUpdateError(
      '수정할 픽업 일정을 찾지 못했습니다.',
      404,
      'OLLI_AGENT_PICKUP_UPDATE_NOT_FOUND'
    );
  }
  if (rows.length > 1) {
    throw pickupUpdateError(
      '수정할 픽업 일정이 여러 개 있습니다. 수업 요일과 시간을 함께 알려 주세요.',
      409,
      'OLLI_AGENT_PICKUP_UPDATE_AMBIGUOUS'
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
    throw pickupUpdateError(
      '수정할 픽업 일정 정보를 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_PICKUP_UPDATE_TARGET_INVALID'
    );
  }

  const classTimeText = timeLabel('kinder', rowWeekday, rowClassTime, mode);
  let actionType = '';
  let actionPayload = null;
  let safeArrivalLabel = '';
  let safeArrivalTime = '';
  let safeDropoffLabel = '';

  if (kind === 'dropoff') {
    safeDropoffLabel = clean(dropoffLabel).slice(0, 80) || pickupDropoffLabel(row);
    if (!safeDropoffLabel) {
      throw pickupUpdateError(
        '수정할 하원 장소를 함께 알려 주세요.',
        400,
        'OLLI_AGENT_PICKUP_UPDATE_DROPOFF_REQUIRED'
      );
    }

    actionType = 'update_pickup_dropoff';
    actionPayload = {
      intent:actionType,
      studentId:clean(subject.studentId),
      studentName:student.name,
      pickupId,
      weekday:rowWeekday,
      classTime:rowClassTime,
      dropoffLabel:safeDropoffLabel,
    };
  } else {
    safeArrivalLabel = clean(arrivalLabel).slice(0, 80) || pickupArrivalLabel(row);
    safeArrivalTime = normalizeClockTime(arrivalTime) || pickupArrivalTime(row);
    if (!safeArrivalLabel || !safeArrivalTime) {
      throw pickupUpdateError(
        '등원 픽업 수정은 장소와 시간을 함께 알려 주세요.',
        400,
        'OLLI_AGENT_PICKUP_UPDATE_ARRIVAL_REQUIRED'
      );
    }

    actionType = 'update_pickup_arrival';
    actionPayload = {
      intent:actionType,
      studentId:clean(subject.studentId),
      studentName:student.name,
      pickupId,
      weekday:rowWeekday,
      classTime:rowClassTime,
      pickupLabel:safeArrivalLabel,
      pickupTime:safeArrivalTime,
    };
  }

  const replyId = replyToMessageId == null ? null : Number(replyToMessageId);
  if (replyId != null && (!Number.isSafeInteger(replyId) || replyId <= 0)) {
    throw pickupUpdateError(
      '픽업 원문 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_INVALID'
    );
  }

  const sent = await callRpc('olli_team_chat_send_action', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:updatePrompt({
      studentName:student.name,
      weekday:rowWeekday,
      classTimeText,
      updateKind:kind,
      arrivalLabel:safeArrivalLabel,
      arrivalTime:safeArrivalTime,
      dropoffLabel:safeDropoffLabel,
    }),
    p_action_type:actionType,
    p_action_payload:actionPayload,
    p_client_message_id:stablePickupUpdateClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if (!sent?.ok || !sent?.message?.action) {
    throw pickupUpdateError(
      sent?.message || '픽업 수정 확인 카드를 저장하지 못했습니다.',
      500,
      'OLLI_AGENT_PICKUP_UPDATE_ACTION_STORE_FAILED'
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
    update_kind:kind,
    arrival_label:kind === 'arrival' ? safeArrivalLabel : '',
    arrival_time:kind === 'arrival' ? safeArrivalTime : '',
    dropoff_label:kind === 'dropoff' ? safeDropoffLabel : '',
  });
}

function createPreparePickupUpdateTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  studentLabel,
  updateKind,
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw pickupUpdateError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'prepare_pickup_update',
    description:
      '유치부 학생의 기존 등원 또는 하원 픽업 수정을 실제 실행하지 않고 Team Chat 확인 대기 카드로 준비합니다. 서버가 기존 픽업 row를 다시 찾아 pickupId를 확정하며, 확인 버튼 전에는 픽업 데이터가 변경되지 않습니다.',
    parameters:z.object({
      weekday:z.number().int().min(0).max(6),
      class_hour:z.number().int().min(0).max(12),
      class_minute:z.union([z.literal(0), z.literal(30)]),
      arrival_label:z.string().max(80),
      arrival_time:z.string().max(5),
      dropoff_label:z.string().max(80),
    }),
    async execute({
      weekday,
      class_hour,
      class_minute,
      arrival_label,
      arrival_time,
      dropoff_label,
    }) {
      const payload = await preparePickupUpdateAction({
        requestContext,
        subjectAccess,
        studentLabel,
        updateKind,
        weekday,
        classHour:class_hour,
        classMinute:class_minute,
        arrivalLabel:arrival_label,
        arrivalTime:arrival_time,
        dropoffLabel:dropoff_label,
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
  normalizeUpdateKind,
  normalizeStoredTime,
  pickupArrivalLabel,
  pickupArrivalTime,
  pickupDropoffLabel,
  stablePickupUpdateClientMessageId,
  resolveTargetClassTime,
  activePickupCandidates,
  preparePickupUpdateAction,
  createPreparePickupUpdateTool,
};
