'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const common = fs.readFileSync(path.join(root, '..', '..', 'packages', 'common', 'olli-feedback-runtime.js'), 'utf8');
const live = fs.readFileSync(path.join(root, 'kinder-feedback.js'), 'utf8');
const teacher = fs.readFileSync(path.join(root, 'kcf-auto-mode-runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const start = common.indexOf('function isOlliFeedbackClarificationResponse(text) {');
const end = common.indexOf('function isTodayFeedbackLoadFailItem(item) {', start);
assert.ok(start >= 0 && end > start, 'classifier should be present in shared runtime');
const classify = new Function(common.slice(start,end) + '\nreturn isOlliFeedbackClarificationResponse;')();

test('additional AI questions are not completed parent feedback', () => {
  assert.equal(classify('몇 가지만 확인해도 될까요?\n1) "사진만의 동물"이라고 입력해주셨는데 자기만의 동물을 뜻하신 건가요?\n2) "과외질"은 어떤 의미인지 알려주실 수 있나요?'), true);
  assert.equal(classify("마지막에 쓰신 '과외질'이 어떤 의미인지 알려주실 수 있나요? 알려주시면 학부모 드릴 피드백으로 정리해드리겠습니다."), true);
  assert.equal(classify('몇 가지만 확인해도 될까요?'), true);
});

test('a child asking questions inside a complete feedback stays valid', () => {
  assert.equal(classify('오늘 수업에서 천을 만지며 자신만의 동물을 만들었습니다. 아이가 “어떤 느낌인가요?”라고 묻고 다양한 조각을 탐색했습니다.'), false);
  assert.equal(classify('집에서도 “어떤 색을 좋아하니?”라고 물어봐 주시면 아이의 생각이 자랄 거예요.'), false);
  assert.equal(classify('오늘 수업에서 색과 형태를 탐색했습니다.'), false);
});

test('LIVE must gate both inbox mirroring and automatic Supabase saving', () => {
  const mirror = live.indexOf('function syncKinderChatFeedbackLiveItemToInbox(item) {');
  const save = live.indexOf("async function saveKinderChatFeedbackLiveOnce(id, selectedStudentId = '') {");
  const finish = live.indexOf("const finalText = restoreKinderChatFeedbackLiveStudentAliases(");
  assert.ok(mirror >= 0 && save >= 0 && finish >= 0);
  assert.match(live.slice(mirror, mirror + 650), /item\.status === 'clarification'/);
  assert.match(live.slice(save, save + 650), /item\.status === 'clarification'/);
  const finishBlock = live.slice(finish, finish + 4100);
  assert.match(finishBlock, /status:'clarification'/);
  assert.ok(finishBlock.indexOf("status:'clarification'") < finishBlock.indexOf("item.status = item.suspiciousSegments.length ? 'review' : 'done'"));
});

test('manual saving and nonstreamed results also block clarification', () => {
  assert.match(common, /item\?\.status === 'clarification' \|\| isOlliFeedbackClarificationResponse/);
  assert.match(common, /notifyKcfFeedbackRequestResult\(item, 'clarification'\)/);
});

test('student roster can be selected again after a question', () => {
  assert.match(teacher, /if \(status !== 'error' && status !== 'clarification'\) return;/);
  assert.match(teacher, /state\.completedIds\.delete\(studentId\)/);
  assert.match(teacher, /selectNextAvailableAutoStudent\(submitted\.studentId, submitted\.order \|\| \[\]\)/);
});

test('all three modified mobile scripts get a new cache-bust version', () => {
  assert.match(html, /olli-feedback-runtime\.js\?v=20261014-feedback-question-guard-1/);
  assert.match(html, /kinder-feedback\.js\?v=20261014-feedback-question-guard-1/);
  assert.match(html, /kcf-auto-mode-runtime\.js\?v=20261014-feedback-question-guard-1/);
});
