'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
const migration = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', '20261013154000_backfill_independent_feedback_teacher.sql'), 'utf8');
const card = fs.readFileSync(path.join(root, 'pc-student-info-card-runtime.js'), 'utf8');
const operations = fs.readFileSync(path.join(root, 'olli-data-student-operations.js'), 'utf8');

test('feedback teacher is a separately persisted student field, not a class-teacher lookup on read', () => {
  assert.match(card, /value="\$\{esc\(student\.feedback_teacher \|\| ''\)\}"/);
  assert.match(card, /profile\.feedback_teacher = feedbackTeacher/);
  assert.match(operations, /feedback_teacher: row\.feedback_teacher \|\| ''/);
  assert.match(operations, /payload\.feedback_teacher = String\(student\.feedback_teacher \|\| ''\)/);
  assert.doesNotMatch(card, /profile\.feedback_teacher\s*=\s*.*__olli_timetable_teacher/);
});

test('one-time migration writes only confirmed first-lesson teacher names to empty student fields', () => {
  assert.match(migration, /UPDATE public\.students s/);
  assert.match(migration, /SET feedback_teacher = c\.teacher_name/);
  assert.match(migration, /first_session_count = 1 AND first_teacher IS NOT NULL/);
  assert.match(migration, /lesson_count = 1 AND unranked_count = 1 AND single_teacher IS NOT NULL/);
  assert.match(migration, /NULLIF\(BTRIM\(s\.feedback_teacher\), ''\) IS NULL/);
  assert.match(migration, /COALESCE\(s\.is_deleted, false\) = false/);
  assert.match(migration, /c\.academy_id = s\.academy_id/);
  assert.match(migration, /e\.effective_from <= CURRENT_DATE/);
  assert.match(migration, /e\.effective_to IS NULL OR e\.effective_to >= CURRENT_DATE/);
  assert.doesNotMatch(migration, /UPDATE public\.olli_schedule_/);
});
