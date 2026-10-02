'use strict';

const { callSupabaseRpc } = require('../supabase-rpc.cjs');
const {
  DATE_PATTERN,
  weekdayLabel,
  timeLabel,
  normalizeTimetableMode,
} = require('./schedule-tools.cjs');

const MAX_PICKUP_DAYS = 62;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function pickupToolError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_PICKUP_TOOL_ERROR'
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
  ) {
    return null;
  }
  return { key:candidate, timestamp };
}

function normalizeDateRange(startDate, endDate) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end) {
    throw pickupToolError(
      '픽업 조회 날짜는 YYYY-MM-DD 형식이어야 합니다.',
      400,
      'OLLI_AGENT_PICKUP_DATE_INVALID'
    );
  }
  if (end.timestamp < start.timestamp) {
    throw pickupToolError(
      '픽업 조회 종료 날짜는 시작 날짜보다 빠를 수 없습니다.',
      400,
      'OLLI_AGENT_PICKUP_RANGE_INVALID'
    );
  }
  const days = Math.floor((end.timestamp - start.timestamp) / 86400000) + 1;
  if (days > MAX_PICKUP_DAYS) {
    throw pickupToolError(
      '한 번에 조회할 수 있는 픽업 기간은 최대 ' + MAX_PICKUP_DAYS + '일입니다.',
      400,
      'OLLI_AGENT_PICKUP_RANGE_TOO_WIDE'
    );
  }
  return { startDate:start.key, endDate:end.key, days };
}

function normalizeTime(value) {
  const match = clean(value).match(/^(\d{2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return match[1] + ':' + match[2];
}

function normalizePickup(row, division, timetableMode) {
  if (!row || typeof row !== 'object') return null;
  const date = clean(row.date).slice(0, 10);
  const weekday = Number(row.weekday || 0);
  const classTime = Number(row.class_time || 0);

  if (
    !DATE_PATTERN.test(date) ||
    weekday < 1 || weekday > 6 ||
    !Number.isInteger(classTime) || classTime < 1 || classTime > 12
  ) {
    return null;
  }

  const hasArrival = row.has_arrival === true;
  const hasDropoff = row.has_dropoff === true;

  return {
    date,
    weekday,
    weekday_label:weekdayLabel(weekday),
    class_time:classTime,
    class_time_label:timeLabel(division, weekday, classTime, timetableMode),
    has_arrival:hasArrival,
    arrival_label:hasArrival ? clean(row.arrival_label).slice(0, 80) : '',
    arrival_time:hasArrival ? normalizeTime(row.arrival_time) : '',
    has_dropoff:hasDropoff,
    dropoff_label:hasDropoff ? clean(row.dropoff_label).slice(0, 80) : '',
  };
}

function safePickupPayload(raw, settings, studentLabel) {
  if (!raw?.ok) {
    throw pickupToolError(
      raw?.message || '픽업 시간표를 조회하지 못했습니다.',
      403,
      raw?.code || 'OLLI_AGENT_PICKUP_READ_FAILED'
    );
  }
  if (!settings?.ok) {
    throw pickupToolError(
      settings?.message || '학원 시간표 설정을 확인하지 못했습니다.',
      403,
      settings?.code || 'OLLI_AGENT_TIMETABLE_MODE_FAILED'
    );
  }

  const division = clean(raw.division).toLowerCase();
  const timetableMode = normalizeTimetableMode(
    settings?.academy?.kinder_timetable_mode
  );
  const pickups = (Array.isArray(raw.pickups) ? raw.pickups : [])
    .map((row) => normalizePickup(row, division, timetableMode))
    .filter(Boolean);

  const closedDates = (Array.isArray(raw.closed_dates) ? raw.closed_dates : [])
    .map((row) => ({
      date:clean(row?.date).slice(0, 10),
      reason:clean(row?.reason).slice(0, 60),
    }))
    .filter((row) => DATE_PATTERN.test(row.date))
    .slice(0, MAX_PICKUP_DAYS);

  return {
    ok:true,
    student_label:clean(studentLabel),
    division,
    pickup_supported:raw.pickup_supported === true,
    start_date:clean(raw.start_date).slice(0, 10),
    end_date:clean(raw.end_date).slice(0, 10),
    timetable_mode:timetableMode,
    pickups,
    pickup_count:pickups.length,
    closed_dates:closedDates,
  };
}

async function readPickups({
  requestContext,
  subjectAccess,
  studentLabel,
  startDate,
  endDate,
  sanitizePayload,
  callRpc = callSupabaseRpc,
}) {
  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label);
  if (!subject?.studentId) {
    throw pickupToolError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }
  if (typeof sanitizePayload !== 'function') {
    throw pickupToolError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_PICKUP_PRIVACY_MISSING'
    );
  }

  const range = normalizeDateRange(startDate, endDate);
  const [pickups, settings] = await Promise.all([
    callRpc('olli_schedule_student_pickups_range', {
      p_session_token:requestContext.sessionToken,
      p_academy_id:requestContext.academyId,
      p_student_id:subject.studentId,
      p_start_date:range.startDate,
      p_end_date:range.endDate,
    }),
    callRpc('olli_academy_settings_get', {
      p_session_token:requestContext.sessionToken,
      p_academy_id:requestContext.academyId,
    }),
  ]);

  return sanitizePayload(safePickupPayload(pickups, settings, label));
}

function createGetPickupsTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw pickupToolError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'get_pickups',
    description:
      '익명화된 학생 라벨의 날짜 범위 등원·하원 픽업 일정을 읽습니다. 실제 학생 이름이나 ID는 반환하지 않으며 데이터를 변경하지 않습니다.',
    parameters:z.object({
      student_label:z.string().min(2).max(20),
      start_date:z.string().regex(DATE_PATTERN),
      end_date:z.string().regex(DATE_PATTERN),
    }),
    async execute({ student_label, start_date, end_date }) {
      const payload = await readPickups({
        requestContext,
        subjectAccess,
        studentLabel:student_label,
        startDate:start_date,
        endDate:end_date,
        sanitizePayload,
      });
      return JSON.stringify(Object.assign({},payload,{
        pickups:(Array.isArray(payload?.pickups)?payload.pickups:[]).map((row)=>{
          const copy=Object.assign({},row);
          delete copy.class_time;
          return copy;
        })
      }));
    },
  });
}

module.exports = {
  MAX_PICKUP_DAYS,
  normalizeDateRange,
  normalizeTime,
  normalizePickup,
  safePickupPayload,
  readPickups,
  createGetPickupsTool,
};
