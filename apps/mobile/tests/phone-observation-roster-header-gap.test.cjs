const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(mobileRoot, 'olli-observation-roster-phone.css'), 'utf8');
const html = fs.readFileSync(path.join(mobileRoot, 'index.html'), 'utf8');

function getRule(selector) {
  const start = css.indexOf(selector + ' {');
  assert.notEqual(start, -1, `Missing CSS selector: ${selector}`);
  return css.slice(start, css.indexOf('}', start) + 1);
}

test('observation roster header-to-first-card gap increases by 50% without changing row spacing', () => {
  const header = getRule('#observationRosterScreen .memoBodyRosterHeader');
  const list = getRule('#observationRosterScreen .memoBodyRosterList');
  const row = getRule('#observationRosterScreen .memoBodyRosterRow');
  const adjacentRow = getRule('#observationRosterScreen .memoBodyRosterRow + .memoBodyRosterRow');

  assert.match(header, /margin:\s*2px 0 35px;/);
  assert.match(list, /margin:\s*0;/);
  assert.match(row, /height:54px;/);
  assert.match(row, /min-height:54px;/);
  assert.match(adjacentRow, /border-top:1px solid #eeeeee;/);
  assert.match(html, /olli-observation-roster-phone\.css\?v=20261108-header-gap-35px-1/);
});
