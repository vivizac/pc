const test = require('node:test');
const assert = require('node:assert/strict');

const {
  preparePrivacySafeAiContext,
  preparePrivacySafeMessages,
  assertPreparedPrivacyEgress,
  deriveKoreanNameAliases,
} = require('../api/_lib/ai-privacy-gateway.cjs');
const {
  SUBJECT_REF_PATTERN,
  createAiRequestScope,
} = require('../api/_lib/ai-request-scope.cjs');
const {
  inspectEgressPayload,
  assertSafeEgress,
} = require('../api/_lib/ai-egress-guard.cjs');
const {
  sanitizeText,
} = require('../api/_lib/ai-privacy-sanitizer.cjs');

test('privacy gateway anonymizes known student and related PII before AI egress', () => {
  const result = preparePrivacySafeAiContext({
    requestType:'student_growth_analysis',
    ageBand:'초등 저학년',
    studentDivision:'elementary',
    question:'김민서 최근에 민서의 표현 방식이 어떻게 달라졌어?',
    subject:{
      id:'student-real-123',
      name:'김민서',
      aliases:['민서'],
      parentName:'김하늘',
      schoolName:'해봄초등학교',
      phone:'010-1234-5678',
      email:'minseo@example.com',
    },
    relatedStudents:[
      { name:'박서준', aliases:['서준'] },
    ],
    records:[
      {
        id:'record-real-1',
        student_id:'student-real-123',
        period:'최근 1개월',
        type:'feedback',
        text:'김민서는 오늘 민서가 고른 색을 서준이와 비교했어요. 해봄초등학교 이야기를 했고 김하늘 보호자 연락처는 010-1234-5678, 이메일은 minseo@example.com 입니다.',
      },
    ],
  });

  const serialized = JSON.stringify(result.context);

  [
    '김민서',
    '민서',
    '박서준',
    '서준',
    '김하늘',
    '해봄초등학교',
    '010-1234-5678',
    'minseo@example.com',
    'student-real-123',
    'record-real-1',
  ].forEach((value) => {
    assert.equal(serialized.includes(value), false, value);
  });

  assert.match(serialized, /학생A/);
  assert.match(serialized, /학생B/);
  assert.match(serialized, /학교A/);
  assert.match(serialized, /보호자A/);
  assert.match(serialized, /전화번호 제거/);
  assert.match(serialized, /이메일 제거/);
  assert.match(result.context.subject_ref, SUBJECT_REF_PATTERN);
  assert.equal(result.context.subject_ref, result.requestScope.subjectRef);
  assert.equal(result.context.student_division, 'elementary');
  assert.equal(result.privacy.sanitized, true);
  assert.equal(result.privacy.guardPassed, true);
});

test('context sent toward AI keeps only whitelisted record fields', () => {
  const result = preparePrivacySafeAiContext({
    subject:{ id:'student-1', name:'김민서' },
    records:[
      {
        id:'record-1',
        student_id:'student-1',
        academy_id:'academy-1',
        student_name:'김민서',
        created_by:'teacher-1',
        period:'9월',
        type:'observation',
        content:'김민서가 작품을 오래 관찰했어요.',
      },
    ],
  });

  assert.deepEqual(Object.keys(result.context.records[0]).sort(), ['period', 'text', 'type']);
  assert.equal(result.context.records[0].text, '학생A가 작품을 오래 관찰했어요.');
});

test('egress guard blocks forbidden keys and does not echo private values in its error message', () => {
  const payload = {
    subject_ref:'student_A',
    student_name:'김민서',
    records:[{ type:'feedback', text:'안전한 기록' }],
  };

  const report = inspectEgressPayload(payload, {
    forbiddenValues:['김민서'],
  });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item => item.type === 'forbidden_key'));
  assert.ok(report.violations.some(item => item.type === 'forbidden_value'));

  let caught = null;
  try {
    assertSafeEgress(payload, { forbiddenValues:['김민서'] });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.code, 'AI_PRIVACY_EGRESS_BLOCKED');
  assert.equal(String(caught.message).includes('김민서'), false);
});

