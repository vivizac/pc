drop function if exists public.olli_agent_subject_refs_get(text, uuid, uuid);
drop function if exists public.olli_agent_subject_ref_upsert(text, uuid, uuid, text, uuid, text);
drop function if exists public.olli_agent_session_recent(text, uuid, uuid, integer);
drop function if exists public.olli_agent_session_append(text, uuid, uuid, text, jsonb, text, bigint);
drop function if exists public.olli_agent_session_open(text, uuid, text);
drop function if exists private.olli_agent_session_member(text, uuid);

drop table if exists public.olli_agent_session_items;
drop table if exists public.olli_agent_sessions;
