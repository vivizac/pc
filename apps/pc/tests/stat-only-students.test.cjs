'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const common = fs.readFileSync(path.join(root, 'packages/common/olli-data-students.js'), 'utf8');
const start = common.indexOf('function getAllStudents(options = {})');
const end = common.indexOf('\nfunction saveStudent(', start);
assert.ok(start >= 0 && end > start, '공통 학생 목록 원본 함수를 찾을 수 있어야 합니다.');

test('통계 전용 학생은 일반 목록에서 숨기되 전체 통계 원본에는 유지', () => {
  const values = new Map();
  const ctx = {
    STUDENTS_KEY: 'students',
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    },
    getStudentsStorageKey: () => 'students',
    getOlliCurrentAcademyId: () => 'academy-a',
    normalizeStudentObject: (student) => ({ ...student }),
    isOlliSoftDeletedRow: () => false
  };
  vm.createContext(ctx);
  vm.runInContext(common.slice(start, end), ctx);
  const normal = { id: 'real-1', academy_id: 'academy-a', type: 'kinder', status: 'active', is_stat_only: false };
  const sample = { id: 'test-1', academy_id: 'academy-a', type: 'kinder', status: 'active', is_stat_only: true };
  ctx.setAllStudents([normal, sample], { replaceStatOnly: true });
  assert.equal(ctx.getAllStudents().length, 1, '일반 목록에는 실제 학생만 보여야 합니다.');
  assert.equal(ctx.getStudentsByType('kinder').length, 1, '유치부 명단에도 테스트 학생은 제외되어야 합니다.');
  assert.equal(ctx.getAllStudents({ includeStatOnly: true }).length, 2, '통계에는 두 학생 모두 포함합니다.');
  ctx.setAllStudents([normal]);
  assert.equal(ctx.getAllStudents({ includeStatOnly: true }).length, 2, '일반 학생 갱신 중 테스트 행이 소실되면 안 됩니다.');
  ctx.setAllStudents([normal], { replaceStatOnly: true });
  assert.equal(ctx.getAllStudents({ includeStatOnly: true }).length, 1, '서버 전체 교체 시 제거된 테스트 행이 부활하면 안 됩니다.');
});

test('PC와 모바일 모두 통계 포함·상담 제외·서버 플래그 로드를 유지', () => {
  for (const platform of ['pc', 'mobile']) {
    const data = fs.readFileSync(path.join(root, 'apps', platform, 'olli-data-student-operations.js'), 'utf8');
    assert.match(data, /is_stat_only: row\.is_stat_only === true/);
    assert.match(data, /setAllStudents\(nextStudents, \{ replaceStatOnly: true \}\)/);
    const consultationFile = platform === 'pc' ? 'olli-consultation-runtime.js' : 'olli-consultation-mobile-runtime.js';
    const source = fs.readFileSync(path.join(root, 'apps', platform, consultationFile), 'utf8');
    assert.match(source, /return getAllStudents\(\{ includeStatOnly: true \}\)/);
    assert.match(source, /\.filter\(student => student\.is_stat_only !== true\)/);
  }
});

test('PC 학생 병합에서 서버의 통계 전용 플래그를 유지', () => {
  const source = fs.readFileSync(path.join(root, 'apps/pc/olli-data-student-operations.js'), 'utf8');
  const start = source.indexOf('function mergeStudentInfoPreservingLocal(');
  const end = source.indexOf('\nasync function ensureStudentSavedToSupabase(', start);
  assert.ok(start >= 0 && end > start);
  const ctx = {
    normalizeStudentObject: (student) => ({ ...student }),
    getOlliCurrentAcademyId: () => 'academy-a'
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  const local = { id: 'test-1', name: '테스트', type: 'kinder', status: 'active', is_stat_only: false };
  const remote = { ...local, is_stat_only: true };
  assert.equal(ctx.mergeStudentInfoPreservingLocal(local, remote).is_stat_only, true);
  assert.equal(ctx.mergeStudentInfoPreservingLocal(remote, { ...remote, is_stat_only: false }).is_stat_only, false);
});
