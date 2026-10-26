-- Runs only in the workflow's isolated PostgreSQL database.
-- Verify the migration changed every source of nth-week booking eligibility.
DO $sunday_week_test$
DECLARE
 changed_functions integer;
 nov2_week integer;
 nov8_week integer;
 nov9_week integer;
 nov16_week integer;
 nov23_week integer;
 jun7_week integer;
BEGIN
 SELECT count(*) INTO changed_functions
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname,p.proname) IN (
  ('olli_booking_private','assert_slot'),
  ('olli_booking_private','available_slots'),
  ('public','olli_booking_list_slots'),
  ('public','olli_booking_server_reserve')
 )
 AND position('extract(dow from date_trunc(''month'',' IN pg_get_functiondef(p.oid))>0;
 IF changed_functions<>4 THEN
  RAISE EXCEPTION 'Expected four Sunday-first booking week validators, got %',changed_functions;
 END IF;

 SELECT
  1+((extract(day from date '2026-11-02')::int+
       extract(dow from date_trunc('month',date '2026-11-02'::timestamp)::date)::int-1)/7),
  1+((extract(day from date '2026-11-08')::int+
       extract(dow from date_trunc('month',date '2026-11-08'::timestamp)::date)::int-1)/7),
  1+((extract(day from date '2026-11-09')::int+
       extract(dow from date_trunc('month',date '2026-11-09'::timestamp)::date)::int-1)/7),
  1+((extract(day from date '2026-11-16')::int+
       extract(dow from date_trunc('month',date '2026-11-16'::timestamp)::date)::int-1)/7),
  1+((extract(day from date '2026-11-23')::int+
       extract(dow from date_trunc('month',date '2026-11-23'::timestamp)::date)::int-1)/7),
  1+((extract(day from date '2026-06-07')::int+
       extract(dow from date_trunc('month',date '2026-06-07'::timestamp)::date)::int-1)/7)
 INTO nov2_week,nov8_week,nov9_week,nov16_week,nov23_week,jun7_week;
 IF (nov2_week,nov8_week,nov9_week,nov16_week,nov23_week,jun7_week)
    IS DISTINCT FROM (1,2,2,3,4,2) THEN
  RAISE EXCEPTION 'Calendar rows not Sunday-first: %, %, %, %, %, %',
   nov2_week,nov8_week,nov9_week,nov16_week,nov23_week,jun7_week;
 END IF;
END;
$sunday_week_test$;
