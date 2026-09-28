-- FK 검사와 향후 교사별 근무 이력 조회를 위한 보조 인덱스입니다.
create index if not exists olli_schedule_teacher_overrides_effective_teacher_fk_idx
  on public.olli_schedule_teacher_overrides (teacher_member_id, academy_id, session_date);

create index if not exists olli_schedule_teacher_overrides_regular_teacher_fk_idx
  on public.olli_schedule_teacher_overrides (regular_teacher_member_id, academy_id, session_date);
