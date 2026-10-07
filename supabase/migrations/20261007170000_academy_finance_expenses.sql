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
  revision bigint not null default 0,
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
  constraint olli_academy_expense_items_revision_check check (revision >= 0),
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

create table private.olli_academy_expense_mutations (
  academy_id uuid not null references public.academies(id) on delete cascade,
  request_id uuid not null,
  operation text not null,
  request_payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (academy_id,request_id),
  constraint olli_academy_expense_mutations_operation_check
    check (operation in ('save','end','restore')),
  constraint olli_academy_expense_mutations_payload_check
    check (jsonb_typeof(request_payload)='object'),
  constraint olli_academy_expense_mutations_result_check
    check (jsonb_typeof(result)='object')
);

create index olli_academy_expense_mutations_created_idx
  on private.olli_academy_expense_mutations(academy_id,created_at desc);

create table private.olli_academy_expense_events (
  id uuid primary key default gen_random_uuid(),
  event_seq bigint generated always as identity unique,
  academy_id uuid not null references public.academies(id) on delete cascade,
  expense_item_id uuid not null,
  event_type text not null,
  event_month date not null,
  request_id uuid null,
  changed_by_member_id uuid null references public.academy_members(id) on delete set null,
  changed_by_name_snapshot text not null,
  before_state jsonb null,
  after_state jsonb not null,
  restore_of_event_id uuid null references private.olli_academy_expense_events(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint olli_academy_expense_events_item_academy_fkey
    foreign key(expense_item_id,academy_id)
    references private.olli_academy_expense_items(id,academy_id)
    on delete cascade,
  constraint olli_academy_expense_events_type_check
    check (event_type in ('create','update','end','restore')),
  constraint olli_academy_expense_events_actor_name_check
    check (char_length(btrim(changed_by_name_snapshot)) between 1 and 80),
  constraint olli_academy_expense_events_month_check
    check (event_month=date_trunc('month',event_month)::date),
  constraint olli_academy_expense_events_before_check
    check (before_state is null or jsonb_typeof(before_state)='object'),
  constraint olli_academy_expense_events_after_check
    check (jsonb_typeof(after_state)='object')
);

create index olli_academy_expense_events_month_idx
  on private.olli_academy_expense_events(academy_id,event_month,event_seq desc);

create index olli_academy_expense_events_item_idx
  on private.olli_academy_expense_events(academy_id,expense_item_id,event_seq desc);

create unique index olli_academy_expense_events_request_uidx
  on private.olli_academy_expense_events(academy_id,request_id)
  where request_id is not null;

alter table private.olli_academy_expense_items enable row level security;
alter table private.olli_academy_expense_values enable row level security;
alter table private.olli_academy_expense_mutations enable row level security;
alter table private.olli_academy_expense_events enable row level security;

revoke all on table private.olli_academy_expense_items from public,anon,authenticated;
revoke all on table private.olli_academy_expense_values from public,anon,authenticated;
revoke all on table private.olli_academy_expense_mutations from public,anon,authenticated;
revoke all on table private.olli_academy_expense_events from public,anon,authenticated;

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

create or replace function private.olli_academy_expense_audit_state(
  p_academy_id uuid,
  p_item_id uuid,
  p_month date
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_item private.olli_academy_expense_items%rowtype;
  v_exact private.olli_academy_expense_values%rowtype;
  v_effective private.olli_academy_expense_values%rowtype;
begin
  select * into v_item
  from private.olli_academy_expense_items i
  where i.academy_id=p_academy_id
    and i.id=p_item_id
  limit 1;

  if v_item.id is null then
    return null;
  end if;

  select * into v_exact
  from private.olli_academy_expense_values v
  where v.academy_id=p_academy_id
    and v.expense_item_id=p_item_id
    and v.effective_month=v_month
  limit 1;

  if v_item.recurrence_mode='recurring' then
    select * into v_effective
    from private.olli_academy_expense_values v
    where v.academy_id=p_academy_id
      and v.expense_item_id=p_item_id
      and v.effective_month<=v_month
    order by v.effective_month desc
    limit 1;
  else
    v_effective := v_exact;
  end if;

  return jsonb_build_object(
    'item_id',v_item.id,
    'system_key',v_item.system_key,
    'name',v_item.item_name,
    'category',v_item.category,
    'recurrence_mode',v_item.recurrence_mode,
    'start_month',to_char(v_item.start_month,'YYYY-MM'),
    'inactive_from_month',case
      when v_item.inactive_from_month is null then null
      else to_char(v_item.inactive_from_month,'YYYY-MM')
    end,
    'revision',v_item.revision,
    'event_month',to_char(v_month,'YYYY-MM'),
    'exact_value_exists',v_exact.id is not null,
    'exact_amount',case when v_exact.id is null then null else v_exact.amount end,
    'exact_note',case when v_exact.id is null then null else v_exact.note end,
    'effective_value_month',case
      when v_effective.id is null then null
      else to_char(v_effective.effective_month,'YYYY-MM')
    end,
    'effective_amount',case
      when v_effective.id is null then null
      else v_effective.amount
    end
  );
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
      coalesce(i.revision,0)::bigint as revision,
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
      i.revision,
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
          'revision',r.revision,
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

create or replace function public.olli_academy_expense_save(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
  p_item_id uuid,
  p_system_key text,
  p_category text,
  p_name text,
  p_recurrence_mode text,
  p_start_month date,
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
  v_start_month date := date_trunc('month',coalesce(p_start_month,p_month,current_date))::date;
  v_system_key text := nullif(btrim(coalesce(p_system_key,'')),'');
  v_category text := lower(btrim(coalesce(p_category,'')));
  v_name text := btrim(coalesce(p_name,''));
  v_recurrence text := lower(btrim(coalesce(p_recurrence_mode,'')));
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_item private.olli_academy_expense_items%rowtype;
  v_default record;
  v_existing_mutation private.olli_academy_expense_mutations%rowtype;
  v_request_payload jsonb;
  v_result jsonb;
  v_sort_base integer;
  v_sort_order integer;
  v_new_revision bigint;
  v_created boolean := false;
  v_before_state jsonb;
  v_after_state jsonb;
  v_event_id uuid;
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);

  if p_request_id is null then
    raise exception '지출 저장 요청 ID를 확인해 주세요.';
  end if;
  if coalesce(p_expected_revision,-1)<0 then
    raise exception '지출 수정 버전을 확인해 주세요.';
  end if;
  if coalesce(p_amount,-1)<0 or p_amount>1000000000 then
    raise exception '지출 금액을 확인해 주세요.';
  end if;
  if v_note is not null and char_length(v_note)>500 then
    raise exception '지출 메모는 500자 이하로 입력해 주세요.';
  end if;

  v_request_payload := jsonb_build_object(
    'item_id',p_item_id,
    'system_key',v_system_key,
    'category',v_category,
    'name',v_name,
    'recurrence_mode',v_recurrence,
    'start_month',to_char(v_start_month,'YYYY-MM'),
    'month',to_char(v_month,'YYYY-MM'),
    'amount',p_amount,
    'note',v_note,
    'expected_revision',p_expected_revision
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_academy_id::text || ':expense-request:' || p_request_id::text,
      0
    )
  );

  select * into v_existing_mutation
  from private.olli_academy_expense_mutations m
  where m.academy_id=p_academy_id
    and m.request_id=p_request_id
  limit 1;

  if v_existing_mutation.request_id is not null then
    if v_existing_mutation.operation<>'save'
       or v_existing_mutation.request_payload<>v_request_payload then
      raise exception '같은 지출 요청 ID가 다른 내용으로 다시 사용되었습니다.';
    end if;
    return v_existing_mutation.result || jsonb_build_object('replayed',true);
  end if;

  if p_item_id is not null then
    select * into v_item
    from private.olli_academy_expense_items i
    where i.id=p_item_id
      and i.academy_id=p_academy_id
    for update;

    if not found then
      raise exception '지출 항목을 찾지 못했습니다.';
    end if;
  elsif v_system_key is not null then
    select * into v_default
    from private.olli_academy_expense_default_definitions() d
    where d.system_key=v_system_key
    limit 1;

    if v_default.system_key is null then
      raise exception '기본 지출 항목을 확인해 주세요.';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        p_academy_id::text || ':expense-system:' || v_system_key,
        0
      )
    );

    select * into v_item
    from private.olli_academy_expense_items i
    where i.academy_id=p_academy_id
      and i.system_key=v_system_key
    for update;

    if not found then
      if p_expected_revision<>0 then
        return jsonb_build_object(
          'ok',false,
          'conflict',true,
          'message','다른 기기에서 지출 항목이 변경되었습니다. 최신 값을 다시 불러옵니다.',
          'current_revision',0
        );
      end if;

      insert into private.olli_academy_expense_items(
        academy_id,system_key,category,item_name,recurrence_mode,
        start_month,sort_order,revision,
        created_by_member_id,updated_by_member_id
      ) values (
        p_academy_id,
        v_default.system_key,
        v_default.category,
        v_default.item_name,
        v_default.recurrence_mode,
        v_month,
        v_default.sort_order,
        0,
        v_owner_id,
        v_owner_id
      )
      returning * into v_item;

      v_created := true;
    end if;
  else
    if v_category not in ('advertising','program','other') then
      raise exception '추가할 수 있는 지출 종류를 확인해 주세요.';
    end if;
    if char_length(v_name) not between 1 and 80 then
      raise exception '지출 항목 이름을 확인해 주세요.';
    end if;
    if v_recurrence not in ('recurring','monthly','one_time') then
      raise exception '지출 반복 방식을 확인해 주세요.';
    end if;
    if p_expected_revision<>0 then
      return jsonb_build_object(
        'ok',false,
        'conflict',true,
        'message','새 지출 항목의 수정 버전을 확인해 주세요.',
        'current_revision',0
      );
    end if;

    v_sort_base := case
      when v_category='advertising' then 200
      when v_category='program' then 300
      else 400
    end;

    select v_sort_base + coalesce(max(i.sort_order-v_sort_base),0) + 10
      into v_sort_order
    from private.olli_academy_expense_items i
    where i.academy_id=p_academy_id
      and i.system_key is null
      and i.category=v_category
      and i.sort_order>=v_sort_base
      and i.sort_order<v_sort_base+100;

    insert into private.olli_academy_expense_items(
      academy_id,system_key,category,item_name,recurrence_mode,
      start_month,sort_order,revision,
      created_by_member_id,updated_by_member_id
    ) values (
      p_academy_id,null,v_category,v_name,v_recurrence,
      v_start_month,v_sort_order,0,
      v_owner_id,v_owner_id
    )
    returning * into v_item;

    v_created := true;
  end if;

  if not v_created and v_item.revision<>p_expected_revision then
    return jsonb_build_object(
      'ok',false,
      'conflict',true,
      'message','다른 기기에서 이 지출 항목을 먼저 변경했습니다. 최신 값을 다시 불러옵니다.',
      'item_id',v_item.id,
      'current_revision',v_item.revision
    );
  end if;

  v_before_state := case
    when v_created then null
    else private.olli_academy_expense_audit_state(
      p_academy_id,v_item.id,v_month
    )
  end;

  if v_item.inactive_from_month is not null
     and v_month>=v_item.inactive_from_month then
    raise exception '종료된 지출 항목입니다.';
  end if;

  if v_item.recurrence_mode='one_time'
     and v_month<>v_item.start_month then
    raise exception '일회성 지출은 등록한 월에서만 수정할 수 있습니다.';
  end if;

  if v_item.system_key is null then
    if v_category<>v_item.category
       or v_recurrence<>v_item.recurrence_mode
       or v_start_month<>v_item.start_month then
      raise exception '기존 지출 항목은 이름과 금액만 수정할 수 있습니다.';
    end if;
    if char_length(v_name) not between 1 and 80 then
      raise exception '지출 항목 이름을 확인해 주세요.';
    end if;

    update private.olli_academy_expense_items
    set item_name=v_name
    where id=v_item.id;
  end if;

  insert into private.olli_academy_expense_values(
    academy_id,expense_item_id,effective_month,amount,note,
    created_by_member_id,updated_by_member_id
  ) values (
    p_academy_id,v_item.id,v_month,p_amount,v_note,
    v_owner_id,v_owner_id
  )
  on conflict(expense_item_id,effective_month)
  do update set
    amount=excluded.amount,
    note=excluded.note,
    updated_by_member_id=excluded.updated_by_member_id,
    updated_at=now();

  update private.olli_academy_expense_items
  set revision=revision+1,
      updated_by_member_id=v_owner_id,
      updated_at=now()
  where id=v_item.id
  returning revision into v_new_revision;

  v_after_state := private.olli_academy_expense_audit_state(
    p_academy_id,v_item.id,v_month
  );

  insert into private.olli_academy_expense_events(
    academy_id,expense_item_id,event_type,event_month,request_id,
    changed_by_member_id,changed_by_name_snapshot,before_state,after_state
  ) values (
    p_academy_id,
    v_item.id,
    case when v_created then 'create' else 'update' end,
    v_month,
    p_request_id,
    v_owner_id,
    coalesce(
      (select nullif(btrim(m.display_name),'')
       from public.academy_members m
       where m.id=v_owner_id
       limit 1),
      '원장'
    ),
    v_before_state,
    v_after_state
  )
  returning id into v_event_id;

  v_result := jsonb_build_object(
    'ok',true,
    'item_id',v_item.id,
    'revision',v_new_revision,
    'event_id',v_event_id,
    'replayed',false
  );

  insert into private.olli_academy_expense_mutations(
    academy_id,request_id,operation,request_payload,result
  ) values (
    p_academy_id,p_request_id,'save',v_request_payload,v_result
  );

  return v_result;
