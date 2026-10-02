const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('apps/pc/pc-timetable.js', 'utf8');
const css = fs.readFileSync('apps/pc/pc-timetable.css', 'utf8');
const startPage = fs.readFileSync('apps/pc/pc-start-page.js', 'utf8');
const index = fs.readFileSync('apps/pc/index.html', 'utf8');

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

test('collapsed PC pickup lets the half-hour kinder timetable fill the released height', () => {
  assert.match(css, /\.olliTtSection\.kinder\.pickupCollapsed \.olliTtGrid\.olliTtHalfHourGrid \{[\s\S]*?height:100%;[\s\S]*?flex:1 1 auto;[\s\S]*?grid-template-rows:52px repeat\(var\(--olli-tt-rows\), minmax\(var\(--olli-tt-class-row-height\), 1fr\)\);/);
});

test('PC half-hour timetable time labels use top alignment and the same font size for 30 minutes', () => {
  assert.match(css, /\.olliTtTime\.halfHourLabel \{[^}]*padding-top:13px;[^}]*justify-content:flex-start;/);
  assert.match(css, /\.olliTtTime\.halfHourLabel small \{[^}]*font-size:inherit;/);
  assert.doesNotMatch(css, /\.olliTtTime\.halfHourLabel \{[^}]*justify-content:center;/);
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
  assert.ok(manageBlock.includes("esc(classTimeLabel) + ' 수업"));
  assert.doesNotMatch(manageBlock, /esc\(item\.class_time\) \+ '시 수업'/);
});

test('pickup grid border rule supports any number of seven-column rows', () => {
  assert.match(css, /\.olliTtPickupGrid > :nth-child\(7n \+ 1\) \{ border-right: 0; \}/);
  assert.doesNotMatch(css, /\.olliTtPickupGrid > :nth-child\(8\),\s*\n#recordRoomScreen \.olliTtPickupGrid > :nth-child\(15\)/);
});


test('PC half-hour timetable keeps internal scroll and disables wheel division switching', () => {
  const start = startPage.indexOf('function installPcTimetableDivisionWheelSwitch');
  const end = startPage.indexOf('installPcTimetableDivisionWheelSwitch();', start);
  const block = startPage.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(block, /const section = scroll\.closest\('\.olliTtSection'\)/);
  assert.match(block, /section && section\.querySelector\('\.olliTtHalfHourGrid'\)/);
  assert.match(block, /resetWheelState\(\);\s*return;/);
  assert.match(block, /nextButton\.click\(\)/);
  assert.match(index, /pc-start-page\.js\?v=20261002-half-hour-wheel-guard-1/);
});


test('PC half-hour timetable uses a real external scrollbar beside the timetable box', () => {
  const sectionStart = ui.indexOf('function sectionHtml');
  const sectionEnd = ui.indexOf('function bindHalfHourExternalScrollbar', sectionStart);
  const sectionBlock = ui.slice(sectionStart, sectionEnd);

  assert.match(sectionBlock, /const section = `<section class="olliTtSection/);
  assert.match(sectionBlock, /if \(!halfHour\) return section;/);
  assert.match(sectionBlock, /<div class="olliTtHalfHourShell">\$\{section\}<div class="olliTtHalfHourExternalScroll"/);
  assert.match(css, /\.olliTtHalfHourShell \{[\s\S]*?display: flex;[\s\S]*?gap: 8px;/);
  assert.match(css, /\.olliTtHalfHourExternalScroll \{[\s\S]*?flex: 0 0 12px;[\s\S]*?overflow-y: scroll;/);
  assert.match(css, /\.olliTtHalfHourShell \.olliTtScroll \{[\s\S]*?scrollbar-width: none;/);
  assert.doesNotMatch(css, /\.olliTtSection:has\(\.olliTtHalfHourGrid\) \.olliTtScroll \{[\s\S]*?padding-right: 10px;/);
  assert.match(ui, /function bindHalfHourExternalScrollbar\(root\)/);
  assert.match(ui, /const scrollMax = \(element\) => Math\.max\(0, element\.scrollHeight - element\.clientHeight\)/);
  assert.match(ui, /\(inner\.scrollTop \/ innerMax\) \* externalMax/);
  assert.match(ui, /\(external\.scrollTop \/ externalMax\) \* innerMax/);
  assert.match(ui, /spacer\.style\.height = `\$\{Math\.max\(1, inner\.scrollHeight\)\}px`/);
  assert.match(index, /pc-timetable\.css\?v=20261002-half-hour-external-scrollbar-1/);
  assert.match(index, /pc-timetable\.js\?v=20261002-half-hour-scroll-ratio-1/);
});
