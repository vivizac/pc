'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('mobile booking shortcut retains existing navigation while wrapping arrow in blue inset', () => {
  const js = read('packages/common/olli-booking-owner-ui.js');
  assert.match(js, /entry\.addEventListener\('click',\(\)=>open\('mobile'\)\)/);
  assert.match(js, /class="obmAcademyEntryContent"/);
  assert.match(js, /class="obmAcademyEntryArrowBox" aria-hidden="true"/);
  assert.match(js, /class="obmAcademyEntryArrow">›<\/span>/);
  assert.match(js, /if\(document\.body\.classList\.contains\('olliPcApp'\)\)return/);
});
test('shortcut matches resident count card borders, radius and shadow', () => {
  const dashboard = read('apps/mobile/olli-academy-dashboard.css');
  const booking = read('packages/common/olli-booking-owner-ui.css');
  const card = dashboard.match(/\.recordAcademyStatCard\s*\{([^}]+)\}/)[1];
  const shortcut = booking.match(/#recordAcademyDashboard \.obmAcademyEntry\s*\{([^}]+)\}/)[1];
  for (const style of ['border:1px solid rgba(0,0,0,0.06)', 'border-radius:22px', 'box-shadow:0 8px 24px rgba(0,0,0,0.045)']) {
    assert.match(card.replace(/\s+/g,''), new RegExp(style.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.ok(shortcut.includes(style), style);
  }
  assert.match(booking, /\.obmAcademyEntryArrowBox\{[^}]*background:#0A84FF;color:#fff/);
  assert.match(booking, /\.obmAcademyEntryArrow\{[^}]*color:inherit/);
});
test('mobile loads the latest booking shortcut CSS and JS', () => {
  const html = read('apps/mobile/index.html');
  assert.match(html, /olli-booking-owner-ui\.css\?v=20261026-mobile-shortcut-card-1/);
  assert.match(html, /olli-booking-owner-ui\.js\?v=20261026-mobile-shortcut-card-1/);
});
