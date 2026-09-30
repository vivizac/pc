'use strict';

const { callSupabaseRpc } = require('../supabase-rpc.cjs');
const {
  DATE_PATTERN,
  weekdayLabel,
  timeLabel,
  normalizeTimetableMode,
} = require('./schedule-tools.cjs');

const MAX_ATTENDANCE_DAYS = 62;
const SESSION_KINDS = new Set(['ALL', 'regular', 'makeup']);
const REGULAR_STATUSES = new Set(['blank', 'present', 'absent']);
const MAKEUP_STATUSES = new Set(['blank', 'makeup']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function attendanceToolError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_ATTENDANCE_TOOL_ERROR'
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
  return { key:candidate, timestamp, year, month, day };
}

function normalizeDateRange(startDate, endDate) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end) {
    throw attendanceToolError(
      '출결 조회 날짜는 YYYY-MM-DD 형식이어야 합니다.',
      400,
      'OLLI_AGENT_ATTENDANCE_DATE_INVALID'
    );
  }
  if (end.timestamp < start.timestamp) {
    throw attendanceToolError(
      '출결 조회 종료 날짜는 시작 날짜보다 빠를 수 없습니다.',
      400,
      'OLLI_AGENT_ATTENDANCE_RANGE_INVALID'
    );
  }
  const days = Math.floor((end.timestamp - start.timestamp) / 86400000) + 1;
  if (days > MAX_ATTENDANCE_DAYS) {
    throw attendanceToolError(
      '한 번에 조회할 수 있는 출결 기간은 최대 ' + MAX_ATTENDANCE_DAYS + '일입니다.',
      400,
      'OLLI_AGENT_ATTENDANCE_RANGE_TOO_WIDE'
    );
  }
  return { startDate:start.key, endDate:end.key, days };
}

function normalizeSessionKind(value) {
  const raw = clean(value);
  const normalized = raw.toUpperCase() === 'ALL' ? 'ALL' : raw.toLowerCase();
  if (!SESSION_KINDS.has(normalized)) {
    throw attendanceToolError(
      '출결 수업 유형 필터를 확인해 주세요.',
      400,
      'OLLI_AGENT_ATTENDANCE_KIND_INVALID'
    );
  }
  return normalized;
}

