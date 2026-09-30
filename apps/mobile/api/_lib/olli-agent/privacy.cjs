'use strict';

const {
  preparePrivacySafeMessages,
  assertPreparedPrivacyEgress,
  collectStudentNameVariants,
} = require('../ai-privacy-gateway.cjs');
const {
  resolveStudentReferences,
  createSubjectAccess,
} = require('./student-reference-resolver.cjs');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function safeSubjectRefs(resolution) {
  return (Array.isArray(resolution?.resolved) ? resolution.resolved : []).map((item) => ({
    label: item.label,
    subject_ref: item.subjectRef,
    division: clean(item.student?.division),
  }));
}

function unresolvedSensitiveEntities(resolution) {
  const resolvedIds = new Set(
    (Array.isArray(resolution?.resolved) ? resolution.resolved : [])
      .map((item) => clean(item.student?.id))
      .filter(Boolean)
  );

  const entities = [];
  (Array.isArray(resolution?.students) ? resolution.students : []).forEach((student) => {
    if (resolvedIds.has(clean(student.id))) return;
    const aliases = collectStudentNameVariants(student.row);
    if (!aliases.length) return;
    entities.push({
      values: aliases,
      replacement: '[학생명 제거]',
    });
  });

  return entities;
}

function prepareAgentPrivacyFromResolution(text, resolution) {
  const sourceText = String(text || '');
  const resolved = Array.isArray(resolution?.resolved) ? resolution.resolved : [];
  const ambiguous = Array.isArray(resolution?.ambiguous) ? resolution.ambiguous : [];

  const primary = resolved[0] || null;
  const related = resolved.slice(1);

  const prepared = preparePrivacySafeMessages({
    requestScope: primary ? { subjectRef: primary.subjectRef } : {},
    subject: primary?.student?.row || {},
    relatedStudents: related.map((item) => item.student.row),
    sensitiveEntities: unresolvedSensitiveEntities(resolution),
    messages: [{ role: 'user', content: sourceText }],
  });

  assertPreparedPrivacyEgress(prepared.messages, prepared);

  const result = {
    safeMessages: prepared.messages,
    safeText: clean(prepared.messages?.[0]?.content),
    subjectRefs: safeSubjectRefs(resolution),
    privacy: prepared.privacy,
    needsDisambiguation: ambiguous.length > 0,
    ambiguousCount: ambiguous.length,
  };

  Object.defineProperties(result, {
    subjectAccess: {
      value: createSubjectAccess(resolution),
      enumerable: false,
      writable: false,
      configurable: false,
    },
    requestScope: {
      value: prepared.requestScope,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    rawResolution: {
      value: resolution,
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });

  return Object.freeze(result);
}

async function prepareAgentPrivacyInput(text, requestContext, options = {}) {
  const resolution = await resolveStudentReferences(text, requestContext, options);
  return prepareAgentPrivacyFromResolution(text, resolution);
}

module.exports = {
  safeSubjectRefs,
  prepareAgentPrivacyFromResolution,
  prepareAgentPrivacyInput,
};
