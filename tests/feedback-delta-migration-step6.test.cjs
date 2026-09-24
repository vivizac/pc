const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(
  path.join(__dirname,'..','supabase','migrations','20260925193000_add_feedback_change_cursor.sql'),
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

test('feedback change log is private and durable',()=>{
  assert.match(sql,/create table if not exists private\.olli_feedback_change_events/i);
  assert.match(sql,/id bigint generated always as identity primary key/i);
  assert.match(sql,/revoke all on table private\.olli_feedback_change_events from public, anon, authenticated/i);
});

test('all three feedback tables are observed for insert update and delete',()=>{
  for(const table of ['feedbacks','fail_feedbacks','summary_feedbacks']){
    assert.match(sql,new RegExp('on public\\.'+table,'i'));
  }
  assert.match(sql,/after insert or update or delete on public\.feedbacks/i);
  assert.match(sql,/after insert or update or delete on public\.fail_feedbacks/i);
  assert.match(sql,/after insert or update or delete on public\.summary_feedbacks/i);
});

test('trigger distinguishes hard delete soft delete restore and updates',()=>{
  const body=bodyBetween('create or replace function private.olli_feedback_log_change');
  for(const type of ['inserted','updated','deleted','restored']){
    assert.match(body,new RegExp("'"+type+"'","i"));
  }
  assert.match(body,/tg_op = 'DELETE'/i);
  assert.match(body,/v_old_deleted/i);
  assert.match(body,/v_new_deleted/i);
});

test('legacy rows without academy scope do not enter academy change log',()=>{
  const body=bodyBetween('create or replace function private.olli_feedback_log_change');
  assert.match(body,/if v_academy_id is null or v_record_id is null then/i);
});

test('feedback realtime domain is emitted with durable event id',()=>{
  const body=bodyBetween('create or replace function private.olli_feedback_log_change');
  assert.match(body,/returning id into v_event_id/i);
  assert.match(body,/olli_realtime_send_signal\(v_academy_id, 'feedback', v_event_id\)/i);
  const rt=bodyBetween('create or replace function private.olli_realtime_send_signal');
  assert.match(rt,/feedback/i);
  assert.match(rt,/materials/i);
  assert.match(rt,/compatibility_alias/i);
});

test('delta freezes academy head before reading student events',()=>{
  const body=bodyBetween('create or replace function public.olli_feedback_delta');
  const head=body.indexOf('into v_window_head');
  const page=body.indexOf('e.id > v_cursor');
  assert.ok(head>=0);
  assert.ok(page>head);
  assert.match(body,/e\.id <= v_window_head/i);
});

test('delta supports current student id and legacy name-only rows',()=>{
  const body=bodyBetween('create or replace function public.olli_feedback_delta');
  assert.match(body,/e\.student_id = p_student_id/i);
  assert.match(body,/e\.student_id is null/i);
  assert.match(body,/e\.student_name = v_student_name/i);
});

test('no relevant student event can safely advance over unrelated academy events',()=>{
  const body=bodyBetween('create or replace function public.olli_feedback_delta');
  assert.match(body,/cardinality\(v_event_ids\) = 0/i);
  assert.match(body,/v_next_event_id := v_window_head/i);
});

test('delta returns current rows plus tombstones for hard or soft deletes',()=>{
  const body=bodyBetween('create or replace function public.olli_feedback_delta');
  assert.match(body,/'records'/i);
  assert.match(body,/'deleted_records'/i);
  assert.match(body,/coalesce\(f\.is_deleted,false\)=false/i);
});

test('manifest exposes feedback event cursor and removes feedback from pending',()=>{
  const body=bodyBetween('create or replace function public.olli_sync_manifest');
  assert.match(body,/'feedback'/i);
  assert.match(body,/'coverage', 'feedback_row_event_cursor'/i);
  assert.doesNotMatch(body,/'feedback', 'no_durable_change_cursor'/i);
});
