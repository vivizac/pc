-- 기존 전체본문 버전 이력을 hash 계보와 압축 checkpoint로 이관한다.

insert into private.olli_note_draft_lineage (
  academy_id, student_id, note_type, revision, content_hash,
  saved_at, account_id, device_id, mutation_id, source, source_revision, created_at
)
select
  v.academy_id, v.student_id, v.note_type, v.revision, md5(coalesce(v.content, '')),
  v.saved_at, v.account_id, v.device_id, v.mutation_id, v.source, v.source_revision, v.created_at
from private.olli_note_draft_versions v
on conflict (academy_id, student_id, note_type, revision) do nothing;

insert into private.olli_note_draft_lineage (
  academy_id, student_id, note_type, revision, content_hash,
  saved_at, account_id, device_id, mutation_id, source, created_at
)
select
  d.academy_id, d.student_id, d.note_type, d.revision, md5(coalesce(d.content, '')),
  coalesce(d.updated_at, now()), d.updated_by_account_id, d.updated_by_device_id,
  d.last_mutation_id, 'migration_current', now()
from public.student_note_drafts d
on conflict (academy_id, student_id, note_type, revision) do nothing;

-- 최근 30일 레거시 버전은 학생/노트/한국 날짜별 마지막 저장본 1개만 복구 지점으로 남긴다.
with ranked as (
  select
    v.*,
    row_number() over (
      partition by v.academy_id, v.student_id, v.note_type,
                   (v.saved_at at time zone 'Asia/Seoul')::date
      order by v.revision desc, v.created_at desc
    ) as rn
  from private.olli_note_draft_versions v
  where v.saved_at >= now() - interval '30 days'
)
insert into private.olli_note_draft_checkpoints (
  academy_id, student_id, note_type, revision, content,
  saved_at, account_id, device_id, source, source_revision, created_at
)
select
  r.academy_id, r.student_id, r.note_type, r.revision, r.content,
  r.saved_at, r.account_id, r.device_id, 'legacy_daily_checkpoint', r.source_revision, now()
from ranked r
where r.rn = 1
on conflict (academy_id, student_id, note_type, revision) do nothing;

insert into private.olli_note_draft_checkpoints (
  academy_id, student_id, note_type, revision, content,
  saved_at, account_id, device_id, source, created_at
)
select
  d.academy_id, d.student_id, d.note_type, d.revision, coalesce(d.content, ''),
  coalesce(d.updated_at, now()), d.updated_by_account_id, d.updated_by_device_id,
  'migration_current', now()
from public.student_note_drafts d
on conflict (academy_id, student_id, note_type, revision) do nothing;

delete from private.olli_note_draft_versions
where saved_at < now() - interval '30 days';

create or replace function private.olli_prune_note_checkpoint_history()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.olli_note_draft_checkpoints
  where saved_at < now() - interval '30 days';

  delete from private.olli_note_draft_versions
  where saved_at < now() - interval '30 days';
end;
$$;

revoke all on function private.olli_prune_note_checkpoint_history() from public, anon, authenticated;
