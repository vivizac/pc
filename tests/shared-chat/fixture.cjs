const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function createDB(){
  const db=new PGlite();
  await db.exec(`create schema private; create schema storage; create schema realtime;
    create role anon; create role authenticated; create role service_role;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.academies(id uuid primary key,academy_name text,status text,deleted_at timestamptz);
    create table public.academy_members(id uuid primary key,academy_id uuid references public.academies(id),
      account_id uuid,status text,role text,display_name text,created_at timestamptz default now(),team_talk_avatar_key text);
    create table private.test_sessions(token text primary key,account_id uuid,active boolean default true);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(bucket_id text);alter table storage.objects enable row level security;
    create table public.olli_team_chat_push_subscriptions(id uuid primary key,academy_id uuid,member_id uuid,endpoint text,p256dh text,auth text,disabled_at timestamptz);
    create function public.olli_account_id_from_session(token text) returns uuid language sql stable security definer set search_path='' as
      $$select account_id from private.test_sessions where test_sessions.token=$1 and active$$;
    create table public.olli_schedule_sync_revisions(academy_id uuid,version bigint);
    create table public.student_note_drafts(academy_id uuid,revision bigint);
    create table private.test_signals(payload jsonb,event text,topic text,is_private boolean);
    create function realtime.send(jsonb,text,text,boolean) returns void language sql as
      $$insert into private.test_signals values($1,$2,$3,$4)$$;`);
  for(let n=1;n<=4;n++)await db.query('insert into public.academies values($1,$2,\'active\',null)',[uid(n),'학원'+n]);
  for(const [n,school,acct,role,name] of [[1,1,1,'owner','원장'],[2,2,1,'owner','원장'],[3,3,1,'owner','원장'],
    [4,1,2,'teacher','동명이인'],[5,2,3,'teacher','동명이인'],[6,3,4,'teacher','세번째'],[7,4,5,'owner','외부'],
    [8,2,2,'teacher','동명이인'],[9,1,6,'manager','관리자']]){
    await db.query('insert into public.academy_members(id,academy_id,account_id,status,role,display_name) values($1,$2,$3,\'active\',$4,$5)',[uid(200+n),uid(school),uid(100+acct),role,name]);
  }
  for(const [token,id] of [['owner',1],['teacherA',2],['teacherB',3],['teacherC',4],['outsider',5],['manager',6]])
    await db.query('insert into private.test_sessions(token,account_id) values($1,$2)',[token,uid(100+id)]);
  for(const migration of ['20260911111500_olli_realtime_signal_channels.sql','20261106055458_team_chat_shared_rooms.sql']){
    await db.exec(readFileSync(join(__dirname,'../../supabase/migrations',migration),'utf8'));
  }
  return db;
}
module.exports={createDB,uid};
