const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('olli-phone-base.css', 'utf8');

test('phone body is not globally width-limited', () => {
  const bodyBlock = css.match(/body\s*\{[\s\S]*?\}/)?.[0] || '';
  assert.doesNotMatch(bodyBlock, /max-width\s*:\s*393px/);
  assert.doesNotMatch(bodyBlock, /transform\s*:\s*translateZ\(0\)/);
});

test('iPad alone receives the fixed phone-width shell', () => {
  assert.match(html, /\/iPad\/i\.test\(navigator\.userAgent\)/);
  assert.match(html, /navigator\.platform\s*===\s*['"]MacIntel['"]/);
  assert.match(html, /navigator\.maxTouchPoints\s*>\s*1/);
  assert.match(css, /html\.olli-ipad-phone-shell body\s*\{[\s\S]*width:\s*393px;[\s\S]*max-width:\s*393px;[\s\S]*transform:\s*translateZ\(0\);/);
});

test('no viewport-width responsive media rules are reintroduced', () => {
  const responsiveMedia = /@media\s*\([^)]*(?:min-width|max-width|orientation|aspect-ratio)[^)]*\)/i;
  assert.doesNotMatch(css, responsiveMedia);
});