end;
$function$;

create or replace function public.olli_academy_expense_item_end(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
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
  v_existing_mutation private.olli_academy_expense_mutations%rowtype;
  v_request_payload jsonb;
  v_result jsonb;
  v_new_revision bigint;
  v_before_state jsonb;
  v_after_state jsonb;
  v_event_id uuid;
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);

  if p_request_id is null then
    raise exception '지출 종료 요청 ID를 확인해 주세요.';
  end if;
  if coalesce(p_expected_revision,-1)<0 then
    raise exception '지출 수정 버전을 확인해 주세요.';
  end if;

  v_request_payload := jsonb_build_object(
    'item_id',p_item_id,
    'end_month',to_char(v_month,'YYYY-MM'),
    'expected_revision',p_expected_revision
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_academy_id::text || ':expense-request:' || p_request_id::text,
      0
    )
  );

  select * into v_existing_mutation
  from private.olli_academy_expense_mutations m
  where m.academy_id=p_academy_id
    and m.request_id=p_request_id
  limit 1;

  if v_existing_mutation.request_id is not null then
    if v_existing_mutation.operation<>'end'
       or v_existing_mutation.request_payload<>v_request_payload then
      raise exception '같은 지출 요청 ID가 다른 내용으로 다시 사용되었습니다.';
    end if;
    return v_existing_mutation.result || jsonb_build_object('replayed',true);
  end if;

  select * into v_item
  from private.olli_academy_expense_items i
  where i.id=p_item_id
    and i.academy_id=p_academy_id
  for update;

  if not found then
    raise exception '지출 항목을 찾지 못했습니다.';
  end if;
  if v_item.system_key is not null then
    raise exception '기본 지출 항목은 삭제할 수 없습니다.';
  end if;

  if v_item.revision<>p_expected_revision then
    return jsonb_build_object(
      'ok',false,
      'conflict',true,
      'message','다른 기기에서 이 지출 항목을 먼저 변경했습니다. 최신 값을 다시 불러옵니다.',
      'item_id',v_item.id,
      'current_revision',v_item.revision
    );
  end if;

  if v_month<v_item.start_month then
    raise exception '지출 종료 월을 확인해 주세요.';
  end if;

  v_before_state := private.olli_academy_expense_audit_state(
    p_academy_id,v_item.id,v_month
  );

  update private.olli_academy_expense_items
  set inactive_from_month=v_month,
      revision=revision+1,
      updated_by_member_id=v_owner_id,
      updated_at=now()
  where id=v_item.id
  returning revision into v_new_revision;

  v_after_state := private.olli_academy_expense_audit_state(
    p_academy_id,v_item.id,v_month
  );

  insert into private.olli_academy_expense_events(
    academy_id,expense_item_id,event_type,event_month,request_id,
    changed_by_member_id,changed_by_name_snapshot,before_state,after_state
  ) values (
    p_academy_id,v_item.id,'end',v_month,p_request_id,
    v_owner_id,
    coalesce(
      (select nullif(btrim(m.display_name),'')
       from public.academy_members m
       where m.id=v_owner_id
       limit 1),
      '원장'
    ),
    v_before_state,v_after_state
  )
  returning id into v_event_id;

  v_result := jsonb_build_object(
    'ok',true,
    'item_id',v_item.id,
    'revision',v_new_revision,
    'event_id',v_event_id,
    'inactive_from_month',to_char(v_month,'YYYY-MM'),
    'replayed',false
  );

  insert into private.olli_academy_expense_mutations(
    academy_id,request_id,operation,request_payload,result
  ) values (
    p_academy_id,p_request_id,'end',v_request_payload,v_result
  );

  return v_result;
