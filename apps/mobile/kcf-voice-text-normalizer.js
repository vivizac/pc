(function initKcfVoiceTextNormalizer(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KcfVoiceTextNormalizer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKcfVoiceTextNormalizer() {
  'use strict';

  var HOUR_WORDS = {
    '하나': 1,
    '한': 1,
    '둘': 2,
    '두': 2,
    '셋': 3,
    '세': 3,
    '넷': 4,
    '네': 4,
    '다섯': 5,
    '여섯': 6,
    '일곱': 7,
    '여덟': 8,
    '아홉': 9,
    '열': 10,
    '열한': 11,
    '열두': 12
  };

  var SINO_DIGITS = {
    '일': 1,
    '이': 2,
    '삼': 3,
    '사': 4,
    '오': 5,
    '육': 6,
    '칠': 7,
    '팔': 8,
    '구': 9
  };

  var HOUR_PATTERN = Object.keys(HOUR_WORDS)
    .sort(function(a, b) { return b.length - a.length; })
    .join('|');

  function parseSinoKoreanNumber(token) {
    var value = String(token || '').replace(/\s+/g, '');
    if (!value) return null;

    if (Object.prototype.hasOwnProperty.call(SINO_DIGITS, value)) {
      return SINO_DIGITS[value];
    }

    var match = value.match(/^([일이삼사오육칠팔구]?)십([일이삼사오육칠팔구]?)$/);
    if (!match) return null;

    var tens = match[1] ? SINO_DIGITS[match[1]] : 1;
    var ones = match[2] ? SINO_DIGITS[match[2]] : 0;
    var number = (tens * 10) + ones;
    return number >= 0 && number < 60 ? number : null;
  }

  function normalizeTimeExpressions(text) {
    var result = String(text == null ? '' : text);
    if (!result) return result;

    var hourRegex = new RegExp('(' + HOUR_PATTERN + ')\\s*시', 'g');
    result = result.replace(hourRegex, function(_, word) {
      var hour = HOUR_WORDS[word];
      return hour ? String(hour) + '시' : _;
    });

    result = result.replace(/(\d{1,2})\s*시\s*반/g, function(_, hourText) {
      var hour = Number(hourText);
      if (!Number.isFinite(hour) || hour < 0 || hour > 24) return _;
      return String(hour) + '시 30분';
    });

    result = result.replace(
      /(\d{1,2})\s*시\s*([일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구])\s*분/g,
      function(_, hourText, minuteText) {
        var hour = Number(hourText);
        var minute = parseSinoKoreanNumber(minuteText);
        if (!Number.isFinite(hour) || hour < 0 || hour > 24 || minute === null) return _;
        return String(hour) + '시 ' + String(minute) + '분';
      }
    );

    result = result.replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*분/g, function(_, hourText, minuteText) {
      var hour = Number(hourText);
      var minute = Number(minuteText);
      if (!Number.isFinite(hour) || hour < 0 || hour > 24) return _;
      if (!Number.isFinite(minute) || minute < 0 || minute >= 60) return _;
      return String(hour) + '시 ' + String(minute) + '분';
    });

    result = result.replace(/(\d{1,2})\s*시/g, function(_, hourText) {
      var hour = Number(hourText);
      if (!Number.isFinite(hour) || hour < 0 || hour > 24) return _;
      return String(hour) + '시';
    });

    return result;
  }

  return {
    normalizeTimeExpressions: normalizeTimeExpressions,
    parseSinoKoreanNumber: parseSinoKoreanNumber
  };
});
