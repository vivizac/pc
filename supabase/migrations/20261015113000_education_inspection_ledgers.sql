-- Olli academy inspection documents: immutable receipt/ledger transactions and student lifecycle log.
-- Independent of timetable, feedback, expense and payroll sync logic.
-- Legal receipt issuance requires verification of payer, student, course and teaching period.
create table private.olli_inspection_transactions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  entry_type text not null check (entry_type in ('income','expense','refund')),
  category text not null default 'other',
  paid_on date not null,
  participant_name text not null check (char_length(btrim(participant_name)) between 1 and 100),
  payer_name text null,
  student_id uuid null,
  student_name text null,
  amount bigint not null check (amount between 1 and 1000000000),
  approval_no text null,
  course_name text null,
  course_period text null,
  note text null,
  source_name text not null default 'manual',
  dedupe_key text not null,
  created_by_member_id uuid null references public.academy_members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (academy_id,dedupe_key),
  constraint olli_inspection_key_length check (char_length(dedupe_key) between 1 and 240),
  constraint olli_inspection_source_length check (char_length(source_name) between 1 and 180),
  constraint olli_inspection_note_length check (note is null or char_length(note)<=500)
);
create index olli_inspection_trans_month_idx on private.olli_inspection_transactions(academy_id,paid_on,id);

create table private.olli_inspection_student_events (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  student_id uuid not null,
  student_name text not null,
  division text null,
  event_type text not null check (event_type in ('register','withdraw')),
  effective_on date not null,
  logged_at timestamptz not null default now(),
  unique (academy_id,student_id,event_type,effective_on)
);
create index olli_inspection_student_month_idx on private.olli_inspection_student_events(academy_id,effective_on,event_type);

alter table private.olli_inspection_transactions enable row level security;
alter table private.olli_inspection_student_events enable row level security;
revoke all on table private.olli_inspection_transactions from public,anon,authenticated;
revoke all on table private.olli_inspection_student_events from public,anon,authenticated;

-- Append-only audit snapshots. Registration and withdrawal events follow existing student changes.
-- This trigger never updates student rows and preserves the original timetable/student write logic.
create function private.olli_inspection_record_student_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.enrolled_at is not null
     and (tg_op='INSERT' or old.enrolled_at is null) then
    insert into private.olli_inspection_student_events(
      academy_id,student_id,student_name,division,event_type,effective_on
    ) values(new.academy_id,new.id,new.name,new.division,'register',new.enrolled_at)
    on conflict do nothing;
  end if;
  if new.status='withdrawn'
     and (tg_op='INSERT' or old.status is distinct from new.status
          or old.withdrawn_at is distinct from new.withdrawn_at) then
    insert into private.olli_inspection_student_events(
      academy_id,student_id,student_name,division,event_type,effective_on
    ) values(new.academy_id,new.id,new.name,new.division,'withdraw',
             coalesce((new.withdrawn_at at time zone 'Asia/Seoul')::date,
                      (new.status_changed_at at time zone 'Asia/Seoul')::date,
                      timezone('Asia/Seoul',now())::date))
    on conflict do nothing;
  end if;
  return new;
end;
$function$;
revoke all on function private.olli_inspection_record_student_event() from public,anon,authenticated;
create trigger olli_inspection_student_lifecycle_log
after insert or update of enrolled_at,withdrawn_at,status on public.students
for each row execute function private.olli_inspection_record_student_event();

-- Backfill existing registrations and historical withdrawal dates, not assumed delete dates.
insert into private.olli_inspection_student_events(academy_id,student_id,student_name,division,event_type,effective_on)
select academy_id,id,name,division,'register',enrolled_at
from public.students where enrolled_at is not null
on conflict do nothing;
insert into private.olli_inspection_student_events(academy_id,student_id,student_name,division,event_type,effective_on)
select academy_id,id,name,division,'withdraw',(withdrawn_at at time zone 'Asia/Seoul')::date
from public.students where withdrawn_at is not null and status='withdrawn'
on conflict do nothing;

