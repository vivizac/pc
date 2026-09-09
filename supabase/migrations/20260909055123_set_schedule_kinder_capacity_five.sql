do $$
declare
  v_def text;
  v_next text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'olli_schedule_week'
    and p.prokind = 'f'
  order by p.oid desc
  limit 1;

  if v_def is null then
    raise exception 'public.olli_schedule_week function not found';
  end if;

  v_next := replace(v_def, '''kinder_capacity'', 6', '''kinder_capacity'', 5');

  if v_next = v_def then
    if position('''kinder_capacity'', 5' in v_def) > 0 then
      return;
    end if;
    raise exception 'expected kinder_capacity literal was not found';
  end if;

  execute v_next;
end $$;
