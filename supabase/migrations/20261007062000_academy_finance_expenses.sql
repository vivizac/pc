begin;

create table private.olli_academy_expense_items (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  system_key text null,
  category text not null,
  item_name text not null,
  recurrence_mode text not null,
  start_month date not null,
  inactive_from_month date null,
  sort_order integer not null default 100,
  created_by_member_id uuid null references public.academy_members(id) on delete set null,
  updated_by_member_id uuid null references public.academy_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint olli_academy_expense_items_id_academy_key unique (id, academy_id),
  constraint olli_academy_expense_items_system_key_check check (
    system_key is null or system_key in ('rent','maintenance','franchise_royalty','materials','tax_accounting')
  ),
  constraint olli_academy_expense_items_category_check check (
    category in ('rent','maintenance','franchise_royalty','materials','tax_accounting','advertising','program','other')
  ),
  constraint olli_academy_expense_items_name_check check (char_length(btrim(item_name)) between 1 and 80),
  constraint olli_academy_expense_items_recurrence_check check (recurrence_mode in ('recurring','monthly','one_time')),
  constraint olli_academy_expense_items_start_month_check check (start_month=date_trunc('month',start_month)::date),
  constraint olli_academy_expense_items_inactive_month_check check (
    inactive_from_month is null
    or (
      inactive_from_month=date_trunc('month',inactive_from_month)::date
      and inactive_from_month>=start_month
    )
  )
);

create unique index olli_academy_expense_items_system_key_uidx
  on private.olli_academy_expense_items(academy_id,system_key)
  where system_key is not null;

create index olli_academy_expense_items_active_idx
  on private.olli_academy_expense_items(academy_id,start_month,inactive_from_month);

create table private.olli_academy_expense_values (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  expense_item_id uuid not null,
  effective_month date not null,
  amount bigint not null,
  note text null,
  created_by_member_id uuid null references public.academy_members(id) on delete set null,
  updated_by_member_id uuid null references public.academy_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint olli_academy_expense_values_item_month_key unique(expense_item_id,effective_month),
  constraint olli_academy_expense_values_item_academy_fkey
    foreign key(expense_item_id,academy_id)
    references private.olli_academy_expense_items(id,academy_id)
    on delete cascade,
  constraint olli_academy_expense_values_month_check check (effective_month=date_trunc('month',effective_month)::date),
  constraint olli_academy_expense_values_amount_check check (amount between 0 and 1000000000),
  constraint olli_academy_expense_values_note_check check (note is null or char_length(note)<=500)
);

create index olli_academy_expense_values_lookup_idx
  on private.olli_academy_expense_values(academy_id,expense_item_id,effective_month desc);

alter table private.olli_academy_expense_items enable row level security;
alter table private.olli_academy_expense_values enable row level security;

revoke all on table private.olli_academy_expense_items from public,anon,authenticated;
revoke all on table private.olli_academy_expense_values from public,anon,authenticated;

create or replace function private.olli_academy_expense_default_definitions()
returns table(
  system_key text,
  item_name text,
  category text,
  recurrence_mode text,
  sort_order integer
)
language sql
immutable
set search_path to ''
as $function$
  select *
  from (values
    ('rent'::text,'월세'::text,'rent'::text,'recurring'::text,10),
    ('maintenance','관리비','maintenance','monthly',20),
    ('franchise_royalty','가맹·로열티','franchise_royalty','recurring',30),
    ('materials','재료비','materials','monthly',40),
    ('tax_accounting','세무·기장료','tax_accounting','recurring',50)
  ) as d(system_key,item_name,category,recurrence_mode,sort_order);
$function$;

