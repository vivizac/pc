-- 관찰노트 자동저장과 사용자 복구 지점을 분리한다.
-- 자동저장은 current draft + revision/CAS에 남기고, 동기화 계보는 본문 대신 hash를 저장한다.

create table if not exists private.olli_note_draft_lineage (
  academy_id uuid not null,
  student_id uuid not null,
  note_type text not null,
  revision bigint not null,
  content_hash text not null,
  saved_at timestamptz not null default now(),
  account_id uuid null,
  device_id text null,
  mutation_id text null,
  source text not null default 'save',
  source_revision bigint null,
  created_at timestamptz not null default now(),
  constraint olli_note_draft_lineage_revision_nonnegative check (revision >= 0),
  constraint olli_note_draft_lineage_pk primary key (academy_id, student_id, note_type, revision)
);

create index if not exists olli_note_draft_lineage_hash_idx
  on private.olli_note_draft_lineage (academy_id, student_id, note_type, content_hash, revision desc);

revoke all on table private.olli_note_draft_lineage from public, anon, authenticated;

create table if not exists private.olli_note_draft_checkpoints (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null,
  student_id uuid not null,
  note_type text not null,
  revision bigint not null,
  content text not null default '',
  saved_at timestamptz not null default now(),
  account_id uuid null,
  device_id text null,
  source text not null default 'memo_exit',
  source_revision bigint null,
  created_at timestamptz not null default now(),
  constraint olli_note_draft_checkpoints_revision_nonnegative check (revision >= 0),
  constraint olli_note_draft_checkpoints_unique_revision unique (academy_id, student_id, note_type, revision)
);

create index if not exists olli_note_draft_checkpoints_lookup_idx
  on private.olli_note_draft_checkpoints (academy_id, student_id, note_type, revision desc);

create index if not exists olli_note_draft_checkpoints_saved_at_idx
  on private.olli_note_draft_checkpoints (saved_at);

revoke all on table private.olli_note_draft_checkpoints from public, anon, authenticated;
