'use strict';

const VERSION = '2026-09-19-ai-privacy-sanitizer-2';

const PHONE_PATTERN = /(?<!\d)(?:\+?82[-.\s]?)?(?:0?1[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const RRN_PATTERN = /(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)/g;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const SCHOOL_NAME_PATTERN = /[가-힣A-Za-z0-9]{2,20}(?:초등학교|중학교|고등학교|유치원|어린이집)/g;
const BIRTH_DATE_LABEL_PATTERN = /(?:생년월일|출생일|생일)[ \t]*(?:은|는)?[ \t]*[:：]?[ \t]*(?:(?:19|20)\d{2}[ \t]*(?:[.\/-]|년)[ \t]*\d{1,2}[ \t]*(?:[.\/-]|월)[ \t]*\d{1,2}[ \t]*일?)/g;
const ADDRESS_LABEL_PATTERN = /(?:집\s*주소|주소|거주지)[ \t]*(?:은|는)?[ \t]*[:：]?[ \t]*[^\n,;.!?]{4,120}/g;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
}

function normalizeReplacementEntries(entries) {
  const flattened = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const replacement = clean(entry.replacement || '[개인정보 제거]');
    const values = Array.isArray(entry.values) ? entry.values : [entry.value];
    values.forEach((value) => {
      const source = clean(value);
      if (source.length < 2) return;
      flattened.push({ source, replacement });
    });
  });

  return flattened.sort((a, b) => b.source.length - a.source.length);
}

function replaceKnownEntities(text, entries) {
  let output = String(text == null ? '' : text);
  normalizeReplacementEntries(entries).forEach(({ source, replacement }) => {
    output = output.replace(new RegExp(escapeRegExp(source), 'g'), replacement);
  });
  return output;
}

function normalizePseudonymParticles(text) {
  return String(text == null ? '' : text)
    .replace(/학생([A-Z])이와/g, '학생$1와')
    .replace(/학생([A-Z])이가/g, '학생$1가')
    .replace(/학생([A-Z])이는/g, '학생$1는')
    .replace(/학생([A-Z])이를/g, '학생$1를')
    .replace(/학생([A-Z])이도/g, '학생$1도')
    .replace(/학생([A-Z])이랑/g, '학생$1랑')
    .replace(/학생([A-Z])이(?=\s)/g, '학생$1가')
    .replace(/학생([A-Z])은/g, '학생$1는')
    .replace(/학생([A-Z])을/g, '학생$1를')
    .replace(/학생([A-Z])과/g, '학생$1와');
}

function sanitizeText(text, options = {}) {
  let output = String(text == null ? '' : text);

  output = output.replace(PHONE_PATTERN, '[전화번호 제거]');
  output = output.replace(EMAIL_PATTERN, '[이메일 제거]');
  output = output.replace(RRN_PATTERN, '[주민번호 제거]');
  output = output.replace(UUID_PATTERN, '[내부식별자 제거]');
  output = output.replace(BIRTH_DATE_LABEL_PATTERN, '생년월일: [생년월일 제거]');
  output = output.replace(ADDRESS_LABEL_PATTERN, '주소: [주소 제거]');
  output = output.replace(SCHOOL_NAME_PATTERN, '학교A');

  output = replaceKnownEntities(output, options.entities);
  return normalizePseudonymParticles(output);
}

function sanitizeValue(value, options = {}) {
  if (typeof value === 'string') return sanitizeText(value, options);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, options));
  if (value && typeof value === 'object') {
    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      next[key] = sanitizeValue(item, options);
    });
    return next;
  }
  return value;
}

module.exports = {
  VERSION,
  PHONE_PATTERN,
  EMAIL_PATTERN,
  RRN_PATTERN,
  UUID_PATTERN,
  SCHOOL_NAME_PATTERN,
  BIRTH_DATE_LABEL_PATTERN,
  ADDRESS_LABEL_PATTERN,
  normalizeReplacementEntries,
  replaceKnownEntities,
  normalizePseudonymParticles,
  sanitizeText,
  sanitizeValue,
};