create or replace function private.olli_academy_finance_owner_member(
  p_session_token text,
  p_academy_id uuid
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_owner_id uuid;
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
    raise exception '급여 및 지출 관리는 원장만 확인할 수 있습니다.';
  end if;

  return v_owner_id;
end;
$function$;

create or replace function private.olli_academy_expense_overview(
  p_academy_id uuid,
  p_month date
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_items jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_missing_monthly integer := 0;
begin
  with default_rows as (
    select
      d.system_key,
      i.id as item_id,
      d.item_name,
      d.category,
      d.recurrence_mode,
      d.sort_order,
      i.start_month,
      null::date as inactive_from_month,
      ev.id as value_id,
      ev.effective_month as value_month,
      ev.amount
    from private.olli_academy_expense_default_definitions() d
    left join private.olli_academy_expense_items i
      on i.academy_id=p_academy_id
     and i.system_key=d.system_key
    left join lateral (
      select v.id,v.effective_month,v.amount
      from private.olli_academy_expense_values v
      where v.academy_id=p_academy_id
        and v.expense_item_id=i.id
        and (
          (d.recurrence_mode='recurring' and v.effective_month<=v_month)
          or
          (d.recurrence_mode='monthly' and v.effective_month=v_month)
        )
      order by v.effective_month desc
      limit 1
    ) ev on true
  ),
  custom_rows as (
    select
      null::text as system_key,
      i.id as item_id,
      i.item_name,
      i.category,
      i.recurrence_mode,
      i.sort_order,
      i.start_month,
      i.inactive_from_month,
      ev.id as value_id,
      ev.effective_month as value_month,
      ev.amount
    from private.olli_academy_expense_items i
    left join lateral (
      select v.id,v.effective_month,v.amount
      from private.olli_academy_expense_values v
      where v.academy_id=p_academy_id
        and v.expense_item_id=i.id
        and (
          (i.recurrence_mode='recurring' and v.effective_month<=v_month)
          or
          (i.recurrence_mode in ('monthly','one_time') and v.effective_month=v_month)
        )
      order by v.effective_month desc
      limit 1
    ) ev on true
    where i.academy_id=p_academy_id
      and i.system_key is null
      and i.start_month<=v_month
      and (i.inactive_from_month is null or v_month<i.inactive_from_month)
      and (i.recurrence_mode<>'one_time' or i.start_month=v_month)
  ),
  all_rows as (
    select * from default_rows
    union all
    select * from custom_rows
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'system_key',r.system_key,
          'item_id',r.item_id,
          'name',r.item_name,
          'category',r.category,
          'recurrence_mode',r.recurrence_mode,
          'sort_order',r.sort_order,
          'start_month',case when r.start_month is null then null else to_char(r.start_month,'YYYY-MM') end,
          'inactive_from_month',case when r.inactive_from_month is null then null else to_char(r.inactive_from_month,'YYYY-MM') end,
          'is_entered',r.value_id is not null,
          'value_month',case when r.value_month is null then null else to_char(r.value_month,'YYYY-MM') end,
          'amount',coalesce(r.amount,0)
        )
        order by r.sort_order,r.item_name,r.item_id
      ),
      '[]'::jsonb
    ),
    coalesce(sum(coalesce(r.amount,0)),0)::bigint,
    coalesce(count(*) filter (
      where r.recurrence_mode='monthly' and r.value_id is null
    ),0)::integer
  into v_items,v_total,v_missing_monthly
  from all_rows r;

  return jsonb_build_object(
    'month',to_char(v_month,'YYYY-MM'),
    'items',v_items,
    'total_amount',v_total,
    'missing_monthly_count',v_missing_monthly
  );
end;
$function$;

create or replace function public.olli_academy_finance_overview(
  p_session_token text,
  p_academy_id uuid,
  p_month date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_owner_id uuid;
  v_payroll jsonb;
  v_expenses jsonb;
  v_payroll_total bigint := 0;
  v_expense_total bigint := 0;
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);

  v_payroll := public.olli_teacher_payroll_overview(p_session_token,p_academy_id,v_month);
  v_expenses := private.olli_academy_expense_overview(p_academy_id,v_month);

  select coalesce(sum(coalesce((t->>'total_amount')::bigint,0)),0)::bigint
  into v_payroll_total
  from jsonb_array_elements(coalesce(v_payroll->'teachers','[]'::jsonb)) t;

  v_expense_total := coalesce((v_expenses->>'total_amount')::bigint,0);

  return jsonb_build_object(
    'ok',true,
    'month',to_char(v_month,'YYYY-MM'),
    'payroll',v_payroll,
    'expenses',v_expenses,
    'payroll_total_amount',v_payroll_total,
    'expense_total_amount',v_expense_total,
    'total_amount',v_payroll_total+v_expense_total
  );
end;
$function$;

