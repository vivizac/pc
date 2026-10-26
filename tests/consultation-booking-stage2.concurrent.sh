#!/usr/bin/env bash
set -euo pipefail
# Ephemeral PostgreSQL ONLY; requires bootstrap + stages 1/2 and integration test.
psql -v ON_ERROR_STOP=1 -qAt <<'SQL'
insert into public.students(id,academy_id) values
 ('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
SQL
# Both transactions independently find same date/time; exclusion constraint must
# make exactly one win, even if they enter the DB at the same instant.
sql_for() {
 local sid="$1" key="$2"
 cat <<SQL
select public.olli_booking_server_reserve(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
 '$sid'::uuid,null,
 (select (d::date+'16:30'::time) at time zone 'Asia/Seoul'
  from generate_series((now() at time zone 'Asia/Seoul')::date+1,
  (now() at time zone 'Asia/Seoul')::date+90,interval '1 day') as d
  where extract(isodow from d) between 1 and 5
   and 1+((extract(day from d)::int+
     extract(isodow from date_trunc('month',d)::date)::int-2)/7) in (2,3)
   and not exists(select 1 from public.olli_booking_blocks b where
      b.academy_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and b.block_date=d::date)
  order by d limit 1),
 '$key'::uuid,null,null);
SQL
}
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
psql -X -v ON_ERROR_STOP=1 -c "$(sql_for 44444444-4444-4444-8444-444444444444 99999999-0000-4000-8000-000000000001)" >"$tmp/one" 2>&1 &
a=$!
psql -X -v ON_ERROR_STOP=1 -c "$(sql_for 55555555-5555-4555-8555-555555555555 99999999-0000-4000-8000-000000000002)" >"$tmp/two" 2>&1 &
b=$!
success=0
if wait "$a"; then success=$((success+1)); fi
if wait "$b"; then success=$((success+1)); fi
if [ "$success" -ne 1 ]; then
  echo "Expected exactly one winner, got $success"
  cat "$tmp/one" "$tmp/two"
  exit 1
fi
count="$(psql -X -qAt -c "select count(*) from public.olli_booking_reservations where academy_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and student_id in ('44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555') and status='confirmed'")"
test "$count" = "1"
echo "PASS: exactly one of two truly concurrent reservations committed."
