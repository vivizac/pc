-- Isolated booking CI fixture for daily consultation push (no real devices).
create function public.olli_account_id_from_session(p_session_token text)
returns uuid language sql immutable as $f$
select case when p_session_token='fixture-owner' then '99999999-9999-4999-8999-999999999999'::uuid
else null::uuid end;$f$;
create table public.academy_members (
 id uuid primary key,academy_id uuid references public.academies(id),
 account_id uuid not null,role text not null,status text not null default 'active'
);
insert into public.academy_members(id,academy_id,account_id,role) values
 ('bbbbbbbb-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '99999999-9999-4999-8999-999999999999','owner'),
 ('bbbbbbbb-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '88888888-8888-4888-8888-888888888888','teacher'),
 ('bbbbbbbb-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 '77777777-7777-4777-8777-777777777777','owner');
create table public.olli_team_chat_push_subscriptions (
 id uuid primary key,academy_id uuid references public.academies(id),
 member_id uuid references public.academy_members(id),
 endpoint text not null,p256dh text not null,auth text not null,disabled_at timestamptz
);
insert into public.olli_team_chat_push_subscriptions
 (id,academy_id,member_id,endpoint,p256dh,auth)
values
 ('cccccccc-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-1111-4111-8111-111111111111','https://push.example/owner','testkey','testauth'),
 ('cccccccc-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-2222-4222-8222-222222222222','https://push.example/teacher','testkey','testauth');
