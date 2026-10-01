'use strict';

const {
  preparePrivacySafeMessages,
  assertPreparedPrivacyEgress,
  collectStudentNameVariants,
  buildPrivacyPlan,
} = require('../ai-privacy-gateway.cjs');
const { sanitizeValue } = require('../ai-privacy-sanitizer.cjs');
const { assertSafeEgress } = require('../ai-egress-guard.cjs');
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

function buildAgentToolPrivacyPlan(resolution) {
  const resolved = Array.isArray(resolution?.resolved) ? resolution.resolved : [];
  const primary = resolved[0] || null;
  const related = resolved.slice(1);

  return buildPrivacyPlan({
    subject: primary?.student?.row || {},
    relatedStudents: related.map((item) => item.student.row),
    sensitiveEntities: unresolvedSensitiveEntities(resolution),
  });
}

function sanitizeAgentToolPayload(value, preparedPrivacy) {
  const resolution = preparedPrivacy?.rawResolution;
  if (!resolution) {
    const error = new Error('Agent Tool 결과를 익명화할 개인정보 범위를 확인하지 못했습니다.');
    error.statusCode = 500;
    error.code = 'OLLI_AGENT_PRIVACY_CONTEXT_MISSING';
    throw error;
  }

  const plan = buildAgentToolPrivacyPlan(resolution);
  const sanitized = sanitizeValue(value, { entities: plan.entities });
  assertSafeEgress(sanitized, { forbiddenValues: plan.forbiddenValues });
  return sanitized;
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

async function prepareAbsencePrivacyInput(text, reasonText, requestContext, options = {}) {
  const sourceText=String(text || '');
  const reason=clean(reasonText);
  let commandText=sourceText;

  if(reason){
    const index=commandText.lastIndexOf(reason);
    if(index>=0){
      commandText=commandText.slice(0,index)
        .replace(/(?:사유|이유)\s*(?:는|은)?\s*[:：-]?\s*$/i,'')
        .replace(/[,，:：-]\s*$/,'')
        .trim();
    }
  }

  const resolution=await resolveStudentReferences(commandText,requestContext,options);
  return prepareAgentPrivacyFromResolution(commandText,resolution);
}


async function prepareTimetableMemoPrivacyInput(text, memoNote, requestContext, options = {}) {
  const sourceText=String(text || '');
  const note=clean(memoNote);
  let commandText=sourceText;

  if(note){
    const quotedVariants=[
      '“'+note+'”',
      '‘'+note+'’',
      '"'+note+'"',
      "'"+note+"'"
    ];
    for(const quoted of quotedVariants){
      if(commandText.includes(quoted)){
        commandText=commandText.replace(quoted,' ');
        break;
      }
    }
    if(commandText.includes(note)){
      commandText=commandText.replace(note,' ');
    }
    commandText=commandText
      .replace(/(?:내용|문구)\s*[:：-]?\s*/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  const resolution=await resolveStudentReferences(commandText,requestContext,options);
  return prepareAgentPrivacyFromResolution(commandText,resolution);
}


module.exports = {
  safeSubjectRefs,
  sanitizeAgentToolPayload,
  prepareAgentPrivacyFromResolution,
  prepareAgentPrivacyInput,
  prepareAbsencePrivacyInput,
  prepareTimetableMemoPrivacyInput,
};
