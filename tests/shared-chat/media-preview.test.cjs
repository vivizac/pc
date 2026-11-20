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
  assert.ok(mobile.includes('OlliSharedTeamChat.fetchUnifiedBlob(attachment,{'));
  assert.match(mobile,/OlliSharedTeamChat\.downloadUnified\(attachment\)/);
  assert.match(mobile,/video\.src=url;video\.hidden=false;video\.load\(\)/);
  assert.doesNotMatch(shared,/openUnifiedMedia|closeUnifiedMedia|olliSharedMediaViewer/);
  assert.doesNotMatch(load('packages/common/olli-shared-team-chat.css'),/olliSharedMediaViewer|olliSharedMediaStage/);
  assert.match(load('apps/mobile/index.html'),/id="olliTalkPhotoViewerVideo"/);
  for(const page of ['apps/pc/index.html','apps/mobile/index.html']){
    assert.match(load(page),/olli-shared-team-chat.css\?v=20261112-unified-media-workhub-1/);
  }
});

test('Work Hub uses only current-room authorized shared attachments and never another academy legacy archive',async()=>{
  const academy='00000000-0000-0000-0000-000000000001',room='00000000-0000-0000-0000-000000000002';
  const store={olli_account_session_token_v1:'s',olli_current_academy_id:academy,olli_current_member_id:'member'};
  const localStorage={getItem:key=>store[key]||null};
  const doc={readyState:'loading',addEventListener(){}};
  const global={SUPABASE_URL:'https://test.supabase.co',SUPABASE_KEY:'anon',OlliStorageCore:{AcademyContext:{getCurrent:()=>({academyId:academy,memberId:'member',contextVersion:1})}},document:doc,localStorage,addEventListener(){}};
  const calls=[];
  async function mockFetch(url,init){
    calls.push({url,body:JSON.parse(init.body)});
    if(url.endsWith('_status'))return new Response(JSON.stringify({ok:true,enabled:true,room:{id:room,participation_id:'part'}}));
    if(url.endsWith('_list'))return new Response(JSON.stringify({ok:true,room_id:room,participation_id:'part',messages:[
      {id:13,seq:13,message_type:'file',file_name:'photo',created_at:'2026-11-11T01:00:00Z',attachment:{id:'image-id',file_name:'photo.jpeg',mime_type:'image/jpeg',file_size:50}},
      {id:14,seq:14,message_type:'file',attachment:{id:'video-id',file_name:'video.mov',mime_type:'video/quicktime'}},
      {id:15,seq:15,message_type:'file',attachment:{id:'document-id',file_name:'notes.pdf',mime_type:'application/pdf'}}
    ]}));
    throw new Error('Unexpected request');
  }
  vm.runInNewContext(shared,{window:global,document:doc,localStorage,fetch:mockFetch,Blob,Response,URL,setTimeout,clearTimeout});
  const archive=await global.OlliSharedTeamChat.archiveUnified({limit:1000});
  assert.equal(archive.joined,true);assert.equal(archive.messages.length,3);
  assert.deepEqual(Array.from(archive.messages,x=>x.attachment.kind),['media','media','file']);
  assert.equal(archive.messages.every(x=>x.attachment.is_shared),true);
  assert.equal(calls.every(x=>x.url.includes('/rpc/olli_shared_chat_')),true);
  assert.equal(calls.find(x=>x.url.endsWith('_list')).body.p_academy_id,academy);
});
test('both Work Hubs merge shared room files without persisting them in academy private cache',()=>{
  const pc=load('apps/pc/pc-team-talk.js'),mobile=load('apps/mobile/olli-talk-beta.js');
  assert.ok(pc.includes('OlliSharedTeamChat.archiveUnified({limit:1000})'));
  assert.ok(mobile.includes('OlliSharedTeamChat.archiveUnified({limit:1000})'));
  assert.ok(pc.includes('openSharedOriginalInBrowser(attachment)'));
  assert.ok(mobile.includes('mountUnifiedThumbnail?.(attachment,button)'));
  assert.ok(mobile.includes('writeOlliTalkArchiveCache(context,payload)'));
  assert.ok(!mobile.includes('writeOlliTalkArchiveCache(context,combined)'));
  assert.ok(mobile.includes('fetchUnifiedBlob(attachment,{'));
  assert.ok(mobile.includes('signal:controller.signal'));
});
test('local legacy photo deletion never persists unified-room records into an academy cache',()=>{
  const mobile=load('apps/mobile/olli-talk-beta.js');
  assert.ok(mobile.includes('messages:nextArchive.messages.filter(message=>!message?.is_shared&&!message?.attachment?.is_shared)'));
});

