const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');

test('short dedicated edit textarea blocks touchmove while a genuinely scrollable textarea keeps native scrolling', () => {
  const block = adapter.match(/function preventPhoneKcfDedicatedEditBackgroundTouchMove\(event\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(block, /const textarea = isPhoneKcfDedicatedEditTextarea\(event\.target\);/);
  assert.match(block, /textarea\.scrollHeight > textarea\.clientHeight \+ 1/);
  assert.match(block, /if \(textarea && textarea\.scrollHeight > textarea\.clientHeight \+ 1\) return;/);
  assert.match(block, /if \(event\.cancelable\) event\.preventDefault\(\);/);
});
