-- Owner-only, read-only payroll statement preview for the finance settings modal.
-- Preserve historical Team Chat previews and due-date notification delivery.
-- Unlike olli_teacher_payroll_statement_preview_send, this function inserts no
-- Team Chat messages, mentions or preview snapshot rows.
create or replace function public.olli_teacher_payroll_statement_inline_preview(
  p_session_token text,
  p_academy_id uuid,
  p_teacher_member_id uuid,
  p_month date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner_id uuid;
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_statement jsonb;
  v_finalized_snapshot jsonb;
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);

  if not exists (
    select 1 from public.academy_members m
    where m.id=p_teacher_member_id
      and m.academy_id=p_academy_id
      and m.role in ('manager','teacher')
  ) then
    raise exception '현재 학원의 선생님을 찾지 못했습니다.';
  end if;

  -- Prefer the finalized/published snapshot when a payroll period is closed.
  select n.statement_snapshot
    into v_finalized_snapshot
  from private.olli_teacher_payroll_notifications n
  join private.olli_teacher_payroll_periods p
    on p.academy_id=n.academy_id
   and p.teacher_member_id=n.teacher_member_id
   and p.payroll_month=n.payroll_month
   and p.finalized_at is not null
  where n.academy_id=p_academy_id
    and n.teacher_member_id=p_teacher_member_id
    and n.payroll_month=v_month
    and n.statement_snapshot is not null
    and n.statement_snapshot<>'{}'::jsonb
  limit 1;

  v_statement := coalesce(
    v_finalized_snapshot,
    private.olli_teacher_payroll_statement_payload(
      p_academy_id,p_teacher_member_id,v_month
    )
  );

  if v_statement is null or v_statement='{}'::jsonb then
    raise exception '급여명세서 내용을 계산하지 못했습니다.';
  end if;

  return jsonb_build_object(
    'ok',true,
    'preview',true,
    'teacher_member_id',p_teacher_member_id,
    'payroll_month',to_char(v_month,'YYYY-MM'),
    'statement',v_statement
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_statement_inline_preview(
  text,uuid,uuid,date
) from public;
grant execute on function public.olli_teacher_payroll_statement_inline_preview(
  text,uuid,uuid,date
) to anon,authenticated;
