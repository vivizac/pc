-- Academy tuition catalog, dated changes and individual terms. No production data reset.
begin;
create table private.olli_tuition_settings (
 academy_id uuid primary key references public.academies(id) on delete cascade,
 revision bigint not null default 0,
 billing_cycle text not null check(billing_cycle in ('monthly','four_weeks')),
 created_at timestamptz not null default now()
);
create table private.olli_tuition_policies (
 id uuid primary key default gen_random_uuid(), academy_id uuid not null references public.academies(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 80),
 new_from date not null, existing_from date, new_until date,
 prices jsonb not null, fees jsonb not null default '[]',
 created_by uuid references public.academy_members(id) on delete set null, created_at timestamptz not null default now(),
 check(existing_from is null or existing_from>=new_from), check(new_until is null or new_until>new_from)
);
create index olli_tuition_policies_lookup on private.olli_tuition_policies(academy_id,new_from desc,created_at desc);
create table private.olli_tuition_student_terms (
 id uuid primary key default gen_random_uuid(), academy_id uuid not null references public.academies(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade, amount bigint check(amount between 0 and 1000000000),
 weekly_sessions integer not null check(weekly_sessions between 0 and 5),
 effective_from date not null, effective_to date, note text not null default '' check(char_length(note)<=500),
 created_by uuid references public.academy_members(id) on delete set null, created_at timestamptz not null default now(),
 check(effective_to is null or effective_to>=effective_from)
);
create index olli_tuition_student_terms_lookup on private.olli_tuition_student_terms(academy_id,student_id,effective_from desc,created_at desc);
create table private.olli_tuition_first_registration (
 academy_id uuid not null references public.academies(id) on delete cascade, student_id uuid not null references public.students(id) on delete cascade,
 registered_on date not null, primary key(academy_id,student_id)
);
create table private.olli_tuition_mutations (
 academy_id uuid not null references public.academies(id) on delete cascade, request_id uuid not null,
 action text not null, data jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(academy_id,request_id)
);
alter table private.olli_tuition_settings enable row level security;
alter table private.olli_tuition_policies enable row level security;
alter table private.olli_tuition_student_terms enable row level security;
alter table private.olli_tuition_first_registration enable row level security;
alter table private.olli_tuition_mutations enable row level security;
revoke all on private.olli_tuition_settings,private.olli_tuition_policies,private.olli_tuition_student_terms,
 private.olli_tuition_first_registration,private.olli_tuition_mutations from public,anon,authenticated;

-- Capture only the first known enrollment; later re-enrollment must not charge an initial fee twice.
insert into private.olli_tuition_first_registration(academy_id,student_id,registered_on)
 select academy_id,id,enrolled_at from public.students where enrolled_at is not null;
create function private.olli_tuition_capture_registration() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.enrolled_at is not null then
  insert into private.olli_tuition_first_registration values(new.academy_id,new.id,new.enrolled_at) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function private.olli_tuition_capture_registration() from public,anon,authenticated;
create trigger olli_tuition_first_registration after insert or update of enrolled_at on public.students
 for each row execute function private.olli_tuition_capture_registration();

-- Preserve the known VIVIZAC fees only. Other academies explicitly configure their own catalog.
insert into private.olli_tuition_settings(academy_id,billing_cycle)
 select id,'four_weeks' from public.academies where academy_code='VIVI-5578';
insert into private.olli_tuition_policies(academy_id,title,new_from,prices,fees)
 select id,'기존 교육비','1900-01-01','{"1":110000,"2":150000,"3":null}'::jsonb,
 '[{"id":"workbook","name":"워크북 교환비","amount":70000,"mode":"once","months":1,"anchor":"enrollment"}]'::jsonb
 from public.academies where academy_code='VIVI-5578';

create function private.olli_tuition_sessions(p_academy uuid,p_student uuid,p_date date) returns integer
language sql stable set search_path='' as $$
 select count(distinct (weekday,time_slot))::integer from public.olli_schedule_enrollments
 where academy_id=p_academy and student_id=p_student and status='active'
 and effective_from<=p_date and (effective_to is null or effective_to>=p_date);
$$;

create function private.olli_tuition_quote(p_academy uuid,p_student uuid,p_date date) returns jsonb
language plpgsql stable set search_path='' as $$
declare
 s public.students; pol private.olli_tuition_policies; term private.olli_tuition_student_terms;
 n integer; price bigint; basis text; pending boolean:=false; first_date date;
begin
 select * into s from public.students where id=p_student and academy_id=p_academy;
 if not found then raise exception 'STUDENT_NOT_FOUND'; end if;
 select registered_on into first_date from private.olli_tuition_first_registration where academy_id=p_academy and student_id=p_student;
 first_date:=coalesce(first_date,s.enrolled_at);
 n:=private.olli_tuition_sessions(p_academy,p_student,p_date);
 select * into pol from private.olli_tuition_policies
 where academy_id=p_academy and new_from<=p_date and
 ((first_date>=new_from and (new_until is null or first_date<new_until)) or (existing_from is not null and existing_from<=p_date))
 order by new_from desc,created_at desc,id desc limit 1;
 price:=(pol.prices->>n::text)::bigint;
 basis:=case when pol.id is null then 'unconfigured' else 'policy' end;
 -- Select the latest event BEFORE checking expiry, so an expired override never revives an older override.
 select * into term from private.olli_tuition_student_terms where academy_id=p_academy and student_id=p_student
 and effective_from<=p_date order by effective_from desc,created_at desc,id desc limit 1;
 if term.id is not null and term.amount is not null and (term.effective_to is null or term.effective_to>=p_date) then
  basis:='individual'; pending:=term.weekly_sessions<>n;
  price:=case when pending then null else term.amount end;
 end if;
 return jsonb_build_object('student_id',s.id,'name',s.name,'weekly_sessions',n,'amount',price,'basis',basis,
 'needs_review',pending or price is null,'policy_id',pol.id,'policy_title',pol.title,'prices',coalesce(pol.prices,'{}'),
 'fees',coalesce(pol.fees,'[]'),'first_registered_on',first_date,'individual_amount',term.amount,
 'individual_sessions',term.weekly_sessions,'individual_from',term.effective_from,'individual_to',term.effective_to,
 'note',term.note,'as_of',p_date);
end $$;

-- Same day in a later calendar month, clamped for 29th/30th/31st enrollments.
create function private.olli_tuition_month_day(p_anchor date,p_month date) returns date
language sql immutable set search_path='' as $$
 select date_trunc('month',p_month)::date + (least(extract(day from p_anchor)::integer,
 extract(day from (date_trunc('month',p_month)+interval '1 month - 1 day'))::integer)-1);
$$;

-- Every component is evaluated on its own expected billing date, never at month-end.
create or replace function private.olli_academy_revenue_estimate(p_academy_id uuid,p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 start_date date:=date_trunc('month',coalesce(p_month,current_date))::date;
 end_date date:=(date_trunc('month',coalesce(p_month,current_date))+interval '1 month - 1 day')::date;
 s record; d date; q jsonb; f jsonb; cycle text; anchor_date date; first_date date; months integer;
 due boolean; tuition bigint:=0; extras bigint:=0; student_total bigint; student_fees bigint;
 once_total bigint:=0; twice_total bigint:=0; once_count integer:=0; twice_count integer:=0;
 new_count integer:=0; missing integer:=0; pending integer:=0; custom_count integer:=0;
 rows jsonb:='[]'; fee_rows jsonb:='[]'; unknown boolean; lastq jsonb; billing_rows jsonb;
begin
 select billing_cycle into cycle from private.olli_tuition_settings where academy_id=p_academy_id;
 for s in select st.*,coalesce(fr.registered_on,st.enrolled_at) first_date
  from public.students st left join private.olli_tuition_first_registration fr on fr.academy_id=st.academy_id and fr.student_id=st.id
  where st.academy_id=p_academy_id and st.enrolled_at<=end_date
  and (st.withdrawn_at is null or (st.withdrawn_at at time zone 'Asia/Seoul')::date>=start_date)
  and (st.deleted_at is null or (st.deleted_at at time zone 'Asia/Seoul')::date>=start_date)
 loop
  student_total:=0;student_fees:=0;unknown:=false;billing_rows:='[]';
  first_date:=s.first_date;
  lastq:=private.olli_tuition_quote(p_academy_id,s.id,greatest(start_date,s.enrolled_at));
  if cycle is null or (lastq->>'needs_review')::boolean then unknown:=true; end if;
  for d in select x::date from generate_series(start_date::timestamp,end_date::timestamp,interval '1 day') x loop
   if d<s.enrolled_at or (s.withdrawn_at is not null and d>=(s.withdrawn_at at time zone 'Asia/Seoul')::date)
    or (s.deleted_at is not null and d>=(s.deleted_at at time zone 'Asia/Seoul')::date)
    or (s.paused_at is not null and d>=(s.paused_at at time zone 'Asia/Seoul')::date and s.status<>'active') then continue; end if;
   -- Also ignore currently inactive rows without historical timestamps (legacy data).
   if end_date>=(now() at time zone 'Asia/Seoul')::date and (s.status not in ('active','paused') or coalesce(s.is_deleted,false)) then continue; end if;
   q:=private.olli_tuition_quote(p_academy_id,s.id,d);
   due:=case when cycle='four_weeks' then (d-s.enrolled_at)%28=0
    else d=private.olli_tuition_month_day(s.enrolled_at,d) end;
   if due then
    lastq:=q;
    if (q->>'needs_review')::boolean then unknown:=true;
    else student_total:=student_total+(q->>'amount')::bigint; end if;
    billing_rows:=billing_rows||jsonb_build_array(jsonb_build_object('date',d,'amount',q->'amount','needs_review',q->'needs_review'));
   end if;
   for f in select value from jsonb_array_elements(q->'fees') loop
    anchor_date:=case when f->>'anchor'='calendar' then (f->>'anchor_date')::date else first_date end;
    months:=coalesce((f->>'months')::integer,1);
    due:=case f->>'mode'
     when 'once' then d=first_date
     when 'cycle' then case when cycle='four_weeks' then (d-s.enrolled_at)%28=0 else d=private.olli_tuition_month_day(s.enrolled_at,d) end
     when 'months' then d>=anchor_date and d=private.olli_tuition_month_day(anchor_date,d)
      and ((extract(year from d)::integer-extract(year from anchor_date)::integer)*12+extract(month from d)::integer-extract(month from anchor_date)::integer)%months=0
     else false end;
    if due then
     student_fees:=student_fees+(f->>'amount')::bigint;
     fee_rows:=fee_rows||jsonb_build_array(jsonb_build_object('student_id',s.id,'name',s.name,'fee_name',f->>'name','date',d,'amount',(f->>'amount')::bigint));
    end if;
   end loop;
  end loop;
  if unknown then missing:=missing+1; end if;
  if (lastq->>'needs_review')::boolean and lastq->>'basis'='individual' then pending:=pending+1; end if;
  if lastq->>'basis'='individual' then custom_count:=custom_count+1; end if;
  if (lastq->>'weekly_sessions')::integer=1 then once_count:=once_count+1;once_total:=once_total+student_total; end if;
  if (lastq->>'weekly_sessions')::integer=2 then twice_count:=twice_count+1;twice_total:=twice_total+student_total; end if;
  if first_date>=start_date and first_date<=end_date then new_count:=new_count+1; end if;
  tuition:=tuition+student_total;extras:=extras+student_fees;
  rows:=rows||jsonb_build_array(lastq||jsonb_build_object('tuition_amount',student_total,'fee_amount',student_fees,'billing',billing_rows,'needs_review',unknown));
 end loop;
 return jsonb_build_object('basis','tuition_policy_estimate','configured',cycle is not null,'billing_cycle',cycle,
 'weekly_once_students',once_count,'weekly_twice_students',twice_count,'new_students',new_count,
 'tuition_once_amount',once_total,'tuition_twice_amount',twice_total,'tuition_total_amount',tuition,'workbook_amount',extras,
 'additional_fee_amount',extras,'total_amount',tuition+extras,'unpriced_students',missing,'review_students',pending,
 'individual_students',custom_count,'students',rows,'fee_items',fee_rows);
end $$;

create function public.olli_tuition_catalog(p_session_token text,p_academy_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.olli_academy_finance_owner_member(p_session_token,p_academy_id);
 return jsonb_build_object('ok',true,'revision',coalesce((select revision from private.olli_tuition_settings where academy_id=p_academy_id),0),
 'billing_cycle',(select billing_cycle from private.olli_tuition_settings where academy_id=p_academy_id),
 'policies',coalesce((select jsonb_agg(to_jsonb(p) order by new_from desc,created_at desc) from private.olli_tuition_policies p where academy_id=p_academy_id),'[]'));
end $$;
create function public.olli_tuition_student(p_session_token text,p_academy_id uuid,p_student_id uuid,p_date date default current_date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q jsonb; n jsonb;
begin
 perform private.olli_academy_finance_owner_member(p_session_token,p_academy_id);
 q:=private.olli_tuition_quote(p_academy_id,p_student_id,coalesce(p_date,current_date));
 select jsonb_build_object('date',d,'amount',private.olli_tuition_quote(p_academy_id,p_student_id,d)->'amount') into n
 from (select existing_from d from private.olli_tuition_policies where academy_id=p_academy_id and existing_from>p_date
 union select new_from from private.olli_tuition_policies where academy_id=p_academy_id and new_from>p_date
 union select effective_from from private.olli_tuition_student_terms where academy_id=p_academy_id and student_id=p_student_id and effective_from>p_date
 union select effective_to+1 from private.olli_tuition_student_terms where academy_id=p_academy_id and student_id=p_student_id and effective_to>=p_date) dates
 where private.olli_tuition_quote(p_academy_id,p_student_id,d)->'amount' is distinct from q->'amount' order by d limit 1;
 return jsonb_build_object('ok',true,'student',q,'next_change',n,'catalog',public.olli_tuition_catalog(p_session_token,p_academy_id));
end $$;

create function public.olli_tuition_write(p_session_token text,p_academy_id uuid,p_expected_revision bigint,
 p_request_id uuid,p_action text,p_data jsonb,p_preview boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid; rev bigint; cycle text; req private.olli_tuition_mutations; result jsonb;
 pol_id uuid; n integer; val jsonb; item jsonb; d date; ex date; st uuid; first_policy boolean;
 preview_rows jsonb:='[]'; r record; q jsonb; amount bigint;
begin
 owner_id:=private.olli_academy_finance_owner_member(p_session_token,p_academy_id);
 if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID_REQUEST'; end if;
 if p_preview and p_action<>'policy' then raise exception 'INVALID_PREVIEW'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text,627));
 select * into req from private.olli_tuition_mutations where academy_id=p_academy_id and request_id=p_request_id;
 if found then
  if req.action<>p_action or req.data<>p_data then raise exception 'REQUEST_ID_REUSED'; end if;
  return req.result;
 end if;
 select revision,billing_cycle into rev,cycle from private.olli_tuition_settings where academy_id=p_academy_id for update;
 rev:=coalesce(rev,0);
 if rev<>p_expected_revision then raise exception 'TUITION_CONFLICT: 다른 화면에서 교육비가 변경되었습니다. 다시 불러와 주세요.'; end if;
 if p_action='policy' then
  first_policy:=not exists(select 1 from private.olli_tuition_policies where academy_id=p_academy_id);
  if jsonb_typeof(p_data->'prices')<>'object' or jsonb_typeof(p_data->'fees')<>'array'
   or length(coalesce(p_data->>'title','')) not between 1 and 80 then raise exception 'INVALID_POLICY'; end if;
  for n in 1..3 loop if not (p_data->'prices' ? n::text) then raise exception 'MISSING_FREQUENCY'; end if; end loop;
  for r in select key,value from jsonb_each(p_data->'prices') loop
   if r.key not in ('1','2','3','4','5') or (r.value<>'null'::jsonb and (jsonb_typeof(r.value)<>'number' or r.value::text !~ '^\d+$' or (r.value::text)::numeric>1000000000)) then raise exception 'INVALID_PRICE'; end if;
  end loop;
  if jsonb_array_length(p_data->'fees')>10 then raise exception 'TOO_MANY_FEES'; end if;
  if (select count(distinct f->>'id') from jsonb_array_elements(p_data->'fees') f)<>jsonb_array_length(p_data->'fees') then raise exception 'DUPLICATE_FEE'; end if;
  for item in select value from jsonb_array_elements(p_data->'fees') loop
   if length(coalesce(item->>'id','')) not between 1 and 80 or length(coalesce(item->>'name','')) not between 1 and 60
    or coalesce(item->>'amount','') !~ '^\d+$' or (item->>'amount')::numeric>1000000000
    or coalesce(item->>'mode','') not in ('once','months','cycle')
    or coalesce(item->>'anchor','') not in ('enrollment','calendar') then raise exception 'INVALID_FEE'; end if;
   if item->>'mode'='months' and (coalesce(item->>'months','') !~ '^\d+$' or (item->>'months')::integer not between 1 and 60) then raise exception 'INVALID_FEE_INTERVAL'; end if;
   if item->>'anchor'='calendar' and nullif(item->>'anchor_date','')::date is null then raise exception 'MISSING_ANCHOR_DATE'; end if;
  end loop;
  d:=case when first_policy then '1900-01-01'::date else (p_data->>'new_from')::date end;
  ex:=nullif(p_data->>'existing_from','')::date;
  if d is null or (not first_policy and d<(now() at time zone 'Asia/Seoul')::date) or (ex is not null and ex<d) then raise exception 'INVALID_EFFECTIVE_DATE'; end if;
  if coalesce(p_data->>'billing_cycle','') not in ('monthly','four_weeks') then raise exception 'INVALID_BILLING_CYCLE'; end if;
  if cycle is not null and cycle<>p_data->>'billing_cycle' then raise exception 'BILLING_CYCLE_LOCKED: 기존 납부 주기는 유지됩니다.'; end if;
  for r in select id,name,enrolled_at from public.students where academy_id=p_academy_id and status='active' and not coalesce(is_deleted,false) loop
   q:=private.olli_tuition_quote(p_academy_id,r.id,greatest(d,(now() at time zone 'Asia/Seoul')::date));
   preview_rows:=preview_rows||jsonb_build_array(jsonb_build_object('student_id',r.id,'name',r.name,'before',q->'amount',
    'individual',q->>'basis'='individual','after',case when q->>'basis'='individual' then q->'amount' else p_data->'prices'->(q->>'weekly_sessions') end,
    'apply_from',case when q->>'basis'='individual' then null when r.enrolled_at>=d then d else ex end));
  end loop;
  if p_preview then return jsonb_build_object('ok',true,'preview',preview_rows,'revision',rev); end if;
  insert into private.olli_tuition_settings(academy_id,billing_cycle) values(p_academy_id,p_data->>'billing_cycle') on conflict do nothing;
  insert into private.olli_tuition_policies(academy_id,title,new_from,existing_from,prices,fees,created_by)
   values(p_academy_id,p_data->>'title',d,ex,p_data->'prices',p_data->'fees',owner_id) returning id into pol_id;
 elsif p_action='individual' then
  if cycle is null then raise exception 'EDUCATION_FEES_NOT_CONFIGURED: 기본 교육비를 먼저 설정해 주세요.'; end if;
  st:=(p_data->>'student_id')::uuid; d:=(p_data->>'effective_from')::date;
  ex:=nullif(p_data->>'effective_to','')::date;
  if not exists(select 1 from public.students where id=st and academy_id=p_academy_id) then raise exception 'STUDENT_NOT_FOUND'; end if;
  if d is null or d<(now() at time zone 'Asia/Seoul')::date or (ex is not null and ex<d) then raise exception 'INVALID_EFFECTIVE_DATE'; end if;
  n:=private.olli_tuition_sessions(p_academy_id,st,d);
  if n>5 or (p_data->>'amount' is not null and n<1) then raise exception 'INVALID_FREQUENCY'; end if;
  if p_data->>'amount' is not null and ((p_data->>'amount')!~'^\d+$' or (p_data->>'amount')::numeric>1000000000) then raise exception 'INVALID_AMOUNT'; end if;
  if p_preview then raise exception 'INVALID_PREVIEW'; end if;
  insert into private.olli_tuition_student_terms(academy_id,student_id,amount,weekly_sessions,effective_from,effective_to,note,created_by)
   values(p_academy_id,st,(p_data->>'amount')::bigint,n,d,ex,coalesce(p_data->>'note',''),owner_id);
 elsif p_action='retire' then
  d:=(p_data->>'new_until')::date;
  if d is null or d<(now() at time zone 'Asia/Seoul')::date then raise exception 'INVALID_EFFECTIVE_DATE'; end if;
  update private.olli_tuition_policies set new_until=d where id=(p_data->>'id')::uuid and academy_id=p_academy_id and new_from<d and new_until is null;
  if not found then raise exception 'POLICY_NOT_FOUND'; end if;
 else raise exception 'INVALID_ACTION'; end if;
 update private.olli_tuition_settings set revision=revision+1 where academy_id=p_academy_id returning revision into rev;
 result:=jsonb_build_object('ok',true,'revision',rev,'policy_id',pol_id);
 insert into private.olli_tuition_mutations(academy_id,request_id,action,data,result) values(p_academy_id,p_request_id,p_action,p_data,result);
 return result;
end $$;

revoke all on function private.olli_tuition_sessions(uuid,uuid,date),private.olli_tuition_quote(uuid,uuid,date),
 private.olli_tuition_month_day(date,date) from public,anon,authenticated;
revoke all on function public.olli_tuition_catalog(text,uuid),public.olli_tuition_student(text,uuid,uuid,date),
 public.olli_tuition_write(text,uuid,bigint,uuid,text,jsonb,boolean) from public;
grant execute on function public.olli_tuition_catalog(text,uuid),public.olli_tuition_student(text,uuid,uuid,date),
 public.olli_tuition_write(text,uuid,bigint,uuid,text,jsonb,boolean) to anon,authenticated;
commit;
