begin;

update storage.buckets
set public = false
where id = 'student_feedback_photos';

drop policy if exists student_feedback_photos_read on storage.objects;
drop policy if exists student_feedback_photos_insert on storage.objects;
drop policy if exists student_feedback_photos_update on storage.objects;
drop policy if exists student_feedback_photos_delete on storage.objects;

commit;
