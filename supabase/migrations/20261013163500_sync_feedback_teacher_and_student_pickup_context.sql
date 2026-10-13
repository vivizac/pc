-- Persist independent feedback homeroom after regular timetable changes.
-- One-day substitute teachers do not change the feedback homeroom.
-- Unresolved/blank first-session teachers are never used to overwrite an existing name.
CREATE OR REPLACE FUNCTION public.olli_sync_feedback_teacher_for_student(
  p_academy_id uuid, p_student_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $sync$
DECLARE v_teacher text;
BEGIN
  WITH lessons AS (
    SELECT e.session_order, nullif(btrim(ct.teacher_name),'') teacher_name
    FROM public.olli_schedule_enrollments e
    JOIN public.students s ON s.id=e.student_id AND s.academy_id=e.academy_id
    LEFT JOIN public.olli_schedule_class_teachers ct
      ON ct.academy_id=e.academy_id AND ct.division=s.division
      AND ct.weekday=e.weekday AND ct.time_slot=e.time_slot
      AND ct.class_group=coalesce(nullif(upper(trim(e.class_group)),''),'A')
    WHERE e.academy_id=p_academy_id AND e.student_id=p_student_id
      AND e.status='active' AND e.effective_from<=current_date
      AND (e.effective_to is null OR e.effective_to>=current_date)
      AND s.status='active' AND coalesce(s.is_deleted,false)=false
  )
  SELECT CASE
    WHEN count(*) FILTER (WHERE session_order=1)=1 THEN max(teacher_name) FILTER (WHERE session_order=1)
    WHEN count(*)=1 THEN max(teacher_name)
    ELSE NULL END INTO v_teacher FROM lessons;
  IF v_teacher IS NULL THEN RETURN; END IF;
  UPDATE public.students s SET feedback_teacher=v_teacher
    WHERE s.id=p_student_id AND s.academy_id=p_academy_id
      AND s.status='active' AND coalesce(s.is_deleted,false)=false
      AND s.feedback_teacher IS DISTINCT FROM v_teacher;
END;
$sync$;

CREATE OR REPLACE FUNCTION public.olli_sync_feedback_teacher_after_enrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $trg$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    PERFORM public.olli_sync_feedback_teacher_for_student(OLD.academy_id,OLD.student_id);
  END IF;
  IF TG_OP IN ('UPDATE','INSERT') THEN
    PERFORM public.olli_sync_feedback_teacher_for_student(NEW.academy_id,NEW.student_id);
  END IF;
  RETURN NULL;
END;
$trg$;

CREATE OR REPLACE FUNCTION public.olli_sync_feedback_teacher_after_class_teacher()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $trg$
DECLARE v_student record;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    FOR v_student IN
      SELECT DISTINCT e.academy_id,e.student_id
      FROM public.olli_schedule_enrollments e
      JOIN public.students s ON s.id=e.student_id AND s.academy_id=e.academy_id
      WHERE e.academy_id=OLD.academy_id AND s.division=OLD.division
        AND e.weekday=OLD.weekday AND e.time_slot=OLD.time_slot
        AND coalesce(nullif(upper(trim(e.class_group)),''),'A')=OLD.class_group
        AND e.status='active' AND e.effective_from<=current_date
        AND (e.effective_to is null OR e.effective_to>=current_date)
    LOOP
      PERFORM public.olli_sync_feedback_teacher_for_student(v_student.academy_id,v_student.student_id);
    END LOOP;
  END IF;
  IF TG_OP IN ('UPDATE','INSERT') THEN
    FOR v_student IN
      SELECT DISTINCT e.academy_id,e.student_id
      FROM public.olli_schedule_enrollments e
      JOIN public.students s ON s.id=e.student_id AND s.academy_id=e.academy_id
      WHERE e.academy_id=NEW.academy_id AND s.division=NEW.division
        AND e.weekday=NEW.weekday AND e.time_slot=NEW.time_slot
        AND coalesce(nullif(upper(trim(e.class_group)),''),'A')=NEW.class_group
        AND e.status='active' AND e.effective_from<=current_date
        AND (e.effective_to is null OR e.effective_to>=current_date)
    LOOP
      PERFORM public.olli_sync_feedback_teacher_for_student(v_student.academy_id,v_student.student_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$trg$;

DROP TRIGGER IF EXISTS olli_feedback_teacher_enrollment_trg ON public.olli_schedule_enrollments;
CREATE TRIGGER olli_feedback_teacher_enrollment_trg
AFTER INSERT OR UPDATE OF student_id,academy_id,session_order,weekday,time_slot,class_group,status,effective_from,effective_to OR DELETE
ON public.olli_schedule_enrollments
FOR EACH ROW EXECUTE FUNCTION public.olli_sync_feedback_teacher_after_enrollment();

DROP TRIGGER IF EXISTS olli_feedback_teacher_class_trg ON public.olli_schedule_class_teachers;
CREATE TRIGGER olli_feedback_teacher_class_trg
AFTER INSERT OR UPDATE OF academy_id,division,weekday,time_slot,class_group,teacher_member_id,teacher_name OR DELETE
ON public.olli_schedule_class_teachers
FOR EACH ROW EXECUTE FUNCTION public.olli_sync_feedback_teacher_after_class_teacher();

-- Student-info pickup RPC now exposes dropoff and daily-vs-weekly details.
-- No existing pickup rows are modified.
CREATE OR REPLACE FUNCTION public.olli_schedule_student_enrollments(p_session_token text, p_academy_id uuid, p_student_id uuid, p_reference_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_date date := coalesce(p_reference_date, current_date);
  v_division text;
  v_rows jsonb;
  v_pickups jsonb;
  v_week_start date := v_date - (extract(isodow from v_date)::integer - 1);
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '학생 시간표를 확인할 권한이 없습니다.');
  end if;

  select s.division
    into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and coalesce(s.is_deleted, false) = false;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'weekday', e.weekday,
        'time_slot', e.time_slot,
        'class_group', coalesce(e.class_group, 'A'),
        'session_order', e.session_order,
        'effective_from', e.effective_from,
        'effective_to', e.effective_to,
        'teacher_member_id', ct.teacher_member_id,
        'teacher_name', coalesce(ct.teacher_name, '')
      )
      order by coalesce(e.session_order, 99), e.weekday, e.time_slot, e.class_group
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.olli_schedule_enrollments e
  left join public.olli_schedule_class_teachers ct
    on ct.academy_id = e.academy_id
   and ct.division = v_division
   and ct.weekday = e.weekday
   and ct.time_slot = e.time_slot
   and ct.class_group = coalesce(nullif(upper(trim(e.class_group)), ''), 'A')
  where e.academy_id = p_academy_id
    and e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= v_date
    and (e.effective_to is null or e.effective_to >= v_date);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'weekday', p.weekday,
        'class_time', p.class_time,
        'pickup_label', p.pickup_label,
        'pickup_time', to_char(p.pickup_time, 'HH24:MI'),
        'is_dropoff', p.is_dropoff,
        'dropoff_label', p.dropoff_label,
        'dropoff_time', to_char(p.dropoff_time, 'HH24:MI'),
        'pickup_scope', p.pickup_scope,
        'effective_from', p.effective_from,
        'effective_to', p.effective_to
      )
      order by p.weekday, p.class_time, p.pickup_time, p.id
    ),
    '[]'::jsonb
  )
  into v_pickups
  from public.olli_schedule_pickups p
  where p.academy_id = p_academy_id
    and p.student_id = p_student_id
    and p.status = 'active'
    -- Match the weekday actually shown in the current-week timetable.
    and p.weekday between 1 and 6
    and p.effective_from <= v_week_start + (p.weekday - 1)
    and (p.effective_to is null or p.effective_to >= v_week_start + (p.weekday - 1))
    -- The student's one-day pickup overrides their recurring pickup for that same slot.
    and not (coalesce(p.pickup_scope, 'weekly')='weekly' and exists (
      select 1 from public.olli_schedule_pickups d
      where d.academy_id=p.academy_id and d.student_id=p.student_id
        and d.weekday=p.weekday and d.class_time=p.class_time
        and d.pickup_scope='daily' and d.status='active'
        and d.effective_from<=v_week_start+(p.weekday-1)
        and (d.effective_to is null or d.effective_to>=v_week_start+(p.weekday-1))
    ));

  return jsonb_build_object(
    'ok', true,
    'division', v_division,
    'reference_date', v_date,
    'enrollments', v_rows,
    'pickups', v_pickups
  );
end;
$function$

