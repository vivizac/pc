'use strict';

const VERSION = '2026-09-20-ai-privacy-context-2';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeRecord(record) {
  const source = record && typeof record === 'object' ? record : {};
  const text = clean(source.text != null ? source.text : source.content);
  if (!text) return null;

  const normalized = {
    type: clean(source.type || source.record_type || 'record') || 'record',
    text,
  };

  const period = clean(source.period || source.date || source.label);
  if (period) normalized.period = period;

  return normalized;
}

function buildAiContext(input = {}) {
  const records = (Array.isArray(input.records) ? input.records : [])
    .map(normalizeRecord)
    .filter(Boolean);

  const context = {
    subject_ref: clean(input.subjectRef || 'student_A') || 'student_A',
    request_type: clean(input.requestType || 'general') || 'general',
    records,
  };

  const ageBand = clean(input.ageBand);
  const question = clean(input.question);
  const studentDivision = clean(input.studentDivision);
  if (ageBand) context.age_band = ageBand;
  if (studentDivision === 'kinder' || studentDivision === 'elementary') {
    context.student_division = studentDivision;
  }
  if (question) context.question = question;

  return context;
}

module.exports = {
  VERSION,
  buildAiContext,
  normalizeRecord,
};
