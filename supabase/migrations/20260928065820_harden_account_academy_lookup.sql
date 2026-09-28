create or replace function public.olli_lookup_academy_by_code(
  p_academy_code text,
  p_session_token text default null
)
returns table(id uuid, academy_id uuid, academy_code text, academy_name text, region text, status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_query text := btrim(coalesce(p_academy_code, ''));
  v_query_upper text := upper(btrim(coalesce(p_academy_code, '')));
  v_account_id uuid;
begin
  if v_query = '' then return; end if;
  if btrim(coalesce(p_session_token, '')) = '' then
    raise exception '개인계정 로그인 후 학원을 검색할 수 있습니다.';
  end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '계정 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  return query
  select a.id, a.id, a.academy_code::text, a.academy_name::text, a.region::text, a.status::text
  from public.academies a
  where coalesce(a.status,'active')='active'
    and a.deleted_at is null
    and (
      upper(btrim(coalesce(a.academy_code::text,''))) = v_query_upper
      or upper(btrim(coalesce(a.academy_code::text,''))) like ('%' || v_query_upper || '%')
      or a.id::text = v_query
      or a.academy_name ilike ('%' || v_query || '%')
    )
  order by
    case
      when upper(btrim(coalesce(a.academy_code::text,''))) = v_query_upper then 0
      when a.id::text = v_query then 1
      when upper(btrim(coalesce(a.academy_name::text,''))) = v_query_upper then 2
      when upper(btrim(coalesce(a.academy_code::text,''))) like (v_query_upper || '%') then 3
      when a.academy_name ilike (v_query || '%') then 4
      else 5
    end,
    a.created_at desc nulls last,
    a.academy_name asc,
    a.academy_code asc
  limit 50;
end;
$function$;

create or replace function public.olli_find_academy_by_code(
  p_academy_code text,
  p_session_token text default null
)
returns table(id uuid, academy_id uuid, academy_code text, academy_name text, region text, status text)
language sql
security definer
set search_path = ''
as $function$
  select * from public.olli_lookup_academy_by_code(p_academy_code,p_session_token);
$function$;

revoke all on function public.olli_lookup_academy_by_code(text,text) from public;
revoke all on function public.olli_lookup_academy_by_code(text,text) from anon, authenticated;
grant execute on function public.olli_lookup_academy_by_code(text,text) to anon, authenticated;
revoke all on function public.olli_find_academy_by_code(text,text) from public;
revoke all on function public.olli_find_academy_by_code(text,text) from anon, authenticated;
grant execute on function public.olli_find_academy_by_code(text,text) to anon, authenticated;
