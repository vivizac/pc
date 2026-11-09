'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const platforms = {
  pc: { runtime: 'olli-record-feedback-generation.js', studentLookup: 'olli-data-feedback.js' },
  mobile: { runtime: 'olli-observation-runtime.js', studentLookup: 'olli-student-core.js' }
};

function functionSource(source, name) {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end + 2);
}

function fixture(platform, activeStudent) {
  const app = path.resolve(__dirname, '../apps', platform);
  const { runtime, studentLookup } = platforms[platform];
  const source = fs.readFileSync(path.join(app, runtime), 'utf8');
  const lookup = fs.readFileSync(path.join(app, studentLookup), 'utf8');
  const students = [
    { id: 'student-elementary', name: '합성 학생', type: 'elementary' },
    { id: 'student-kinder', name: '합성 학생', type: 'kinder' }
  ];
  const calls = { request: [], student: [], feedback: [], reset: [], errors: [] };
  const reviewCard = { classList: { contains: () => false } };
  const reviewButton = { closest: () => reviewCard, isConnected: true, textContent: '저장' };
  let resolveResponse;
  const response = new Promise(resolve => { resolveResponse = resolve; });
  const sandbox = {
    currentMemoStudent: students[activeStudent],
    loading: false,
    observationFeedbackLoading: false,
    document: {
      getElementById: () => null,
      createElement: () => ({ querySelector: () => reviewCard }),
      body: { appendChild() {} }
    },
    console: { error: (...args) => calls.errors.push(args), warn: (...args) => calls.errors.push(args) },
    fetch(url, options) {
      assert.equal(url, '/api/chat');
      calls.request.push(JSON.parse(options.body));
      return response;
    },
    normalizeTodayFeedbackStudentName: name => name.trim(),
    getAllStudents: () => students,
    async ensureStudentSavedToSupabase(student) {
      calls.student.push({ id: student.id, division: student.type });
      return student;
    },
    getFeedbackTableNameByType: () => 'feedbacks',
    addOlliAcademyToPayload: data => ({ ...data, academy_id: 'synthetic-academy' }),
    async saveFeedbackRowVerified(table, data) {
      calls.feedback.push({ table, studentId: data.student_id, type: data.feedback_type });
      return { id: 'synthetic-feedback' };
    },
    resetElementaryMemoAfterFeedbackSave: () => calls.reset.push(sandbox.currentMemoStudent.id),
    getFeedbackMonthLabel: () => '11월',
    getFeedbackMonthNumber: () => 11,
    getOlliFeedbackTargetMonthForSave: () => '2026-11-01',
    buildSceneCardUserText: text => text,
    buildTodayFeedbackRequestContent: text => text,
    parseReplyType: text => ({ cleanText: text }),
    getFutureDirectionFromApiData: () => '',
    escapeHtml: text => text,
    alert: message => calls.errors.push(message),
    showFeedbackLoading() {},
    hideFeedbackLoading() {},
    closeMemoFeedbackPopup() {},
    showPushToast() {},
    addMemoFeedbackArchiveItem() {},
    async refreshRecordsAfterFeedbackSave() {},
    async loadMemoFeedbackArchiveItemsFromSupabase() {}
  };
  const names = platform === 'pc'
    ? ['requestSceneCardFeedbackFromElementary', 'saveElementaryFeedbackDirectly']
    : ['requestSceneCardFeedbackFromElementary', 'openMemoFeedbackReviewPopup',
      'saveMemoFeedbackReviewFromPopup', 'saveElementaryFeedbackDirectlyToArchive'];
  vm.runInNewContext([
    ...names.map(name => functionSource(source, name)),
    functionSource(lookup, 'getOrCreateStudentForSupabaseSave')
  ].join('\n'), sandbox);
  return {
    sandbox, students, calls, reviewCard, reviewButton,
    reply: () => resolveResponse({ ok: true, text: async () => '{"reply":"합성 성장 피드백"}' })
  };
}

for (const platform of Object.keys(platforms)) {
  test(platform + ' growth feedback keeps the requested student and division after switching notes', async () => {
    for (const index of [0, 1]) {
      const { sandbox, students, calls, reviewCard, reviewButton, reply } = fixture(platform, index);
      const student = students[index];
      const otherStudent = students[1 - index];
      const request = sandbox.requestSceneCardFeedbackFromElementary(student.name, '합성 수업 기록', '');
      assert.equal(calls.request[0].studentId, student.id);
      assert.equal(calls.request[0].studentDivision, student.type);
      if (platform === 'pc') sandbox.currentMemoStudent = otherStudent;
      reply();
      await request;
      if (platform === 'mobile') {
        assert.equal(reviewCard._studentId, student.id);
        assert.equal(reviewCard._studentDivision, student.type);
        sandbox.currentMemoStudent = otherStudent;
        assert.ok(await sandbox.saveMemoFeedbackReviewFromPopup(reviewButton));
      }
      assert.deepEqual(calls.errors, []);
      assert.deepEqual(calls.student, [{ id: student.id, division: student.type }]);
      assert.deepEqual(calls.feedback, [{ table: 'feedbacks', studentId: student.id, type: 'growth' }]);
      assert.deepEqual(calls.reset, []);
      assert.equal(sandbox.currentMemoStudent, otherStudent);
    }
  });

  test(platform + ' explicit division takes precedence and feedback lookup preserves the registered division', async () => {
    const { sandbox, students, calls, reviewButton, reply } = fixture(platform, 1);
    const student = students[0];
    const request = sandbox.requestSceneCardFeedbackFromElementary(student.name, '합성 수업 기록', '', {
      studentId: student.id,
      studentDivision: student.type
    });
    assert.equal(calls.request[0].studentId, student.id);
    assert.equal(calls.request[0].studentDivision, 'elementary');
    reply();
    await request;
    if (platform === 'mobile') assert.ok(await sandbox.saveMemoFeedbackReviewFromPopup(reviewButton));
    assert.deepEqual(calls.errors, []);
    assert.deepEqual(calls.student, [{ id: student.id, division: 'elementary' }]);

    await sandbox.getOrCreateStudentForSupabaseSave(student.name, 'kinder', student.id);
    assert.deepEqual(calls.student[1], { id: student.id, division: 'elementary' });
  });
}
