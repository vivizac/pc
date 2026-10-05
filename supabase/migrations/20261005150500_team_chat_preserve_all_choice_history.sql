-- Preserve every structured choice prompt as conversation history.
-- The existing selector implementations still validate and complete the choice.
-- These wrappers restore the original prompt body after selection so the next
-- choice/confirmation can be appended as a separate message by the client.

alter function public.olli_team_chat_action_select_structured_date(text,uuid,uuid,text)
  rename to olli_team_chat_action_select_structured_date_history_impl_20261005;
alter function public.olli_team_chat_action_select_structured_date_history_impl_20261005(text,uuid,uuid,text)
  set schema private;

alter function public.olli_team_chat_action_select_structured_time(text,uuid,uuid,integer)
  rename to olli_team_chat_action_select_structured_time_history_impl_20261005;
alter function public.olli_team_chat_action_select_structured_time_history_impl_20261005(text,uuid,uuid,integer)
  set schema private;

alter function public.olli_team_chat_action_select_structured_student(text,uuid,uuid,text)
  rename to olli_team_chat_action_select_structured_student_history_impl_20261005;
alter function public.olli_team_chat_action_select_structured_student_history_impl_20261005(text,uuid,uuid,text)
  set schema private;

alter function public.olli_team_chat_action_select_structured_division(text,uuid,uuid,text)
  rename to olli_team_chat_action_select_structured_division_history_impl_20261005;
alter function public.olli_team_chat_action_select_structured_division_history_impl_20261005(text,uuid,uuid,text)
  set schema private;

alter function public.olli_team_chat_action_select_structured_target(text,uuid,uuid,text)
  rename to olli_team_chat_action_select_structured_target_history_impl_20261005;
alter function public.olli_team_chat_action_select_structured_target_history_impl_20261005(text,uuid,uuid,text)
  set schema private;

revoke execute on function private.olli_team_chat_action_select_structured_date_history_impl_20261005(text,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function private.olli_team_chat_action_select_structured_time_history_impl_20261005(text,uuid,uuid,integer) from public, anon, authenticated;
revoke execute on function private.olli_team_chat_action_select_structured_student_history_impl_20261005(text,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function private.olli_team_chat_action_select_structured_division_history_impl_20261005(text,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function private.olli_team_chat_action_select_structured_target_history_impl_20261005(text,uuid,uuid,text) from public, anon, authenticated;

create or replace function public.olli_team_chat_action_select_structured_date(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_date_expression text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_message_id bigint;
  v_original_body text;
  v_result jsonb;
begin
  select a.message_id,m.body
    into v_message_id,v_original_body
  from public.olli_team_chat_actions a
  join public.olli_team_chat_messages m
    on m.academy_id=a.academy_id and m.id=a.message_id
  where a.id=p_action_id and a.academy_id=p_academy_id and m.deleted_at is null
  limit 1;

  v_result:=private.olli_team_chat_action_select_structured_date_history_impl_20261005(
    p_session_token,p_academy_id,p_action_id,p_date_expression
  );

  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'changed')::boolean,false)=true
     and v_message_id is not null and v_original_body is not null then
    update public.olli_team_chat_messages
    set body=v_original_body
    where academy_id=p_academy_id and id=v_message_id and deleted_at is null;
  end if;

  return v_result - 'message_body';
end;
$function$;

create or replace function public.olli_team_chat_action_select_structured_time(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_time_slot integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_message_id bigint;
  v_original_body text;
  v_result jsonb;
begin
  select a.message_id,m.body
    into v_message_id,v_original_body
  from public.olli_team_chat_actions a
  join public.olli_team_chat_messages m
    on m.academy_id=a.academy_id and m.id=a.message_id
  where a.id=p_action_id and a.academy_id=p_academy_id and m.deleted_at is null
  limit 1;

  v_result:=private.olli_team_chat_action_select_structured_time_history_impl_20261005(
    p_session_token,p_academy_id,p_action_id,p_time_slot
  );

  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'changed')::boolean,false)=true
     and v_message_id is not null and v_original_body is not null then
    update public.olli_team_chat_messages
    set body=v_original_body
    where academy_id=p_academy_id and id=v_message_id and deleted_at is null;
  end if;

  return v_result - 'message_body';
end;
$function$;

create or replace function public.olli_team_chat_action_select_structured_student(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_student_name text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_message_id bigint;
  v_original_body text;
  v_result jsonb;
begin
  select a.message_id,m.body
    into v_message_id,v_original_body
  from public.olli_team_chat_actions a
  join public.olli_team_chat_messages m
    on m.academy_id=a.academy_id and m.id=a.message_id
  where a.id=p_action_id and a.academy_id=p_academy_id and m.deleted_at is null
  limit 1;

  v_result:=private.olli_team_chat_action_select_structured_student_history_impl_20261005(
    p_session_token,p_academy_id,p_action_id,p_student_name
  );

  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'changed')::boolean,false)=true
     and v_message_id is not null and v_original_body is not null then
    update public.olli_team_chat_messages
    set body=v_original_body
    where academy_id=p_academy_id and id=v_message_id and deleted_at is null;
  end if;

  return v_result - 'message_body';
