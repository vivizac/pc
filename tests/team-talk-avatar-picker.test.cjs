'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

const catalog=read('packages/common/olli-team-talk-avatar-catalog.js');
const mobileManifest=read('packages/common/mobile-runtime-manifest.json');
const pcManifest=read('packages/common/pc-runtime-manifest.json');
const mobileSettings=read('apps/mobile/olli-settings-team-talk-phone.js');
const mobileSettingsCss=read('apps/mobile/olli-settings-team-talk-phone.css');
const pcSettings=read('packages/common/olli-settings-team-talk-common.js');
const pcSettingsCss=read('packages/common/olli-settings-team-talk-common.css');
const mobileTalk=read('apps/mobile/olli-talk-beta.js');
const pcTalk=read('apps/pc/pc-team-talk.js');
const pcTalkCss=read('apps/pc/pc-team-talk.css');
const mobileHtml=read('apps/mobile/index.html');
const pcHtml=read('apps/pc/index.html');
const migration=read('supabase/migrations/20261008021500_team_talk_member_avatars.sql');

test('Team Chat exposes exactly 15 shared avatar assets to PC and mobile builds',()=>{
  assert.match(catalog,/Array\.from\(\{length:15\}/);
  assert.match(catalog,/team-talk-avatars\/.*\.webp/);
  for(let i=1;i<=15;i+=1){
    const key='avatar-'+String(i).padStart(2,'0');
    const asset='team-talk-avatars/'+key+'.webp';
    assert.match(mobileManifest,new RegExp(asset.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&')));
    assert.match(pcManifest,new RegExp(asset.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&')));
  }
  assert.match(mobileManifest,/olli-team-talk-avatar-catalog\.js/);
  assert.match(pcManifest,/olli-team-talk-avatar-catalog\.js/);
});

test('settings entry is Team Chat settings and avatar picker is available to every member',()=>{
  assert.match(mobileHtml,/id="settingsTeamTalkRow"/);
  assert.doesNotMatch(mobileHtml,/data-owner-manager-only="true" id="settingsTeamTalkRow"/);
  assert.match(mobileHtml,/settingsRowTitle">팀챗 설정</);
  assert.match(pcSettings,/settingsRowTitle">팀챗 설정</);
  assert.doesNotMatch(pcSettings,/data-owner-manager-only="true" id="settingsTeamTalkRow"/);
  for(const source of [mobileSettings,pcSettings]){
    assert.match(source,/아이콘 설정/);
    assert.match(source,/olliTeamTalkAvatarGrid/);
    assert.match(source,/olli_team_talk_avatar_get/);
    assert.match(source,/olli_team_talk_avatar_update/);
    assert.match(source,/title:'팀챗 설정'/);
    assert.match(source,/olliTeamTalkSelectAvatar/);
  }
  assert.match(mobileSettingsCss,/\.olliTeamTalkAvatarGrid/);
  assert.match(pcSettingsCss,/\.olliTeamTalkAvatarGrid/);
});

test('PC and mobile Team Chat render member avatar keys instead of name initials when catalog is available',()=>{
  assert.match(mobileTalk,/getOlliTalkMemberAvatarKey/);
  assert.match(mobileTalk,/item\?\.sender_member_id/);
  assert.match(mobileTalk,/OlliTeamTalkAvatars/);
  assert.match(mobileTalk,/hydrateOlliTalkMemberAvatars/);

  assert.match(pcTalk,/memberAvatarKey/);
  assert.match(pcTalk,/syncMemberAvatarElement\(avatar,item\?\.sender_member_id,senderName\)/);
  assert.match(pcTalk,/OlliTeamTalkAvatars/);
  assert.match(pcTalk,/hydrateMemberAvatars/);
  assert.match(pcTalkCss,/\.olliPcTeamTalkAvatar img/);
});

test('avatar persistence assigns random defaults globally and only seeds Vivizac requested members',()=>{
  assert.match(migration,/add column if not exists team_talk_avatar_key text/);
  assert.match(migration,/random\(\) \* 15/);
  assert.match(migration,/'avatar_key', m\.team_talk_avatar_key/);
  assert.match(migration,/create or replace function public\.olli_team_talk_avatar_get/);
  assert.match(migration,/create or replace function public\.olli_team_talk_avatar_update/);
  assert.match(migration,/a\.academy_name = '비비작아이성향미술학원'/);
  assert.match(migration,/when '루루' then 'avatar-13'/);
  assert.match(migration,/when '최민기' then 'avatar-11'/);
  assert.match(migration,/when '송지원' then 'avatar-01'/);
  assert.match(migration,/when '조영아' then 'avatar-05'/);
  assert.match(migration,/when '김다미' then 'avatar-03'/);
  assert.doesNotMatch(mobileSettings,/비비작아이성향미술학원|송지원|김다미|조영아/);
  assert.doesNotMatch(pcSettings,/비비작아이성향미술학원|송지원|김다미|조영아/);
});

test('avatar catalog is loaded before settings and Team Chat runtimes',()=>{
  const mobileCatalog=mobileHtml.indexOf('olli-team-talk-avatar-catalog.js');
  const mobileSettingsIndex=mobileHtml.indexOf('olli-settings-team-talk-phone.js');
  const mobileTalkIndex=mobileHtml.indexOf('olli-talk-beta.js');
  assert.ok(mobileCatalog>=0 && mobileCatalog<mobileSettingsIndex && mobileCatalog<mobileTalkIndex);

  const pcCatalog=pcHtml.indexOf('olli-team-talk-avatar-catalog.js');
  const pcSettingsIndex=pcHtml.indexOf('olli-settings-team-talk-common.js');
  const pcTalkIndex=pcHtml.indexOf('pc-team-talk.js');
  assert.ok(pcCatalog>=0 && pcCatalog<pcSettingsIndex && pcCatalog<pcTalkIndex);
});