test('privacy gateway fails closed when an explicitly forbidden value survives sanitization', () => {
  assert.throws(
    () => preparePrivacySafeAiContext({
      subject:{ name:'김민서' },
      extraForbiddenValues:['비밀식별자XYZ'],
      records:[
        { type:'memo', text:'학생 관련 내부 키는 비밀식별자XYZ 입니다.' },
      ],
    }),
    (error) => error && error.code === 'AI_PRIVACY_EGRESS_BLOCKED'
  );
});

test('egress guard blocks raw phone and email patterns even without an explicit forbidden list', () => {
  const phone = inspectEgressPayload({
    subject_ref:'student_A',
    records:[{ type:'memo', text:'연락처 010-9999-8888' }],
  });
  assert.equal(phone.ok, false);
  assert.ok(phone.violations.some(item => item.type === 'phone_pattern'));

  const email = inspectEgressPayload({
    subject_ref:'student_A',
    records:[{ type:'memo', text:'메일 test@example.com' }],
  });
  assert.equal(email.ok, false);
  assert.ok(email.violations.some(item => item.type === 'email_pattern'));
});


test('Korean three-syllable names derive a common given-name alias without client help', () => {
  assert.deepEqual(deriveKoreanNameAliases('김민서'), ['김민서', '민서']);

  const result = preparePrivacySafeAiContext({
    subject:{ id:'student-2', name:'김민서' },
    records:[
      { type:'memo', text:'민서가 오늘 김민서의 작품을 다시 수정했어요.' },
    ],
  });

  assert.equal(result.context.records[0].text.includes('김민서'), false);
  assert.equal(result.context.records[0].text.includes('민서'), false);
  assert.match(result.context.records[0].text, /학생A/);
});

test('request scope keeps real student and job ids non-enumerable and outside JSON payloads', () => {
  const scope = createAiRequestScope({
    jobId:'feedback-job-1001',
    studentId:'real-student-1001',
  });

  assert.equal(scope.jobId, 'feedback-job-1001');
  assert.equal(scope.studentId, 'real-student-1001');
  assert.match(scope.subjectRef, SUBJECT_REF_PATTERN);

  const serialized = JSON.stringify(scope);
  assert.equal(serialized.includes('feedback-job-1001'), false);
  assert.equal(serialized.includes('real-student-1001'), false);
  assert.equal(serialized.includes(scope.subjectRef), true);
  assert.deepEqual(Object.keys(scope), ['subjectRef']);
});

test('parallel AI requests get different opaque subject refs and keep identities isolated', () => {
  const jobs = Array.from({ length:25 }, (_, index) => {
    const n = index + 1;
    return preparePrivacySafeAiContext({
      jobId:`job-${n}`,
      subject:{
        id:`student-real-${n}`,
        name:n === 1 ? '김민서' : `테스트학생${n}`,
      },
      records:[
        {
          type:'feedback',
          text:n === 1 ? '김민서가 오늘 작품을 완성했어요.' : '수업 기록입니다.',
        },
      ],
    });
  });

  const refs = jobs.map(item => item.context.subject_ref);
  assert.equal(new Set(refs).size, jobs.length);

  jobs.forEach((item, index) => {
    const n = index + 1;
    assert.equal(item.requestScope.jobId, `job-${n}`);
    assert.equal(item.requestScope.studentId, `student-real-${n}`);
    const serializedContext = JSON.stringify(item.context);
    assert.equal(serializedContext.includes(`student-real-${n}`), false);
    assert.equal(serializedContext.includes(`job-${n}`), false);
  });
});


