'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.resolve(__dirname, '../../..', p), 'utf8');
const academy = read('apps/mobile/olli-academy-dashboard.css');
const booking = read('packages/common/olli-booking-owner-ui.css');
const shortcut = read('packages/common/olli-booking-owner-ui.js');
const mobileHtml = read('apps/mobile/index.html');

function rule(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, selector + ' must exist');
  const brace = css.indexOf('{', start);
  const end = css.indexOf('}', brace);
  assert.ok(brace > start && end > brace);
  return css.slice(brace + 1, end);
}

test('consultation shortcut matches student-count card border, radius and shadow', () => {
  const stat = rule(academy, '.recordAcademyStatCard').replace(/\s+/g, '');
  const entry = rule(booking, '.obmAcademyEntry').replace(/\s+/g, '');
  for (const property of [
    'border:1pxsolidrgba(0,0,0,0.06)',
    'border-radius:22px',
    'box-shadow:08px24pxrgba(0,0,0,0.045)'
  ]) {
    assert.ok(stat.includes(property), 'student-count card missing ' + property);
    assert.ok(entry.includes(property), 'booking card missing ' + property);
  }
  assert.match(entry, /background:#fff/);
  assert.match(entry, /align-items:stretch/);
});

test('blue inset visual centers the white existing chevron; mobile navigation stays intact', () => {
  const visual = rule(booking, '.obmAcademyEntry>span:last-child');
  assert.match(visual, /display:flex/);
  assert.match(visual, /align-items:center/);
  assert.match(visual, /justify-content:center/);
  assert.match(visual, /border-radius:16px/);
  assert.match(visual, /background:#0A84FF/);
  assert.match(visual, /color:#fff/);
  assert.match(shortcut, /entry\.innerHTML=.*상담 예약 현황.*<span aria-hidden="true">›<\/span>/);
  assert.match(shortcut, /entry\.addEventListener\('click',\(\)=>open\('mobile'\)\)/);
  assert.match(shortcut, /document\.body\.classList\.contains\('olliPcApp'\)/);
});

test('mobile loads the versioned updated booking stylesheet', () => {
  assert.match(mobileHtml, /olli-booking-owner-ui\.css\?v=20261026-mobile-card-1/);
});
