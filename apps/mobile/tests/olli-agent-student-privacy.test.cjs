const test = require('node:test');
const assert = require('node:assert/strict');

const resolver = require('../api/_lib/olli-agent/student-reference-resolver.cjs');
const privacy = require('../api/_lib/olli-agent/privacy.cjs');

const rows = [
  {
    id:'11111111-1111-4111-8111-111111111111',
    name:'최지안',
    division:'kinder',
    status:'active',
    is_deleted:false,
    school:'대구초등학교',
  },
  {
    id:'22222222-2222-4222-8222-222222222222',
    name:'김지안',
    division:'elementary',
    status:'active',
    is_deleted:false,
  },
  {
    id:'33333333-3333-4333-8333-333333333333',
    name:'한재림',
    division:'elementary',
    status:'active',
    is_deleted:false,
  },
];

function fixedRefs() {
  const values = ['subject_AAAAAAAAAAAAAAAA','subject_BBBBBBBBBBBBBBBB','subject_CCCCCCCCCCCCCCCC'];
  let index = 0;
  return () => values[index++] || 'subject_ZZZZZZZZZZZZZZZZ';
}

test('full student name wins over an ambiguous given-name alias inside the same text span', () => {
  const result = resolver.matchStudentReferences(
    '최지안 오늘 수업 어때?',
    rows,
    { createSubjectRef: fixedRefs() }
  );

  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].student.id, rows[0].id);
  assert.equal(result.ambiguous.length, 0);
});

test('ambiguous given-name-only reference is detected before any model call', () => {
  const result = resolver.matchStudentReferences(
    '지안이 오늘 수업 어때?',
    rows,
    { createSubjectRef: fixedRefs() }
  );

  assert.equal(result.resolved.length, 0);
  assert.equal(result.ambiguous.length, 1);

  const prepared = privacy.prepareAgentPrivacyFromResolution(
    '지안이 오늘 수업 어때?',
    result
  );

  assert.equal(prepared.needsDisambiguation, true);
  assert.equal(prepared.ambiguousCount, 1);
  assert.doesNotMatch(prepared.safeText, /지안/);
});

test('privacy boundary replaces resolved student names with opaque labels', () => {
  const resolution = resolver.matchStudentReferences(
    '최지안 오늘 수업 어때?',
    [rows[0]],
    { createSubjectRef: fixedRefs() }
  );
  const prepared = privacy.prepareAgentPrivacyFromResolution(
    '최지안 오늘 수업 어때?',
    resolution
  );

  assert.equal(prepared.safeText, '학생A 오늘 수업 어때?');
  assert.deepEqual(prepared.subjectRefs, [{
    label:'학생A',
    subject_ref:'subject_AAAAAAAAAAAAAAAA',
    division:'kinder',
  }]);

  const serialized = JSON.stringify(prepared);
  assert.doesNotMatch(serialized, /최지안/);
  assert.doesNotMatch(serialized, /11111111-1111-4111-8111-111111111111/);
});

test('multiple students get stable A/B labels in mention order', () => {
  const resolution = resolver.matchStudentReferences(
    '한재림이랑 최지안 최근 기록 비교해줘',
    [rows[0], rows[2]],
    { createSubjectRef: fixedRefs() }
  );
  const prepared = privacy.prepareAgentPrivacyFromResolution(
    '한재림이랑 최지안 최근 기록 비교해줘',
    resolution
  );

  assert.equal(prepared.safeText, '학생A랑 학생B 최근 기록 비교해줘');
  assert.deepEqual(
    prepared.subjectRefs.map((item) => item.label),
    ['학생A','학생B']
  );
});

test('real student ids remain reachable only through non-enumerable subject access', () => {
  const resolution = resolver.matchStudentReferences(
    '최지안 오늘 수업 어때?',
    [rows[0]],
    { createSubjectRef: fixedRefs() }
  );
  const prepared = privacy.prepareAgentPrivacyFromResolution(
    '최지안 오늘 수업 어때?',
    resolution
  );

  assert.equal(
    prepared.subjectAccess.resolve('subject_AAAAAAAAAAAAAAAA').studentId,
    rows[0].id
  );
  assert.equal(
    prepared.subjectAccess.resolve('학생A').studentId,
    rows[0].id
  );
  assert.equal(Object.keys(prepared).includes('subjectAccess'), false);
  assert.doesNotMatch(JSON.stringify(prepared), /11111111-1111-4111-8111-111111111111/);
});

test('known but unresolved student names are masked instead of leaking to model input', () => {
  const resolution = resolver.matchStudentReferences(
    '지안이와 한재림 이야기를 정리해줘',
    rows,
    { createSubjectRef: fixedRefs() }
  );
  const prepared = privacy.prepareAgentPrivacyFromResolution(
    '지안이와 한재림 이야기를 정리해줘',
    resolution
  );

  assert.equal(prepared.needsDisambiguation, true);
  assert.doesNotMatch(prepared.safeText, /지안|한재림/);
});
