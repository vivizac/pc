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
test('PC and Phone use one shared thumbnail and media viewer implementation',()=>{
  const pc=load('apps/pc/pc-team-talk.js');
  const mobile=load('apps/mobile/olli-talk-beta.js');
  assert.match(pc,/mountUnifiedThumbnail\?\.\(attachment, thumb\)/);
  assert.match(pc,/openUnifiedMedia\(attachment\)/);
  assert.match(mobile,/mountUnifiedThumbnail\?\.\(attachment,frame\)/);
  assert.match(mobile,/openUnifiedMedia\(attachment\)/);
  assert.match(shared,/function openUnifiedMedia\(attachment\)/);
  assert.match(shared,/function closeUnifiedMedia\(\)/);
  assert.match(shared,/function reset\(\)\{closeUnifiedMedia\(\);/);
  for(const page of ['apps/pc/index.html','apps/mobile/index.html']){
    assert.match(load(page),/olli-shared-team-chat.css\?v=20261111-media-preview-1/);
  }
});
