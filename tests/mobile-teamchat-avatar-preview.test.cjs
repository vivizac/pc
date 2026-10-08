'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const talk=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');

test('Team Chat avatar check messages stay visual-only and reuse the real member renderer',()=>{
  assert.match(talk,/const OLLI_TALK_AVATAR_PREVIEW_ENABLED = true/);
  assert.match(talk,/function renderOlliTalkAvatarPreviewMessages\(\)/);
  assert.match(talk,/createOlliTalkMessageGroupElement\(item,OLLI_TALK_AVATAR_PREVIEW_MEMBER_ID\)/);
  assert.match(talk,/appendOlliTalkMessageToGroup\(group,item,OLLI_TALK_AVATAR_PREVIEW_MEMBER_ID\)/);
  assert.match(talk,/body:'아이콘 확인용 메시지입니다\.'/);
  assert.match(talk,/Promise\.allSettled\(\[memberLoadPromise,messageLoadPromise\]\)/);
  assert.match(talk,/group\.dataset\.olliAvatarPreview='1'/);
  assert.ok(html.includes('olli-talk-beta.js?v=20261008-scroll-authority-1'));
});

test('Team Chat member icon artwork fills its clipped avatar tile without resizing the tile',()=>{
  const tile=css.match(/#olliTalkBetaScreen \.olliTalkBetaMemberAvatar\{([\s\S]*?)\}/)?.[1] || '';
  const image=css.match(/#olliTalkBetaScreen \.olliTalkBetaMemberAvatar img\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(tile,/overflow:hidden/);
  assert.match(image,/object-fit:cover/);
  assert.match(image,/transform:scale\(1\.18\)/);
  assert.match(image,/transform-origin:center/);
  assert.match(html,/olli-talk-beta\.css\?v=20261008-avatar-zoom-1/);
});
