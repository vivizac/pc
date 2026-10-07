begin;

create table if not exists private.olli_teacher_payroll_statement_previews (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null,
  teacher_member_id uuid not null,
  payroll_month date not null,
  statement_snapshot jsonb not null,
  message_id bigint unique,
  created_by_member_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists olli_teacher_payroll_statement_previews_academy_created_idx
  on private.olli_teacher_payroll_statement_previews(academy_id,created_at desc);

create index if not exists olli_teacher_payroll_statement_previews_creator_idx
  on private.olli_teacher_payroll_statement_previews(academy_id,created_by_member_id,created_at desc);

alter table private.olli_teacher_payroll_statement_previews enable row level security;
revoke all on table private.olli_teacher_payroll_statement_previews from public,anon,authenticated;

create or replace function public.olli_teacher_payroll_statement_preview_send(
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
  v_account_id uuid;
  v_owner public.academy_members%rowtype;
  v_teacher public.academy_members%rowtype;
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_statement jsonb;
  v_finalized_snapshot jsonb;
  v_preview_id uuid;
  v_message_id bigint;
  v_pay_date date;
  v_teacher_label text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.* into v_owner
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and m.role='owner'
    and a.status='active'
    and a.deleted_at is null
  order by m.created_at
  limit 1;

  if v_owner.id is null then
    raise exception '급여명세서 미리보기는 원장만 만들 수 있습니다.';
  end if;

  select m.* into v_teacher
  from public.academy_members m
  where m.id=p_teacher_member_id
    and m.academy_id=p_academy_id
    and m.role in ('manager','teacher')
  limit 1;

  if v_teacher.id is null then
    raise exception '현재 학원의 선생님을 찾지 못했습니다.';
  end if;

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
    raise exception '급여명세서 미리보기 내용을 계산하지 못했습니다.';
  end if;

  v_pay_date := nullif(v_statement->>'pay_date','')::date;
  v_teacher_label := case
    when trim(coalesce(v_teacher.display_name,'')) ~ '선생님$'
      then trim(v_teacher.display_name)
    else trim(coalesce(v_teacher.display_name,'선생님')) || ' 선생님'
  end;

  insert into private.olli_teacher_payroll_statement_previews(
    academy_id,
    teacher_member_id,
    payroll_month,
    statement_snapshot,
    created_by_member_id
  ) values (
    p_academy_id,
    p_teacher_member_id,
    v_month,
    v_statement,
    v_owner.id
  )
  returning id into v_preview_id;

  insert into public.olli_team_chat_messages(
    academy_id,
    sender_member_id,
    sender_name_snapshot,
    message_type,
    body,
    client_message_id,
    audience
  ) values (
    p_academy_id,
    null,
    '올리',
    'ai',
    format(
      '[미리보기] %s월 %s일 급여 지급 안내%s%s의 급여명세서 미리보기입니다.%s실제 선생님에게는 전송되지 않습니다.',
      coalesce(extract(month from v_pay_date)::integer,extract(month from v_month)::integer),
      coalesce(extract(day from v_pay_date)::integer,1),
      E'\n',
      v_teacher_label,
      E'\n'
    ),
    v_preview_id,
    'management'
  )
  returning id into v_message_id;

  update private.olli_teacher_payroll_statement_previews
  set message_id=v_message_id
  where id=v_preview_id;

  insert into public.olli_team_chat_mentions(
    academy_id,message_id,member_id
  ) values (
    p_academy_id,v_message_id,v_owner.id
  )
  on conflict (message_id,member_id) do nothing;

  perform private.olli_realtime_send_signal(
    p_academy_id,'chat',v_message_id
  );

  return jsonb_build_object(
    'ok',true,
    'preview_id',v_preview_id,
    'message_id',v_message_id,
    'teacher_member_id',p_teacher_member_id,
    'payroll_month',to_char(v_month,'YYYY-MM')
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_statement_preview_send(
  text,uuid,uuid,date
) from public;
grant execute on function public.olli_teacher_payroll_statement_preview_send(
  text,uuid,uuid,date
) to anon,authenticated;

create or replace function public.olli_teacher_payroll_statement_preview_get(
  p_session_token text,
  p_academy_id uuid,
  p_preview_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_owner_id uuid;
  v_preview private.olli_teacher_payroll_statement_previews%rowtype;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id into v_owner_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and m.role='owner'
    and a.status='active'
    and a.deleted_at is null
  order by m.created_at
  limit 1;

  if v_owner_id is null then
    raise exception '급여명세서 미리보기는 원장만 확인할 수 있습니다.';
  end if;

  select * into v_preview
  from private.olli_teacher_payroll_statement_previews p
  where p.id=p_preview_id
    and p.academy_id=p_academy_id
    and p.created_by_member_id=v_owner_id
  limit 1;

  if v_preview.id is null then
    raise exception '급여명세서 미리보기를 찾지 못했습니다.';
  end if;

  return jsonb_build_object(
    'ok',true,
    'preview',true,
    'preview_id',v_preview.id,
    'statement',v_preview.statement_snapshot
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_statement_preview_get(
  text,uuid,uuid
) from public;
grant execute on function public.olli_teacher_payroll_statement_preview_get(
  text,uuid,uuid
) to anon,authenticated;

create or replace function private.olli_team_chat_message_visible_to_member(
  p_academy_id uuid,
  p_message_id bigint,
  p_audience text,
  p_member_id uuid,
  p_member_role text
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when exists (
      select 1
      from private.olli_teacher_payroll_statement_previews preview
      where preview.academy_id=p_academy_id
        and preview.message_id=p_message_id
    ) then exists (
      select 1
      from private.olli_teacher_payroll_statement_previews preview
      where preview.academy_id=p_academy_id
        and preview.message_id=p_message_id
        and preview.created_by_member_id=p_member_id
        and p_member_role='owner'
    )
    when exists (
      select 1
      from private.olli_teacher_payroll_notifications n
      where n.academy_id=p_academy_id
        and n.message_id=p_message_id
    ) then exists (
      select 1
      from private.olli_teacher_payroll_notifications n
      where n.academy_id=p_academy_id
        and n.message_id=p_message_id
        and (
          (
            n.statement_message_version>=1
            and n.teacher_member_id=p_member_id
          )
          or (
            n.statement_message_version=0
            and p_member_role='owner'
          )
        )
    )
    when p_audience='all' then true
    when p_audience='management' and p_member_role in ('owner','manager') then true
    else false
  end;
$function$;

revoke all on function private.olli_team_chat_message_visible_to_member(
  uuid,bigint,text,uuid,text
) from public,anon,authenticated;

commit;
