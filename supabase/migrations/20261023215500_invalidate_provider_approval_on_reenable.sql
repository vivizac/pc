DO $audit$
DECLARE definition text;
old_snippet text := 'set approval_state=next_state,previous_approval_state=null';
new_snippet text := 'set approval_state=next_state,previous_approval_state=null,provider_status=null,provider_checked_at=null,provider_content_matches=null,provider_error_code=null';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='olli_consultation_template_lifecycle';
  IF definition IS NULL THEN RAISE EXCEPTION 'Lifecycle function absent'; END IF;
  IF position(new_snippet in definition)>0 THEN RETURN; END IF;
  IF position(old_snippet in definition)=0 THEN RAISE EXCEPTION 'Unexpected lifecycle enable expression'; END IF;
  EXECUTE replace(definition,old_snippet,new_snippet);
END $audit$;