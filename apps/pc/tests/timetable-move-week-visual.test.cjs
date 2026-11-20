'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const js = fs.readFileSync(path.join(root, 'apps/pc/pc-timetable.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'apps/pc/pc-timetable.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'apps/pc/index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261120062532_pc_timetable_move_week_projection.sql'), 'utf8');

function extractFunction(name) {
  const start = js.indexOf('  function ' + name + '(');
  assert.notEqual(start, -1, name + ' exists');
  const end = js.indexOf('\n  function ', start + 4);
  assert.notEqual(end, -1, 'next function exists after ' + name);
  return js.slice(start, end);
}
function helperContext(records) {
  const context = {
    clean: value => String(value ?? '').trim(),
    dateKey: d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'),
    mondayOf(value) {
      const d = typeof value === 'string' ? new Date(value + 'T12:00:00') : new Date(value);
      d.setDate(d.getDate() - (d.getDay() || 7) + 1);
      return d;
    },
    changes: () => records
  };
  vm.runInNewContext(extractFunction('isMoveTransitionWeek') + '\n' + extractFunction('regularMoveInWeek'), context);
  return context;
}
test('Jan 1 to Jan 2 2027 only marks the Dec 28-Jan 2 transition week', () => {
  const record = {change_type:'move',status:'scheduled',source_enrollment_id:'before',target_enrollment_id:'after',effective_date:'2027-01-02'};
  const ctx = helperContext([record]);
  assert.equal(ctx.regularMoveInWeek('before',new Date('2027-01-01T12:00:00'),'source'),true);
  assert.equal(ctx.regularMoveInWeek('after',new Date('2027-01-02T12:00:00'),'target'),true);
  assert.equal(ctx.regularMoveInWeek('before',new Date('2026-12-25T12:00:00'),'source'),false);
  assert.equal(ctx.regularMoveInWeek('after',new Date('2027-01-04T12:00:00'),'target'),false);
  assert.equal(helperContext([{...record,status:'cancelled'}]).regularMoveInWeek('before',new Date('2027-01-01T12:00:00'),'source'),false);
});
test('ghost is separate from attendance, drag and capacity; destination has blue name', () => {
  assert.match(js, /!regularMoveInWeek\(item\.id, date, 'source'\)/);
  assert.match(js, /!regularMoveInWeek\(item\.id, date, 'source', data\.changes\)/);
  assert.match(js, /movedSources = movedSourceEnrollments\(/);
  assert.match(js, /data-tt-move-source-ghost="1"/);
  assert.match(js, /const targetId = clean\(linkedMove && linkedMove\.target_enrollment_id\)/);
  assert.match(js, /const availableTarget = targetId && currentStudentEnrollments\(item\.student_id\)/);
  assert.match(js, /data-enrollment-id="\$\{esc\(targetId\)\}"/);
  assert.match(js, /'<span class="olliTtStudentMore" aria-hidden="true">☰<\/span>'/);
  assert.match(js, /if \(ghost && !event\.target\.closest\('\[data-tt-entry="regular"\]'\)\)/);
  assert.match(js, /const studentNameHtml = movedTarget/);
  assert.match(js, /movedSourcePickups\(date, classTime\)/);
  assert.match(js, /const rows = slotPickups\(date, classTime\)\.filter\(\(item\) => !ghostIds\.has\(clean\(item\.id\)\)\)/);
  assert.doesNotMatch(js, /scheduledChangeForSource/);
  assert.doesNotMatch(js, /const scheduleText = scheduled/);
});
test('source cards show student name and same-color 수업이동 guidance without changing live-card behavior', () => {
  const sourceRegular = js.slice(js.indexOf('const movedSourceHtml = movedSources.map('), js.indexOf('const waitHtml = waits.map('));
  const sourcePickup = js.slice(js.indexOf('const movedSourceHtml = sourceGhosts.map('), js.indexOf('return `<div class="olliTtPickupCell', js.indexOf('const movedSourceHtml = sourceGhosts.map(')));
  assert.ok(sourceRegular.includes('${esc(item.student_name)}<span class="olliTtMoveGuide">수업이동</span>'));
  assert.ok(sourcePickup.includes('${esc(item.student_name)}</span>${dropoffMark}<span class="olliTtMoveGuide">수업이동</span>'));
  const rule = css.slice(css.indexOf('/* 이동 전 카드의'), css.indexOf('/* 이동된 카드의'));
  assert.ok(rule.includes('.olliTtMovedSource .olliTtMoveGuide'));
  assert.ok(rule.includes('color: #6aa9d6;'));
  assert.ok(rule.includes('white-space: nowrap;'));
  assert.match(sourceRegular, /data-tt-move-source-ghost="1"/);
  assert.match(sourcePickup, /data-tt-move-source-ghost="1"/);
});
test('moved source and target styling is scoped to week-specific classes', () => {
  assert.match(css, /\.olliTtMovedSource[\s\S]*?border: 1px dashed #6aa9d6/);
  assert.match(css, /background: #eff9ff/);
  assert.match(css, /\.olliTtMovedTarget \.olliTtMovedTargetName[\s\S]*?color: #1979c8/);
  assert.match(html, /pc-timetable\.css\?v=20261119-move-week-1/);
  assert.match(html, /pc-timetable\.js\?v=20261120-new-card-sync-1/);
  assert.doesNotMatch(js, /예약 이동' : '지금 바로 이동'/);
  assert.doesNotMatch(js, /<strong>예약 이동<\/strong>/);
  assert.match(js, /data-tt-cancel-change=/);
});
test('future move closes original booking at previous week, retains selected target date and history', () => {
  assert.match(sql, /date_trunc\('week', v_effective\)::date - 1/);
  assert.match(sql, /date_trunc\('week', v_apply_date\)::date - 1/);
  assert.match(sql, /v_source_last_date < v_source\.effective_from/);
  assert.match(sql, /v_source_last_date >= v_pickup\.effective_from/);
  assert.match(sql, /'move_source_enrollments',v_move_sources/);
  assert.match(sql, /'move_source_pickups',v_pickup_sources/);
  assert.match(sql, /c\.change_type='move' and c\.status='scheduled'/);
  assert.match(sql, /c\.effective_date >= \(date_trunc\('week', current_date\)::date \+ 7\)/);
  assert.match(sql, /'effective_date',v_effective/);
  assert.match(sql, /'target_date', p_target_date/);
  assert.match(sql, /c\.status in \('scheduled','applied'\)/);
});
