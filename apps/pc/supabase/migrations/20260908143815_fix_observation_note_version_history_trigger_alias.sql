-- PostgreSQL trigger의 OLD 레코드와 delete alias `old` 충돌을 피한다.
create or replace function private.olli_capture_note_draft_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := coalesce(nullif(current_setting('olli.note_version_source', true), ''), lower(tg_op));
  v_source_revision bigint;
begin
  begin
    v_source_revision := nullif(current_setting('olli.note_version_source_revision', true), '')::bigint;
  exception when others then
    v_source_revision := null;
  end;

  insert into private.olli_note_draft_versions (
    academy_id, student_id, note_type, revision, content,
    saved_at, account_id, device_id, mutation_id,
    source, source_revision
  ) values (
    new.academy_id,
    new.student_id,
    new.note_type,
    new.revision,
    coalesce(new.content, ''),
    coalesce(new.updated_at, now()),
    new.updated_by_account_id,
    new.updated_by_device_id,
    new.last_mutation_id,
    v_source,
    v_source_revision
  )
  on conflict (academy_id, student_id, note_type, revision) do nothing;

  delete from private.olli_note_draft_versions history_row
  where history_row.id in (
    select v.id
    from private.olli_note_draft_versions v
    where v.academy_id = new.academy_id
      and v.student_id = new.student_id
      and v.note_type = new.note_type
    order by v.revision desc, v.created_at desc
    offset 300
  );

  return new;
end;
$$;

revoke all on function private.olli_capture_note_draft_version() from public, anon, authenticated;