test('video cards in PC and mobile Team Chat and Work Hub retain a visible central play overlay',()=>{
  const service=load('packages/common/olli-shared-team-chat.js');
  const style=load('packages/common/olli-shared-team-chat.css');
  const pc=load('apps/pc/pc-team-talk.js'),mobile=load('apps/mobile/olli-talk-beta.js');
  assert.ok(service.includes("mime.startsWith('video/')&&!target.querySelector('.olliUnifiedVideoPlay')"));
  assert.ok(service.includes("play.setAttribute('aria-hidden','true')"));
  assert.ok(service.includes('target.append(play)'));
  assert.ok(style.includes('.olliUnifiedVideoPlay{position:absolute;left:50%;top:50%;'));
  assert.ok(style.includes('z-index:3'));
  assert.ok(style.includes('pointer-events:none'));
  assert.ok(pc.includes('mountUnifiedThumbnail?.(attachment, thumb)'));
  assert.ok(pc.includes('mountUnifiedThumbnail?.(attachment,button)'));
  assert.ok(mobile.includes('mountUnifiedThumbnail?.(attachment,frame)'));
  assert.ok(mobile.includes('mountUnifiedThumbnail?.(attachment,button)'));
});


test('a stalled media request times out, releases controls, and permits a clean retry',async()=>{
  const academy='00000000-0000-0000-0000-000000000001';
  const room='00000000-0000-0000-0000-000000000002';
  const store={olli_account_session_token_v1:'session',olli_current_academy_id:academy,olli_current_member_id:'member'};
  const localStorage={getItem:key=>store[key]||null};
  const doc={readyState:'loading',addEventListener(){}};
  const global={SUPABASE_URL:'https://test.supabase.co',SUPABASE_KEY:'anon',
    OlliStorageCore:{AcademyContext:{getCurrent:()=>({academyId:academy,memberId:'member',contextVersion:1})}},
    document:doc,localStorage,addEventListener(){}};
  let stall='status',aborts=0;
  async function mockFetch(url,init){
    if(stall==='status'&&String(url).endsWith('olli_shared_chat_status')
      ||stall==='file'&&String(url).startsWith('/api/shared-team-chat-file')){
      return new Promise((_,reject)=>{
        init.signal.addEventListener('abort',()=>{aborts++;reject(new Error('request aborted'));},{once:true});
      });
    }
    if(String(url).endsWith('olli_shared_chat_status'))
      return new Response(JSON.stringify({ok:true,enabled:true,room:{id:room}}));
    if(String(url).startsWith('/api/shared-team-chat-file'))
      return new Response(Uint8Array.from([1,2,3]));
    throw new Error('Unexpected URL '+url);
  }
  vm.runInNewContext(shared,{window:global,document:doc,localStorage,fetch:mockFetch,
    Blob,Response,URL,AbortController,DOMException,setTimeout,clearTimeout});
  const attachment={id:'00000000-0000-0000-0000-000000000004',mime_type:'image/jpeg'};
  await assert.rejects(
    ()=>global.OlliSharedTeamChat.fetchUnifiedBlob(attachment,{timeoutMs:15}),
    /다운로드가 지연되어 중단/
  );
  stall='file';
  await assert.rejects(
    ()=>global.OlliSharedTeamChat.fetchUnifiedBlob(attachment,{timeoutMs:15}),
    /다운로드가 지연되어 중단/
  );
  assert.equal(aborts,2,'both the authorization check and media transfer are abortable');
  stall='none';
  const blob=await global.OlliSharedTeamChat.fetchUnifiedBlob(attachment,{timeoutMs:100});
  assert.equal(blob.size,3,'failed downloads do not poison the next attempt');
});

