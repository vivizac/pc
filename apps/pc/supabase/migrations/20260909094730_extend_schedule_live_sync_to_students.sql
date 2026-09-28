drop trigger if exists olli_schedule_sync_revision_trg on public.students;
create trigger olli_schedule_sync_revision_trg
  after insert or update or delete on public.students
  for each row execute function private.olli_schedule_bump_sync_revision();
