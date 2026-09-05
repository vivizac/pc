-- Include timetable cell memo changes in the existing 30-day schedule audit history.
-- Memo history is view-only for now; schedule restore remains limited to student schedule rows.

alter table public.olli_schedule_audit_log
  drop constraint if exists olli_schedule_audit_log_table_name_check;

alter table public.olli_schedule_audit_log
  add constraint olli_schedule_audit_log_table_name_check
  check (table_name in (
    'olli_schedule_enrollments',
    'olli_schedule_waitlist',
    'olli_schedule_changes',
    'olli_schedule_one_time_sessions',
    'olli_schedule_cell_memos'
  ));

drop trigger if exists olli_schedule_cell_memos_audit on public.olli_schedule_cell_memos;
create trigger olli_schedule_cell_memos_audit
after insert or update or delete on public.olli_schedule_cell_memos
for each row execute function private.olli_schedule_capture_audit();

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
      max(a.restore_transaction_id) as restore_transaction_id,
      bool_or(a.table_name = 'olli_schedule_cell_memos') as contains_memo
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
    'student_name', case when g.contains_memo then '시간표 메모' else coalesce(s.name, '학생') end,
    'actor_name', coalesce(actor.display_name, '기록 없음'),
    'change_count', g.change_count,
    'is_restore', g.is_restore,
    'restore_of_transaction_id', g.restore_of_transaction_id::text,
    'is_restored', g.is_restored,
    'restored_at', g.restored_at,
    'restore_transaction_id', g.restore_transaction_id::text,
    'can_restore', (
      v_role in ('owner','manager')
      and not g.contains_memo
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
