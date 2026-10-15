const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const js=read('packages/common/olli-education-inspection-common.js');
const css=read('packages/common/olli-education-inspection-common.css');
const sql=read('supabase/migrations/20261015113000_education_inspection_ledgers.sql');
const pc=read('apps/pc/index.html'), mobile=read('apps/mobile/index.html');
test('owner-only entry appears on both platforms with one shared implementation',()=>{
 for(const html of [pc,mobile]){
  assert.match(html,/data-owner-only="true"[^>]*>[\s\S]*?openOlliEducationInspection\(\)/);
  assert.match(html,/olli-education-inspection-common\.js\?v=20261015-inspection-1/);
  assert.match(html,/olli-education-inspection-common\.css\?v=20261015-inspection-1/);
 }
 assert.match(js,/global\.openOlliEducationInspection=open/);
 assert.match(js,/getOlliCurrentRole/);
 assert.match(js,/r==='owner'\|\|r==='super_admin'/);
});
test('inspection ledgers read real records; no estimates impersonate actual payments',()=>{
 assert.match(js,/현금출납부/);
 assert.match(js,/교습비등 영수증 원부/);
 assert.match(js,/수강생 대장/);
 assert.match(js,/실제 거래를 기록하는 점검용 원장/);
 assert.match(js,/미수납 교육비 예상액이나 월간 지출 추정치는 자동 입력되지 않습니다/);
 assert.match(js,/교습과목/);
 assert.match(js,/교습기간/);
 assert.match(js,/data-inspection-export/);
});
test('file ingestion includes CSV/XLSX, mapping preview and owner confirmation',()=>{
 assert.match(js,/\\.xlsx/);
 assert.match(js,/JSZip\.loadAsync/);
 assert.match(js,/TextDecoder\('euc-kr'\)/);
 assert.match(js,/function csvRecords/);
 assert.match(js,/function stagedFromSource/);
 assert.match(js,/data-inspection-preview/);
 assert.match(js,/data-inspection-save/);
 assert.match(js,/async function saveRows/);
 assert.match(js,/await rpc\('olli_inspection_import'/);
 assert.match(js,/await load\(\)/);
 assert.match(js,/fingerprintOf/);
});
test('backing tables are private and immutable transaction insert is owner-gated and idempotent',()=>{
 assert.match(sql,/create table private\.olli_inspection_transactions/);
 assert.match(sql,/create table private\.olli_inspection_student_events/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on table private\.olli_inspection_transactions/);
 assert.match(sql,/private\.olli_academy_finance_owner_member\(p_session_token,p_academy_id\)/);
 assert.match(sql,/on conflict\(academy_id,dedupe_key\) do nothing/);
 assert.match(sql,/s\.academy_id=p_academy_id/);
 assert.match(sql,/limit 3000/);
 assert.doesNotMatch(sql,/delete from private\.olli_inspection_transactions|update private\.olli_inspection_transactions/);
});
test('student event log does not change student sync or timetable',()=>{
 assert.match(sql,/after insert or update of enrolled_at,withdrawn_at,status on public\.students/);
 assert.match(sql,/returns trigger/);
 assert.match(sql,/return new;/);
 assert.match(sql,/on conflict do nothing/);
 assert.doesNotMatch(sql,/update public\.students|delete from public\.students|update public\.olli_schedule_enrollments/i);
});
test('transaction import requires positive amount, accepts refund separately, and deduplicates',()=>{
 assert.match(sql,/entry_type in \('income','expense','refund'\)/);
 assert.match(sql,/v_amount not between 1 and 1000000000/);
 assert.match(sql,/v_total<1 or v_total>200/);
 assert.match(sql,/v_saved:=v_saved\+1/);
 assert.match(sql,/duplicates',v_total-v_saved/);
 assert.match(js,/entry_type=signed<0\|\|/);
});
test('presentation styles are scoped and mobile responsive',()=>{
 assert.match(css,/\.olliInspectPage/);
 assert.match(css,/\.olliInspectStats/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.doesNotMatch(css,/!important/);
});

test('local CSV parser preserves quoted names and date/amount values',()=>{
 const vm=require('node:vm');
 const window={};
 const injected=js.replace(/\}\)\(window\);\s*$/, "global.__inspectionTest={csvRecords,isoDate,amountValue,state,stagedFromSource};})(window);");
 vm.runInNewContext(injected,{window,Date,localStorage:{getItem:()=>null}});
 const h=window.__inspectionTest;
 h.state.month='2026-10';
 const rows=h.csvRecords('결제일,학생명,승인금액\n2026.10.02,"김,훈",110000\n');
 assert.equal(JSON.stringify(rows),JSON.stringify([['결제일','학생명','승인금액'],['2026.10.02','김,훈','110000']]));
 assert.equal(h.isoDate('10월 2일'),'2026-10-02');
 assert.equal(h.isoDate('2026.2.31'),'');
 assert.equal(h.amountValue('(70,000)'),-70000);
});
test('student name matches unique roster only and reimport dedupes by approval',()=>{
 assert.match(js,/matches\.length===1\?matches\[0\]:null/);
 assert.match(js,/dedupe_key:approval\?/);
 assert.match(js,/card:'\+approval/);
 assert.match(js,/fingerprintOf/);
 assert.match(js,/data-inspection-preview-step/);
 assert.match(js,/data-inspection-category/);
});
test('historical student withdrawal without date is not fabricated in migration backfill',()=>{
 assert.match(sql,/from public\.students where withdrawn_at is not null and status='withdrawn'/);
 assert.match(sql,/legacy_withdrawals_without_date/);
 assert.match(js,/날짜를 추정해 자동 등록하지 않았습니다/);
});
