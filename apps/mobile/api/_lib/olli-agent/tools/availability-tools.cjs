'use strict';

const { callSupabaseRpc } = require('../supabase-rpc.cjs');
const { DATE_PATTERN, weekdayLabel, timeLabel, normalizeTimetableMode } = require('./schedule-tools.cjs');

const MAX_AVAILABILITY_DAYS = 14;
const VALID_DIVISIONS = new Set(['elementary', 'kinder']);
const VALID_PURPOSES = new Set(['regular', 'makeup', 'trial', 'wait']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function availabilityToolError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_AVAILABILITY_TOOL_ERROR'
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeDivision(value) {
  const division = clean(value).toLowerCase();
  if (!VALID_DIVISIONS.has(division)) {
    throw availabilityToolError(
      '시간표 가용성 조회의 수업 구분이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_AVAILABILITY_DIVISION_INVALID'
    );
  }
  return division;
}

function normalizePurpose(value) {
  const purpose = clean(value).toLowerCase();
  if (!VALID_PURPOSES.has(purpose)) {
    throw availabilityToolError(
      '시간표 가용성 조회 목적이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_AVAILABILITY_PURPOSE_INVALID'
    );
  }
  return purpose;
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
    throw availabilityToolError(
      '조회 날짜는 YYYY-MM-DD 형식이어야 합니다.',
      400,
      'OLLI_AGENT_AVAILABILITY_DATE_INVALID'
    );
  }
  if (end.timestamp < start.timestamp) {
    throw availabilityToolError(
      '조회 종료 날짜는 시작 날짜보다 빠를 수 없습니다.',
      400,
      'OLLI_AGENT_AVAILABILITY_RANGE_INVALID'
    );
  }
  const days = Math.floor((end.timestamp - start.timestamp) / 86400000) + 1;
  if (days > MAX_AVAILABILITY_DAYS) {
    throw availabilityToolError(
      '한 번에 조회할 수 있는 시간표 기간은 최대 ' + MAX_AVAILABILITY_DAYS + '일입니다.',
      400,
      'OLLI_AGENT_AVAILABILITY_RANGE_TOO_WIDE'
    );
  }
  return { startDate:start.key, endDate:end.key, days };
}

function normalizeTimeFilter(value) {
  const parsed = Number(value || 0);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 12) {
    throw availabilityToolError(
      '시간 필터를 확인해 주세요.',
      400,
      'OLLI_AGENT_AVAILABILITY_TIME_INVALID'
    );
  }
  return parsed;
}

function normalizeGroupFilter(value) {
  const group = clean(value).toUpperCase() || 'ALL';
  if (!['ALL','A','B'].includes(group)) {
    throw availabilityToolError(
      '반 필터를 확인해 주세요.',
      400,
      'OLLI_AGENT_AVAILABILITY_GROUP_INVALID'
    );
  }
  return group;
}