end;
$function$;

create or replace function public.olli_academy_expense_history(
  p_session_token text,
  p_academy_id uuid,
  p_month date default current_date,
  p_item_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner_id uuid;
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_limit integer := greatest(1,least(100,coalesce(p_limit,50)));
  v_events jsonb;
begin
  v_owner_id := private.olli_academy_finance_owner_member(
    p_session_token,p_academy_id
  );

  with ranked as (
    select
      e.*,
      row_number() over (
        partition by e.expense_item_id
        order by e.event_seq desc
      ) as item_rank
    from private.olli_academy_expense_events e
    where e.academy_id=p_academy_id
  ),
  filtered as (
    select
      r.*,
      coalesce(r.changed_by_name_snapshot,m.display_name,'원장') as actor_name
    from ranked r
    left join public.academy_members m
      on m.id=r.changed_by_member_id
     and m.academy_id=r.academy_id
    where r.event_month=v_month
      and (p_item_id is null or r.expense_item_id=p_item_id)
    order by r.event_seq desc
    limit v_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id',f.id,
        'event_seq',f.event_seq,
        'item_id',f.expense_item_id,
        'event_type',f.event_type,
        'event_month',to_char(f.event_month,'YYYY-MM'),
        'request_id',f.request_id,
        'actor_name',f.actor_name,
        'before_state',f.before_state,
        'after_state',f.after_state,
        'restore_of_event_id',f.restore_of_event_id,
        'created_at',f.created_at,
        'is_latest',f.item_rank=1,
        'can_restore',f.item_rank=1 and f.event_type<>'create',
        'current_revision',coalesce(
          (select i.revision
           from private.olli_academy_expense_items i
           where i.id=f.expense_item_id
             and i.academy_id=f.academy_id),
          0
        )
      )
      order by f.event_seq desc
    ),
    '[]'::jsonb
  )
  into v_events
  from filtered f;

  return jsonb_build_object(
    'ok',true,
    'month',to_char(v_month,'YYYY-MM'),
    'events',v_events
  );