-- Owner-only inspection view; no student/financial PII exposed to other members.
create function public.olli_inspection_overview(
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
  v_owner_id uuid;
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_end date := (date_trunc('month',coalesce(p_month,current_date))+interval '1 month - 1 day')::date;
  v_transactions jsonb;
  v_events jsonb;
  v_students jsonb;
  v_expense_reference jsonb;
  v_income bigint;
  v_expenses bigint;
  v_refunds bigint;
  v_count integer;
  v_undated_withdrawals integer := 0;
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);
  v_expense_reference := private.olli_academy_expense_overview(p_academy_id,v_month);
  select count(*) into v_undated_withdrawals
  from public.students s
  where s.academy_id=p_academy_id and s.status='withdrawn' and s.withdrawn_at is null;
  select count(*) into v_count
  from private.olli_inspection_transactions t
  where t.academy_id=p_academy_id and t.paid_on between v_month and v_end;
  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.paid_on,row_data.created_at,row_data.id),'[]'::jsonb)
  into v_transactions
  from (
    select t.id,t.paid_on,t.entry_type,t.category,t.participant_name,t.payer_name,t.student_name,
      t.amount,t.approval_no,t.course_name,t.course_period,t.note,t.source_name,t.created_at
    from private.olli_inspection_transactions t
    where t.academy_id=p_academy_id and t.paid_on between v_month and v_end
    order by t.paid_on,t.created_at,t.id limit 3000
  ) row_data;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.effective_on,s.logged_at,s.id),'[]'::jsonb)
  into v_events
  from (
    select e.id,e.student_id,e.student_name,e.division,e.event_type,e.effective_on,e.logged_at
    from private.olli_inspection_student_events e
    where e.academy_id=p_academy_id and e.effective_on between v_month and v_end
    order by e.effective_on,e.logged_at,e.id limit 3000
  ) s;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name,s.id),'[]'::jsonb)
  into v_students
  from public.students s
  where s.academy_id=p_academy_id;
  select coalesce(sum(amount) filter(where entry_type='income'),0),
         coalesce(sum(amount) filter(where entry_type='expense'),0),
         coalesce(sum(amount) filter(where entry_type='refund'),0)
    into v_income,v_expenses,v_refunds
  from private.olli_inspection_transactions
  where academy_id=p_academy_id and paid_on between v_month and v_end;
  return jsonb_build_object('ok',true,'month',to_char(v_month,'YYYY-MM'),
    'transactions',v_transactions,'student_events',v_events,'student_candidates',v_students,
    'expense_reference_amount',coalesce((v_expense_reference->>'total_amount')::bigint,0),
    'expense_reference_missing',coalesce((v_expense_reference->>'missing_monthly_count')::integer,0),
    'total_records',v_count,'truncated',v_count>3000,
    'legacy_withdrawals_without_date',v_undated_withdrawals,
    'income_amount',v_income,'expense_amount',v_expenses,
    'refund_amount',v_refunds,'balance_amount',v_income-v_refunds-v_expenses);
end;
$function$;
revoke all on function public.olli_inspection_overview(text,uuid,date) from public;
grant execute on function public.olli_inspection_overview(text,uuid,date) to anon,authenticated;

-- Atomic batch insert. Duplicate import identifiers never insert twice.
-- The caller must review mapped records before committing.
create function public.olli_inspection_import(
  p_session_token text,
  p_academy_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner_id uuid;
  v_row jsonb;
  v_total integer;
  v_saved integer := 0;
  v_student_id uuid;
  v_entry_type text;
  v_category text;
  v_paid_on date;
  v_amount bigint;
  v_key text;
  v_name text;
  v_source text;
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception '거래 목록 형식을 확인해 주세요.';
  end if;
  v_total:=jsonb_array_length(p_rows);
  if v_total<1 or v_total>200 then
    raise exception '거래는 한 번에 1~200건까지 저장할 수 있습니다.';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) as x(value) loop
    v_entry_type:=btrim(coalesce(v_row->>'entry_type',''));
    v_category:=btrim(coalesce(v_row->>'category','other'));
    v_name:=btrim(coalesce(v_row->>'participant_name',''));
    v_key:=btrim(coalesce(v_row->>'dedupe_key',''));
    v_source:=btrim(coalesce(v_row->>'source_name','manual'));
    if v_entry_type not in ('income','expense','refund') then
      raise exception '수입·지출·환불 구분이 올바르지 않습니다.';
    end if;
    if char_length(v_name) not between 1 and 100 or char_length(v_key) not between 1 and 240
      or char_length(v_source) not between 1 and 180 or char_length(v_category)>50
      or char_length(coalesce(v_row->>'note',''))>500
      or char_length(coalesce(v_row->>'payer_name',''))>100
      or char_length(coalesce(v_row->>'student_name',''))>100
      or char_length(coalesce(v_row->>'approval_no',''))>120
      or char_length(coalesce(v_row->>'course_name',''))>150
      or char_length(coalesce(v_row->>'course_period',''))>150 then
      raise exception '거래 이름 또는 메모 길이가 올바르지 않습니다.';
    end if;
    v_paid_on:=(v_row->>'paid_on')::date;
    v_amount:=(v_row->>'amount')::bigint;
    if v_paid_on is null or v_amount not between 1 and 1000000000 then
      raise exception '거래 날짜와 금액을 확인해 주세요.';
    end if;
    v_student_id:=nullif(v_row->>'student_id','')::uuid;
    if v_student_id is not null and not exists (
      select 1 from public.students s where s.id=v_student_id and s.academy_id=p_academy_id
    ) then
      raise exception '다른 학원의 학생과 연결할 수 없습니다.';
    end if;
    insert into private.olli_inspection_transactions(
      academy_id,entry_type,category,paid_on,participant_name,payer_name,student_id,student_name,
      amount,approval_no,course_name,course_period,note,source_name,dedupe_key,created_by_member_id
    ) values (
      p_academy_id,v_entry_type,v_category,v_paid_on,v_name,
      nullif(btrim(v_row->>'payer_name'),''),
      v_student_id,nullif(btrim(v_row->>'student_name'),''),
      v_amount,nullif(btrim(v_row->>'approval_no'),''),
      nullif(btrim(v_row->>'course_name'),''),
      nullif(btrim(v_row->>'course_period'),''),
      nullif(btrim(v_row->>'note'),''),
      v_source,v_key,v_owner_id
    ) on conflict(academy_id,dedupe_key) do nothing;
    if found then v_saved:=v_saved+1; end if;
  end loop;
  return jsonb_build_object('ok',true,'saved',v_saved,'duplicates',v_total-v_saved,'total',v_total);
end;
$function$;
revoke all on function public.olli_inspection_import(text,uuid,jsonb) from public;
grant execute on function public.olli_inspection_import(text,uuid,jsonb) to anon,authenticated;