test('sanitizer removes high-risk free-text PII patterns before egress', () => {
  const text = [
    '주민번호 180503-4123456',
    '내부키 550e8400-e29b-41d4-a716-446655440000',
    '생년월일: 2018-05-03',
    '주소: 대구광역시 달서구 월배로 123',
    '해봄초등학교에 다녀요.',
  ].join('\n');

  const sanitized = sanitizeText(text);

  assert.equal(sanitized.includes('180503-4123456'), false);
  assert.equal(sanitized.includes('550e8400-e29b-41d4-a716-446655440000'), false);
  assert.equal(sanitized.includes('2018-05-03'), false);
  assert.equal(sanitized.includes('대구광역시 달서구 월배로 123'), false);
  assert.equal(sanitized.includes('해봄초등학교'), false);

  assert.match(sanitized, /주민번호 제거/);
  assert.match(sanitized, /내부식별자 제거/);
  assert.match(sanitized, /생년월일 제거/);
  assert.match(sanitized, /주소 제거/);
  assert.match(sanitized, /학교A/);
});

test('egress guard blocks high-risk PII patterns when sanitizer is bypassed', () => {
  const samples = [
    ['rrn_pattern', '주민번호 180503-4123456'],
    ['uuid_pattern', '내부키 550e8400-e29b-41d4-a716-446655440000'],
    ['school_name_pattern', '해봄초등학교에서 있었던 일'],
    ['birth_date_pattern', '생년월일: 2018-05-03'],
    ['address_pattern', '주소: 대구광역시 달서구 월배로 123'],
  ];

  samples.forEach(([type, text]) => {
    const report = inspectEgressPayload({
      subject_ref:'subject_abcdefghijklmnop',
      records:[{ type:'memo', text }],
    });
    assert.equal(report.ok, false, type);
    assert.ok(report.violations.some(item => item.type === type), type);
  });
});

test('ordinary lesson dates and generic school-stage wording are not treated as direct identifiers', () => {
  const report = inspectEgressPayload({
    subject_ref:'subject_abcdefghijklmnop',
    records:[
      {
        type:'memo',
        period:'2026.09.19',
        text:'초등학교 저학년 수준에서 관찰과 표현을 연결했어요.',
      },
    ],
  });

  assert.equal(report.ok, true);
});

test('known alternate PII fields are removed even when embedded in lesson text', () => {
  const result = preparePrivacySafeAiContext({
    subject:{
      id:'student-private-7',
      name:'김민서',
      dob:'2018-05-03',
      parentPhone:'010-5555-7777',
      postalCode:'42711',
      residentRegistrationNumber:'180503-4123456',
    },
    records:[
      {
        type:'memo',
        text:'민서 생년월일은 2018-05-03이고 보호자 연락처는 010-5555-7777, 우편번호 42711, 주민번호 180503-4123456입니다.',
      },
    ],
  });

  const serialized = JSON.stringify(result.context);
  ['2018-05-03', '010-5555-7777', '42711', '180503-4123456', '민서'].forEach((value) => {
    assert.equal(serialized.includes(value), false, value);
  });
  assert.equal(result.privacy.guardPassed, true);
});

test('related-student ids are redacted as well as related-student names', () => {
  const result = preparePrivacySafeAiContext({
    subject:{ id:'student-main-1', name:'김민서' },
    relatedStudents:[
      { id:'student-related-9', name:'박서준' },
    ],
    records:[
      {
        type:'memo',
        text:'박서준과 함께 작업했고 내부 표시는 student-related-9 였어요.',
      },
    ],
  });

  const text = result.context.records[0].text;
  assert.equal(text.includes('박서준'), false);
  assert.equal(text.includes('서준'), false);
  assert.equal(text.includes('student-related-9'), false);
  assert.match(text, /학생B/);
  assert.match(text, /식별자 제거/);
});

test('pseudonym replacement normalizes common Korean particles for readable AI context', () => {
  const result = preparePrivacySafeAiContext({
    subject:{ id:'student-main-1', name:'김민서' },
    relatedStudents:[
      { name:'박서준' },
    ],
    records:[
      {
        type:'memo',
        text:'서준이와 함께 했고 서준이가 먼저 말했으며 서준은 기다렸어요.',
      },
    ],
  });

  assert.equal(result.context.records[0].text, '학생B와 함께 했고 학생B가 먼저 말했으며 학생B는 기다렸어요.');
});