end;
$function$;

create or replace function public.olli_academy_expense_restore(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner_id uuid;
  v_event private.olli_academy_expense_events%rowtype;
  v_latest_event_id uuid;
  v_item private.olli_academy_expense_items%rowtype;
  v_existing_mutation private.olli_academy_expense_mutations%rowtype;
  v_request_payload jsonb;
  v_before_state jsonb;
  v_after_state jsonb;
  v_source_before jsonb;
  v_source_after jsonb;
  v_result jsonb;
  v_new_revision bigint;
  v_restore_event_id uuid;
  v_event_month date;
  v_before_exact_exists boolean;
  v_after_exact_exists boolean;
  v_value_changed boolean;
  v_name_changed boolean;
  v_inactive_changed boolean;
begin
  v_owner_id := private.olli_academy_finance_owner_member(
    p_session_token,p_academy_id
  );

  if p_request_id is null then
    raise exception '지출 복구 요청 ID를 확인해 주세요.';
  end if;
  if p_event_id is null then
    raise exception '복구할 변경 기록을 확인해 주세요.';
  end if;
  if coalesce(p_expected_revision,-1)<0 then
    raise exception '지출 수정 버전을 확인해 주세요.';
  end if;

  v_request_payload := jsonb_build_object(
    'event_id',p_event_id,
    'expected_revision',p_expected_revision
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_academy_id::text || ':expense-request:' || p_request_id::text,
      0
    )
  );

  select * into v_existing_mutation
  from private.olli_academy_expense_mutations m
  where m.academy_id=p_academy_id
    and m.request_id=p_request_id
  limit 1;

  if v_existing_mutation.request_id is not null then
    if v_existing_mutation.operation<>'restore'
       or v_existing_mutation.request_payload<>v_request_payload then
      raise exception '같은 지출 요청 ID가 다른 내용으로 다시 사용되었습니다.';
    end if;
    return v_existing_mutation.result || jsonb_build_object('replayed',true);
  end if;

  select * into v_event
  from private.olli_academy_expense_events e
  where e.id=p_event_id
    and e.academy_id=p_academy_id
  limit 1;

  if v_event.id is null then
    raise exception '지출 변경 기록을 찾지 못했습니다.';
  end if;
  if v_event.event_type='create' or v_event.before_state is null then
    raise exception '항목 생성 기록은 이전 상태로 복구할 수 없습니다.';
  end if;

  select e.id into v_latest_event_id
  from private.olli_academy_expense_events e
  where e.academy_id=p_academy_id
    and e.expense_item_id=v_event.expense_item_id
  order by e.event_seq desc
  limit 1;

  if v_latest_event_id is distinct from v_event.id then
    return jsonb_build_object(
      'ok',false,
      'conflict',true,
      'message','이 항목에 더 최근 변경이 있습니다. 가장 최근 변경부터 복구해 주세요.'
    );
  end if;

  select * into v_item
  from private.olli_academy_expense_items i
  where i.id=v_event.expense_item_id
    and i.academy_id=p_academy_id
  for update;

  if v_item.id is null then
    raise exception '지출 항목을 찾지 못했습니다.';
  end if;

  if v_item.revision<>p_expected_revision then
    return jsonb_build_object(
      'ok',false,
      'conflict',true,
      'message','다른 기기에서 이 지출 항목을 먼저 변경했습니다. 최신 값을 다시 불러옵니다.',
      'item_id',v_item.id,
      'current_revision',v_item.revision
    );
  end if;

  v_event_month := v_event.event_month;
  v_source_before := v_event.before_state;
  v_source_after := v_event.after_state;
  v_before_state := private.olli_academy_expense_audit_state(
    p_academy_id,v_item.id,v_event_month
  );

  v_name_changed :=
    coalesce(v_source_before->>'name','')
    is distinct from
    coalesce(v_source_after->>'name','');

  v_inactive_changed :=
    coalesce(v_source_before->>'inactive_from_month','')
    is distinct from
    coalesce(v_source_after->>'inactive_from_month','');

  v_before_exact_exists :=
    coalesce((v_source_before->>'exact_value_exists')::boolean,false);
  v_after_exact_exists :=
    coalesce((v_source_after->>'exact_value_exists')::boolean,false);

  v_value_changed :=
    v_before_exact_exists is distinct from v_after_exact_exists
    or (v_source_before->>'exact_amount')
       is distinct from
       (v_source_after->>'exact_amount')
    or coalesce(v_source_before->>'exact_note','')
       is distinct from
       coalesce(v_source_after->>'exact_note','');

  if v_name_changed and v_item.system_key is null then
    update private.olli_academy_expense_items
    set item_name=coalesce(
      nullif(btrim(v_source_before->>'name'),''),
      item_name
    )
    where id=v_item.id;
  end if;

  if v_inactive_changed then
    update private.olli_academy_expense_items
    set inactive_from_month=case
      when nullif(v_source_before->>'inactive_from_month','') is null
        then null
      else to_date(
        (v_source_before->>'inactive_from_month') || '-01',
        'YYYY-MM-DD'
      )
    end
    where id=v_item.id;
  end if;

  if v_value_changed then
    if v_before_exact_exists then
      insert into private.olli_academy_expense_values(
        academy_id,expense_item_id,effective_month,amount,note,
        created_by_member_id,updated_by_member_id
      ) values (
        p_academy_id,
        v_item.id,
        v_event_month,
        (v_source_before->>'exact_amount')::bigint,
        nullif(v_source_before->>'exact_note',''),
        v_owner_id,
        v_owner_id
      )
      on conflict(expense_item_id,effective_month)
      do update set
        amount=excluded.amount,
        note=excluded.note,
        updated_by_member_id=excluded.updated_by_member_id,
        updated_at=now();
    else
      delete from private.olli_academy_expense_values v
      where v.academy_id=p_academy_id
        and v.expense_item_id=v_item.id
        and v.effective_month=v_event_month;
    end if;
  end if;

  update private.olli_academy_expense_items
  set revision=revision+1,
      updated_by_member_id=v_owner_id,
      updated_at=now()
  where id=v_item.id
  returning revision into v_new_revision;

  v_after_state := private.olli_academy_expense_audit_state(
    p_academy_id,v_item.id,v_event_month
  );

  insert into private.olli_academy_expense_events(
    academy_id,expense_item_id,event_type,event_month,request_id,
    changed_by_member_id,changed_by_name_snapshot,before_state,after_state,restore_of_event_id
  ) values (
    p_academy_id,v_item.id,'restore',v_event_month,p_request_id,
    v_owner_id,
    coalesce(
      (select nullif(btrim(m.display_name),'')
       from public.academy_members m
       where m.id=v_owner_id
       limit 1),
      '원장'
    ),
    v_before_state,v_after_state,v_event.id
  )
  returning id into v_restore_event_id;

  v_result := jsonb_build_object(
    'ok',true,
    'item_id',v_item.id,
    'revision',v_new_revision,
    'event_id',v_restore_event_id,
    'restored_event_id',v_event.id,
    'replayed',false
  );

  insert into private.olli_academy_expense_mutations(
    academy_id,request_id,operation,request_payload,result
  ) values (
    p_academy_id,p_request_id,'restore',v_request_payload,v_result
  );

  return v_result;
