'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'pc-timetable.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function renderSortedPickups(items, time = 5) {
  const start = code.indexOf('  function slotPickups(date, classTime) {');
  const end = code.indexOf('  function recurringPickupTemplateForStudent(', start);
  assert.ok(start !== -1 && end > start);
  const getRows = new Function('pickups', 'pickupActiveOn', 'pickupScope', 'clean',
    code.slice(start, end) + '\nreturn slotPickups;')(
      () => items,
      (item, date) => Number(item.weekday) === Number(date.weekday),
      item => item.pickup_scope === 'daily' ? 'daily' : 'weekly',
      value => String(value ?? '').trim()
    );
  return getRows({ weekday: 2 }, time);
}

test('same pickup locations are adjacent and retain their previous relative order', () => {
  const rows = [
    { id:'1', student_id:'1', weekday:2, class_time:5, pickup_label:'웅진' },
    { id:'2', student_id:'2', weekday:2, class_time:5, pickup_label:'유치원' },
    { id:'3', student_id:'3', weekday:2, class_time:5, pickup_label:' 웅진  ' },
    { id:'4', student_id:'4', weekday:2, class_time:5, pickup_label:'유치원' },
    { id:'5', student_id:'5', weekday:2, class_time:5, pickup_label:'웅진' }
  ];
  const originals = rows.map(row => row.id);
  const ordered = renderSortedPickups(rows);
  assert.deepEqual(ordered.map(row => row.id), ['1','3','5','2','4']);
  assert.deepEqual(rows.map(row => row.id), originals);
});

test('dropoff-only uses dropoff location; daily overrides recurring, keeping other slots separate', () => {
  const rows = [
    { id:'a', student_id:'1', weekday:2, class_time:5, pickup_label:'웅진', pickup_scope:'weekly' },
    { id:'b', student_id:'2', weekday:2, class_time:5, pickup_label:'유치원' },
    { id:'c', student_id:'3', weekday:2, class_time:5, pickup_label:'집', is_dropoff:true, dropoff_label:'유치원' },
    { id:'d', student_id:'1', weekday:2, class_time:5, pickup_label:'유치원', pickup_scope:'daily' },
    { id:'e', student_id:'4', weekday:2, class_time:4, pickup_label:'유치원' },
    { id:'f', student_id:'5', weekday:2, class_time:5, pickup_label:'' }
  ];
  const ordered = renderSortedPickups(rows);
  assert.deepEqual(ordered.map(row => row.id), ['b','c','d','f']);
  assert.ok(!ordered.some(row => row.id === 'a' || row.id === 'e'));
  assert.equal(renderSortedPickups(rows, 4)[0].id, 'e');
});

test('PC timetable script gets its own cache-busted version', () => {
  assert.match(html, /pc-timetable\.js\?v=20261013-pickup-location-1/);
});