function todayInSeoul() {
  return new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function isoWeekday(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return 0;
  const weekday = new Date(parsed.timestamp).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function monthStartsBetween(startDate, endDate) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end) return [];

  const months = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push(
      String(year).padStart(4, '0') + '-' +
      String(month).padStart(2, '0') + '-01'
    );
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function groupOf(row) {
  return clean(row?.class_group).toUpperCase() === 'B' ? 'B' : 'A';
}

function timeOf(row) {
  const timestamp = Date.parse(clean(row?.marked_at));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function overrideKind(row) {
  const explicit = clean(row?.register_session_kind).toLowerCase();
  if (explicit === 'regular' || explicit === 'makeup') return explicit;
  return clean(row?.register_status).toLowerCase() === 'makeup'
    ? 'makeup'
    : 'regular';
}

function sessionsForDate(records, sessionKind) {
  const rows = Array.isArray(records) ? records : [];
  const kind = sessionKind === 'makeup' ? 'makeup' : 'regular';
  const allowedKinds = kind === 'makeup'
    ? ['makeup', 'makeup_expected']
    : ['regular', 'regular_expected'];

  const sessions = new Map();
  rows.forEach((row) => {
    const rowKind = clean(row?.session_kind);
    const rowOverrideKind = rowKind === 'register_override' ? overrideKind(row) : '';
    if (
      !allowedKinds.includes(rowKind) &&
      !(rowKind === 'register_override' && rowOverrideKind === kind)
    ) {
      return;
    }

    const timeSlot = Number(row?.time_slot || 0);
    if (!Number.isInteger(timeSlot) || timeSlot < 1 || timeSlot > 12) return;
    const classGroup = groupOf(row);
    const key = kind + '|' + timeSlot + '|' + classGroup;
    if (!sessions.has(key)) {
      sessions.set(key, { sessionKind:kind, timeSlot, classGroup });
    }
  });

  return Array.from(sessions.values()).sort((a, b) =>
    a.timeSlot - b.timeSlot || a.classGroup.localeCompare(b.classGroup)
  );
}

function finalSessionStatus(
  records,
  sessionDate,
  sessionKind,
  timeSlot,
  classGroup,
  allowCoarseOverride,
  todayKey = todayInSeoul()
) {
  const rows = Array.isArray(records) ? records : [];
  const kind = sessionKind === 'makeup' ? 'makeup' : 'regular';
  const allowed = kind === 'makeup' ? MAKEUP_STATUSES : REGULAR_STATUSES;
  const slot = Number(timeSlot || 0);
  const group = clean(classGroup).toUpperCase() === 'B' ? 'B' : 'A';

  const specificOverride = rows
    .filter((row) =>
      clean(row?.session_kind) === 'register_override' &&
      overrideKind(row) === kind &&
      Number(row?.time_slot || 0) === slot &&
      groupOf(row) === group &&
      allowed.has(clean(row?.register_status))
    )
    .sort((a, b) => timeOf(b) - timeOf(a))[0] || null;

  const coarseOverride = allowCoarseOverride
    ? rows
        .filter((row) =>
          clean(row?.session_kind) === 'register_override' &&
          overrideKind(row) === kind &&
          Number(row?.time_slot || 0) === 0 &&
          allowed.has(clean(row?.register_status))
        )
        .sort((a, b) => timeOf(b) - timeOf(a))[0] || null
    : null;

  const override = specificOverride || coarseOverride;
  const actual = rows
    .filter((row) =>
      clean(row?.session_kind) === kind &&
      Number(row?.time_slot || 0) === slot &&
      groupOf(row) === group &&
      row?.attended !== false
    )
    .sort((a, b) => timeOf(b) - timeOf(a))[0] || null;

  if (override && (!actual || timeOf(override) >= timeOf(actual))) {
    return clean(override.register_status);
  }
  if (actual) return kind === 'makeup' ? 'makeup' : 'present';
  if (kind === 'makeup') return 'blank';

  const expected = rows.some((row) =>
    clean(row?.session_kind) === 'regular_expected' &&
    Number(row?.time_slot || 0) === slot &&
    groupOf(row) === group
  );

  if (expected && clean(sessionDate) < clean(todayKey)) return 'absent';
  return 'blank';
}

function statusLabel(status) {
  if (status === 'present') return '출석';
  if (status === 'absent') return '결석';
  if (status === 'makeup') return '보강';
  return '빈칸';
}

function isSunday(dateKey) {
  return isoWeekday(dateKey) === 7;
}

function normalizeClosedDates(calendarRows, startDate, endDate) {
  const closed = new Map();
  (Array.isArray(calendarRows) ? calendarRows : []).forEach((row) => {
    const date = clean(row?.session_date).slice(0, 10);
    if (
      !DATE_PATTERN.test(date) ||
      date < startDate ||
      date > endDate ||
      row?.is_holiday !== true
    ) {
      return;
    }
    closed.set(date, clean(row?.name) || '휴원일');
  });

  let cursor = parseDateKey(startDate)?.timestamp;
  const end = parseDateKey(endDate)?.timestamp;
  while (Number.isFinite(cursor) && Number.isFinite(end) && cursor <= end) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    if (isSunday(date) && !closed.has(date)) closed.set(date, '일요일');
    cursor += 86400000;
  }

  return closed;
}

function buildAttendancePayload({
  rows,
  calendarRows,
  studentId,
  studentLabel,
  division,
  timetableMode,
  startDate,
  endDate,
  sessionKind = 'ALL',
  todayKey = todayInSeoul(),
}) {
  const kindFilter = normalizeSessionKind(sessionKind);
  const studentRows = (Array.isArray(rows) ? rows : []).filter((row) =>
    clean(row?.student_id) === clean(studentId) &&
    clean(row?.session_date).slice(0, 10) >= startDate &&
    clean(row?.session_date).slice(0, 10) <= endDate
  );

  const closedDates = normalizeClosedDates(calendarRows, startDate, endDate);
  const byDate = new Map();
  studentRows.forEach((row) => {
    const date = clean(row?.session_date).slice(0, 10);
    if (!DATE_PATTERN.test(date) || closedDates.has(date)) return;
    const list = byDate.get(date) || [];
    list.push(row);
    byDate.set(date, list);
  });

  const sessions = [];
  Array.from(byDate.keys()).sort().forEach((date) => {
    const dateRows = byDate.get(date) || [];
    const regular = kindFilter === 'makeup' ? [] : sessionsForDate(dateRows, 'regular');
    const makeup = kindFilter === 'regular' ? [] : sessionsForDate(dateRows, 'makeup');
    const combined = [...regular, ...makeup];

    combined.forEach((session, index) => {
      const status = finalSessionStatus(
        dateRows,
        date,
        session.sessionKind,
        session.timeSlot,
        session.classGroup,
        index === 0,
        todayKey
      );
      const weekday = isoWeekday(date);
      sessions.push({
        date,
        weekday,
        weekday_label: weekdayLabel(weekday),
        session_kind: session.sessionKind,
        time_slot: session.timeSlot,
        time_label: timeLabel(division, weekday, session.timeSlot, timetableMode),
        class_group: session.classGroup,
        status,
        status_label: statusLabel(status),
        attended: status === 'present' || status === 'makeup',
      });
    });
  });

  const counts = sessions.reduce((acc, session) => {
    acc.total += 1;
    acc[session.status] = (acc[session.status] || 0) + 1;
    if (session.session_kind === 'regular') acc.regular += 1;
    if (session.session_kind === 'makeup') acc.makeup_sessions += 1;
    return acc;
  }, {
    total:0,
    regular:0,
    makeup_sessions:0,
    present:0,
    absent:0,
    makeup:0,
    blank:0,
  });

  return {
    ok:true,
    student_label:clean(studentLabel),
    start_date:startDate,
    end_date:endDate,
    division:clean(division).toLowerCase(),
    timetable_mode:normalizeTimetableMode(timetableMode),
    session_kind_filter:kindFilter,
    sessions,
    counts,
    closed_dates:Array.from(closedDates.entries())
      .map(([date, reason]) => ({ date, reason }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function assertReadResult(result, label) {
  if (result?.ok) return;
  throw attendanceToolError(
    result?.message || label + '을 조회하지 못했습니다.',
    403,
    result?.code || 'OLLI_AGENT_ATTENDANCE_READ_FAILED'
  );
}

async function readAttendance({
  requestContext,
  subjectAccess,
  studentLabel,
  startDate,
  endDate,
  sessionKind = 'ALL',
  sanitizePayload,
  callRpc = callSupabaseRpc,
  todayKey = todayInSeoul(),
}) {
  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label);
  if (!subject?.studentId) {
    throw attendanceToolError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }

  if (typeof sanitizePayload !== 'function') {
    throw attendanceToolError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_ATTENDANCE_PRIVACY_MISSING'
    );
  }

  const range = normalizeDateRange(startDate, endDate);
  const normalizedKind = normalizeSessionKind(sessionKind);
  const months = monthStartsBetween(range.startDate, range.endDate);

  const monthPromises = months.map((monthStart) =>
    callRpc('olli_schedule_attendance_month', {
      p_session_token:requestContext.sessionToken,
      p_academy_id:requestContext.academyId,
      p_month:monthStart,
    })
  );

  const [calendar, settings, ...monthResults] = await Promise.all([
    callRpc('olli_schedule_calendar_range', {
      p_session_token:requestContext.sessionToken,
      p_academy_id:requestContext.academyId,
      p_start_date:range.startDate,
      p_end_date:range.endDate,
    }),
    callRpc('olli_academy_settings_get', {
      p_session_token:requestContext.sessionToken,
      p_academy_id:requestContext.academyId,
    }),
    ...monthPromises,
  ]);

  assertReadResult(calendar, '수업일 정보');
  assertReadResult(settings, '학원 시간표 설정');
  monthResults.forEach((result) => assertReadResult(result, '월 출결 기록'));

  const rawRows = monthResults.flatMap((result) =>
    Array.isArray(result?.attendance) ? result.attendance : []
  );

  const payload = buildAttendancePayload({
    rows:rawRows,
    calendarRows:Array.isArray(calendar?.days) ? calendar.days : [],
    studentId:subject.studentId,
    studentLabel:label,
    division:subject.division,
    timetableMode:settings?.academy?.kinder_timetable_mode,
    startDate:range.startDate,
    endDate:range.endDate,
    sessionKind:normalizedKind,
    todayKey,
  });

  return sanitizePayload(payload);
}

function createGetAttendanceTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw attendanceToolError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'get_attendance',
    description:
      '익명화된 학생 라벨의 날짜 범위 출결을 읽습니다. 현재 출석부와 동일하게 정규/보강 일정, 실제 출석, 수동 상태 override, 휴원일을 결합하며 데이터를 변경하지 않습니다.',
    parameters:z.object({
      student_label:z.string().min(2).max(20),
      start_date:z.string().regex(DATE_PATTERN),
      end_date:z.string().regex(DATE_PATTERN),
      session_kind:z.enum(['ALL','regular','makeup']),
    }),
    async execute({ student_label, start_date, end_date, session_kind }) {
      const payload = await readAttendance({
        requestContext,
        subjectAccess,
        studentLabel:student_label,
        startDate:start_date,
        endDate:end_date,
        sessionKind:session_kind,
        sanitizePayload,
      });
      return JSON.stringify(payload);
    },
  });
}

module.exports = {
  MAX_ATTENDANCE_DAYS,
  normalizeDateRange,
  normalizeSessionKind,
  monthStartsBetween,
  overrideKind,
  sessionsForDate,
  finalSessionStatus,
  normalizeClosedDates,
  buildAttendancePayload,
  readAttendance,
  createGetAttendanceTool,
};
