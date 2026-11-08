-- Statistics-only test enrollments for academy VIVI-5578.
-- These rows must never enter public.students or trigger tuition, attendance,
-- consultation, timetable, inspection, or other real-student workflows.
create table if not exists private.olli_stat_test_students (
  academy_id uuid not null references public.academies(id) on delete cascade,
  test_number integer not null check (test_number between 1 and 1000),
  enrolled_at date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint olli_stat_test_students_pkey primary key (academy_id, test_number)
);

alter table private.olli_stat_test_students enable row level security;
comment on table private.olli_stat_test_students is
  'Statistics-only test enrollment rows. Never insert into public.students or tuition, consultation, schedule, inspection and attendance data.';

create or replace function public.olli_stat_test_counts(p_session_token text, p_academy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_total integer;
  v_year integer;
  v_month integer;
  v_today date := timezone('Asia/Seoul', now())::date;
begin
  if p_academy_id is null then
    raise exception '학원 식별값을 확인할 수 없습니다.';
  end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;
  if not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
  ) then
    raise exception '현재 계정은 이 학원의 통계를 볼 수 없습니다.';
  end if;

  select count(*) filter (where t.active),
         count(*) filter (where t.enrolled_at >= date_trunc('year', v_today)::date),
         count(*) filter (where t.enrolled_at >= date_trunc('month', v_today)::date)
  into v_total, v_year, v_month
  from private.olli_stat_test_students t
  where t.academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true, 'total', coalesce(v_total,0),
    'this_year', coalesce(v_year,0), 'this_month', coalesce(v_month,0)
  );
end
$function$;

revoke all on function public.olli_stat_test_counts(text, uuid) from public;
grant execute on function public.olli_stat_test_counts(text, uuid) to anon, authenticated;

insert into private.olli_stat_test_students(academy_id,test_number,enrolled_at)
select a.id, gs.n, timezone('Asia/Seoul',now())::date
from public.academies a
cross join generate_series(1,13) as gs(n)
where a.academy_code = 'VIVI-5578'
on conflict (academy_id,test_number) do nothing;