create or replace function public.olli_academy_expense_value_set(
  p_session_token text,
  p_academy_id uuid,
  p_item_id uuid,
  p_system_key text,
  p_month date,
  p_amount bigint,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner_id uuid;
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_item private.olli_academy_expense_items%rowtype;
  v_default record;
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);

  if coalesce(p_amount,-1)<0 or p_amount>1000000000 then
    raise exception '지출 금액을 확인해 주세요.';
  end if;
  if v_note is not null and char_length(v_note)>500 then
    raise exception '지출 메모는 500자 이하로 입력해 주세요.';
  end if;

  if p_item_id is not null then
    select * into v_item
    from private.olli_academy_expense_items i
    where i.id=p_item_id and i.academy_id=p_academy_id
    for update;
    if not found then raise exception '지출 항목을 찾지 못했습니다.'; end if;
  else
    select * into v_default
    from private.olli_academy_expense_default_definitions() d
    where d.system_key=nullif(btrim(coalesce(p_system_key,'')),'')
    limit 1;
    if v_default.system_key is null then
      raise exception '기본 지출 항목을 확인해 주세요.';
    end if;

    select * into v_item
    from private.olli_academy_expense_items i
    where i.academy_id=p_academy_id and i.system_key=v_default.system_key
    for update;

    if not found then
      insert into private.olli_academy_expense_items(
        academy_id,system_key,category,item_name,recurrence_mode,start_month,sort_order,
        created_by_member_id,updated_by_member_id
      ) values (
        p_academy_id,v_default.system_key,v_default.category,v_default.item_name,
        v_default.recurrence_mode,v_month,v_default.sort_order,v_owner_id,v_owner_id
      )
      returning * into v_item;
    end if;
  end if;

  if v_item.inactive_from_month is not null and v_month>=v_item.inactive_from_month then
    raise exception '종료된 지출 항목입니다.';
  end if;
  if v_item.recurrence_mode='one_time' and v_month<>v_item.start_month then
    raise exception '일회성 지출은 등록한 월에서만 수정할 수 있습니다.';
  end if;

  insert into private.olli_academy_expense_values(
    academy_id,expense_item_id,effective_month,amount,note,
    created_by_member_id,updated_by_member_id
  ) values (
    p_academy_id,v_item.id,v_month,p_amount,v_note,v_owner_id,v_owner_id
  )
  on conflict(expense_item_id,effective_month)
  do update set
    amount=excluded.amount,
    note=excluded.note,
    updated_by_member_id=excluded.updated_by_member_id,
    updated_at=now();

  update private.olli_academy_expense_items
  set updated_by_member_id=v_owner_id,updated_at=now()
  where id=v_item.id;

  return jsonb_build_object(
    'ok',true,
    'item_id',v_item.id,
    'overview',private.olli_academy_expense_overview(p_academy_id,v_month)
  );
end;
$function$;

