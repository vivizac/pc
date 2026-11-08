begin;
-- Independent receipts ledger. Existing students, tuition, schedules and apps are unchanged.
create table private.olli_receipt_invoices (
 id uuid primary key default gen_random_uuid(), academy_id uuid not null references public.academies(id),
 student_id uuid not null, month date not null check(extract(day from month)=1),
 student_name text not null, amount bigint not null check(amount between 0 and 1000000000),
 source jsonb not null, created_by uuid not null, created_at timestamptz not null default now(),
 unique(academy_id,student_id,month), unique(academy_id,id)
);
create table private.olli_receipt_entries (
 id uuid primary key default gen_random_uuid(), academy_id uuid not null,
 invoice_id uuid not null, kind text not null check(kind in ('payment','reversal')),
 amount bigint not null check(amount between 1 and 1000000000),
 method text not null check(method in ('transfer','card','cash','other')),
 paid_on date not null, note text not null default '' check(length(note)<=500),
 reverses uuid unique references private.olli_receipt_entries(id), created_by uuid not null,
 created_at timestamptz not null default now(),
 foreign key(academy_id,invoice_id) references private.olli_receipt_invoices(academy_id,id),
 check((kind='payment' and reverses is null) or (kind='reversal' and reverses is not null))
);
create index olli_receipt_entries_invoice on private.olli_receipt_entries(academy_id,invoice_id,created_at);
create table private.olli_receipt_favorites (
 academy_id uuid not null references public.academies(id), student_id uuid not null,
 enabled boolean not null, updated_by uuid not null, updated_at timestamptz not null default now(),
 primary key(academy_id,student_id)
);
create table private.olli_receipt_requests (
 academy_id uuid not null, request_id uuid not null, actor uuid not null,
 action text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(academy_id,request_id)
);
alter table private.olli_receipt_invoices enable row level security;
alter table private.olli_receipt_entries enable row level security;
alter table private.olli_receipt_favorites enable row level security;
alter table private.olli_receipt_requests enable row level security;
revoke all on private.olli_receipt_invoices,private.olli_receipt_entries,private.olli_receipt_favorites,private.olli_receipt_requests from public,anon,authenticated;

