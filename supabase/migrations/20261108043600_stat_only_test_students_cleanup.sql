-- Superseded by public.students.is_stat_only records, which are now seeded and deployed.
-- Preserve one source of truth for exactly 13 test students.
do $$
declare
  v_academy uuid := '6871d975-6c50-426d-97b1-81ac4e35ba27'::uuid;
begin
  if (select count(*) from public.students
      where academy_id=v_academy and is_stat_only and not is_deleted) <> 13 then
    raise exception 'Cleanup blocked: exactly 13 public.students stat-only records are required.';
  end if;
  if (select count(*) from private.olli_stat_test_students) <> 13
     or exists (select 1 from private.olli_stat_test_students where academy_id<>v_academy) then
    raise exception 'Cleanup blocked: statistics-only private table contents changed unexpectedly.';
  end if;
end
$$;

drop function if exists public.olli_stat_test_counts(text, uuid);
drop table if exists private.olli_stat_test_students;
