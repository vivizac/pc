'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../packages/common/olli-data-record-list.js'), 'utf8');
const pcStyles = fs.readFileSync(path.resolve(__dirname, '../apps/pc/olli-common-components.css'), 'utf8');
const pcResponsive = fs.readFileSync(path.resolve(__dirname, '../apps/pc/olli-responsive.css'), 'utf8');
const pcHtml = fs.readFileSync(path.resolve(__dirname, '../apps/pc/index.html'), 'utf8');
const pcRoster = fs.readFileSync(path.resolve(__dirname, '../apps/pc/olli-record-list-view.js'), 'utf8');

function contextFor(elementaryCriterion, kinderCriterion = 'initial') {
  const sortState = {elementary: {criteria: elementaryCriterion}, kinder: {criteria: kinderCriterion}};
  const context = {
    localStorage: {getItem: () => JSON.stringify(sortState)},
    getStudentStatusRank: s => s.status === 'paused' ? 1 : s.status === 'withdrawn' ? 2 : 0,
    compareElementaryGroupFeedbackOrder: () => 0
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function ids(rows) { return Array.from(rows, row => row.id); }

test('학교 정렬: 학생 수가 많은 학교부터, 동률은 학교명 가나다순, 미지정은 맨 뒤', () => {
  const ctx = contextFor('school');
  const rows = [
    {id:'1',name:'도아',school:'하늘초',type:'elementary'},
    {id:'2',name:'도윤',school:'새별초',type:'elementary'},
    {id:'3',name:'도희',school:'하늘초',type:'elementary'},
    {id:'4',name:'민아',school:'새별초',type:'elementary'},
    {id:'5',name:'민준',school:'하늘초',type:'elementary'},
    {id:'6',name:'서아',school:'가람초',type:'elementary'},
    {id:'7',name:'태호',school:'',type:'elementary'}
  ];
  assert.deepEqual(ids(ctx.sortElementaryStudents(rows)), ['1','3','5','2','4','6','7']);
  assert.deepEqual(ids(rows), ['1','2','3','4','5','6','7'], '원본 배열을 변경하지 않는다');
});

test('담임 정렬은 수업 담임이 아닌 피드백 담임만 사용', () => {
  const ctx = contextFor('teacher', 'teacher');
  const rows = [
    {id:'1',name:'나래',homeroom_teacher:'가수업',feedback_teacher:'윤피드백',type:'elementary'},
    {id:'2',name:'가온',homeroom_teacher:'하수업',feedback_teacher:'김피드백',type:'elementary'},
    {id:'3',name:'다솜',homeroom_teacher:'고수업',feedback_teacher:'',type:'elementary'}
  ];
  assert.deepEqual(ids(ctx.sortElementaryStudents(rows)), ['2','1','3']);
  assert.equal(ctx.getRecordSortTeacherValue(rows[2]), '', '피드백 담임 미지정 시 수업 담임으로 대체하지 않는다');
  assert.equal(ctx.getRecordSortSectionKey(rows[0],'elementary'), 'teacher:윤피드백');
  assert.deepEqual(ids(ctx.sortKinderStudents(rows.map(r => ({...r,type:'kinder'})))), ['2','1','3']);
});

test('PC 구분선은 두께 2px, 검정색이며 초등/유치부 모두 동일', () => {
  assert.match(pcStyles, /\.elementaryStudentRow\.groupBreak::before\s*\{[^}]*height:\s*2px;[^}]*background:\s*#000;/s);
  assert.match(pcResponsive, /#recordRoomScreen \.kinderStudentRow\.groupBreak::before\s*\{[^}]*height:\s*2px;[^}]*background:\s*#000;/s);
  assert.match(pcHtml, /olli-data-record-list\.js\?v=20261029-feedback-teacher-school-count-1/);
});

test('PC 담임 정렬 표시에는 피드백담임만 사용하고 수업 담임은 중복 표시하지 않는다', () => {
  const ctx = {
    getRecordSortCriteria: () => 'teacher',
    getStudentTeacherDisplay: () => '기존수업T',
    getRecordSortTeacherValue: student => student.feedback_teacher || '',
    getElementaryMetaBits: () => ['학교 / 기존수업T / 월·수'],
    getKinderMetaBits: () => ['유치원 / 기존수업T / 화']
  };
  vm.createContext(ctx);
  vm.runInContext(pcRoster, ctx);
  assert.deepEqual(Array.from(ctx.getPcRosterMetaBits({feedback_teacher:'홍선생'}, 'elementary')), ['학교 / 피드백담임 홍선생 / 월·수']);
  assert.deepEqual(Array.from(ctx.getPcRosterMetaBits({feedback_teacher:''}, 'kinder')), ['유치원 / 피드백담임 미정 / 화']);
  assert.match(pcHtml, /olli-record-list-view\\.js\\?v=20261029-feedback-roster-teacher-1/);
});
