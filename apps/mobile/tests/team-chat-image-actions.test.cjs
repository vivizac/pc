const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');

const beta=fs.readFileSync('olli-talk-beta.js','utf8');
const api=fs.readFileSync('api/team-talk-file.js','utf8');
const cache=fs.readFileSync('olli-talk-attachment-cache-phone.js','utf8');
const css=fs.readFileSync('olli-talk-beta.css','utf8');
const html=fs.readFileSync('index.html','utf8');
const deleteMigration=fs.readFileSync('supabase/migrations/20260924161103_team_chat_delete_attachment.sql','utf8');

test('Team Chat photo opens a dedicated original-photo page instead of an action sheet',()=>{
  assert.match(beta,/frame\.addEventListener\('click',[\s\S]*openOlliTalkPhotoViewer\(item,\{source:'chat'\}\)/);
  assert.match(beta,/openOlliTalkPhotoViewer\(item,\{source:'archive'\}\)/);
  assert.doesNotMatch(beta,/openOlliTalkImageActions/);
  assert.doesNotMatch(css,/\.olliTalkImageActionBackdrop/);
  assert.match(html,/id="olliTalkPhotoViewerScreen"/);
  assert.match(html,/id="olliTalkPhotoViewerSender"/);
  assert.match(html,/id="olliTalkPhotoViewerDate"/);
  assert.match(html,/id="olliTalkPhotoViewerSaveBtn"/);
  assert.match(html,/id="olliTalkPhotoViewerDeleteBtn"/);
  assert.match(html,/viewbox="0 0 94 94"/);
  assert.match(html,/M23\.5 29\.5H80\.5/);
  assert.match(html,/M29\.5 30V68C29\.5 72\.7 33\.3 76\.5 37 76\.5H67C70\.7 76\.5 74\.5 72\.7 74\.5 68V30/);
  assert.match(css,/\.olliTalkPhotoViewerActionBtn\.delete\{color:#fff\}/);
  assert.match(css,/\.olliTalkPhotoViewerActionBtn\.delete svg\{width:27px;height:27px;stroke-width:1\.9\}/);
});

test('original-photo viewer loads original, saves there, and routes the top-right button to Photo Review',()=>{
  const start=beta.indexOf('async function hydrateOlliTalkPhotoViewer');
  const end=beta.indexOf('function isOlliTalkImageAttachment',start);
  const body=beta.slice(start,end);
  assert.match(body,/getOlliTalkAttachmentBlobUrl\(attachment\)/);
  assert.match(body,/downloadOlliTalkAttachment\(attachment\)/);
  assert.match(body,/openOlliTalkArchivePage\(null,\{tab:'media'\}\)/);
  assert.match(html,/aria-label="포토리뷰로 이동"/);
});

test('photo deletion remains server-first and local/cache cleanup follows success',()=>{
  const start=beta.indexOf('async function deleteOlliTalkImageItem');
  const end=beta.indexOf('function formatOlliTalkPhotoViewerDate',start);
  const body=beta.slice(start,end);
  const server=body.indexOf("callOlliTalkFileApi('delete'");
  assert.ok(server>=0);
  assert.ok(body.indexOf('purgeOlliTalkAttachmentCaches')>server);
  assert.ok(body.indexOf('removeOlliTalkImageMessageLocally')>server);
  assert.match(cache,/async function removeAttachment\(input\)/);
});

test('server still protects delete permissions and blocks reads after soft delete',()=>{
  assert.match(api,/if\(action==='delete'\)/);
  assert.match(api,/olli_team_chat_delete_attachment/);
  assert.match(api,/deleted_at:'is\.null'/);
  assert.match(api,/삭제된 사진입니다/);
  assert.match(deleteMigration,/v_member\.role not in \('owner','manager'\)/);
  assert.match(deleteMigration,/uploaded_by_member_id is distinct from v_member\.id/);
  assert.match(deleteMigration,/deleted_at = now\(\)/);
});
