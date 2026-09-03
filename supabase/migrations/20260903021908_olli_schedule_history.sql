-- OLLI timetable audit history and guarded restore.
-- Every schedule row mutation is recorded automatically. User-initiated PC actions
-- pass through olli_schedule_execute so the actor and semantic action are attached.

create table if not exists public.olli_schedule_audit_log (
  id bigint generated always as identity primary key,
  academy_id uuid not null references public.academies(id) on delete cascade,
  transaction_id bigint not null,
  table_name text not null check (table_name in (
    'olli_schedule_enrollments',
    'olli_schedule_waitlist',
    'olli_schedule_changes',
    'olli_schedule_one_time_sessions'
  )),
  row_id uuid not null,
  student_id uuid references public.students(id) on delete set null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  action_name text,
  old_data jsonb,
  new_data jsonb,
  actor_account_id uuid references public.olli_accounts(id) on delete set null,
  restore_of_transaction_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  restored_at timestamptz,
  restored_by_account_id uuid references public.olli_accounts(id) on delete set null,
  restore_transaction_id bigint
);

create index if not exists olli_schedule_audit_log_academy_created_idx
  on public.olli_schedule_audit_log (academy_id, created_at desc);
create index if not exists olli_schedule_audit_log_transaction_idx
  on public.olli_schedule_audit_log (academy_id, transaction_id);
create index if not exists olli_schedule_audit_log_student_idx
  on public.olli_schedule_audit_log (academy_id, student_id, created_at desc);

alter table public.olli_schedule_audit_log enable row level security;
revoke all on table public.olli_schedule_audit_log from public, anon, authenticated;
revoke all on sequence public.olli_schedule_audit_log_id_seq from public, anon, authenticated;

create or replace function private.olli_schedule_capture_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_actor uuid;
  v_restore_of bigint;
  v_action text;
