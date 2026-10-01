'use strict';

const { callSupabaseRpc } = require('../supabase-rpc.cjs');

const DEFAULT_MAX_RECORDS = 12;
const MAX_RECORDS = 20;
const MAX_PER_SOURCE = 60;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function recordToolError(message, statusCode = 400, code = 'OLLI_AGENT_RECORD_TOOL_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeMaxRecords(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_RECORDS;
  return Math.min(MAX_RECORDS, Math.max(1, Math.trunc(parsed)));
}

function normalizeDateText(row = {}) {
  const lessonDate = clean(row.lesson_date);
  if (lessonDate) return lessonDate;

  const storedDate = clean(row.date);
  if (storedDate) return storedDate;

  const year = Number(row.year || 0);
  const month = Number(row.month || 0);
  const day = Number(row.day || 0);
  if (
    Number.isInteger(year) && year >= 2000 && year <= 2100 &&
    Number.isInteger(month) && month >= 1 && month <= 12 &&
    Number.isInteger(day) && day >= 1 && day <= 31
  ) {
    return String(year).padStart(4, '0') + '-' +
      String(month).padStart(2, '0') + '-' +
      String(day).padStart(2, '0');
  }

  return clean(row.created_at).slice(0, 10);
}

function normalizeFeedbackRecord(row, recordType) {
  if (!row || row.is_deleted === true) return null;
  const content = clean(row.content);
  if (!content) return null;

  return {
    record_type: recordType,
    date: normalizeDateText(row),
    created_at: clean(row.created_at),
    content,
  };
}

function normalizeObservationRecord(row) {
  if (!row || typeof row !== 'object') return null;
  const content = clean(row.content);
  if (!content) return null;

  return {
    record_type: 'observation',
    date: normalizeDateText(row),
    created_at: clean(row.created_at),
    note_type: clean(row.note_type),
    record_label: clean(row.record_label),
    content,
  };
}

function recordTimestamp(record) {
  const values = [clean(record?.created_at), clean(record?.date)];
  for (const value of values) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function mergeRecentRecords(generalRows, growthRows, observationRows, maxRecords) {
  const limit = normalizeMaxRecords(maxRecords);
  const combined = [
    ...(Array.isArray(generalRows) ? generalRows : [])
      .map((row) => normalizeFeedbackRecord(row, 'feedback'))
      .filter(Boolean),
    ...(Array.isArray(growthRows) ? growthRows : [])
      .map((row) => normalizeFeedbackRecord(row, 'growth_feedback'))
      .filter(Boolean),
    ...(Array.isArray(observationRows) ? observationRows : [])
      .map(normalizeObservationRecord)
      .filter(Boolean),
  ];

  const seen = new Set();
  const unique = combined.filter((record) => {
    const key = [
      clean(record.record_type),
      clean(record.date),
      clean(record.content),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .sort((a, b) =>
      recordTimestamp(b) - recordTimestamp(a) ||
      clean(b.created_at).localeCompare(clean(a.created_at)) ||
      clean(b.date).localeCompare(clean(a.date))
    )
    .slice(0, limit);
}

function assertReadResult(result, label) {
  if (result?.ok) return;
  throw recordToolError(
    result?.message || label + '을 조회하지 못했습니다.',
    403,
    result?.code || 'OLLI_AGENT_RECENT_RECORDS_FAILED'
  );
}

async function readRecentRecords({
  requestContext,
  subjectAccess,
  studentLabel,
  maxRecords = DEFAULT_MAX_RECORDS,
  sanitizePayload,
  callRpc = callSupabaseRpc,
}) {
  const label = clean(studentLabel);
  const subject = subjectAccess?.resolve?.(label);

  if (!subject?.studentId) {
    throw recordToolError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }

  if (typeof sanitizePayload !== 'function') {
    throw recordToolError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_RECORD_PRIVACY_MISSING'
    );
  }

  const limit = normalizeMaxRecords(maxRecords);
  const perSourceLimit = Math.min(
    MAX_PER_SOURCE,
    Math.max(24, limit * 3)
  );
  const commonParams = {
    p_session_token: requestContext.sessionToken,
    p_academy_id: requestContext.academyId,
    p_action: 'read',
    p_operation: 'list',
    p_identity: { student_id: subject.studentId },
    p_payload: {},
    p_limit: perSourceLimit,
  };

  const [general, growth, observations] = await Promise.all([
    callRpc('olli_general_feedback_data_access', commonParams),
    callRpc('olli_growth_feedback_data_access', commonParams),
    callRpc('olli_note_archive_data_access', commonParams),
  ]);

  assertReadResult(general, '일반 피드백 기록');
  assertReadResult(growth, '성장 피드백 기록');
  assertReadResult(observations, '관찰노트 기록');

  const records = mergeRecentRecords(
    general.rows,
    growth.rows,
    observations.rows,
    limit
  );

  const sourceCounts = records.reduce((counts, record) => {
    const key = clean(record.record_type);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  const payload = {
    ok: true,
    student_label: label,
    records,
    record_count: records.length,
    source_counts: sourceCounts,
  };

  return sanitizePayload(payload);
}

function createGetRecentRecordsTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw recordToolError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name: 'get_recent_records',
    description:
      '익명화된 학생 라벨(예: 학생A)의 최근 저장 기록을 읽습니다. 일반 피드백, 성장 피드백, 관찰노트 기록만 조회하며 데이터를 변경하지 않습니다.',
    parameters: z.object({
      student_label: z.string().min(2).max(20),
      max_records: z.number().int().min(1).max(MAX_RECORDS),
    }),
    async execute({ student_label, max_records }) {
      const payload = await readRecentRecords({
        requestContext,
        subjectAccess,
        studentLabel: student_label,
        maxRecords: max_records,
        sanitizePayload,
      });
      return JSON.stringify(payload);
    },
  });
}

module.exports = {
  DEFAULT_MAX_RECORDS,
  MAX_RECORDS,
  MAX_PER_SOURCE,
  normalizeMaxRecords,
  normalizeDateText,
  normalizeFeedbackRecord,
  normalizeObservationRecord,
  mergeRecentRecords,
  readRecentRecords,
  createGetRecentRecordsTool,
};
