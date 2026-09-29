'use strict';

const { buildAiContext } = require('./ai-context-builder.cjs');
const { sanitizeValue } = require('./ai-privacy-sanitizer.cjs');
const { assertSafeEgress } = require('./ai-egress-guard.cjs');
const { createAiRequestScope } = require('./ai-request-scope.cjs');

const VERSION = '2026-09-20-ai-privacy-gateway-5';
const COMPOUND_KOREAN_SURNAMES = new Set([
  '남궁', '황보', '제갈', '선우', '독고', '동방', '사공', '서문',
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function uniqueStrings(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(clean)
      .filter((value) => value.length >= 2)
  ));
}

function valuesFrom(source, keys) {
  if (!source || typeof source !== 'object') return [];
  const values = [];
  keys.forEach((key) => {
    const value = source[key];
    if (Array.isArray(value)) values.push(...value);
    else if (value != null) values.push(value);
  });
  return uniqueStrings(values);
}

function deriveKoreanNameAliases(name) {
  const original = clean(name);
  const compact = original.replace(/\s+/g, '');
  if (!compact || !/^[가-힣]+$/.test(compact)) return original ? [original] : [];

  const aliases = [original];
  if (compact !== original) aliases.push(compact);

  if (compact.length === 3) {
    aliases.push(compact.slice(1));
  } else if (
    compact.length === 4 &&
    COMPOUND_KOREAN_SURNAMES.has(compact.slice(0, 2))
  ) {
    aliases.push(compact.slice(2));
  }

  return uniqueStrings(aliases);
}

function collectStudentNameVariants(student) {
  const fullNames = valuesFrom(student, ['name', 'studentName']);
  const explicitAliases = valuesFrom(student, ['aliases', 'nameAliases']);
  return uniqueStrings([
    ...fullNames.flatMap(deriveKoreanNameAliases),
    ...explicitAliases,
  ]);
}

function buildPrivacyPlan(input = {}) {
  const subject = input.subject && typeof input.subject === 'object' ? input.subject : {};
  const relatedStudents = Array.isArray(input.relatedStudents) ? input.relatedStudents : [];
  const entities = [];
  const forbiddenValues = [];

  const subjectNames = collectStudentNameVariants(subject);
  if (subjectNames.length) {
    entities.push({ values:subjectNames, replacement:'학생A' });
    forbiddenValues.push(...subjectNames);
  }

  const subjectIdentifiers = valuesFrom(subject, ['id', 'studentId', 'student_id']);
  if (subjectIdentifiers.length) {
    entities.push({ values:subjectIdentifiers, replacement:'[식별자 제거]' });
    forbiddenValues.push(...subjectIdentifiers);
  }

  const guardianValues = valuesFrom(subject, ['parentName', 'parent_name', 'guardianName', 'guardian_name']);
  if (guardianValues.length) {
    entities.push({ values:guardianValues, replacement:'보호자A' });
    forbiddenValues.push(...guardianValues);
  }

  const schoolValues = valuesFrom(subject, ['school', 'schoolName', 'school_name', 'kindergarten', 'kindergartenName', 'kindergarten_name', 'daycare', 'daycareName', 'daycare_name']);
  if (schoolValues.length) {
    entities.push({ values:schoolValues, replacement:'학교A' });
    forbiddenValues.push(...schoolValues);
  }

  const directPrivateValues = valuesFrom(subject, [
    'phone', 'phoneNumber', 'phone_number', 'mobile',
    'parentPhone', 'parent_phone', 'guardianPhone', 'guardian_phone',
    'email', 'parentEmail', 'parent_email', 'guardianEmail', 'guardian_email',
    'address', 'postalCode', 'postal_code', 'zip',
    'birthDate', 'birth_date', 'birthday', 'dateOfBirth', 'date_of_birth', 'dob',
    'rrn', 'residentRegistrationNumber', 'resident_registration_number',
  ]);
  if (directPrivateValues.length) {
    entities.push({ values:directPrivateValues, replacement:'[개인정보 제거]' });
    forbiddenValues.push(...directPrivateValues);
  }

  relatedStudents.forEach((student, index) => {
    if (!student || typeof student !== 'object') return;
    const label = '학생' + String.fromCharCode(66 + index);
    const names = collectStudentNameVariants(student);
    if (names.length) {
      entities.push({ values:names, replacement:label });
      forbiddenValues.push(...names);
    }
    const relatedIdentifiers = valuesFrom(student, ['id', 'studentId', 'student_id', 'uuid']);
    if (relatedIdentifiers.length) {
      entities.push({ values:relatedIdentifiers, replacement:'[식별자 제거]' });
      forbiddenValues.push(...relatedIdentifiers);
    }
  });

  (Array.isArray(input.sensitiveEntities) ? input.sensitiveEntities : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const values = uniqueStrings(Array.isArray(entry.values) ? entry.values : [entry.value]);
    if (!values.length) return;
    entities.push({
      values,
      replacement:clean(entry.replacement || '[개인정보 제거]') || '[개인정보 제거]',
    });
    forbiddenValues.push(...values);
  });

  forbiddenValues.push(...uniqueStrings(input.extraForbiddenValues));

  return {
    entities,
    forbiddenValues:uniqueStrings(forbiddenValues),
  };
}


