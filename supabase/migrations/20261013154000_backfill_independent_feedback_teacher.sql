-- One-time initialization only. Feedback homeroom stays in students.feedback_teacher.
-- This does NOT create any ongoing dependency on class-teacher reads.
-- Preserve every existing non-empty student feedback teacher; never modify timetable assignments.
-- The migration intentionally leaves missing/ambiguous teachers unchanged for manual assignment.
WITH effective_lessons AS (
  SELECT
    s.id AS student_id,
    s.academy_id,
    e.session_order,
    NULLIF(BTRIM(ct.teacher_name), '') AS teacher_name
  FROM public.students s
  JOIN public.olli_schedule_enrollments e
    ON e.student_id = s.id
   AND e.academy_id = s.academy_id
   AND e.status = 'active'
   AND e.effective_from <= CURRENT_DATE
   AND (e.effective_to IS NULL OR e.effective_to >= CURRENT_DATE)
  LEFT JOIN public.olli_schedule_class_teachers ct
    ON ct.academy_id = e.academy_id
   AND ct.division = s.division
   AND ct.weekday = e.weekday
   AND ct.time_slot = e.time_slot
   AND ct.class_group = COALESCE(NULLIF(UPPER(TRIM(e.class_group)), ''), 'A')
  WHERE s.status = 'active'
    AND COALESCE(s.is_deleted, false) = false
    AND NULLIF(BTRIM(s.feedback_teacher), '') IS NULL
),
per_student AS (
  SELECT
    student_id, academy_id,
    COUNT(*) AS lesson_count,
    COUNT(*) FILTER (WHERE session_order = 1) AS first_session_count,
    MAX(teacher_name) FILTER (WHERE session_order = 1) AS first_teacher,
    COUNT(*) FILTER (WHERE session_order IS NULL) AS unranked_count,
    MAX(teacher_name) FILTER (WHERE session_order IS NULL) AS single_teacher
  FROM effective_lessons
  GROUP BY student_id, academy_id
),
confirmed AS (
  SELECT student_id, academy_id,
    CASE
      WHEN first_session_count = 1 AND first_teacher IS NOT NULL THEN first_teacher
      WHEN lesson_count = 1 AND unranked_count = 1 AND single_teacher IS NOT NULL THEN single_teacher
      ELSE NULL
    END AS teacher_name
  FROM per_student
)
UPDATE public.students s
   SET feedback_teacher = c.teacher_name
FROM confirmed c
WHERE c.student_id = s.id
  AND c.academy_id = s.academy_id
  AND c.teacher_name IS NOT NULL
  AND s.status = 'active'
  AND COALESCE(s.is_deleted, false) = false
  AND NULLIF(BTRIM(s.feedback_teacher), '') IS NULL;
