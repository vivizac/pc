'use strict';

const { callSupabaseRpc } = require('../supabase-rpc.cjs');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function profileToolError(
  message,
  statusCode = 400,
  code = 'OLLI_AGENT_STUDENT_PROFILE_TOOL_ERROR'
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function divisionLabel(value) {
  const division = clean(value).toLowerCase();
  if (division === 'kinder') return '유치부';
  if (division === 'elementary') return '초등부';
  return '';
}

function statusLabel(value) {
  const status = clean(value).toLowerCase();
  if (status === 'active') return '재원';
  if (status === 'paused') return '휴원';
  if (status === 'withdrawn') return '퇴원';
  if (status === 'inactive') return '비활성';
  return '';
}

function normalizeDate(value) {
  const candidate = clean(value).slice(0, 10);
  return DATE_PATTERN.test(candidate) ? candidate : '';
}

function normalizeProfileRow(row, studentLabel) {
  if (!row || typeof row !== 'object' || row.is_deleted === true) {
    throw profileToolError(
      '학생 기본정보를 찾지 못했습니다.',
      404,
      'OLLI_AGENT_STUDENT_PROFILE_NOT_FOUND'
    );
  }

  const division = clean(row.division).toLowerCase();
  const status = clean(row.status).toLowerCase();

  return {
    ok:true,
    student_label:clean(studentLabel),
    division,
    division_label:divisionLabel(division),
    status,
    status_label:statusLabel(status),
    grade:clean(row.grade).slice(0, 20),
    age:clean(row.age).slice(0, 20),
    enrolled_at:normalizeDate(row.enrolled_at),
  };
}

async function readStudentProfile({
  requestContext,
  subjectAccess,
  studentLabel,
  sanitizePayload,
  callRpc = callSupabaseRpc,
}) {
  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label);

  if (!subject?.studentId) {
    throw profileToolError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }

  if (typeof sanitizePayload !== 'function') {
    throw profileToolError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_STUDENT_PROFILE_PRIVACY_MISSING'
    );
  }

  const result = await callRpc('olli_student_data_access', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_action:'read',
    p_operation:'get',
    p_identity:{ id:subject.studentId },
    p_payload:{},
    p_limit:1,
  });

  if (!result?.ok) {
    throw profileToolError(
      result?.message || '학생 기본정보를 조회하지 못했습니다.',
      403,
      result?.code || 'OLLI_AGENT_STUDENT_PROFILE_READ_FAILED'
    );
  }

  const row = Array.isArray(result.rows) ? result.rows[0] : null;
  return sanitizePayload(normalizeProfileRow(row, label));
}

function createGetStudentProfileTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw profileToolError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'get_student_profile',
    description:
      '익명화된 학생 라벨의 최소 기본정보(유치부/초등부, 현재 재원 상태, 학년, 나이, 등록일)를 읽습니다. 실제 이름, 학교·유치원명, 메모, 성향, 수업시간, 내부 ID는 반환하지 않습니다.',
    parameters:z.object({
      student_label:z.string().min(2).max(20),
    }),
    async execute({ student_label }) {
      const payload = await readStudentProfile({
        requestContext,
        subjectAccess,
        studentLabel:student_label,
        sanitizePayload,
      });
      return JSON.stringify(payload);
    },
  });
}

module.exports = {
  DATE_PATTERN,
  divisionLabel,
  statusLabel,
  normalizeDate,
  normalizeProfileRow,
  readStudentProfile,
  createGetStudentProfileTool,
};