function preparePrivacySafeMessages(input = {}) {
  const subject = input.subject && typeof input.subject === 'object' ? input.subject : {};
  const requestScope = createAiRequestScope({
    subjectRef:input.requestScope?.subjectRef,
    jobId:input.jobId || input.requestScope?.jobId,
    studentId:
      subject.id ||
      subject.studentId ||
      subject.student_id ||
      input.requestScope?.studentId,
  });

  const plan = buildPrivacyPlan(input);
  const messages = sanitizeValue(
    Array.isArray(input.messages) ? input.messages : [],
    { entities:plan.entities }
  );
  const guard = assertSafeEgress(messages, {
    forbiddenValues:plan.forbiddenValues,
  });

  const result = {
    requestScope,
    messages,
    privacy:{
      version:VERSION,
      sanitized:true,
      guardPassed:guard.ok === true,
      requestScoped:true,
      replacementRuleCount:plan.entities.length,
    },
  };

  Object.defineProperties(result, {
    forbiddenValues: {
      value:plan.forbiddenValues.slice(),
      enumerable:false,
      writable:false,
      configurable:false,
    },
    subjectName: {
      value:clean(subject.name || subject.studentName),
      enumerable:false,
      writable:false,
      configurable:false,
    },
  });

  return result;
}

function assertPreparedPrivacyEgress(payload, prepared) {
  const forbiddenValues = Array.isArray(prepared?.forbiddenValues)
    ? prepared.forbiddenValues
    : [];
  return assertSafeEgress(payload, { forbiddenValues });
}

function preparePrivacySafeAiContext(input = {}) {
  const subject = input.subject && typeof input.subject === 'object' ? input.subject : {};
  const requestScope = createAiRequestScope({
    subjectRef:input.requestScope?.subjectRef,
    jobId:input.jobId || input.requestScope?.jobId,
    studentId:
      subject.id ||
      subject.studentId ||
      subject.student_id ||
      input.requestScope?.studentId,
  });

  const rawContext = buildAiContext({
    subjectRef:requestScope.subjectRef,
    requestType:input.requestType,
    ageBand:input.ageBand,
    studentDivision:input.studentDivision,
    question:input.question,
    records:input.records,
  });

  const plan = buildPrivacyPlan(input);
  const context = sanitizeValue(rawContext, { entities:plan.entities });
  const guard = assertSafeEgress(context, {
    forbiddenValues:plan.forbiddenValues,
  });

  return {
    requestScope,
    context,
    privacy:{
      version:VERSION,
      sanitized:true,
      guardPassed:guard.ok === true,
      requestScoped:true,
      replacementRuleCount:plan.entities.length,
    },
  };
}

module.exports = {
  VERSION,
  deriveKoreanNameAliases,
  collectStudentNameVariants,
  buildPrivacyPlan,
  preparePrivacySafeMessages,
  assertPreparedPrivacyEgress,
  preparePrivacySafeAiContext,
};
