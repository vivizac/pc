const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const chat = fs.readFileSync('api/chat.js', 'utf8');
const start = chat.indexOf('const OLLI_COMPOUND_KOREAN_SURNAMES');
const end = chat.indexOf('function extractReplyText', start);
assert.ok(start >= 0 && end > start);
const { restorePrivacyResponseAliases, createPrivacyStreamRewriter } = vm.runInNewContext(
  chat.slice(start, end) + '\n({ restorePrivacyResponseAliases, createPrivacyStreamRewriter })'
);

test('request-specific given names use natural Korean particles', () => {
  const cases = [
    ['최민서', '학생A는 학생A가 골랐어요.', '민서는 민서가 골랐어요.'],
    ['김민준', '학생A는 학생A가 골랐어요.', '민준이는 민준이가 골랐어요.'],
    ['이지안', '학생 A는 학생 A가 골랐어요.', '지안이는 지안이가 골랐어요.'],
    ['김하린', '학생A은 학생A이 웃었어요.', '하린이는 하린이 웃었어요.'],
    ['김민서', '학생A를 학생A와 비교했어요.', '민서를 민서와 비교했어요.'],
    ['김민준', '학생A을 학생A과 비교했어요.', '민준이를 민준이와 비교했어요.'],
    ['남궁민서', '학생A는 학생A에게 말했어요.', '민서는 민서에게 말했어요.'],
    ['김민준', '학생A이가 학생A이를 도왔어요.', '민준이가 민준이를 도왔어요.'],
    ['김민준', '학생A이랑 학생A의 그림', '민준이랑 민준이의 그림'],
    ['최민서', '학생A이지만 학생B가 도왔어요.', '민서지만 다른 친구가 도왔어요.'],
    ['김민준', '김민준는 김민준가 그렸어요.', '민준이는 민준이가 그렸어요.'],
    ['최민서', '최민서는 최민서가 그렸어요.', '민서는 민서가 그렸어요.'],
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(restorePrivacyResponseAliases(input, name), expected, name);
  }
});

test('stream chunks do not separate subject aliases and Korean particles', () => {
  const source = '🌱 오늘 학생 A는 색을 골랐고 학생A가 웃었어요. 학생B와 놀며 학생A에게 이야기했어요.';
  const expected = restorePrivacyResponseAliases(source, '김민준');
  const chars = Array.from(source);
  for (let chunkSize = 1; chunkSize <= chars.length; chunkSize++) {
    const rewriter = createPrivacyStreamRewriter('김민준');
    let actual = '';
    for (let i = 0; i < chars.length; i += chunkSize) {
      actual += rewriter.push(chars.slice(i, i + chunkSize).join(''));
    }
    actual += rewriter.flush();
    assert.equal(actual, expected, 'chunkSize=' + chunkSize);
  }
});

test('PC and mobile growth use the original privacy gateway; no saving logic changed', () => {
  assert.match(chat, /requestMessages = privacyPrepared.messages/);
  assert.match(chat, /privacyGateway.assertPreparedPrivacyEgress/);
  assert.match(chat, /restorePrivacyResponseAliases\(rawReplyText, responseStudentName\)/);
  assert.match(chat, /createPrivacyStreamRewriter\(options.studentName \|\| ''\)/);
});