create or replace function public.olli_academy_expense_item_save(
  p_session_token text,
  p_academy_id uuid,
  p_item_id uuid,
  p_category text,
  p_name text,
  p_recurrence_mode text,
  p_start_month date,
  p_initial_amount bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner_id uuid;
  v_month date := date_trunc('month',coalesce(p_start_month,current_date))::date;
  v_category text := lower(btrim(coalesce(p_category,'')));
  v_name text := btrim(coalesce(p_name,''));
  v_recurrence text := lower(btrim(coalesce(p_recurrence_mode,'')));
  v_item private.olli_academy_expense_items%rowtype;
  v_sort_base integer;
  v_sort_order integer;
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);

  if v_category not in ('advertising','program','other') then
    raise exception '추가할 수 있는 지출 종류를 확인해 주세요.';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception '지출 항목 이름을 확인해 주세요.';
  end if;
  if v_recurrence not in ('recurring','monthly','one_time') then
    raise exception '지출 반복 방식을 확인해 주세요.';
  end if;
  if p_initial_amount is not null and (p_initial_amount<0 or p_initial_amount>1000000000) then
    raise exception '지출 금액을 확인해 주세요.';
  end if;

  if p_item_id is null then
    v_sort_base := case v_category when 'advertising' then 200 when 'program' then 300 else 400 end;
    select v_sort_base + coalesce(max(i.sort_order-v_sort_base),0) + 10
    into v_sort_order
    from private.olli_academy_expense_items i
    where i.academy_id=p_academy_id
      and i.system_key is null
      and i.category=v_category
      and i.sort_order>=v_sort_base
      and i.sort_order<v_sort_base+100;

    insert into private.olli_academy_expense_items(
      academy_id,system_key,category,item_name,recurrence_mode,start_month,sort_order,
      created_by_member_id,updated_by_member_id
    ) values (
      p_academy_id,null,v_category,v_name,v_recurrence,v_month,v_sort_order,
      v_owner_id,v_owner_id
    )
    returning * into v_item;

    if p_initial_amount is not null then
      insert into private.olli_academy_expense_values(
        academy_id,expense_item_id,effective_month,amount,
        created_by_member_id,updated_by_member_id
      ) values (
        p_academy_id,v_item.id,v_month,p_initial_amount,v_owner_id,v_owner_id
      );
    end if;
  else
    select * into v_item
    from private.olli_academy_expense_items i
    where i.id=p_item_id and i.academy_id=p_academy_id
    for update;
    if not found then raise exception '지출 항목을 찾지 못했습니다.'; end if;
    if v_item.system_key is not null then raise exception '기본 지출 항목의 이름은 변경할 수 없습니다.'; end if;
    if v_item.category<>v_category or v_item.recurrence_mode<>v_recurrence or v_item.start_month<>v_month then
      raise exception '기존 지출 항목은 이름만 수정할 수 있습니다.';
    end if;

    update private.olli_academy_expense_items
    set item_name=v_name,updated_by_member_id=v_owner_id,updated_at=now()
    where id=v_item.id
    returning * into v_item;
  end if;

  return jsonb_build_object(
    'ok',true,
    'item_id',v_item.id,
    'overview',private.olli_academy_expense_overview(p_academy_id,v_month)
  );
end;
$function$;

create or replace function public.olli_academy_expense_item_end(
  p_session_token text,
  p_academy_id uuid,
  p_item_id uuid,
  p_end_month date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner_id uuid;
  v_month date := date_trunc('month',coalesce(p_end_month,current_date))::date;
  v_item private.olli_academy_expense_items%rowtype;
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);

  select * into v_item
  from private.olli_academy_expense_items i
  where i.id=p_item_id and i.academy_id=p_academy_id
  for update;
  if not found then raise exception '지출 항목을 찾지 못했습니다.'; end if;
  if v_item.system_key is not null then raise exception '기본 지출 항목은 삭제할 수 없습니다.'; end if;
  if v_month<v_item.start_month then raise exception '지출 종료 월을 확인해 주세요.'; end if;

  update private.olli_academy_expense_items
  set inactive_from_month=v_month,updated_by_member_id=v_owner_id,updated_at=now()
  where id=v_item.id;

  return jsonb_build_object(
    'ok',true,
    'item_id',v_item.id,
    'inactive_from_month',to_char(v_month,'YYYY-MM'),
    'overview',private.olli_academy_expense_overview(p_academy_id,v_month)
  );
end;
$function$;

revoke all on function private.olli_academy_expense_default_definitions() from public,anon,authenticated;
revoke all on function private.olli_academy_finance_owner_member(text,uuid) from public,anon,authenticated;
revoke all on function private.olli_academy_expense_overview(uuid,date) from public,anon,authenticated;

revoke all on function public.olli_academy_finance_overview(text,uuid,date) from public;
revoke all on function public.olli_academy_expense_value_set(text,uuid,uuid,text,date,bigint,text) from public;
revoke all on function public.olli_academy_expense_item_save(text,uuid,uuid,text,text,text,date,bigint) from public;
revoke all on function public.olli_academy_expense_item_end(text,uuid,uuid,date) from public;

grant execute on function public.olli_academy_finance_overview(text,uuid,date) to anon,authenticated,service_role;
grant execute on function public.olli_academy_expense_value_set(text,uuid,uuid,text,date,bigint,text) to anon,authenticated,service_role;
grant execute on function public.olli_academy_expense_item_save(text,uuid,uuid,text,text,text,date,bigint) to anon,authenticated,service_role;
grant execute on function public.olli_academy_expense_item_end(text,uuid,uuid,date) to anon,authenticated,service_role;

commit;
