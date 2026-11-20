'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {makeHandler}=require('../../apps/mobile/api/_lib/shared-team-chat-files.cjs');

const ROOT=path.resolve(__dirname,'../..');
const UUID='00000000-0000-0000-0000-000000000001';
const FILE_PATH=[UUID,UUID,UUID].join('/');
const ORIGIN='https://test.supabase.co';
function mockResponse(){
  return {
    headersSent:false,statusCode:200,headers:{},bytes:[],ended:false,destroyed:false,
    setHeader(key,value){this.headers[key.toLowerCase()]=value;},
    status(value){this.statusCode=value;return this;},
    json(value){this.body=value;this.ended=true;return this;},
    write(value){this.headersSent=true;this.bytes.push(...value);return true;},
    end(value){if(value)this.bytes.push(...value);this.ended=true;return this;},
    destroy(){this.destroyed=true;this.headersSent=true;}
  };
}
function request(){
  return {method:'GET',query:{attachmentId:UUID},headers:{
    'x-olli-session-token':'mock-session',
    'x-olli-academy-id':UUID,
    'x-olli-room-id':UUID,
    'x-vercel-id':'test-trace'
  }};
}
function fakeStorage(bytes){
  const calls=[];
  const fetchImpl=async (url,options={})=>{
    calls.push({url,method:options.method});
    if(url.includes('/rpc/olli_shared_chat_file_access')){
      return new Response(JSON.stringify({
        ok:true,storage_path:FILE_PATH,file_name:'photo.jpeg',
        mime_type:'image/jpeg',file_size:4
      }));
    }
    if(url.includes('/storage/v1/object/sign/')&&options.method==='POST'){
      return new Response(JSON.stringify({
        signedURL:'/object/sign/olli_shared_chat_files/'+FILE_PATH+'?token=mock-token'
      }));
    }
    if(url.includes('/storage/v1/object/sign/')&&!options.method){
      return new Response(Uint8Array.from(bytes));
    }
    throw new Error('Unexpected storage request: '+url);
  };
  return {calls,fetchImpl};
}
test('shared file broker transfers the exact authorized image bytes',async()=>{
  const storage=fakeStorage([1,2,3,4]);
  const handler=makeHandler({base:ORIGIN,key:()=> 'mock-service-key',fetchImpl:storage.fetchImpl});
  const res=mockResponse();
  await handler(request(),res);
  assert.equal(res.ended,true);
  assert.equal(res.destroyed,false);
  assert.equal(res.bytes.length,4);
  assert.equal(Number(res.headers['content-length']),4);
  assert.equal(storage.calls.filter(call=>call.url.includes('file_access')).length,2,'authorization must be rechecked after fetching the object');
});
test('shared file broker cannot report a truncated 200 image as success',async()=>{
  const storage=fakeStorage([1,2,3]);
  const handler=makeHandler({base:ORIGIN,key:()=> 'mock-service-key',fetchImpl:storage.fetchImpl});
  const res=mockResponse();
  await handler(request(),res);
  assert.equal(res.destroyed,true,'the partial stream must be aborted');
  assert.equal(res.ended,false,'the partial stream must not be marked complete');
  assert.equal(res.bytes.length,3);
});
function pcHandler(fakeFetch){
  const source=fs.readFileSync(path.join(ROOT,'apps/pc/api/shared-team-chat-file.js'),'utf8');
  return new Function('process','fetch','URL','Buffer','console',
    source.replace('export default async function handler','return async function handler')
  )({env:{OLLI_SHARED_CHAT_FILE_SERVER_URL:ORIGIN+'/api/shared-team-chat-file'}},
    fakeFetch,URL,Buffer,{error(){}});
}
test('PC relay verifies the complete media response',async()=>{
  const res=mockResponse();
  await pcHandler(async()=>new Response(Uint8Array.from([1,2,3,4]),{
    headers:{'Content-Length':'4'}
  }))(request(),res);
  assert.equal(res.ended,true);
  assert.equal(res.destroyed,false);
  assert.equal(res.bytes.length,4);
});
test('PC relay aborts a truncated transfer rather than completing it',async()=>{
  const res=mockResponse();
  await pcHandler(async()=>new Response(Uint8Array.from([1,2,3]),{
    headers:{'Content-Length':'4'}
  }))(request(),res);
  assert.equal(res.destroyed,true);
  assert.equal(res.ended,false);
  assert.equal(res.bytes.length,3);
});
