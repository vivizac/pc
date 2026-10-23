-- Add a dedicated 24+ month annual consultation template without changing existing settings.
DO $annual$
DECLARE
  definition text;
  old_fragment text := '''kinder:every_12'') or jsonb_typeof(v_variant)';
  new_fragment text := '''kinder:every_12'',''annual:every_12'') or jsonb_typeof(v_variant)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='olli_consultation_messages_manage' LIMIT 1;
  IF definition IS NULL THEN RAISE EXCEPTION 'consultation settings function missing'; END IF;
  IF position(new_fragment IN definition)>0 THEN RETURN; END IF;
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'unexpected consultation template validator'; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END;
$annual$;
