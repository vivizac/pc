const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('PC loads Feedback sync common before attendance feedback runtime',()=>{
  const html=read('index.html');
  assert.ok(html.indexOf('olli-feedback-sync-common.js')>=0);
  assert.ok(html.indexOf('olli-feedback-sync-common.js')<html.indexOf('olli-data-attendance-feedback.js'));
});

test('shared realtime accepts feedback domain',()=>{
  const src=read('olli-realtime-common.js');
  assert.match(src,/VALID_DOMAINS = new Set\(\['observation', 'schedule', 'chat', 'materials', 'feedback'\]\)/);
});

test('PC record cache is passed into feedback loader with durable persistence callback',()=>{
  const src=read('pc-attendance.js');
  const block=src.match(/async function selectStudent\(studentOrId\)[\s\S]*?\n  \}/)?.[0]||'';
  assert.match(block,/baseData:cached \|\| null/);
  assert.match(block,/persistData:fresh => persistPcFeedbackSyncData\(student, fresh\)/);
  assert.match(src,/function persistPcFeedbackSyncData/);
  assert.match(src,/rememberRecordCache\(student, data\)/);
});

test('PC feedback realtime watches only feedback domain and uses current record cache',()=>{
  const src=read('pc-attendance.js');
  assert.match(src,/watchDomain\('feedback', syncSelectedFeedbackFromRealtime\)/);
  assert.match(src,/const baseData = readRecordCache\(student\)/);
  assert.match(src,/loadAttendanceStudentFeedbackSheetItems\(student, \{/);
});

test('PC feedback loader keeps full three-table fallback',()=>{
  const src=read('olli-data-attendance-feedback.js');
  assert.match(src,/feedbacks'.*buildAttendanceStudentFeedbackPath\('feedbacks'/s);
  assert.match(src,/fail_feedbacks'.*buildAttendanceStudentFeedbackPath\('fail_feedbacks'/s);
  assert.match(src,/summary_feedbacks'.*buildAttendanceStudentFeedbackPath\('summary_feedbacks'/s);
  assert.match(src,/const deltaData = await tryAttendanceFeedbackDelta/);
});

test('PC full snapshot captures baseline before network rows and commits only after persistence',()=>{
  const src=read('olli-data-attendance-feedback.js');
  const block=src.match(/async function loadAttendanceStudentFeedbackSheetItems\(student, options = \{\}\)[\s\S]*?\n\}/)?.[0]||'';
  const baseline=block.indexOf('captureAttendanceFeedbackBaseline(student)');
  const fetch=block.indexOf("supabase('GET'");
  const persist=block.indexOf('persistAttendanceFeedbackSyncData(student, data, options)');
  const cursor=block.indexOf('OlliFeedbackSync.writeCheckpoint');
  assert.ok(baseline>=0);
  assert.ok(fetch>baseline);
  assert.ok(persist>fetch);
  assert.ok(cursor>persist);
});

test('PC feedback delta checkpoint follows persisted merged data',()=>{
  const src=read('olli-data-attendance-feedback.js');
  const block=src.match(/async function tryAttendanceFeedbackDelta\(student, baseData, options = \{\}\)[\s\S]*?\n\}/)?.[0]||'';
  const apply=block.indexOf('api.applyToData');
  const persist=block.indexOf('persistAttendanceFeedbackSyncData');
  const cursor=block.indexOf('api.writeCheckpoint');
  assert.ok(apply>=0);
  assert.ok(persist>apply);
  assert.ok(cursor>persist);
  assert.match(block,/if \(persisted\)/);
});
