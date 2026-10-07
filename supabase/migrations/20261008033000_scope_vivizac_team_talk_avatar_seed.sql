-- 이미 적용된 team_talk_member_avatars 마이그레이션은 변경하지 않습니다.
-- 비비작 본원만 안정적인 academy_code로 정확히 좁혀 요청된 초기 아이콘을 재확정합니다.
update public.academy_members m
set team_talk_avatar_key = case m.display_name
  when '루루' then 'avatar-13'
  when '최민기' then 'avatar-11'
  when '송지원' then 'avatar-01'
  when '조영아' then 'avatar-05'
  when '김다미' then 'avatar-03'
  else m.team_talk_avatar_key
end
from public.academies a
where a.id = m.academy_id
  and a.academy_code = 'VIVI-5578'
  and a.deleted_at is null
  and m.display_name in ('루루','최민기','송지원','조영아','김다미');
