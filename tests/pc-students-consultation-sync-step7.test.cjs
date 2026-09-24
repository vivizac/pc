const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('PC loads snapshot, student and consultation sync common modules in order',()=>{
  const html=read('index.html');
  const snapshot=html.indexOf('olli-snapshot-revision-common.js');
  const students=html.indexOf('olli-student-sync-common.js');
  const consultation=html.indexOf('olli-consultation-sync-common.js');
  assert.ok(snapshot>=0);
  assert.ok(students>snapshot);
  assert.ok(consultation>students);
});

test('realtime client accepts students and consultation domains',()=>{
  const src=read('olli-realtime-common.js');
  assert.match(src,/VALID_DOMAINS = new Set\(\['observation', 'schedule', 'chat', 'materials', 'feedback', 'students', 'consultation'\]\)/);
});

test('student sync uses students manifest marker and existing full loader as fallback',()=>{
  const src=read('olli-student-sync-common.js');
  assert.match(src,/snapshotKey:'students'/);
  assert.match(src,/markerName:'students'/);
  assert.match(src,/loadStudentsFromSupabase/);
  assert.match(src,/watchDomain\('students'/);
});

test('PC student 30 second polling and direct focus visibility fetches are removed',()=>{
  const src=read('olli-data-student-operations.js');
  assert.doesNotMatch(src,/setInterval\(syncVisibleStudentListSilently,\s*30000\)/);
  assert.doesNotMatch(src,/addEventListener\('focus'[\s\S]{0,180}syncVisibleStudentListSilently/);
  assert.match(src,/OlliStudentSync\?\.start/);
  assert.match(src,/olli:students-synced/);
});

test('PC record views use revision-aware student sync with full fallback retained',()=>{
  const src=read('olli-consultation-runtime.js');
  assert.match(src,/function syncStudentsForRecordView/);
  assert.match(src,/window\.OlliStudentSync\?\.sync/);
  assert.match(src,/return loadStudentsFromSupabase/);
  assert.match(src,/syncStudentsForRecordView\('record_elementary'\)/);
  assert.match(src,/syncStudentsForRecordView\('record_kinder'\)/);
  assert.match(src,/syncStudentsForRecordView\('academy_management'\)/);
});

test('consultation survey keeps local cache and removes 20 second polling',()=>{
  const src=read('consultation-survey-core.js');
  assert.match(src,/ROWS_CACHE_PREFIX='olli_consultation_rows_cache_v1'/);
  assert.match(src,/rows=readRowsCache\(\)/);
  assert.doesNotMatch(src,/setInterval\([^\n]*20000/);
  assert.doesNotMatch(src,/startPolling/);
});

test('consultation survey uses dedicated snapshot key and consultation realtime',()=>{
  const src=read('consultation-survey-core.js');
  assert.match(src,/snapshotKey:'consultation_surveys'/);
  assert.match(src,/markerName:'consultation'/);
  assert.match(src,/watchDomain\('consultation'/);
  assert.match(src,/refreshConsultationSurveyManager\(\{force:context\?\.trigger==='change'\}\)/);
  assert.match(src,/refreshConsultationSurveyManager\(\{force:true\}\)/);
});

test('consultation detail caches invalidate after server reconciliation',()=>{
  for(const file of ['consultation-observation-ui.js','consultation-final-analysis-ui.js']){
    const src=read(file);
    assert.match(src,/olli:consultation-reconciled/);
    assert.match(src,/cache\.delete\(String\(currentId\)\)/);
    assert.match(src,/saving\.has\(String\(currentId\)\)/);
  }
});

test('consultation settings use separate checkpoint and no 30 second polling',()=>{
  const common=read('olli-consultation-sync-common.js');
  const runtime=read('olli-consultation-runtime.js');
  assert.match(common,/snapshotKey:'consultation_settings'/);
  assert.match(common,/markerName:'consultation'/);
  assert.match(common,/watchDomain\('consultation'/);
  assert.doesNotMatch(runtime,/setInterval\([^\n]*30000/);
  assert.match(runtime,/OlliConsultationSync\?\.syncSettings/);
  assert.match(runtime,/loadOlliConsultationRulesFromServer/);
  assert.match(runtime,/loadOlliConsultationProgressFromServer/);
});
