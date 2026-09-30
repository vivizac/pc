const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('apps/pc/pc-timetable.js', 'utf8');
const css = fs.readFileSync('apps/pc/pc-timetable.css', 'utf8');

test('PC pickup grid keeps hourly two-row layout and uses five timetable slots in half-hour mode', () => {
  const start = ui.indexOf('function pickupGridHtml');
  const end = ui.indexOf('function elementaryAdaptiveEdgeRowHeight', start);
  const block = ui.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(block, /const halfHour = isHalfHourMode\(\)/);
  assert.match(block, /HALF_HOUR_SLOTS\.kinder/);
  assert.match(block, /TIME_SLOTS\.kinder\.map/);
  assert.match(block, /olliTtPickupGrid\$\{halfHour \? ' halfHour' : ''\}/);
  assert.match(block, /pickupCellHtml\(date, Number\(slot\.time\)\)/);
  assert.doesNotMatch(block, /\[4, 5\]\.forEach/);

  assert.match(css, /\.olliTtPickupGrid \{[\s\S]*?height: 258px;[\s\S]*?grid-template-rows: 34px repeat\(2, 112px\);/);
  assert.match(css, /\.olliTtPickupGrid\.halfHour \{[\s\S]*?height: 594px;[\s\S]*?grid-template-rows: 34px repeat\(5, 112px\);/);
});

test('PC pickup grid shows half-hour labels as hour and 30-minute lines', () => {
  const start = ui.indexOf('function pickupGridHtml');
  const end = ui.indexOf('function elementaryAdaptiveEdgeRowHeight', start);
  const block = ui.slice(start, end);

  assert.match(block, /label\.match\(\/\^\(\\d\+\)시/);
  assert.match(block, /<small>\$\{labelParts\[2\]\}<\/small>/);
  assert.match(block, /olliTtPickupTime\$\{labelParts && labelParts\[2\] \? ' halfHourLabel' : ''\}/);
  assert.match(css, /\.olliTtPickupTime\.halfHourLabel \{[^}]*display:flex;[^}]*flex-direction:column;/);
});

test('PC pickup add and manage dialogs render the timetable label instead of raw stored slot numbers', () => {
  const addStart = ui.indexOf('function pickupAddDialogHtml');
  const addEnd = ui.indexOf('function pickupManageDirtyState', addStart);
  const addBlock = ui.slice(addStart, addEnd);
  assert.match(addBlock, /scheduleSlotLabel\('kinder', dialog\.classTime, '', dialog\.weekday\)/);
  assert.match(addBlock, /\$\{classTimeLabel\} 수업/);
  assert.doesNotMatch(addBlock, /\$\{dialog\.classTime\}시 수업/);

  const manageStart = ui.indexOf('function pickupManageDialogHtml');
  const manageEnd = ui.indexOf('let timetableHistoryRuntime', manageStart);
  const manageBlock = ui.slice(manageStart, manageEnd);
  assert.match(manageBlock, /scheduleSlotLabel\('kinder', item\.class_time, '', item\.weekday\)/);
  assert.match(manageBlock, /esc\(classTimeLabel\) \+ ' 수업'/);
  assert.doesNotMatch(manageBlock, /esc\(item\.class_time\) \+ '시 수업'/);
});

test('pickup grid border rule supports any number of seven-column rows', () => {
  assert.match(css, /\.olliTtPickupGrid > :nth-child\(7n \+ 1\) \{ border-right: 0; \}/);
  assert.doesNotMatch(css, /\.olliTtPickupGrid > :nth-child\(8\),\s*\n#recordRoomScreen \.olliTtPickupGrid > :nth-child\(15\)/);
});
