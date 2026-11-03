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
  assert.match(html, /pc-timetable\.js\?v=20261103-daily-pickup-makeup-color-1/);
  assert.match(html, /pc-timetable\.css\?v=20261103-daily-pickup-makeup-color-1/);
});

test('earlier pickup times sort first, with matching locations grouped at equal times', () => {
  const rows = [
    { id:'late', student_id:'1', weekday:2, class_time:5, pickup_label:'웅진', pickup_time:'16:50' },
    { id:'firstA', student_id:'2', weekday:2, class_time:5, pickup_label:'웅진', pickup_time:'16:20' },
    { id:'firstB', student_id:'3', weekday:2, class_time:5, pickup_label:'유치원', pickup_time:'16:20' },
    { id:'middle', student_id:'4', weekday:2, class_time:5, pickup_label:'웅진', pickup_time:'16:35' },
    { id:'firstC', student_id:'5', weekday:2, class_time:5, pickup_label:' 웅진  ', pickup_time:'16:20' },
    { id:'earliest', student_id:'6', weekday:2, class_time:5, pickup_label:'유치원', pickup_time:'16:10' }
  ];
  const savedOrder = rows.map(item => item.id);
  assert.deepEqual(renderSortedPickups(rows).map(item => item.id),
    ['earliest', 'firstA', 'firstC', 'firstB', 'middle', 'late']);
  assert.deepEqual(rows.map(item => item.id), savedOrder);
});

test('dropoff-only uses its dropoff time; missing/invalid times appear after timed cards', () => {
  const rows = [
    { id:'blank', student_id:'1', weekday:2, class_time:5, pickup_label:'웅진', pickup_time:null },
    { id:'arrival', student_id:'2', weekday:2, class_time:5, pickup_label:'유치원', pickup_time:'16:45' },
    { id:'dropoff', student_id:'3', weekday:2, class_time:5, pickup_label:'이전 장소', pickup_time:null, is_dropoff:true, dropoff_label:'집 앞', dropoff_time:'16:15' },
    { id:'invalid', student_id:'4', weekday:2, class_time:5, pickup_label:'유치원', pickup_time:'25:99' }
  ];
  assert.deepEqual(renderSortedPickups(rows).map(item => item.id),
    ['dropoff', 'arrival', 'blank', 'invalid']);
});


function renderPickupCards(items, holiday = false) {
  const start = code.indexOf('  function pickupCellHtml(date, classTime) {');
  const end = code.indexOf('  function pickupGridHtml(dates)', start);
  assert.ok(start !== -1 && end > start, 'original pickup renderer must exist');
  const render = new Function(
    'slotPickups', 'isHolidayDate', 'pickupScope', 'dateKey', 'clean', 'esc', 'pickupTimeLabel',
    code.slice(start, end) + '\nreturn pickupCellHtml;'
  )(
    () => items,
    () => holiday,
    item => item.pickup_scope === 'daily' ? 'daily' : 'weekly',
    () => '2026-11-03',
    value => String(value ?? '').trim(),
    value => String(value ?? ''),
    value => String(value ?? '')
  );
  return render(new Date(2026, 10, 3), 4);
}

test('only daily pickup reservations receive makeup-colored card class', () => {
  const rendered = renderPickupCards([
    { id: 'daily', student_name: '하루', pickup_scope: 'daily', pickup_label: '학교', pickup_time: '16:00' },
    { id: 'weekly', student_name: '매주', pickup_scope: 'weekly', pickup_label: '학원', pickup_time: '16:30' },
    { id: 'legacy', student_name: '기존', pickup_label: '집', pickup_time: '16:15' }
  ]);
  assert.match(rendered, /class="olliTtPickupCard daily" data-tt-pickup-manage="daily"/);
  assert.match(rendered, /class="olliTtPickupCard" data-tt-pickup-manage="weekly"/);
  assert.match(rendered, /class="olliTtPickupCard" data-tt-pickup-manage="legacy"/);
  assert.doesNotMatch(rendered, /class="olliTtPickupCard daily" data-tt-pickup-manage="weekly"/);
});

test('daily pickup color tokens exactly match original makeup card and preserve holiday override', () => {
  const css = fs.readFileSync(path.join(root, 'pc-timetable.css'), 'utf8');
  const makeup = css.match(/#recordRoomScreen \.olliTtStudent\.makeup \{([^}]+)\}/)?.[1];
  const daily = css.match(/#recordRoomScreen \.olliTtPickupCard\.daily \{([^}]+)\}/)?.[1];
  assert.ok(makeup && daily, 'both markup styles must be present');
  const value = (rule, key) => {
    const match = rule.match(new RegExp('(?:^|;)\\s*' + key + '\\s*:\\s*([^;]+)'));
    assert.ok(match, key + ' must be explicitly defined');
    return match[1].trim();
  };
  for (const key of ['border-color', 'color', 'background']) {
    assert.equal(value(daily, key), value(makeup, key), key);
  }
  assert.match(css, /#recordRoomScreen \.olliTtPickupCell\.holiday \.olliTtPickupCard \{/);
  assert.match(css, /#recordRoomScreen \.olliTtPickupCard\.daily > span \{ color:/);
});
