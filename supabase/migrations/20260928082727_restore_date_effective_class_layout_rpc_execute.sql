grant execute on function public.olli_schedule_class_splits_range(text, uuid, date, date)
to anon, authenticated;

grant execute on function public.olli_schedule_split_class(text, uuid, integer, integer, date)
to anon, authenticated;

grant execute on function public.olli_schedule_merge_class(text, uuid, integer, integer, date)
to anon, authenticated;
