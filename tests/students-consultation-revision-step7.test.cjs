const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(
  path.join(__dirname,'..','supabase','migrations','20260925203000_students_consultation_snapshot_revision.sql'),
  'utf8'
);

function bodyBetween(marker){
  const start=sql.indexOf(marker);
  assert.ok(start>=0,'missing '+marker);
  const bodyStart=sql.indexOf('as $function$',start);
  assert.ok(bodyStart>=0,'missing body '+marker);
  const end=sql.indexOf('$function$;',bodyStart+13);
  assert.ok(end>bodyStart,'missing end '+marker);
  return sql.slice(bodyStart+13,end);
}

test('students reuse schedule revision instead of creating a second student revision table',()=>{
  assert.doesNotMatch(sql,/create table[^;]*student[^;]*sync_revisions/i);
  const manifest=bodyBetween('create or replace function public.olli_sync_manifest');
  assert.match(manifest,/'students'/);
  assert.match(manifest,/'value', v_schedule_revision/);
  assert.match(manifest,/'coverage', 'students_snapshot_via_schedule_revision'/);
});

test('schedule revision behavior is preserved and students only add a wake-up signal',()=>{
  const body=bodyBetween('create or replace function private.olli_schedule_bump_sync_revision');
  assert.match(body,/insert into public\.olli_schedule_sync_revisions/i);
  assert.match(body,/version = public\.olli_schedule_sync_revisions\.version \+ 1/i);
  assert.match(body,/if tg_table_name = 'students'/i);
  assert.match(body,/olli_realtime_send_signal\(v_academy_id, 'students', v_version\)/i);
});

test('consultation has one private lightweight academy revision',()=>{
  assert.match(sql,/create table if not exists private\.olli_consultation_sync_revisions/i);
  assert.match(sql,/academy_id uuid primary key/i);
  assert.match(sql,/version bigint not null default 0/i);
  assert.match(sql,/revoke all on table private\.olli_consultation_sync_revisions from public, anon, authenticated/i);
});

test('consultation revision covers survey observation final analysis and consultation settings',()=>{
  for(const table of ['consultation_surveys','consultation_observations','consultation_final_analyses']){
    assert.match(sql,new RegExp('on public\\.'+table,'i'));
  }
  assert.match(sql,/update of consultation_rules, consultation_progress, elementary_group_feedback_months/i);
  assert.match(sql,/on public\.academy_settings/i);
});

test('unrelated academy setting update does not bump consultation revision',()=>{
  const body=bodyBetween('create or replace function private.olli_consultation_bump_sync_revision');
  assert.match(body,/new\.consultation_rules is not distinct from old\.consultation_rules/i);
  assert.match(body,/new\.consultation_progress is not distinct from old\.consultation_progress/i);
  assert.match(body,/new\.elementary_group_feedback_months is not distinct from old\.elementary_group_feedback_months/i);
  assert.match(body,/return new;/i);
});

test('realtime domains include students and consultation while prior domains remain',()=>{
  const body=bodyBetween('create or replace function private.olli_realtime_send_signal');
  for(const domain of ['observation','schedule','chat','materials','feedback','students','consultation']){
    assert.match(body,new RegExp("'"+domain+"'"));
  }
  assert.match(body,/compatibility_alias/i);
});

test('manifest exposes consultation revision and removes students consultation from pending',()=>{
  const body=bodyBetween('create or replace function public.olli_sync_manifest');
  assert.match(body,/'consultation'/);
  assert.match(body,/'coverage', 'consultation_snapshot_revision'/);
  assert.doesNotMatch(body,/'students', 'no_independent_durable_checkpoint'/);
  assert.doesNotMatch(body,/'consultation', 'no_academy_checkpoint'/);
  assert.match(body,/'observation', 'per_record_revision_only'/);
});
