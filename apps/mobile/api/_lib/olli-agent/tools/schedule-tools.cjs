'use strict';

const { callSupabaseRpc } = require('../supabase-rpc.cjs');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_LABELS = Object.freeze(['', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']);
const HALF_HOUR_LABELS = Object.freeze({
  elementary: Object.freeze({
    1:'1시', 7:'1시 30분', 2:'2시', 8:'2시 30분', 3:'3시', 9:'3시 30분',
    4:'4시', 10:'4시 30분', 5:'5시', 11:'5시 30분', 6:'6시',
  }),
  kinder: Object.freeze({
    7:'3시 30분', 4:'4시', 8:'4시 30분', 5:'5시', 9:'5시 30분',
  }),
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function scheduleToolError(message, statusCode = 400, code = 'OLLI_AGENT_SCHEDULE_TOOL_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeTimetableMode(value) {
  return clean(value).toLowerCase() === 'half_hour' ? 'half_hour' : 'hourly';
}

function weekdayLabel(value) {
  const weekday = Number(value || 0);
  return WEEKDAY_LABELS[weekday] || '';
}

function timeLabel(division, weekday, timeSlot, timetableMode) {
  const normalizedDivision = clean(division).toLowerCase();
  const day = Number(weekday || 0);
  const slot = Number(timeSlot || 0);
  const mode = normalizeTimetableMode(timetableMode);

  if (!Number.isFinite(slot) || slot <= 0) return '';

  if (normalizedDivision === 'elementary' && day === 6 && slot >= 10 && slot <= 12) {
    return String(slot - 9) + '시';
  }

  if (mode === 'half_hour') {
    const mapped = HALF_HOUR_LABELS[normalizedDivision]?.[slot];
    if (mapped) return mapped;
  }

  return String(slot) + '시';
}

function normalizeReferenceDate(value) {
  const candidate = clean(value);
  if (!DATE_PATTERN.test(candidate)) {
    throw scheduleToolError(
      '조회 기준 날짜는 YYYY-MM-DD 형식이어야 합니다.',
      400,
      'OLLI_AGENT_REFERENCE_DATE_INVALID'
    );
  }
  return candidate;
}

function normalizeEnrollment(row, division, timetableMode) {
  const weekday = Number(row?.weekday || 0);
  const timeSlot = Number(row?.time_slot || 0);
  const classGroup = clean(row?.class_group).toUpperCase();

  if (weekday < 1 || weekday > 6 || !Number.isFinite(timeSlot) || timeSlot <= 0) {
    return null;
  }

  return {
    weekday,
    weekday_label: weekdayLabel(weekday),
    time_slot: timeSlot,
    time_label: timeLabel(division, weekday, timeSlot, timetableMode),
    class_group: classGroup === 'B' ? 'B' : 'A',
    session_order: Number.isFinite(Number(row?.session_order)) ? Number(row.session_order) : null,
  };
}

function safeSchedulePayload(rawSchedule, academySettings, studentLabel) {
  if (!rawSchedule?.ok) {
    throw scheduleToolError(
      rawSchedule?.message || '학생 시간표를 조회하지 못했습니다.',
      403,
      'OLLI_AGENT_STUDENT_SCHEDULE_FAILED'
    );
  }

  if (!academySettings?.ok) {
    throw scheduleToolError(
      academySettings?.message || '학원 시간표 설정을 확인하지 못했습니다.',
      403,
      'OLLI_AGENT_TIMETABLE_MODE_FAILED'
    );
  }

  const division = clean(rawSchedule.division).toLowerCase();
  const referenceDate = clean(rawSchedule.reference_date);
  const timetableMode = normalizeTimetableMode(
    academySettings?.academy?.kinder_timetable_mode
  );

  const enrollments = (Array.isArray(rawSchedule.enrollments) ? rawSchedule.enrollments : [])
    .map((row) => normalizeEnrollment(row, division, timetableMode))
    .filter(Boolean);

  return {
    ok: true,
    student_label: clean(studentLabel),
    reference_date: referenceDate,
    division,
    timetable_mode: timetableMode,
    enrollments,
    enrollment_count: enrollments.length,
  };
}

async function readStudentSchedule({
  requestContext,
  subjectAccess,
  studentLabel,
  referenceDate,
  callRpc = callSupabaseRpc,
}) {
  const label = clean(studentLabel);
  const date = normalizeReferenceDate(referenceDate);
  const subject = subjectAccess?.resolve?.(label);

  if (!subject?.studentId) {
    throw scheduleToolError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }

  const [schedule, settings] = await Promise.all([
    callRpc('olli_schedule_student_enrollments', {
      p_session_token: requestContext.sessionToken,
      p_academy_id: requestContext.academyId,
      p_student_id: subject.studentId,
      p_reference_date: date,
    }),
    callRpc('olli_academy_settings_get', {
      p_session_token: requestContext.sessionToken,
      p_academy_id: requestContext.academyId,
    }),
  ]);

  return safeSchedulePayload(schedule, settings, label);
}

function createGetStudentScheduleTool({
  tool,
  z,
  requestContext,
  subjectAccess,
}) {
  if (typeof tool !== 'function' || !z) {
    throw scheduleToolError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name: 'get_student_schedule',
    description:
      '익명화된 학생 라벨(예: 학생A)의 기준 날짜 정규 수업 요일, 시간, 반을 조회합니다. 실제 학생 이름이나 ID는 사용하지 않습니다.',
    parameters: z.object({
      student_label: z.string().min(2).max(20),
      reference_date: z.string().regex(DATE_PATTERN),
    }),
    async execute({ student_label, reference_date }) {
      const payload = await readStudentSchedule({
        requestContext,
        subjectAccess,
        studentLabel: student_label,
        referenceDate: reference_date,
      });
      return JSON.stringify(payload);
    },
  });
}

module.exports = {
  DATE_PATTERN,
  WEEKDAY_LABELS,
  HALF_HOUR_LABELS,
  normalizeTimetableMode,
  weekdayLabel,
  timeLabel,
  normalizeEnrollment,
  safeSchedulePayload,
  readStudentSchedule,
  createGetStudentScheduleTool,
};
