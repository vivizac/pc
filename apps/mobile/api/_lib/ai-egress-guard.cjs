'use strict';

const VERSION = '2026-09-19-ai-egress-guard-2';

const FORBIDDEN_KEY_PATTERN = /^(?:id|uuid|student_?(?:id|uuid|name)|name|parent_?(?:id|name|phone|email)|guardian_?(?:id|name|phone|email)|phone|phone_?number|mobile|email|address|postal_?code|zip|birth_?date|birthday|date_?of_?birth|dob|school|school_?name|kindergarten|kindergarten_?name|academy_?(?:id|name)|rrn|resident_?registration_?number)$/i;
const PHONE_TEST_PATTERN = /(?<!\d)(?:\+?82[-.\s]?)?(?:0?1[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/;
const EMAIL_TEST_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const RRN_TEST_PATTERN = /(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)/;
const UUID_TEST_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const SCHOOL_NAME_TEST_PATTERN = /[가-힣A-Za-z0-9]{2,20}(?:초등학교|중학교|고등학교|유치원|어린이집)/;
const BIRTH_DATE_LABEL_TEST_PATTERN = /(?:생년월일|출생일|생일)[ \t]*(?:은|는)?[ \t]*[:：]?[ \t]*(?:(?:19|20)\d{2}[ \t]*(?:[.\/-]|년)[ \t]*\d{1,2}[ \t]*(?:[.\/-]|월)[ \t]*\d{1,2}[ \t]*일?)/;
const ADDRESS_LABEL_TEST_PATTERN = /(?:집\s*주소|주소|거주지)[ \t]*(?:은|는)?[ \t]*[:：]?(?![ \t]*\[주소 제거\])[ \t]*[^\n,;.!?]{4,120}/;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function collectForbiddenKeyPaths(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeyPaths(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;

  Object.entries(value).forEach(([key, item]) => {
    const nextPath = `${path}.${key}`;
    if (FORBIDDEN_KEY_PATTERN.test(key)) found.push(nextPath);
    collectForbiddenKeyPaths(item, nextPath, found);
  });
  return found;
}

function findForbiddenValueLeaks(serialized, forbiddenValues) {
  const text = String(serialized || '');
  const lower = text.toLowerCase();
  const indexes = [];

  (Array.isArray(forbiddenValues) ? forbiddenValues : []).forEach((value, index) => {
    const candidate = clean(value);
    if (candidate.length < 2) return;
    if (lower.includes(candidate.toLowerCase())) indexes.push(index);
  });

  return indexes;
}

function addPatternViolation(violations, type, pattern, serialized) {
  if (pattern.test(serialized)) violations.push({ type, count:1 });
}

function inspectEgressPayload(payload, options = {}) {
  const serialized = JSON.stringify(payload == null ? null : payload);
  const violations = [];

  const forbiddenKeyPaths = collectForbiddenKeyPaths(payload);
  if (forbiddenKeyPaths.length) {
    violations.push({
      type:'forbidden_key',
      count:forbiddenKeyPaths.length,
      paths:forbiddenKeyPaths,
    });
  }

  const valueLeaks = findForbiddenValueLeaks(serialized, options.forbiddenValues);
  if (valueLeaks.length) {
    violations.push({
      type:'forbidden_value',
      count:valueLeaks.length,
      indexes:valueLeaks,
    });
  }

  addPatternViolation(violations, 'phone_pattern', PHONE_TEST_PATTERN, serialized);
  addPatternViolation(violations, 'email_pattern', EMAIL_TEST_PATTERN, serialized);
  addPatternViolation(violations, 'rrn_pattern', RRN_TEST_PATTERN, serialized);
  addPatternViolation(violations, 'uuid_pattern', UUID_TEST_PATTERN, serialized);
  addPatternViolation(violations, 'school_name_pattern', SCHOOL_NAME_TEST_PATTERN, serialized);
  addPatternViolation(violations, 'birth_date_pattern', BIRTH_DATE_LABEL_TEST_PATTERN, serialized);
  const addressInspectionText = serialized
    .replace(
      /(?:집\s*주소|주소|거주지)[ \t]*(?:은|는)?[ \t]*[:：]?[ \t]*\[주소 제거\]/g,
      '[REDACTED_ADDRESS]'
    )
    .replace(/\[주소 제거\]/g, '[REDACTED_ADDRESS]');
  addPatternViolation(violations, 'address_pattern', ADDRESS_LABEL_TEST_PATTERN, addressInspectionText);

  return {
    ok:violations.length === 0,
    violations,
  };
}

function assertSafeEgress(payload, options = {}) {
  const report = inspectEgressPayload(payload, options);
  if (report.ok) return report;

  const error = new Error('AI 개인정보 보호 검사에 실패해 외부 전송을 차단했습니다.');
  error.code = 'AI_PRIVACY_EGRESS_BLOCKED';
  error.violationTypes = report.violations.map((item) => item.type);
  error.report = report;
  throw error;
}

module.exports = {
  VERSION,
  FORBIDDEN_KEY_PATTERN,
  PHONE_TEST_PATTERN,
  EMAIL_TEST_PATTERN,
  RRN_TEST_PATTERN,
  UUID_TEST_PATTERN,
  SCHOOL_NAME_TEST_PATTERN,
  BIRTH_DATE_LABEL_TEST_PATTERN,
  ADDRESS_LABEL_TEST_PATTERN,
  collectForbiddenKeyPaths,
  findForbiddenValueLeaks,
  inspectEgressPayload,
  assertSafeEgress,
};
