-- 30일이 지난 관찰노트 전체본문 복구 지점을 매일 실제 삭제한다.
create extension if not exists pg_cron;

select cron.schedule(
  'olli-observation-checkpoint-retention',
  '17 18 * * *',
  $$select private.olli_prune_note_checkpoint_history();$$
);
