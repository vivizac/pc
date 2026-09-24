const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(
  path.join(__dirname,'..','supabase','migrations','20260925183000_split_materials_realtime_and_delta.sql'),
  'utf8'
);

function bodyBetween(startMarker,endMarker='$function$;'){
  const start=sql.indexOf(startMarker);
  assert.ok(start>=0,'missing '+startMarker);
  const bodyStart=sql.indexOf('as $function$',start);
  assert.ok(bodyStart>=0,'missing function body '+startMarker);
  const end=sql.indexOf(endMarker,bodyStart+13);
  assert.ok(end>bodyStart,'missing function end '+startMarker);
  return sql.slice(bodyStart+13,end);
}

test('materials becomes a valid realtime domain with rolling-deploy compatibility alias',()=>{
  const body=bodyBetween('create or replace function private.olli_realtime_send_signal');
  assert.match(body,/materials/i);
  assert.match(body,/v_domain not in/i);
  assert.match(body,/compatibility_alias/i);
  assert.match(body,/'domain', 'chat'/i);
  assert.match(body,/'compatibility_alias', 'materials'/i);
});

test('request table trigger owns durable event emission',()=>{
  assert.match(sql,/create trigger olli_team_material_request_change_event_trg/i);
  assert.match(sql,/after insert or update on public\.olli_team_material_requests/i);
  const body=bodyBetween('create or replace function private.olli_team_material_request_log_change');
  assert.match(body,/insert into public\.olli_team_material_request_events/i);
  assert.match(body,/returning id into v_event_id/i);
  assert.match(body,/olli_realtime_send_signal/i);
  assert.match(body,/'materials'/i);
});

test('trigger covers create status generic update soft-delete and restore',()=>{
  const body=bodyBetween('create or replace function private.olli_team_material_request_log_change');
  for(const type of ['created','status_changed','updated','deleted','restored']){
    assert.match(body,new RegExp("'"+type+"'","i"));
  }
  assert.match(sql,/event_type in \('created','status_changed','updated','deleted','restored'\)/i);
});

test('write RPCs preserve idempotent create and revision CAS',()=>{
  const createBody=bodyBetween('create or replace function public.olli_team_material_request_create');
  const statusBody=bodyBetween('create or replace function public.olli_team_material_request_set_status');
  assert.match(createBody,/on conflict \(academy_id, client_mutation_id\) do nothing/i);
  assert.match(statusBody,/r\.revision = p_expected_revision/i);
  assert.match(statusBody,/revision = r\.revision \+ 1/i);
});

test('write RPCs no longer manually emit event or chat signal',()=>{
  const createBody=bodyBetween('create or replace function public.olli_team_material_request_create');
  const statusBody=bodyBetween('create or replace function public.olli_team_material_request_set_status');
  assert.doesNotMatch(createBody,/insert into public\.olli_team_material_request_events/i);
  assert.doesNotMatch(statusBody,/insert into public\.olli_team_material_request_events/i);
  assert.doesNotMatch(createBody,/olli_realtime_send_signal/i);
  assert.doesNotMatch(statusBody,/olli_realtime_send_signal/i);
});

test('delta RPC uses event cursor and leaves full list RPC intact',()=>{
  const body=bodyBetween('create or replace function public.olli_team_material_requests_delta');
  assert.match(body,/p_after_event_id/i);
  assert.match(body,/e\.id > v_cursor/i);
  assert.match(body,/'next_event_id'/i);
  assert.match(body,/'has_more'/i);
  assert.match(body,/'deleted_request_ids'/i);
  assert.match(body,/'summary'/i);
  assert.doesNotMatch(sql,/create or replace function public\.olli_team_material_requests_list\(/i);
});

test('baseline advances to current event head without replay',()=>{
  const body=bodyBetween('create or replace function public.olli_team_material_requests_delta');
  assert.match(body,/v_baseline boolean := p_after_event_id is null/i);
  assert.match(body,/'baseline', true/i);
  assert.match(body,/'next_event_id', v_latest_event_id/i);
  assert.match(body,/'items', '\[\]'::jsonb/i);
});

test('event cursor has academy plus id index',()=>{
  assert.match(sql,/olli_team_material_request_events_academy_id_desc_idx[\s\S]*\(academy_id, id desc\)/i);
});