test('egress guard rejects alternate structured PII keys', () => {
  const payload = {
    subject_ref:'subject_abcdefghijklmnop',
    records:[],
    guardian_phone:'010-1111-2222',
    date_of_birth:'2018-05-03',
    school_name:'해봄초등학교',
  };

  const report = inspectEgressPayload(payload);
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item => item.type === 'forbidden_key'));
});


test('privacy-safe context keeps only allowed student division values', () => {
  const elementary = preparePrivacySafeAiContext({
    studentDivision:'elementary',
    subject:{ id:'student-e', name:'김민서' },
    records:[{ type:'memo', text:'김민서가 관찰한 것을 표현했어요.' }],
  });
  const kinder = preparePrivacySafeAiContext({
    studentDivision:'kinder',
    subject:{ id:'student-k', name:'이도하' },
    records:[{ type:'memo', text:'이도하가 재료를 탐색했어요.' }],
  });
  const invalid = preparePrivacySafeAiContext({
    studentDivision:'unknown-private-group',
    subject:{ id:'student-x', name:'박서준' },
    records:[{ type:'memo', text:'박서준이 표현했어요.' }],
  });

  assert.equal(elementary.context.student_division, 'elementary');
  assert.equal(kinder.context.student_division, 'kinder');
  assert.equal(Object.prototype.hasOwnProperty.call(invalid.context, 'student_division'), false);
});


test('pseudonym replacement fixes bare Korean subject particle after student alias', () => {
  const result = preparePrivacySafeAiContext({
    studentDivision:'elementary',
    subject:{ id:'student-z', name:'박서준' },
    records:[{ type:'memo', text:'박서준이 표현을 시작했어요.' }],
  });
  assert.equal(result.context.records[0].text, '학생A가 표현을 시작했어요.');
});


test('message privacy path sanitizes the exact chat messages before AI transport', () => {
  const prepared = preparePrivacySafeMessages({
    jobId:'feedback-job-2001',
    studentDivision:'elementary',
    subject:{
      id:'student-real-2001',
      name:'김민서',
      aliases:['민서'],
      schoolName:'해봄초등학교',
      phone:'010-2222-3333',
    },
    messages:[
      {
        role:'user',
        content:'아이 이름: 김민서\n민서가 해봄초등학교 이야기를 했고 연락처는 010-2222-3333입니다.',
      },
    ],
  });

  const serialized = JSON.stringify(prepared.messages);
  assert.equal(serialized.includes('김민서'), false);
  assert.equal(serialized.includes('민서'), false);
  assert.equal(serialized.includes('해봄초등학교'), false);
  assert.equal(serialized.includes('010-2222-3333'), false);
  assert.equal(serialized.includes('student-real-2001'), false);
  assert.match(serialized, /학생A/);
  assert.match(serialized, /학교A/);
  assert.match(serialized, /전화번호 제거/);
  assert.equal(prepared.requestScope.studentId, 'student-real-2001');
  assert.equal(JSON.stringify(prepared).includes('student-real-2001'), false);
});

test('final prepared egress guard blocks a forbidden identity reintroduced after sanitization', () => {
  const prepared = preparePrivacySafeMessages({
    subject:{ id:'student-real-3001', name:'김민서' },
    messages:[{ role:'user', content:'김민서가 작업했어요.' }],
  });

  assert.doesNotThrow(() => assertPreparedPrivacyEgress(prepared.messages, prepared));
  assert.throws(
    () => assertPreparedPrivacyEgress(
      [{ role:'user', content:'김민서가 작업했어요.' }],
      prepared
    ),
    (error) => error && error.code === 'AI_PRIVACY_EGRESS_BLOCKED'
  );
});
