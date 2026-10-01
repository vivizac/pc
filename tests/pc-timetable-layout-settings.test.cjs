const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const settings = fs.readFileSync('apps/pc/olli-settings-pc-ui.js', 'utf8');
const ui = fs.readFileSync('apps/pc/pc-timetable.js', 'utf8');
const css = fs.readFileSync('apps/pc/pc-timetable.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261001133648_pc_timetable_layout_settings.sql', 'utf8');

test('PC timetable settings expose five/six day and capacity-based card layout options', () => {
  assert.match(settings, /data-timetable-week-days-option/);
  assert.match(settings, /주 5일/);
  assert.match(settings, /주 6일/);
  assert.match(settings, /data-timetable-student-columns-option/);
  assert.match(settings, /6명 이하/);
  assert.match(settings, /7명 이상/);
  assert.match(settings, /timetable_week_days: selectedWeekDays/);
  assert.match(settings, /timetable_student_columns: selectedStudentColumns/);
});

test('five-day mode removes Saturday from timetable and registration day choices without deleting data', () => {
  assert.match(ui, /DAYS\.slice\(0, weekDays\)\.map/);
  assert.match(ui, /DAYS\.slice\(0, getTimetableWeekDays\(\)\)\.map/);
  assert.match(ui, /weekDays === 5 \? ' fiveDay' : ''/);
  assert.match(css, /\.olliTtSection\.fiveDay \.olliTtGrid \{ grid-template-columns: 56px repeat\(5,/);
});

test('six-day mode keeps the Saturday collapse control', () => {
  assert.match(ui, /data-tt-saturday-toggle/);
  assert.match(ui, /state\.saturdayCollapsed = !state\.saturdayCollapsed/);
  assert.match(css, /\.olliTtSection\.saturdayCollapsed \.olliTtGrid/);
  assert.match(css, /\.olliTtSection\.saturdayCollapsed \.olliTtPickupGrid/);
});

test('student card columns switch between two and three while preserving preview spacing fixes', () => {
  assert.match(css, /--olli-tt-student-columns:2/);
  assert.match(css, /threeStudentColumns \{ --olli-tt-student-columns:3/);
  assert.match(css, /repeat\(var\(--olli-tt-student-columns\), minmax\(0, 1fr\)\)/);
  assert.match(css, /\.olliTtCell\.split \{ padding: 4px 0;/);
  assert.match(css, /\.olliTtClassLane \{ min-width: 0; padding: 4px 6px;/);
  assert.match(css, /\.olliTtStudentMore \{[^}]*margin-right: -4px;/);
  assert.match(ui, /const studentColumns = getTimetableStudentColumns\(\)/);
});

test('academy settings migration is additive and constrains layout values', () => {
  assert.match(migration, /add column if not exists timetable_week_days smallint not null default 6/);
  assert.match(migration, /timetable_week_days in \(5,6\)/);
  assert.match(migration, /add column if not exists timetable_student_columns smallint not null default 2/);
  assert.match(migration, /timetable_student_columns in \(2,3\)/);
  assert.match(migration, /SETTING_FIELD_NOT_ALLOWED/);
  assert.match(migration, /set search_path=''/);
});