function nonNegativeInteger(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function normalizeSlot(row, division, timetableMode) {
  if (!row || typeof row !== 'object') return null;
  const date = clean(row.date).slice(0, 10);
  const weekday = Number(row.weekday || 0);
  const timeSlot = Number(row.time_slot || 0);
  const classGroup = clean(row.class_group).toUpperCase() === 'B' ? 'B' : 'A';

  if (
    !DATE_PATTERN.test(date) ||
    weekday < 1 || weekday > 6 ||
    !Number.isInteger(timeSlot) || timeSlot < 1 || timeSlot > 12
  ) {
    return null;
  }

  return {
    date,
    weekday,
    weekday_label: weekdayLabel(weekday),
    time_slot: timeSlot,
    time_label: timeLabel(division, weekday, timeSlot, timetableMode),
    class_group: classGroup,
    grouped: row.grouped === true,
    capacity: nonNegativeInteger(row.capacity),
    regular_count: nonNegativeInteger(row.regular_count),
    absent_count: nonNegativeInteger(row.absent_count),
    effective_regular_count: nonNegativeInteger(row.effective_regular_count),
    makeup_count: nonNegativeInteger(row.makeup_count),
    trial_count: nonNegativeInteger(row.trial_count),
    one_time_count: nonNegativeInteger(row.one_time_count),
    occupancy: nonNegativeInteger(row.occupancy),
    remaining: nonNegativeInteger(row.remaining),
    waitlist_count: nonNegativeInteger(row.waitlist_count),
    waitlist_open: row.waitlist_open === true,
    class_full: row.class_full === true,
    available: row.available === true,
  };
}

function safeAvailabilityPayload(raw, {
  division,
  purpose,
  startDate,
  endDate,
  timeSlot = 0,
  classGroup = 'ALL',
}) {
  if (!raw?.ok) {
    throw availabilityToolError(
      raw?.message || '시간표 가용성을 조회하지 못했습니다.',
      403,
      raw?.code || 'OLLI_AGENT_AVAILABILITY_READ_FAILED'
    );
  }

  const normalizedDivision = normalizeDivision(division);
  const normalizedPurpose = normalizePurpose(purpose);
  const timetableMode = normalizeTimetableMode(raw.timetable_mode);
  const timeFilter = normalizeTimeFilter(timeSlot);
  const groupFilter = normalizeGroupFilter(classGroup);

  const slots = (Array.isArray(raw.slots) ? raw.slots : [])
    .map((row) => normalizeSlot(row, normalizedDivision, timetableMode))
    .filter(Boolean)
    .filter((slot) => !timeFilter || slot.time_slot === timeFilter)
    .filter((slot) => groupFilter === 'ALL' || slot.class_group === groupFilter)
    .slice(0, 240);

  const closedDates = (Array.isArray(raw.closed_dates) ? raw.closed_dates : [])
    .map((row) => ({
      date: clean(row?.date).slice(0, 10),
      reason: clean(row?.reason).slice(0, 60),
    }))
    .filter((row) => DATE_PATTERN.test(row.date))
    .slice(0, MAX_AVAILABILITY_DAYS);

  return {
    ok: true,
    start_date: startDate,
    end_date: endDate,
    division: normalizedDivision,
    purpose: normalizedPurpose,
    timetable_mode: timetableMode,
    capacity: nonNegativeInteger(raw.capacity),
    slots,
    slot_count: slots.length,
    available_count: slots.filter((slot) => slot.available).length,
    closed_dates: closedDates,
  };
}

async function readScheduleAvailability({
  requestContext,
  division,
  purpose,
  startDate,
  endDate,
  timeSlot = 0,
  classGroup = 'ALL',
  sanitizePayload,
  callRpc = callSupabaseRpc,
}) {
  if (typeof sanitizePayload !== 'function') {
    throw availabilityToolError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_AVAILABILITY_PRIVACY_MISSING'
    );
  }

  const normalizedDivision = normalizeDivision(division);
  const normalizedPurpose = normalizePurpose(purpose);
  const range = normalizeDateRange(startDate, endDate);
  const normalizedTime = normalizeTimeFilter(timeSlot);
  const normalizedGroup = normalizeGroupFilter(classGroup);

  const raw = await callRpc('olli_schedule_availability_slots', {
    p_session_token: requestContext.sessionToken,
    p_academy_id: requestContext.academyId,
    p_start_date: range.startDate,
    p_end_date: range.endDate,
    p_division: normalizedDivision,
    p_purpose: normalizedPurpose,
  });

  const payload = safeAvailabilityPayload(raw, {
    division: normalizedDivision,
    purpose: normalizedPurpose,
    startDate: range.startDate,
    endDate: range.endDate,
    timeSlot: normalizedTime,
    classGroup: normalizedGroup,
  });

  return sanitizePayload(payload);
}

function createGetScheduleAvailabilityTool({
  tool,
  z,
  requestContext,
  division,
  purpose,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw availabilityToolError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  const normalizedDivision = normalizeDivision(division);
  const normalizedPurpose = normalizePurpose(purpose);

  return tool({
    name: 'get_schedule_availability',
    description:
      '현재 학원의 익명 집계 시간표에서 날짜별 수업 정원, 보강·체험 인원, 결석 빈자리, 대기 상태를 읽습니다. 학생 이름이나 ID를 조회하거나 반환하지 않습니다.',
    parameters: z.object({
      start_date: z.string().regex(DATE_PATTERN),
      end_date: z.string().regex(DATE_PATTERN),
      time_slot: z.number().int().min(0).max(12),
      class_group: z.enum(['ALL', 'A', 'B']),
    }),
    async execute({ start_date, end_date, time_slot, class_group }) {
      const payload = await readScheduleAvailability({
        requestContext,
        division: normalizedDivision,
        purpose: normalizedPurpose,
        startDate: start_date,
        endDate: end_date,
        timeSlot: time_slot,
        classGroup: class_group,
        sanitizePayload,
      });
      return JSON.stringify(payload);
    },
  });
}

module.exports = {
  MAX_AVAILABILITY_DAYS,
  normalizeDivision,
  normalizePurpose,
  normalizeDateRange,
  normalizeTimeFilter,
  normalizeGroupFilter,
  normalizeSlot,
  safeAvailabilityPayload,
  readScheduleAvailability,
  createGetScheduleAvailabilityTool,
};
