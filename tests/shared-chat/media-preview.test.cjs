'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const load=name=>fs.readFileSync(path.join(root,name),'utf8');
const shared=load('packages/common/olli-shared-team-chat.js');
test('shared media fetch is authorized through the common broker, never the legacy file API',async()=>{
  const academy='00000000-0000-0000-0000-000000000001';
  const room='00000000-0000-0000-0000-000000000002';
  const id='00000000-0000-0000-0000-000000000004';
  const calls=[];
  let joined=true;
  const store={olli_account_session_token_v1:'session',olli_current_academy_id:academy,olli_current_member_id:'member'};
  const localStorage={getItem:key=>store[key]||null};
  const doc={readyState:'loading',addEventListener(){}};
  const global={
    SUPABASE_URL:'https://test.supabase.co',SUPABASE_KEY:'test-public',
    OlliStorageCore:{AcademyContext:{getCurrent:()=>({academyId:academy,memberId:'member',contextVersion:1})}},
    addEventListener(){},document:doc,localStorage
  };
  async function mockFetch(url,init){
    calls.push({url,init});
    if(String(url).includes('/rpc/olli_shared_chat_status')){
      return new Response(JSON.stringify({ok:true,enabled:true,room:joined?{id:room}:null}),{headers:{'Content-Type':'application/json'}});
    }
    if(String(url).startsWith('/api/shared-team-chat-file')){
      return new Response(Uint8Array.from([255,216,255,217]),{headers:{'Content-Type':'application/octet-stream'}});
    }
    throw new Error('Unexpected URL: '+url);
  }
  vm.runInNewContext(shared,{window:global,document:doc,localStorage,fetch:mockFetch,Blob,Response,URL,setTimeout,clearTimeout});
  const media={id,is_shared:true,mime_type:'image/jpeg',file_name:'test.jpg'};
  const blob=await global.OlliSharedTeamChat.fetchUnifiedBlob(media);
  assert.equal(blob.type,'image/jpeg');
  assert.equal(blob.size,4);
  assert.equal(calls.filter(c=>c.url.startsWith('/api/shared-team-chat-file')).length,1);
  assert.equal(calls.some(c=>String(c.url).includes('/api/team-talk-file?')),false);
  const request=calls.find(c=>c.url.startsWith('/api/shared-team-chat-file'));
  assert.equal(request.init.headers['X-Olli-Room-Id'],room);
  assert.equal(request.init.headers['X-Olli-Academy-Id'],academy);
  assert.equal(request.init.headers['X-Olli-Session-Token'],'session');
  joined=false;calls.length=0;
  await assert.rejects(()=>global.OlliSharedTeamChat.fetchUnifiedBlob(media),/참여하지 않습니다/);
  assert.equal(calls.filter(c=>c.url.startsWith('/api/shared-team-chat-file')).length,0);
});
test('shared thumbnails keep working while the original phone viewer is reused and the duplicate popup is removed',()=>{
  const pc=load('apps/pc/pc-team-talk.js');
  const mobile=load('apps/mobile/olli-talk-beta.js');
  assert.match(pc,/mountUnifiedThumbnail\?\.\(attachment, thumb\)/);
  assert.match(pc,/openSharedOriginalInBrowser\(attachment\)/);
  assert.match(mobile,/mountUnifiedThumbnail\?\.\(attachment,frame\)/);
  assert.match(mobile,/openOlliTalkPhotoViewer\(item,\{source:'chat'\}\)/);
  assert.match(mobile,/OlliSharedTeamChat\.fetchUnifiedBlob\(attachment\)/);
  assert.match(mobile,/OlliSharedTeamChat\.downloadUnified\(attachment\)/);
  assert.match(mobile,/video\.src=url;video\.hidden=false;video\.load\(\)/);
  assert.doesNotMatch(shared,/openUnifiedMedia|closeUnifiedMedia|olliSharedMediaViewer/);
  assert.doesNotMatch(load('packages/common/olli-shared-team-chat.css'),/olliSharedMediaViewer|olliSharedMediaStage/);
  assert.match(load('apps/mobile/index.html'),/id="olliTalkPhotoViewerVideo"/);
  for(const page of ['apps/pc/index.html','apps/mobile/index.html']){
    assert.match(load(page),/olli-shared-team-chat.css\?v=20261112-unified-media-workhub-1/);
  }
});
\ntest('Work Hub uses only current-room authorized shared attachments and never another academy legacy archive',async()=>{\n  const academy='00000000-0000-0000-0000-000000000001',room='00000000-0000-0000-0000-000000000002';\n  const store={olli_account_session_token_v1:'s',olli_current_academy_id:academy,olli_current_member_id:'member'};\n  const localStorage={getItem:key=>store[key]||null};\n  const doc={readyState:'loading',addEventListener(){}};\n  const global={SUPABASE_URL:'https://test.supabase.co',SUPABASE_KEY:'anon',OlliStorageCore:{AcademyContext:{getCurrent:()=>({academyId:academy,memberId:'member',contextVersion:1})}},document:doc,localStorage,addEventListener(){}};\n  const calls=[];\n  async function mockFetch(url,init){\n    calls.push({url,body:JSON.parse(init.body)});\n    if(url.endsWith('_status'))return new Response(JSON.stringify({ok:true,enabled:true,room:{id:room,participation_id:'part'}}));\n    if(url.endsWith('_list'))return new Response(JSON.stringify({ok:true,room_id:room,participation_id:'part',messages:[\n      {id:13,seq:13,message_type:'file',file_name:'photo',created_at:'2026-11-11T01:00:00Z',attachment:{id:'image-id',file_name:'photo.jpeg',mime_type:'image/jpeg',file_size:50}},\n      {id:14,seq:14,message_type:'file',attachment:{id:'video-id',file_name:'video.mov',mime_type:'video/quicktime'}},\n      {id:15,seq:15,message_type:'file',attachment:{id:'document-id',file_name:'notes.pdf',mime_type:'application/pdf'}}\n    ]}));\n    throw new Error('Unexpected request');\n  }\n  vm.runInNewContext(shared,{window:global,document:doc,localStorage,fetch:mockFetch,Blob,Response,URL,setTimeout,clearTimeout});\n  const archive=await global.OlliSharedTeamChat.archiveUnified({limit:1000});\n  assert.equal(archive.joined,true);assert.equal(archive.messages.length,3);\n  assert.deepEqual(Array.from(archive.messages,x=>x.attachment.kind),['media','media','file']);\n  assert.equal(archive.messages.every(x=>x.attachment.is_shared),true);\n  assert.equal(calls.every(x=>x.url.includes('/rpc/olli_shared_chat_')),true);\n  assert.equal(calls.find(x=>x.url.endsWith('_list')).body.p_academy_id,academy);\n});\ntest('both Work Hubs merge shared room files without persisting them in academy private cache',()=>{\n  const pc=load('apps/pc/pc-team-talk.js'),mobile=load('apps/mobile/olli-talk-beta.js');\n  assert.match(pc,/archiveUnified\\?\\.\\(\\{limit:1000\\}\\)/);\n  assert.match(mobile,/archiveUnified\\?\\.\\(\\{limit:1000\\}\\)/);\n  assert.match(pc,/attachment\\.is_shared[\\s\\S]*openSharedOriginalInBrowser\\(attachment\\)/);\n  assert.match(mobile,/attachment\\.is_shared[\\s\\S]*mountUnifiedThumbnail\\?\\.\\(attachment,button\\)/);\n  assert.match(mobile,/writeOlliTalkArchiveCache\\(context,payload\\)/);\n  assert.doesNotMatch(mobile,/writeOlliTalkArchiveCache\\(context,combined\\)/);\n  assert.match(mobile,/OlliSharedTeamChat\\.fetchUnifiedBlob\\(attachment,\\{[\\s\\S]*signal:controller\\.signal/);\n});\n
test('local legacy photo deletion never persists unified-room records into an academy cache',()=>{\n  const mobile=load('apps/mobile/olli-talk-beta.js');\n  assert.match(mobile,/writeOlliTalkArchiveCache\\(context,\\{[\\s\\S]*messages:nextArchive\\.messages\\.filter\\(message=>!message\\?\\.is_shared&&!message\\?\\.attachment\\?\\.is_shared\\)/);\n});\n