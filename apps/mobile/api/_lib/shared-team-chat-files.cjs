'use strict';
const DEFAULT_BASE='https://fvkxipjwgeyosgnfhdnx.supabase.co';
const BUCKET='olli_shared_chat_files';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=value=>String(Array.isArray(value)?value[0]:value||'').trim();
function credentials(key){return {apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{})};}
function objectUrl(path,base){
  if(!/^[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+$/i.test(path))throw new Error('Invalid object path');
  return `${base}/storage/v1/object/authenticated/${BUCKET}/${path}`;
}
function makeHandler({fetchImpl=globalThis.fetch,base=process.env.OLLI_SHARED_CHAT_SUPABASE_URL||DEFAULT_BASE,key=()=>process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||''}={}){
  const BASE=String(base).replace(/\/+$/,'');
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store, private');res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
    const serverKey=key();if(!serverKey)return res.status(503).json({error:'첨부 서버가 준비되지 않았습니다.'});
    const session=clean(req.headers['x-olli-session-token']),academy=clean(req.headers['x-olli-academy-id']),room=clean(req.headers['x-olli-room-id']);
    if(!session||session.length>4096||!UUID.test(academy)||!UUID.test(room))return res.status(400).json({error:'로그인 및 학원 정보가 필요합니다.'});
    const base={p_session_token:session,p_academy_id:academy,p_room_id:room};
    const headers=credentials(serverKey);
    async function rpc(name,params){
      const response=await fetchImpl(`${BASE}/rest/v1/rpc/olli_shared_chat_${name}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(params),redirect:'error'});
      const data=await response.json();if(!response.ok||data?.ok!==true)throw new Error('Access denied');return data;
    }
    try{
      if(req.method==='GET'){
        const id=clean(req.query?.attachmentId);if(!UUID.test(id))return res.status(400).json({error:'첨부파일 ID가 필요합니다.'});
        const file=await rpc('file_access',{...base,p_attachment_id:id,p_upload:false});
        const upstream=await fetchImpl(objectUrl(file.storage_path,BASE),{headers,redirect:'error'});
        if(!upstream.ok)throw new Error('Object unavailable');
        // Recheck after storage fetch; a leave/deletion may have happened in between.
        try{await rpc('file_access',{...base,p_attachment_id:id,p_upload:false});}
        catch(error){await upstream.body?.cancel?.();throw error;}
        res.setHeader('Content-Type','application/octet-stream');
        res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.file_name));
        if(upstream.body?.getReader){
          const reader=upstream.body.getReader();
          try{while(true){const {value,done}=await reader.read();if(done)break;res.write(Buffer.from(value));}}
          finally{reader.releaseLock();}
          return res.end();
        }
        return res.end(Buffer.from(await upstream.arrayBuffer()));
      }
      const body=req.body;
      if(!body||typeof body!=='object'||Buffer.byteLength(JSON.stringify(body))>65536)return res.status(400).json({error:'요청 형식이 올바르지 않습니다.'});
      if(body.action==='prepare'){
        const name=clean(body.file_name).replace(/[\\/\u0000-\u001f\u007f]/g,'_').slice(0,180);
        if(!name||!Number.isInteger(body.file_size)||body.file_size<1||body.file_size>20971520)return res.status(400).json({error:'파일은 20MB 이하만 가능합니다.'});
        const file=await rpc('file_prepare',{...base,p_file_name:name,p_mime_type:clean(body.mime_type)||'application/octet-stream',p_file_size:body.file_size});
        objectUrl(file.storage_path,BASE); // Validate server-returned path before minting upload capability.
        const response=await fetchImpl(`${BASE}/storage/v1/object/upload/sign/${BUCKET}/${file.storage_path}`,{
          method:'POST',headers:{...headers,'Content-Type':'application/json','x-upsert':'false'},body:'{}',redirect:'error'
        });
        const signed=await response.json();if(!response.ok||!signed.url)throw new Error('Upload unavailable');
        const uploadUrl=new URL(signed.url,BASE+'/storage/v1/');
        // Storage returns /object/upload/sign/... relative to /storage/v1.
        if(String(signed.url).startsWith('/object/'))uploadUrl.pathname='/storage/v1'+uploadUrl.pathname;
        if(uploadUrl.origin!==BASE||!uploadUrl.pathname.startsWith('/storage/v1/object/upload/sign/'+BUCKET+'/'))throw new Error('Invalid upload URL');
        return res.status(200).json({ok:true,attachment_id:file.attachment_id,upload_url:uploadUrl.href});
      }
      if(body.action==='commit'){
        const id=clean(body.attachment_id);if(!UUID.test(id))return res.status(400).json({error:'첨부파일 ID가 필요합니다.'});
        const file=await rpc('file_access',{...base,p_attachment_id:id,p_upload:true});
        if(file.message_id)return res.status(200).json({ok:true,message_id:file.message_id});
        const uploaded=await fetchImpl(objectUrl(file.storage_path,BASE),{method:'HEAD',headers,redirect:'error'});
        const bytes=Number(uploaded.headers.get('content-length'));
        if(!uploaded.ok||!Number.isInteger(bytes)||bytes!==Number(file.file_size))throw new Error('Upload size mismatch');
        const result=await rpc('file_commit',{...base,p_attachment_id:id,p_reply_to_message_id:body.reply_to_message_id||null,
          p_member_ids:Array.isArray(body.p_member_ids)?body.p_member_ids:[],p_mention_all:body.p_mention_all===true});
        return res.status(200).json(result);
      }
      return res.status(400).json({error:'알 수 없는 요청입니다.'});
    }catch(_){if(!res.headersSent)return res.status(403).json({error:'첨부파일 권한 또는 업로드 상태를 확인해 주세요.'});res.end();}
  };
}
module.exports={makeHandler,credentials};