begin
  if coalesce(current_setting('olli.audit_disabled', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  v_row := coalesce(v_new, v_old);

  -- Initial conversion from the legacy student fields is not a user edit.
  if tg_table_name = 'olli_schedule_enrollments'
     and tg_op = 'INSERT'
     and coalesce(v_new->>'source', '') = 'legacy' then
    return new;
  end if;

  -- Applying an already-saved future reservation is system bookkeeping.
  if tg_table_name = 'olli_schedule_changes'
     and tg_op = 'UPDATE'
     and coalesce(v_old->>'status', '') = 'scheduled'
     and coalesce(v_new->>'status', '') = 'applied'
     and (v_old - 'status' - 'updated_at') = (v_new - 'status' - 'updated_at') then
    return new;
  end if;

  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  begin
    v_actor := nullif(current_setting('olli.actor_account_id', true), '')::uuid;
  exception when others then
    v_actor := null;
  end;
  begin
    v_restore_of := nullif(current_setting('olli.restore_of_transaction_id', true), '')::bigint;
  exception when others then
    v_restore_of := null;
  end;
  v_action := left(nullif(current_setting('olli.schedule_action', true), ''), 60);

  insert into public.olli_schedule_audit_log (
    academy_id, transaction_id, table_name, row_id, student_id,
    operation, action_name, old_data, new_data, actor_account_id,
    restore_of_transaction_id
  ) values (
    (v_row->>'academy_id')::uuid,
    txid_current(),
    tg_table_name,
    (v_row->>'id')::uuid,
    nullif(v_row->>'student_id', '')::uuid,
    tg_op,
    v_action,
    v_old,
    v_new,
    v_actor,
    v_restore_of
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.olli_schedule_capture_audit() from public;

drop trigger if exists olli_schedule_enrollments_audit on public.olli_schedule_enrollments;
create trigger olli_schedule_enrollments_audit
after insert or update or delete on public.olli_schedule_enrollments
for each row execute function private.olli_schedule_capture_audit();

drop trigger if exists olli_schedule_waitlist_audit on public.olli_schedule_waitlist;
create trigger olli_schedule_waitlist_audit
after insert or update or delete on public.olli_schedule_waitlist
for each row execute function private.olli_schedule_capture_audit();

drop trigger if exists olli_schedule_changes_audit on public.olli_schedule_changes;
create trigger olli_schedule_changes_audit
after insert or update or delete on public.olli_schedule_changes
for each row execute function private.olli_schedule_capture_audit();

drop trigger if exists olli_schedule_one_time_sessions_audit on public.olli_schedule_one_time_sessions;
create trigger olli_schedule_one_time_sessions_audit
after insert or update or delete on public.olli_schedule_one_time_sessions
for each row execute function private.olli_schedule_capture_audit();

create or replace function public.olli_schedule_execute(
  p_session_token text,
  p_academy_id uuid,
  p_action text,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_result jsonb;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_semantic_action text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;

  v_semantic_action := case v_action
    when 'change' then case when v_params->>'change_type' = 'move' then 'move' else 'add' end
    when 'resolve_waitlist' then case when v_params->>'action' = 'accept' then 'wait_accept' else 'wait_cancel' end
    when 'add_one_time' then 'makeup_add'
    when 'cancel_one_time' then 'makeup_cancel'
    when 'cancel_change' then 'scheduled_cancel'
    when 'remove_enrollment' then 'remove'
    else null
  end;
  if v_semantic_action is null then
    return jsonb_build_object('ok', false, 'message', '지원하지 않는 시간표 변경입니다.');
  end if;

  perform set_config('olli.actor_account_id', v_account_id::text, true);
  perform set_config('olli.schedule_action', v_semantic_action, true);

  if v_action = 'change' then
    v_result := public.olli_schedule_change(
      p_session_token,
      p_academy_id,
      nullif(v_params->>'student_id', '')::uuid,
      nullif(v_params->>'source_enrollment_id', '')::uuid,
      (v_params->>'target_weekday')::integer,
      (v_params->>'target_time_slot')::integer,
      nullif(v_params->>'effective_date', '')::date,
      v_params->>'change_type',
      coalesce((v_params->>'allow_wait')::boolean, true)
    );
  elsif v_action = 'resolve_waitlist' then
    v_result := public.olli_schedule_resolve_waitlist(
      p_session_token,
      p_academy_id,
      nullif(v_params->>'waitlist_id', '')::uuid,
      v_params->>'action',
      coalesce(nullif(v_params->>'effective_date', '')::date, current_date)
    );
  elsif v_action = 'add_one_time' then
    v_result := public.olli_schedule_add_one_time(
      p_session_token,
      p_academy_id,
      nullif(v_params->>'student_id', '')::uuid,
      nullif(v_params->>'session_date', '')::date,
      (v_params->>'time_slot')::integer,
      coalesce(v_params->>'note', '')
    );
  elsif v_action = 'cancel_one_time' then
    v_result := public.olli_schedule_cancel_one_time(
      p_session_token,
      p_academy_id,
      nullif(v_params->>'one_time_session_id', '')::uuid
    );
  elsif v_action = 'cancel_change' then
    v_result := public.olli_schedule_cancel_change(
      p_session_token,
      p_academy_id,
      nullif(v_params->>'change_id', '')::uuid
    );
  else
    v_result := public.olli_schedule_remove_enrollment(
      p_session_token,
      p_academy_id,
      nullif(v_params->>'student_id', '')::uuid,
      nullif(v_params->>'enrollment_id', '')::uuid,
      nullif(v_params->>'effective_date', '')::date
    );
  end if;

  return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'message', '시간표 변경 값을 확인해 주세요.');
end;
$$;

revoke all on function public.olli_schedule_execute(text, uuid, text, jsonb) from public;
grant execute on function public.olli_schedule_execute(text, uuid, text, jsonb) to anon, authenticated;

create or replace function public.olli_schedule_history_list(
  p_session_token text,
  p_academy_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_role text;
  v_items jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  select m.role into v_role
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and m.role in ('owner','manager','teacher')
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'message', '시간표 변경 이력을 볼 권한이 없습니다.');
  end if;

  with grouped as (
    select
      a.transaction_id,
      min(a.created_at) as created_at,
      coalesce(max(nullif(a.action_name, '')), 'schedule_change') as action_name,
      (array_agg(a.student_id order by a.id) filter (where a.student_id is not null))[1] as student_id,
      (array_agg(a.actor_account_id order by a.id) filter (where a.actor_account_id is not null))[1] as actor_account_id,
      count(*)::integer as change_count,
      bool_or(a.restore_of_transaction_id is not null) as is_restore,
      max(a.restore_of_transaction_id) as restore_of_transaction_id,
      bool_or(a.restored_at is not null) as is_restored,
      max(a.restored_at) as restored_at,
      max(a.restore_transaction_id) as restore_transaction_id
    from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.created_at >= now() - interval '30 days'
    group by a.transaction_id
    order by min(a.created_at) desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'transaction_id', g.transaction_id::text,
    'created_at', g.created_at,
    'action_name', g.action_name,
    'student_id', g.student_id,
    'student_name', coalesce(s.name, '학생'),
    'actor_name', coalesce(actor.display_name, '기록 없음'),
    'change_count', g.change_count,
    'is_restore', g.is_restore,
    'restore_of_transaction_id', g.restore_of_transaction_id::text,
    'is_restored', g.is_restored,
    'restored_at', g.restored_at,
    'restore_transaction_id', g.restore_transaction_id::text,
    'can_restore', (
      v_role in ('owner','manager')
      and not g.is_restore
      and not g.is_restored
      and g.created_at >= now() - interval '30 days'
    ),
    'details', coalesce(detail.items, '[]'::jsonb)
  ) order by g.created_at desc), '[]'::jsonb)
  into v_items
  from grouped g
  left join public.students s on s.id = g.student_id
  left join lateral (
    select m.display_name
    from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = g.actor_account_id
    order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end
    limit 1
  ) actor on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', d.id,
      'table_name', d.table_name,
      'operation', d.operation,
      'row_id', d.row_id,
      'old_data', d.old_data,
      'new_data', d.new_data
    ) order by d.id) as items
    from public.olli_schedule_audit_log d
    where d.academy_id = p_academy_id
      and d.transaction_id = g.transaction_id
  ) detail on true;

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'can_restore', v_role in ('owner','manager'),
    'retention_days', 30,
    'items', v_items
  );
