'use strict';

const crypto = require('node:crypto');
const { callSupabaseRpc } = require('../supabase-rpc.cjs');
const {
  DATE_PATTERN,
  HALF_HOUR_LABELS,
  normalizeTimetableMode,
  weekdayLabel,
  timeLabel,
} = require('./schedule-tools.cjs');

const VALID_PICKUP_KINDS = new Set(['arrival', 'dropoff', 'both']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function pickupPrepareError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_PICKUP_PREPARE_ERROR'
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseDateKey(value) {
  const candidate = clean(value);
  if (!DATE_PATTERN.test(candidate)) return null;
  const [year, month, day] = candidate.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return { key:candidate, timestamp };
}

function isoWeekday(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return 0;
  const day = new Date(parsed.timestamp).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDaysKey(dateKey, amount) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return '';
  return new Date(parsed.timestamp + (Number(amount || 0) * 86400000))
    .toISOString().slice(0, 10);
}

function nextOccurrenceKey(dateKey, weekday) {
  const current = isoWeekday(dateKey);
  const target = Number(weekday || 0);
  if (!current || target < 1 || target > 6) return '';
  return addDaysKey(dateKey, (target - current + 7) % 7);
}

function mondayKey(dateKey) {
  const weekday = isoWeekday(dateKey);
  if (!weekday) return '';
  return addDaysKey(dateKey, -(weekday - 1));
}

function normalizePickupKind(value) {
  const kind = clean(value).toLowerCase();
  if (!VALID_PICKUP_KINDS.has(kind)) {
    throw pickupPrepareError(
      '픽업 종류를 확인해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_KIND_INVALID'
    );
  }
  return kind;
}

function normalizeClockTime(value) {
  const match = clean(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return match[1] + ':' + match[2];
}

function visibleTimeLabel(hour, minute) {
  const h = Number(hour || 0);
  const m = Number(minute || 0);
  if (!Number.isInteger(h) || h < 1 || h > 12 || ![0, 30].includes(m)) return '';
  return String(h) + '시' + (m === 30 ? ' 30분' : '');
}

function encodePickupClassTime(timetableMode, hour, minute) {
  const mode = normalizeTimetableMode(timetableMode);
  const label = visibleTimeLabel(hour, minute);
  if (!label) return 0;

  if (mode === 'half_hour') {
    const found = Object.entries(HALF_HOUR_LABELS.kinder || {})
      .find(([, candidate]) => candidate === label);
    return found ? Number(found[0]) : 0;
  }

  if (Number(minute || 0) !== 0) return 0;
  const h = Number(hour || 0);
  return h === 4 || h === 5 ? h : 0;
}

function effectiveOn(row, dateKey) {
  const from = clean(row?.effective_from).slice(0, 10);
  const to = clean(row?.effective_to).slice(0, 10);
  return (!from || from <= dateKey) && (!to || to >= dateKey);
}

function hasExistingPickup(weekData, studentId, weekday, classTime, effectiveDate) {
  return (Array.isArray(weekData?.pickups) ? weekData.pickups : [])
    .some((row) =>
      clean(row?.student_id) === clean(studentId) &&
      Number(row?.weekday || 0) === Number(weekday) &&
      Number(row?.class_time || 0) === Number(classTime) &&
      effectiveOn(row, effectiveDate)
    );
}

function stablePickupActionClientMessageId({ academyId, memberId, requestId }) {
  const request = clean(requestId);
  if (!request || request.length > 160) {
    throw pickupPrepareError(
      '픽업 준비 요청 식별값이 없습니다.',
      400,
      'OLLI_AGENT_PICKUP_REQUEST_ID_REQUIRED'
    );
  }
  const hex = crypto
    .createHash('sha256')
    .update([
      'olli-agent-pickup-add-v1',
      clean(academyId),
      clean(memberId),
      request,
      'add_pickup',
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

function actionPrompt({
  studentName,
  weekday,
  timeText,
  pickupKind,
  arrivalLabel,
  arrivalTime,
  dropoffLabel,
}) {
  const lines = [
    clean(studentName) + ' · ' + weekdayLabel(weekday) + ' ' + clean(timeText) + ' 수업',
  ];
  if (pickupKind === 'arrival' || pickupKind === 'both') {
    lines.push('등원: ' + clean(arrivalLabel) + ' · ' + clean(arrivalTime));
  }
  if (pickupKind === 'dropoff' || pickupKind === 'both') {
    lines.push('하원: ' + clean(dropoffLabel));
  }
  lines.push('등록할까요?');
  return lines.join('\n');
}

async function loadPrivateStudent({
  requestContext,
  studentId,
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
    throw pickupPrepareError(
      result?.message || '학생 정보를 확인하지 못했습니다.',
      403,
      result?.code || 'OLLI_AGENT_PICKUP_STUDENT_READ_FAILED'
    );
  }

  const row = Array.isArray(result.rows) ? result.rows[0] : null;
  if (
    !row ||
    clean(row.id) !== clean(studentId) ||
    clean(row.division).toLowerCase() !== 'kinder' ||
    clean(row.status).toLowerCase() !== 'active' ||
    row.is_deleted === true
  ) {
    throw pickupPrepareError(
      '픽업 등록은 현재 재원 중인 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_KINDER_ACTIVE_REQUIRED'
    );
  }

  const name = clean(row.name);
  if (!name) {
    throw pickupPrepareError(
      '학생 이름을 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_PICKUP_STUDENT_NAME_MISSING'
    );
  }

  return { name };
}

async function preparePickupAddAction({
  requestContext,
  subjectAccess,
  studentLabel,
  pickupKind,
  weekday,
  classHour,
  classMinute,
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
    throw pickupPrepareError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_PICKUP_PRIVACY_MISSING'
    );
  }

  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label);
  if (!subject?.studentId) {
    throw pickupPrepareError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }
  if (clean(subject.division).toLowerCase() !== 'kinder') {
    throw pickupPrepareError(
      '픽업 등록은 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_KINDER_ONLY'
    );
  }

  const kind = normalizePickupKind(pickupKind);
  const targetWeekday = Number(weekday || 0);
  if (!Number.isInteger(targetWeekday) || targetWeekday < 1 || targetWeekday > 6) {
    throw pickupPrepareError(
      '픽업 수업 요일은 월요일부터 토요일까지 지정해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_WEEKDAY_INVALID'
    );
  }

  const baseDate = parseDateKey(currentDate);
  if (!baseDate) {
    throw pickupPrepareError(
      '픽업 적용 기준 날짜를 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_PICKUP_CURRENT_DATE_INVALID'
    );
  }

  const normalizedArrivalLabel = clean(arrivalLabel).slice(0, 80);
  const normalizedArrivalTime = normalizeClockTime(arrivalTime);
  const normalizedDropoffLabel = clean(dropoffLabel).slice(0, 80);

  if (
    (kind === 'arrival' || kind === 'both') &&
    (!normalizedArrivalLabel || !normalizedArrivalTime)
  ) {
    throw pickupPrepareError(
      '등원 픽업은 장소와 시간을 함께 알려 주세요.',
      400,
      'OLLI_AGENT_PICKUP_ARRIVAL_REQUIRED'
    );
  }
  if (
    (kind === 'dropoff' || kind === 'both') &&
    !normalizedDropoffLabel
  ) {
    throw pickupPrepareError(
      '하원 픽업은 하원 장소를 함께 알려 주세요.',
      400,
      'OLLI_AGENT_PICKUP_DROPOFF_REQUIRED'
    );
  }

  const commonParams = {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
  };
  const student = await loadPrivateStudent({
    requestContext,
    studentId:subject.studentId,
    callRpc,
  });
  const settings = await callRpc('olli_academy_settings_get', commonParams);
  if (!settings?.ok) {
    throw pickupPrepareError(
      settings?.message || '학원 시간표 설정을 확인하지 못했습니다.',
      403,
      settings?.code || 'OLLI_AGENT_TIMETABLE_MODE_FAILED'
    );
  }

  const mode = normalizeTimetableMode(settings?.academy?.kinder_timetable_mode);
  const classTime = encodePickupClassTime(mode, classHour, classMinute);
  if (!classTime) {
    throw pickupPrepareError(
      '현재 시간표 모드에서 사용할 수 있는 유치부 수업 시간을 확인해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_CLASS_TIME_INVALID'
    );
  }

  const effectiveDate = nextOccurrenceKey(baseDate.key, targetWeekday);
  const weekStart = mondayKey(effectiveDate);
  const weekData = await callRpc('olli_schedule_week', {
    ...commonParams,
    p_week_start:weekStart,
  });
  if (!weekData?.ok) {
    throw pickupPrepareError(
      weekData?.message || '기존 픽업 일정을 확인하지 못했습니다.',
      403,
      weekData?.code || 'OLLI_AGENT_PICKUP_WEEK_READ_FAILED'
    );
  }

  if (hasExistingPickup(
    weekData,
    subject.studentId,
    targetWeekday,
    classTime,
    effectiveDate
  )) {
    throw pickupPrepareError(
      '같은 학생의 같은 요일·수업 시간에 이미 픽업 일정이 있습니다. 기존 픽업 수정 기능을 사용해 주세요.',
      409,
      'OLLI_AGENT_PICKUP_ALREADY_EXISTS'
    );
  }

  const timeText = timeLabel('kinder', targetWeekday, classTime, mode);
  const isDropoffOnly = kind === 'dropoff';
  const replyId = replyToMessageId == null ? null : Number(replyToMessageId);
  if (replyId != null && (!Number.isSafeInteger(replyId) || replyId <= 0)) {
    throw pickupPrepareError(
      '픽업 원문 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_INVALID'
    );
  }
  const actionPayload = {
    intent:'add_pickup',
    studentId:clean(subject.studentId),
    studentName:student.name,
    division:'kinder',
    weekday:targetWeekday,
    classTime,
    timetableMode:mode,
    pickupLabel:isDropoffOnly ? '' : normalizedArrivalLabel,
    pickupTime:isDropoffOnly ? '' : normalizedArrivalTime,
    dropoffLabel:(kind === 'dropoff' || kind === 'both') ? normalizedDropoffLabel : '',
    effectiveDate,
    isDropoff:isDropoffOnly,
  };

  const sent = await callRpc('olli_team_chat_send_action', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:actionPrompt({
      studentName:student.name,
      weekday:targetWeekday,
      timeText,
      pickupKind:kind,
      arrivalLabel:normalizedArrivalLabel,
      arrivalTime:normalizedArrivalTime,
      dropoffLabel:normalizedDropoffLabel,
    }),
    p_action_type:'add_pickup',
    p_action_payload:actionPayload,
    p_client_message_id:stablePickupActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
    }),
    p_reply_to_message_id:replyId,
  });

  if (!sent?.ok || !sent?.message?.action) {
    throw pickupPrepareError(
      sent?.message || '픽업 확인 카드를 저장하지 못했습니다.',
      500,
      'OLLI_AGENT_PICKUP_ACTION_STORE_FAILED'
    );
  }

  if (typeof capturePersistedMessage === 'function') {
    capturePersistedMessage(sent.message);
  }

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:'add_pickup',
    student_label:label,
    weekday:targetWeekday,
    weekday_label:weekdayLabel(targetWeekday),
    effective_date:effectiveDate,
    class_time_label:timeText,
    timetable_mode:mode,
    pickup_kind:kind,
    arrival_label:(kind === 'arrival' || kind === 'both') ? normalizedArrivalLabel : '',
    arrival_time:(kind === 'arrival' || kind === 'both') ? normalizedArrivalTime : '',
    dropoff_label:(kind === 'dropoff' || kind === 'both') ? normalizedDropoffLabel : '',
  });
}

function createPreparePickupAddTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  studentLabel,
  pickupKind,
  currentDate,
  requestId,
  replyToMessageId = null,
  capturePersistedMessage = null,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw pickupPrepareError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'prepare_pickup_add',
    description:
      '유치부 학생의 등원·하원 픽업 추가를 실제 실행하지 않고 Team Chat 확인 대기 카드로 준비합니다. 확인 버튼을 누르기 전에는 픽업 데이터가 변경되지 않습니다.',
    parameters:z.object({
      weekday:z.number().int().min(1).max(6),
      class_hour:z.number().int().min(1).max(12),
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
      const payload = await preparePickupAddAction({
        requestContext,
        subjectAccess,
        studentLabel,
        pickupKind,
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
  parseDateKey,
  isoWeekday,
  nextOccurrenceKey,
  mondayKey,
  normalizeClockTime,
  visibleTimeLabel,
  encodePickupClassTime,
  effectiveOn,
  hasExistingPickup,
  loadPrivateStudent,
  stablePickupActionClientMessageId,
  preparePickupAddAction,
  createPreparePickupAddTool,
};