end;
$function$;

revoke all on function private.olli_academy_expense_default_definitions() from public,anon,authenticated;
revoke all on function private.olli_academy_finance_owner_member(text,uuid) from public,anon,authenticated;
revoke all on function private.olli_academy_expense_audit_state(uuid,uuid,date) from public,anon,authenticated;
revoke all on function private.olli_academy_expense_overview(uuid,date) from public,anon,authenticated;

revoke all on function public.olli_academy_finance_overview(text,uuid,date) from public;
revoke all on function public.olli_academy_expense_save(text,uuid,uuid,bigint,uuid,text,text,text,text,date,date,bigint,text) from public;
revoke all on function public.olli_academy_expense_item_end(text,uuid,uuid,bigint,uuid,date) from public;
revoke all on function public.olli_academy_expense_history(text,uuid,date,uuid,integer) from public;
revoke all on function public.olli_academy_expense_restore(text,uuid,uuid,bigint,uuid) from public;

grant execute on function public.olli_academy_finance_overview(text,uuid,date) to anon,authenticated,service_role;
grant execute on function public.olli_academy_expense_save(text,uuid,uuid,bigint,uuid,text,text,text,text,date,date,bigint,text) to anon,authenticated,service_role;
grant execute on function public.olli_academy_expense_item_end(text,uuid,uuid,bigint,uuid,date) to anon,authenticated,service_role;
grant execute on function public.olli_academy_expense_history(text,uuid,date,uuid,integer) to anon,authenticated,service_role;
grant execute on function public.olli_academy_expense_restore(text,uuid,uuid,bigint,uuid) to anon,authenticated,service_role;

commit;