end;
$$;

revoke all on function public.olli_schedule_history_list(text, uuid, integer) from public;
grant execute on function public.olli_schedule_history_list(text, uuid, integer) to anon, authenticated;

create or replace function public.olli_schedule_restore_history(
  p_session_token text,
  p_academy_id uuid,
  p_transaction_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_role text;
  v_item public.olli_schedule_audit_log%rowtype;
  v_current jsonb;
  v_restore_txid bigint;
  v_student_id uuid;
  v_found boolean := false;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  select m.role into v_role
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and m.role in ('owner','manager')
  order by case m.role when 'owner' then 1 else 2 end
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'message', '시간표 복구는 원장 또는 관리자만 할 수 있습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text || ':schedule-restore', 0));

  if not exists (
    select 1 from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
      and a.created_at >= now() - interval '30 days'
  ) then
    return jsonb_build_object('ok', false, 'message', '복구할 변경 이력을 찾지 못했습니다.');
  end if;
  if exists (
    select 1 from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
      and (a.restore_of_transaction_id is not null or a.restored_at is not null)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 복구했거나 복구 작업으로 생성된 이력입니다.');
  end if;

  -- Refuse a stale restore. A later edit to any affected row must be reviewed first.
  for v_item in
    select * from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
    order by a.id
    for update
  loop
    v_found := true;
    v_current := null;
    if v_item.table_name = 'olli_schedule_enrollments' then
      select to_jsonb(e) into v_current from public.olli_schedule_enrollments e where e.id = v_item.row_id;
    elsif v_item.table_name = 'olli_schedule_waitlist' then
      select to_jsonb(w) into v_current from public.olli_schedule_waitlist w where w.id = v_item.row_id;
    elsif v_item.table_name = 'olli_schedule_changes' then
      select to_jsonb(c) into v_current from public.olli_schedule_changes c where c.id = v_item.row_id;
    else
      select to_jsonb(o) into v_current from public.olli_schedule_one_time_sessions o where o.id = v_item.row_id;
    end if;

    if v_item.operation in ('INSERT','UPDATE') then
      if v_current is null or (v_current - 'updated_at') <> (v_item.new_data - 'updated_at') then
        return jsonb_build_object(
          'ok', false,
          'conflict', true,
          'message', '이 변경 이후 같은 시간표가 다시 수정되었습니다. 최근 변경부터 확인해 주세요.'
        );
      end if;
    elsif v_item.operation = 'DELETE' and v_current is not null then
      return jsonb_build_object(
        'ok', false,
        'conflict', true,
        'message', '이 변경 이후 같은 시간표가 다시 생성되었습니다. 최근 변경부터 확인해 주세요.'
      );
    end if;
  end loop;

  if not v_found then
    return jsonb_build_object('ok', false, 'message', '복구할 변경 내용이 없습니다.');
  end if;

  v_restore_txid := txid_current();
  perform set_config('olli.actor_account_id', v_account_id::text, true);
  perform set_config('olli.schedule_action', 'restore', true);
  perform set_config('olli.restore_of_transaction_id', p_transaction_id::text, true);

  -- Reverse child rows before parent rows by replaying the audit in reverse order.
  for v_item in
    select * from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
    order by a.id desc
  loop
    v_student_id := coalesce(v_student_id, v_item.student_id);
    if v_item.operation = 'INSERT' then
      if v_item.table_name = 'olli_schedule_changes' then
        delete from public.olli_schedule_changes where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_waitlist' then
        delete from public.olli_schedule_waitlist where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_one_time_sessions' then
        delete from public.olli_schedule_one_time_sessions where id = v_item.row_id;
      else
        delete from public.olli_schedule_enrollments where id = v_item.row_id;
      end if;
    elsif v_item.operation = 'UPDATE' then
      if v_item.table_name = 'olli_schedule_enrollments' then
        update public.olli_schedule_enrollments set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          weekday = (v_item.old_data->>'weekday')::smallint,
          time_slot = (v_item.old_data->>'time_slot')::smallint,
          effective_from = (v_item.old_data->>'effective_from')::date,
          effective_to = nullif(v_item.old_data->>'effective_to', '')::date,
          status = v_item.old_data->>'status',
          source = v_item.old_data->>'source',
          created_at = (v_item.old_data->>'created_at')::timestamptz,
          updated_at = now()
        where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_waitlist' then
        update public.olli_schedule_waitlist set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          target_weekday = (v_item.old_data->>'target_weekday')::smallint,
          target_time_slot = (v_item.old_data->>'target_time_slot')::smallint,
          request_type = v_item.old_data->>'request_type',
          source_enrollment_id = nullif(v_item.old_data->>'source_enrollment_id', '')::uuid,
          desired_effective_date = nullif(v_item.old_data->>'desired_effective_date', '')::date,
          status = v_item.old_data->>'status',
          requested_at = (v_item.old_data->>'requested_at')::timestamptz,
          resolved_at = nullif(v_item.old_data->>'resolved_at', '')::timestamptz,
          updated_at = now()
        where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_changes' then
        update public.olli_schedule_changes set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          change_type = v_item.old_data->>'change_type',
          source_enrollment_id = nullif(v_item.old_data->>'source_enrollment_id', '')::uuid,
          target_enrollment_id = nullif(v_item.old_data->>'target_enrollment_id', '')::uuid,
          effective_date = (v_item.old_data->>'effective_date')::date,
          status = v_item.old_data->>'status',
          waitlist_id = nullif(v_item.old_data->>'waitlist_id', '')::uuid,
          created_at = (v_item.old_data->>'created_at')::timestamptz,
          updated_at = now(),
          cancelled_at = nullif(v_item.old_data->>'cancelled_at', '')::timestamptz
        where id = v_item.row_id;
      else
        update public.olli_schedule_one_time_sessions set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          session_date = (v_item.old_data->>'session_date')::date,
          time_slot = (v_item.old_data->>'time_slot')::smallint,
          session_type = v_item.old_data->>'session_type',
          status = v_item.old_data->>'status',
          note = coalesce(v_item.old_data->>'note', ''),
          created_at = (v_item.old_data->>'created_at')::timestamptz,
          updated_at = now()
        where id = v_item.row_id;
      end if;
    else
      if v_item.table_name = 'olli_schedule_changes' then
        insert into public.olli_schedule_changes
          select * from jsonb_populate_record(null::public.olli_schedule_changes, v_item.old_data);
      elsif v_item.table_name = 'olli_schedule_waitlist' then
        insert into public.olli_schedule_waitlist
          select * from jsonb_populate_record(null::public.olli_schedule_waitlist, v_item.old_data);
      elsif v_item.table_name = 'olli_schedule_one_time_sessions' then
        insert into public.olli_schedule_one_time_sessions
          select * from jsonb_populate_record(null::public.olli_schedule_one_time_sessions, v_item.old_data);
      else
        insert into public.olli_schedule_enrollments
          select * from jsonb_populate_record(null::public.olli_schedule_enrollments, v_item.old_data);
      end if;
    end if;
  end loop;

  for v_student_id in
    select distinct a.student_id
    from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
      and a.student_id is not null
  loop
    perform private.olli_schedule_sync_student(v_student_id, current_date);
  end loop;

  update public.olli_schedule_audit_log
  set restored_at = now(),
      restored_by_account_id = v_account_id,
      restore_transaction_id = v_restore_txid
  where academy_id = p_academy_id
    and transaction_id = p_transaction_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'restored',
    'restored_transaction_id', p_transaction_id::text,
    'restore_transaction_id', v_restore_txid::text
  );
end;
$$;

revoke all on function public.olli_schedule_restore_history(text, uuid, bigint) from public;
grant execute on function public.olli_schedule_restore_history(text, uuid, bigint) to anon, authenticated;