-- Existing custom account tokens are verified server-side, on every operation.
create function public.olli_receipts_overview(p_session_token text,p_academy_id uuid,p_month date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',p_month)::date; estimate jsonb; result jsonb;
begin
 perform private.olli_academy_finance_owner_member(p_session_token,p_academy_id);
 if m is null or m<'2000-01-01' or m>'2200-12-01' then raise exception 'INVALID_MONTH'; end if;
 estimate:=private.olli_academy_revenue_estimate(p_academy_id,m);
 with projected as (
  select (s->>'student_id')::uuid student_id,s->>'name' student_name,
   case when coalesce((s->>'needs_review')::boolean,true) then null else coalesce((s->>'tuition_amount')::bigint,0)+coalesce((s->>'fee_amount')::bigint,0) end amount,s source
  from jsonb_array_elements(coalesce(estimate->'students','[]')) s
 ), merged as (
  select coalesce(i.student_id,p.student_id) student_id,coalesce(i.student_name,p.student_name) name,
   coalesce(i.amount,p.amount) amount,i.id invoice_id,i.source
  from projected p full join (select * from private.olli_receipt_invoices where academy_id=p_academy_id and month=m) i using(student_id)
 ), rows as (
  select x.*,coalesce(f.enabled,false) favorite,
   coalesce((select sum(case when e.kind='payment' then e.amount else -e.amount end) from private.olli_receipt_entries e where e.academy_id=p_academy_id and e.invoice_id=x.invoice_id),0) paid,
   (select count(*) from private.olli_receipt_entries e where e.academy_id=p_academy_id and e.invoice_id=x.invoice_id) revision
  from merged x left join private.olli_receipt_favorites f on f.academy_id=p_academy_id and f.student_id=x.student_id
 ) select coalesce(jsonb_agg(to_jsonb(rows) order by name,student_id),'[]') into result from rows;
 return jsonb_build_object('ok',true,'month',m,'students',result);
end $$;

create function public.olli_receipts_write(p_session_token text,p_academy_id uuid,p_request_id uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; req private.olli_receipt_requests; inv private.olli_receipt_invoices; entry private.olli_receipt_entries;
 m date; estimate jsonb; s jsonb; v_amount bigint; paid bigint; revision bigint; result jsonb; eid uuid; n integer:=0;
begin
 actor:=private.olli_academy_finance_owner_member(p_session_token,p_academy_id);
 if p_request_id is null or p_action is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID_REQUEST'; end if;
 -- Academy lock serializes issuance, payment and reversal, including retried requests.
 perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text,8511));
 select * into req from private.olli_receipt_requests where academy_id=p_academy_id and request_id=p_request_id;
 if found then
  if req.actor<>actor or req.action<>p_action or req.payload<>p_data then raise exception 'REQUEST_ID_REUSED'; end if;
  return req.result;
 end if;
 if p_action='issue' then
  m:=date_trunc('month',(p_data->>'month')::date)::date;
  if m is null or m<'2000-01-01' or m>'2200-12-01' then raise exception 'INVALID_MONTH'; end if;
  estimate:=private.olli_academy_revenue_estimate(p_academy_id,m);
  for s in select value from jsonb_array_elements(estimate->'students') loop
   if not coalesce((s->>'needs_review')::boolean,true) then
    v_amount:=coalesce((s->>'tuition_amount')::bigint,0)+coalesce((s->>'fee_amount')::bigint,0);
    insert into private.olli_receipt_invoices(academy_id,student_id,month,student_name,amount,source,created_by)
     values(p_academy_id,(s->>'student_id')::uuid,m,s->>'name',v_amount,s,actor) on conflict(academy_id,student_id,month) do nothing;
    if found then n:=n+1; end if;
   end if;
  end loop;
  result:=jsonb_build_object('ok',true,'issued',n);
 elsif p_action='favorite' then
  if not exists(select 1 from public.students where academy_id=p_academy_id and id=(p_data->>'student_id')::uuid) then raise exception 'STUDENT_NOT_FOUND'; end if;
  if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then raise exception 'INVALID_FAVORITE'; end if;
  insert into private.olli_receipt_favorites values(p_academy_id,(p_data->>'student_id')::uuid,(p_data->>'enabled')::boolean,actor,now())
   on conflict(academy_id,student_id) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  result:=jsonb_build_object('ok',true);
 elsif p_action in ('payment','reversal') then
  select * into inv from private.olli_receipt_invoices where academy_id=p_academy_id and id=(p_data->>'invoice_id')::uuid for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  select coalesce(sum(case when kind='payment' then amount else -amount end),0),count(*) into paid,revision from private.olli_receipt_entries where academy_id=p_academy_id and invoice_id=inv.id;
  if (p_data->>'revision') is null or (p_data->>'revision')::bigint<>revision then raise exception 'CONFLICT: 다른 화면에서 수납 내역이 바뀌었습니다. 새로고침해 주세요.'; end if;
  if p_action='payment' then
   if coalesce(p_data->>'amount','') !~ '^[0-9]+$' then raise exception 'INVALID_AMOUNT'; end if;
   v_amount:=(p_data->>'amount')::bigint;
   if v_amount<=0 or v_amount>inv.amount-paid then raise exception 'INVALID_AMOUNT: 미납 잔액 이내로 입력해 주세요.'; end if;
   if (p_data->>'paid_on')::date is null or (p_data->>'paid_on')::date>(now() at time zone 'Asia/Seoul')::date then raise exception 'INVALID_DATE'; end if;
   insert into private.olli_receipt_entries(academy_id,invoice_id,kind,amount,method,paid_on,note,created_by)
    values(p_academy_id,inv.id,'payment',v_amount,p_data->>'method',(p_data->>'paid_on')::date,coalesce(p_data->>'note',''),actor) returning id into eid;
  else
   if length(trim(coalesce(p_data->>'note',''))) not between 1 and 500 then raise exception '취소 사유를 입력해 주세요.'; end if;
   select * into entry from private.olli_receipt_entries where academy_id=p_academy_id and invoice_id=inv.id and id=(p_data->>'entry_id')::uuid and kind='payment';
   if not found or exists(select 1 from private.olli_receipt_entries where reverses=entry.id) then raise exception 'PAYMENT_NOT_REVERSIBLE'; end if;
   insert into private.olli_receipt_entries(academy_id,invoice_id,kind,amount,method,paid_on,note,reverses,created_by)
    values(p_academy_id,inv.id,'reversal',entry.amount,entry.method,(now() at time zone 'Asia/Seoul')::date,p_data->>'note',entry.id,actor) returning id into eid;
  end if;
  result:=jsonb_build_object('ok',true,'entry_id',eid);
 else raise exception 'INVALID_ACTION'; end if;
 insert into private.olli_receipt_requests values(p_academy_id,p_request_id,actor,p_action,p_data,result,now());
 return result;
end $$;

create function public.olli_receipts_history(p_session_token text,p_academy_id uuid,p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.olli_academy_finance_owner_member(p_session_token,p_academy_id);
 if not exists(select 1 from private.olli_receipt_invoices where academy_id=p_academy_id and id=p_invoice_id) then raise exception 'INVOICE_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') into result from private.olli_receipt_entries e where e.academy_id=p_academy_id and e.invoice_id=p_invoice_id;
 return jsonb_build_object('ok',true,'entries',result);
end $$;
revoke all on function public.olli_receipts_overview(text,uuid,date),public.olli_receipts_write(text,uuid,uuid,text,jsonb),public.olli_receipts_history(text,uuid,uuid) from public;
grant execute on function public.olli_receipts_overview(text,uuid,date),public.olli_receipts_write(text,uuid,uuid,text,jsonb),public.olli_receipts_history(text,uuid,uuid) to anon,authenticated;
commit;
