'use strict';

const crypto = require('node:crypto');

const VERSION = '2026-09-19-ai-request-scope-1';
const SUBJECT_REF_PATTERN = /^subject_[A-Za-z0-9_-]{16}$/;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function createOpaqueSubjectRef() {
  return 'subject_' + crypto.randomBytes(12).toString('base64url');
}

function normalizeSubjectRef(value) {
  const candidate = clean(value);
  if (SUBJECT_REF_PATTERN.test(candidate)) return candidate;
  return createOpaqueSubjectRef();
}

function createAiRequestScope(input = {}) {
  const scope = {
    subjectRef: normalizeSubjectRef(input.subjectRef),
  };

  Object.defineProperties(scope, {
    jobId: {
      value: clean(input.jobId),
      enumerable: false,
      writable: false,
      configurable: false,
    },
    studentId: {
      value: clean(input.studentId || input.student_id),
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });

  return Object.freeze(scope);
}

module.exports = {
  VERSION,
  SUBJECT_REF_PATTERN,
  createOpaqueSubjectRef,
  createAiRequestScope,
};
