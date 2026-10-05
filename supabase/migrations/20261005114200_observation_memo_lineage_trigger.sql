create or replace function private.olli_capture_note_draft_lineage()
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

  insert into private.olli_note_draft_lineage (
    academy_id, student_id, note_type, revision, content_hash,
    saved_at, account_id, device_id, mutation_id, source, source_revision
  ) values (
    new.academy_id,
    new.student_id,
    new.note_type,
    new.revision,
    md5(coalesce(new.content, '')),
    coalesce(new.updated_at, now()),
    new.updated_by_account_id,
    new.updated_by_device_id,
    new.last_mutation_id,
    v_source,
    v_source_revision
  )
  on conflict (academy_id, student_id, note_type, revision) do nothing;

  -- 자동저장 계보는 본문을 저장하지 않으므로 학생/노트별 최근 500 hash만 유지한다.
  delete from private.olli_note_draft_lineage history_row
  where (history_row.academy_id, history_row.student_id, history_row.note_type, history_row.revision) in (
    select v.academy_id, v.student_id, v.note_type, v.revision
    from private.olli_note_draft_lineage v
    where v.academy_id = new.academy_id
      and v.student_id = new.student_id
      and v.note_type = new.note_type
    order by v.revision desc, v.created_at desc
    offset 500
  );

  return new;
end;
$$;

revoke all on function private.olli_capture_note_draft_lineage() from public, anon, authenticated;

drop trigger if exists olli_note_draft_version_capture on public.student_note_drafts;
drop trigger if exists olli_note_draft_lineage_capture on public.student_note_drafts;

create trigger olli_note_draft_lineage_capture
after insert or update of content, revision, updated_at, last_mutation_id, updated_by_account_id, updated_by_device_id
on public.student_note_drafts
for each row
execute function private.olli_capture_note_draft_lineage();