test('a truncated unified image must fail even when HTTP status is 200',async()=>{
  const academy='00000000-0000-0000-0000-000000000001';
  const room='00000000-0000-0000-0000-000000000002';
  const store={olli_account_session_token_v1:'session',olli_current_academy_id:academy,olli_current_member_id:'member'};
  const localStorage={getItem:key=>store[key]||null};
  const doc={readyState:'loading',addEventListener(){}};
  const global={SUPABASE_URL:'https://test.supabase.co',SUPABASE_KEY:'anon',
    OlliStorageCore:{AcademyContext:{getCurrent:()=>({academyId:academy,memberId:'member',contextVersion:1})}},
    document:doc,localStorage,addEventListener(){}};
  async function mockFetch(url){
    if(String(url).endsWith('olli_shared_chat_status'))
      return new Response(JSON.stringify({ok:true,enabled:true,room:{id:room}}));
    if(String(url).startsWith('/api/shared-team-chat-file'))
      return new Response(Uint8Array.from([1,2,3]));
    throw new Error('Unexpected request');
  }
  vm.runInNewContext(shared,{window:global,document:doc,localStorage,fetch:mockFetch,
    Blob,Response,URL,AbortController,DOMException,setTimeout,clearTimeout});
  await assert.rejects(()=>global.OlliSharedTeamChat.fetchUnifiedBlob({
    id:'00000000-0000-0000-0000-000000000004',mime_type:'image/jpeg',file_size:4
  }),/파일 전송 크기가 일치하지 않습니다/);
});
test('concurrent verified status reads share one request; failed status is never joined:false',async()=>{
  const academy='00000000-0000-0000-0000-000000000001';
  const room='00000000-0000-0000-0000-000000000002';
  const store={olli_account_session_token_v1:'session',olli_current_academy_id:academy,olli_current_member_id:'member'};
  const localStorage={getItem:key=>store[key]||null};
  const doc={readyState:'loading',addEventListener(){}};
  const global={SUPABASE_URL:'https://test.supabase.co',SUPABASE_KEY:'anon',
    OlliStorageCore:{AcademyContext:{getCurrent:()=>({academyId:academy,memberId:'member',contextVersion:1})}},
    document:doc,localStorage,addEventListener(){}};
  let statusCalls=0,fail=false;
  async function mockFetch(url){
    if(String(url).endsWith('olli_shared_chat_status')){
      statusCalls++;
      if(fail)throw new Error('status unavailable');
      return new Response(JSON.stringify({ok:true,enabled:true,room:{id:room,participation_id:'part'}}));
    }
    if(String(url).endsWith('olli_shared_chat_list'))
      return new Response(JSON.stringify({ok:true,room_id:room,participation_id:'part',messages:[]}));
    if(String(url).endsWith('olli_shared_chat_members'))
      return new Response(JSON.stringify({ok:true,members:[]}));
    throw new Error('Unexpected URL '+url);
  }
  vm.runInNewContext(shared,{window:global,document:doc,localStorage,fetch:mockFetch,
    Blob,Response,URL,setTimeout,clearTimeout});
  const [messages,members]=await Promise.all([
    global.OlliSharedTeamChat.unifiedExtension({messages:true}),
    global.OlliSharedTeamChat.unifiedExtension({members:true})
  ]);
  assert.equal(statusCalls,1,'one concurrent authorized status lookup');
  assert.equal(messages.joined,true);assert.equal(members.joined,true);
  fail=true;
  await assert.rejects(()=>global.OlliSharedTeamChat.unifiedExtension({messages:true}),/status unavailable/);
});
test('thumbnail original requests are deduplicated in-memory and cleared on context change',()=>{
  assert.match(shared,/const unifiedThumbnailLoads=new Map\(\)/);
  assert.match(shared,/const cached=unifiedThumbnailLoads\.get\(id\)/);
  assert.match(shared,/const request=fetchUnifiedBlob\(attachment\)/);
  assert.match(shared,/while\(unifiedThumbnailLoads\.size>4\)/);
  assert.match(shared,/if\(unifiedThumbnailScope!==scope\)/);
  assert.match(shared,/const blob=await fetchUnifiedThumbnailBlob\(attachment\)/);
  assert.doesNotMatch(shared,/localStorage\.setItem\([^)]*unifiedThumbnail/);
});