end;
$function$;

create or replace function public.olli_team_chat_action_select_structured_division(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_division text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_message_id bigint;
  v_original_body text;
  v_result jsonb;
begin
  select a.message_id,m.body
    into v_message_id,v_original_body
  from public.olli_team_chat_actions a
  join public.olli_team_chat_messages m
    on m.academy_id=a.academy_id and m.id=a.message_id
  where a.id=p_action_id and a.academy_id=p_academy_id and m.deleted_at is null
  limit 1;

  v_result:=private.olli_team_chat_action_select_structured_division_history_impl_20261005(
    p_session_token,p_academy_id,p_action_id,p_division
  );

  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'changed')::boolean,false)=true
     and v_message_id is not null and v_original_body is not null then
    update public.olli_team_chat_messages
    set body=v_original_body
    where academy_id=p_academy_id and id=v_message_id and deleted_at is null;
  end if;

  return v_result - 'message_body';
end;
$function$;

create or replace function public.olli_team_chat_action_select_structured_target(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_choice_id text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_message_id bigint;
  v_original_body text;
  v_result jsonb;
begin
  select a.message_id,m.body
    into v_message_id,v_original_body
  from public.olli_team_chat_actions a
  join public.olli_team_chat_messages m
    on m.academy_id=a.academy_id and m.id=a.message_id
  where a.id=p_action_id and a.academy_id=p_academy_id and m.deleted_at is null
  limit 1;

  v_result:=private.olli_team_chat_action_select_structured_target_history_impl_20261005(
    p_session_token,p_academy_id,p_action_id,p_choice_id
  );

  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'changed')::boolean,false)=true
     and v_message_id is not null and v_original_body is not null then
    update public.olli_team_chat_messages
    set body=v_original_body
    where academy_id=p_academy_id and id=v_message_id and deleted_at is null;
  end if;

  return v_result - 'message_body';
end;
$function$;

revoke execute on function public.olli_team_chat_action_select_structured_date(text,uuid,uuid,text) from public;
revoke execute on function public.olli_team_chat_action_select_structured_time(text,uuid,uuid,integer) from public;
revoke execute on function public.olli_team_chat_action_select_structured_student(text,uuid,uuid,text) from public;
revoke execute on function public.olli_team_chat_action_select_structured_division(text,uuid,uuid,text) from public;
revoke execute on function public.olli_team_chat_action_select_structured_target(text,uuid,uuid,text) from public;

grant execute on function public.olli_team_chat_action_select_structured_date(text,uuid,uuid,text) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_structured_time(text,uuid,uuid,integer) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_structured_student(text,uuid,uuid,text) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_structured_division(text,uuid,uuid,text) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_structured_target(text,uuid,uuid,text) to anon, authenticated;
