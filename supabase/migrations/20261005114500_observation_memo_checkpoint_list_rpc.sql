create or replace function private.olli_note_draft_version_list_impl(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_note_type text := btrim(coalesce(p_note_type, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 50));
  v_items jsonb;
  v_current_revision bigint;
  v_current_updated_at timestamptz;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '관찰노트 이전 기록을 볼 권한이 없습니다.');
  end if;

  if p_student_id is null or v_note_type = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', '관찰노트 이전 기록 정보를 확인해 주세요.');
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.academy_id = p_academy_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '학생 정보를 찾을 수 없습니다.');
  end if;

  perform private.olli_prune_note_checkpoint_history();

  select d.revision, d.updated_at
    into v_current_revision, v_current_updated_at
  from public.student_note_drafts d
  where d.academy_id = p_academy_id
    and d.student_id = p_student_id
    and d.note_type = v_note_type;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.revision desc), '[]'::jsonb)
    into v_items
  from (
    select c.revision,
           c.content,
           c.saved_at,
           c.device_id,
           c.source,
           c.source_revision,
           (c.revision = v_current_revision) as is_current
    from private.olli_note_draft_checkpoints c
    where c.academy_id = p_academy_id
      and c.student_id = p_student_id
      and c.note_type = v_note_type
      and c.saved_at >= now() - interval '30 days'
    order by c.revision desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok', true,
    'student_id', p_student_id,
    'note_type', v_note_type,
    'current_revision', coalesce(v_current_revision, 0),
    'current_updated_at', v_current_updated_at,
    'items', v_items
  );
end;
$$;
