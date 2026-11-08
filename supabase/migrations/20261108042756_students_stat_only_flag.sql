ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_stat_only boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.students.is_stat_only IS '통계 합산 전용 테스트 학생. 실제 학생 목록 및 운영 화면에서는 제외.';
