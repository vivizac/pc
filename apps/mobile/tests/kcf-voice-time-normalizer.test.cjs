const test = require('node:test');
const assert = require('node:assert/strict');

const normalizer = require('../kcf-voice-text-normalizer.js');

test('voice time normalizer converts spoken Korean clock hours to digits', () => {
  assert.equal(normalizer.normalizeTimeExpressions('다섯시 보강'), '5시 보강');
  assert.equal(normalizer.normalizeTimeExpressions('월요일 다섯 시 보강'), '월요일 5시 보강');
  assert.equal(normalizer.normalizeTimeExpressions('오후 열한 시'), '오후 11시');
});

test('voice time normalizer converts half hours and Korean minutes', () => {
  assert.equal(normalizer.normalizeTimeExpressions('다섯 시 반'), '5시 30분');
  assert.equal(normalizer.normalizeTimeExpressions('여섯시 삼십분'), '6시 30분');
  assert.equal(normalizer.normalizeTimeExpressions('두 시 십오 분'), '2시 15분');
  assert.equal(normalizer.normalizeTimeExpressions('오후 다섯시 사십오분'), '오후 5시 45분');
});

test('voice time normalizer keeps ordinary Korean counters unchanged', () => {
  assert.equal(normalizer.normalizeTimeExpressions('다섯 명이 참여했어요'), '다섯 명이 참여했어요');
  assert.equal(normalizer.normalizeTimeExpressions('두 번째 작품이에요'), '두 번째 작품이에요');
  assert.equal(normalizer.normalizeTimeExpressions('세 장을 사용했어요'), '세 장을 사용했어요');
});

test('voice time normalizer keeps am pm wording instead of converting to 24 hour time', () => {
  assert.equal(normalizer.normalizeTimeExpressions('오전 아홉시'), '오전 9시');
  assert.equal(normalizer.normalizeTimeExpressions('오후 다섯시'), '오후 5시');
});
