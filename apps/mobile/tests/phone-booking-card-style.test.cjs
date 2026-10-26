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
  assert.doesNotMatch(entry, /min-height:/, 'restores automatic card height before the design changes');
  assert.match(rule(booking, '.obmAcademyEntry>span:first-child'), /padding:7px 0 7px 8px/, 'original 16px vertical padding is split between the outer 9px and inner 7px');
  assert.match(entry, /padding:9px/);
});

test('blue inset visual centers the white existing chevron; mobile navigation stays intact', () => {
  const visual = rule(booking, '.obmAcademyEntry>span:last-child');
  assert.match(visual, /display:flex/);
  assert.match(visual, /align-items:center/);
  assert.match(visual, /justify-content:center/);
  assert.match(visual, /flex:0 0 30%/, 'blue inset has a horizontal rectangular proportion');
  assert.match(visual, /text-align:center/, 'arrow text centered in its box');
  assert.match(visual, /border-radius:0 16px 16px 0/);
  assert.match(visual, /background:#0A84FF/);
  assert.match(visual, /color:#fff/);
  assert.match(shortcut, /entry\.innerHTML=.*상담 예약 현황.*<span aria-hidden="true">›<\/span>/);
  assert.match(shortcut, /entry\.addEventListener\('click',\(\)=>open\('mobile'\)\)/);
  assert.match(shortcut, /document\.body\.classList\.contains\('olliPcApp'\)/);
});

test('mobile loads the versioned updated booking stylesheet', () => {
  assert.match(mobileHtml, /olli-booking-owner-ui\.css\?v=20261026-mobile-card-height-2/);
});

test('consultation card is the fifth item in the two-column stat grid under 올해 등록', () => {
  const vm = require('node:vm');
  const dashboardSource = read('apps/mobile/olli-settings-server-sync.js');
  const statGrid = rule(academy, '.recordAcademyStatGrid');
  assert.match(statGrid, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  const renderer = dashboardSource.slice(dashboardSource.indexOf('dashboard.innerHTML'));
  const cardOrder = ['원생수', 'consultationCardLabel', '올해 등록', '올해 퇴원'];
  const at = cardOrder.map(label => renderer.indexOf(label));
  assert.ok(at.every(pos => pos >= 0) && at.every((pos, i) => i === 0 || pos > at[i - 1]));

  const start = shortcut.indexOf('function insertMobileShortcut(){');
  const end = shortcut.indexOf('function initMobileShortcut(){', start);
  assert.ok(start >= 0 && end > start, 'mobile shortcut has a single source function');
  const source = shortcut.slice(start, end);
  const cards = Array.from({length: 4}, (_, i) => ({label: cardOrder[i]}));
  const grid = {
    children: [...cards],
    appendChild(element){this.children.push(element);}
  };
  const dashboard = {
    classList:{contains: value => value === 'show'},
    querySelector(selector){
      if(selector === '.recordAcademyStatGrid') return grid;
      if(selector === '[data-olli-booking-entry]') return grid.children.find(x => x.dataset?.olliBookingEntry) || null;
      return null;
    }
  };
  const document = {
    body:{classList:{contains:() => false}},
    getElementById:id => id === 'recordAcademyDashboard' ? dashboard : null
  };
  const context = {
    document,
    isOwner:()=>true,
    open:()=>true,
    el:(tag, className) => ({
      tag, className, dataset:{},
      addEventListener(event, callback){this.onClick=callback;}
    })
  };
  vm.runInNewContext(source + '\ninsertMobileShortcut();insertMobileShortcut();', context);
  assert.equal(grid.children.length, 5, 'only one new card is placed');
  assert.deepEqual(grid.children.slice(0, 4), cards, 'the existing four stat cards keep their places');
  assert.equal(grid.children[4].dataset.olliBookingEntry, 'true');
  assert.equal(grid.children[4].className, 'obmAcademyEntry');
  const fullWidthRule = rule(booking, '.recordAcademyStatGrid > .obmAcademyEntry');
  assert.match(fullWidthRule, /grid-column:1\s*\/\s*-1/);
  assert.match(fullWidthRule, /margin-top:0/);
  assert.match(rule(booking, '.obmAcademyEntry'), /width:100%/);
});
