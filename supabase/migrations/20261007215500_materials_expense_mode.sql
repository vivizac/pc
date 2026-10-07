begin;

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

  if v_item.system_key='materials' then
    if v_recurrence not in ('recurring','monthly') then
      raise exception '재료비 입력 방식은 매달 유지 또는 이번 달 입력으로 선택해 주세요.';
    end if;

    if v_item.recurrence_mode<>v_recurrence then
      update private.olli_academy_expense_items
      set recurrence_mode=v_recurrence
      where id=v_item.id;
      v_item.recurrence_mode := v_recurrence;
    end if;
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

revoke all on function public.olli_academy_expense_save(
  text,uuid,uuid,bigint,uuid,text,text,text,text,date,date,bigint,text
) from public;

grant execute on function public.olli_academy_expense_save(
  text,uuid,uuid,bigint,uuid,text,text,text,text,date,date,bigint,text
) to anon,authenticated;

commit;
