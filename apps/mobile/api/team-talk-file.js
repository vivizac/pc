import { randomUUID } from 'node:crypto';

const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const STORAGE_BASE = `${SUPABASE_URL}/storage/v1`;
const BUCKET = 'team_talk_files';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

export const config = { api: { bodyParser:false } };

function getServerKey(){
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}
function headerValue(value){
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}
function encodePath(value){
  return String(value || '').split('/').map(encodeURIComponent).join('/');
}
function safeFileName(value){
  const cleaned=String(value||'').trim().replace(/[\\/]+/g,'_').replace(/[\u0000-\u001f\u007f]+/g,'');
  return (cleaned||'file').slice(0,180);
}
function safeKind(value){
  return String(value||'').toLowerCase()==='media' ? 'media' : 'file';
}
function assertUploadSize(value){
  const size=Number(value||0);
  if(!Number.isFinite(size)||size<1) throw new Error('파일 크기가 올바르지 않습니다.');
  if(size>MAX_FILE_BYTES) throw new Error('파일은 20MB 이하만 올릴 수 있습니다.');
  return Math.round(size);
}
function assertThumbnailSize(value){
  const size=Number(value||0);
  if(!Number.isFinite(size)||size<1||size>MAX_THUMBNAIL_BYTES) throw new Error('썸네일 크기가 올바르지 않습니다.');
  return Math.round(size);
}
function safeThumbnailMime(value){
  const mime=String(value||'').trim().toLowerCase();
  if(mime==='image/webp'||mime==='image/jpeg')return mime;
  throw new Error('썸네일 형식이 올바르지 않습니다.');
}
function safeImageDimension(value){
  const size=Math.round(Number(value||0));
  return Number.isFinite(size)&&size>0&&size<=50000?size:null;
}
async function rpc(name,body,key){
  const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{
    method:'POST',
    headers:{'Content-Type':'application/json',apikey:key,Authorization:`Bearer ${key}`},
    body:JSON.stringify(body)
  });
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={message:raw}}
  if(!response.ok) throw new Error(data?.message||data?.error||'Supabase 요청에 실패했습니다.');
  return data;
}
async function authorize(sessionToken,academyId,key){
  if(!sessionToken||!academyId) throw new Error('로그인 정보가 없습니다.');
  const result=await rpc('olli_team_chat_members',{p_session_token:sessionToken,p_academy_id:academyId},key);
  if(!result?.ok||!result?.current_member_id) throw new Error('팀톡 접근 권한이 없습니다.');
}
async function readJson(req){
  const chunks=[];let total=0;
  for await(const chunk of req){
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    total+=buffer.length;
    if(total>MAX_JSON_BYTES) throw new Error('요청 데이터가 너무 큽니다.');
    chunks.push(buffer);
  }
  const raw=Buffer.concat(chunks).toString('utf8');
  if(!raw) return {};
  try{return JSON.parse(raw)}catch{throw new Error('요청 형식이 올바르지 않습니다.')}
}
async function cleanup(path,key){
  if(!path)return;
  try{
    await fetch(`${STORAGE_BASE}/object/${BUCKET}/${encodePath(path)}`,{
      method:'DELETE',headers:{apikey:key,Authorization:`Bearer ${key}`}
    });
  }catch(_){}
}
async function deleteStoredObject(path,bucket,key){
  if(!path)return true;
  if(String(bucket||BUCKET)!==BUCKET)return false;
  try{
    const response=await fetch(`${STORAGE_BASE}/object/${BUCKET}/${encodePath(path)}`,{
      method:'DELETE',headers:{apikey:key,Authorization:`Bearer ${key}`}
    });
    return response.ok||response.status===404;
  }catch(_){return false}
}
function assertAcademyPath(path,academyId){
  const value=String(path||'').trim();
  if(!value||!value.startsWith(String(academyId||'')+'/')) throw new Error('파일 저장 경로가 올바르지 않습니다.');
  return value;
}
function assertThumbnailPath(path,academyId){
  const value=assertAcademyPath(path,academyId);
  if(!value.startsWith(String(academyId||'')+'/thumb/')) throw new Error('썸네일 저장 경로가 올바르지 않습니다.');
  return value;
}
async function patchAttachmentThumbnail(attachmentId,academyId,metadata,key){
  const id=Number(attachmentId||0);
  if(!id)return false;
  const response=await fetch(
    `${SUPABASE_URL}/rest/v1/olli_team_chat_attachments?id=eq.${encodeURIComponent(id)}&academy_id=eq.${encodeURIComponent(academyId)}`,
    {
      method:'PATCH',
      headers:{
        'Content-Type':'application/json',
        apikey:key,
        Authorization:`Bearer ${key}`,
        Prefer:'return=minimal'
      },
      body:JSON.stringify(metadata)
    }
  );
  if(!response.ok){
    const raw=await response.text().catch(()=>'');
    throw new Error(raw||'썸네일 정보를 저장하지 못했습니다.');
  }
  return true;
}
async function createSignedUpload(objectPath,key){
  const response=await fetch(`${STORAGE_BASE}/object/upload/sign/${BUCKET}/${encodePath(objectPath)}`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:key,
      Authorization:`Bearer ${key}`,
      'x-upsert':'false'
    },
    body:'{}'
  });
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={message:raw}}
  if(!response.ok) throw new Error(data?.message||data?.error||'업로드 주소를 만들지 못했습니다.');
  const signedPath=String(data?.url||'').trim();
  if(!signedPath) throw new Error('업로드 주소가 비어 있습니다.');
  return signedPath.startsWith('http')
    ? signedPath
    : STORAGE_BASE+(signedPath.startsWith('/')?'':'/')+signedPath;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const key=getServerKey();
  if(!key)return res.status(500).json({error:'Supabase 서버 키가 설정되지 않았습니다.'});

  const sessionToken=headerValue(req.headers['x-olli-session-token']);
  const academyId=headerValue(req.headers['x-olli-academy-id']);

  try{
    await authorize(sessionToken,academyId,key);

    if(req.method==='POST'){
      const body=await readJson(req);
      const action=String(body?.action||'').trim();

      if(action==='prepare'){
        const fileName=safeFileName(body?.fileName);
        const mimeType=String(body?.mimeType||'application/octet-stream').trim()||'application/octet-stream';
        const fileSize=assertUploadSize(body?.fileSize);
        const kind=safeKind(body?.kind);
        const assetId=randomUUID();
        const objectPath=`${academyId}/${assetId}-${fileName}`;
        const uploadUrl=await createSignedUpload(objectPath,key);

        let thumbnailObjectPath=null;
        let thumbnailUploadUrl=null;
        let thumbnailMimeType=null;
        let thumbnailSize=null;
        if(kind==='media'&&body?.thumbnail){
          try{
            thumbnailMimeType=safeThumbnailMime(body.thumbnail?.mimeType);
            thumbnailSize=assertThumbnailSize(body.thumbnail?.fileSize);
            const extension=thumbnailMimeType==='image/webp'?'webp':'jpg';
            thumbnailObjectPath=`${academyId}/thumb/${assetId}.${extension}`;
            thumbnailUploadUrl=await createSignedUpload(thumbnailObjectPath,key);
          }catch(error){
            console.warn('Team Chat 썸네일 업로드 주소 준비 실패, 원본 업로드만 진행합니다.',error);
            thumbnailObjectPath=null;
            thumbnailUploadUrl=null;
            thumbnailMimeType=null;
            thumbnailSize=null;
          }
        }

        return res.status(200).json({
          ok:true,action:'prepare',objectPath,uploadUrl,fileName,mimeType,fileSize,kind,
          thumbnailObjectPath,thumbnailUploadUrl,thumbnailMimeType,thumbnailSize
        });
      }

      if(action==='finalize'){
        const objectPath=assertAcademyPath(body?.objectPath,academyId);
        const fileName=safeFileName(body?.fileName);
        const mimeType=String(body?.mimeType||'application/octet-stream').trim()||'application/octet-stream';
        const fileSize=assertUploadSize(body?.fileSize);
        const kind=safeKind(body?.kind);
        const thumbnailObjectPath=body?.thumbnailObjectPath?assertThumbnailPath(body.thumbnailObjectPath,academyId):null;
        const thumbnailMimeType=thumbnailObjectPath?safeThumbnailMime(body?.thumbnailMimeType):null;
        const thumbnailSize=thumbnailObjectPath?assertThumbnailSize(body?.thumbnailSize):null;
        const imageWidth=safeImageDimension(body?.imageWidth);
        const imageHeight=safeImageDimension(body?.imageHeight);
        try{
          const payload=await rpc('olli_team_chat_send_attachment',{
            p_session_token:sessionToken,p_academy_id:academyId,p_file_name:fileName,
            p_mime_type:mimeType,p_file_size:fileSize,p_storage_path:objectPath,
            p_kind:kind,p_client_message_id:randomUUID()
          },key);

          const attachmentId=Number(payload?.message?.attachment?.id||0);
          if(attachmentId&&(thumbnailObjectPath||(imageWidth&&imageHeight))){
            const metadata={
              image_width:imageWidth,
              image_height:imageHeight
            };
            if(thumbnailObjectPath){
              metadata.thumbnail_storage_path=thumbnailObjectPath;
              metadata.thumbnail_mime_type=thumbnailMimeType;
              metadata.thumbnail_size=thumbnailSize;
            }
            try{
              await patchAttachmentThumbnail(attachmentId,academyId,metadata,key);
              payload.message.attachment={
                ...(payload.message.attachment||{}),
                thumbnail_storage_path:thumbnailObjectPath,
                thumbnail_mime_type:thumbnailMimeType,
                thumbnail_size:thumbnailSize,
                image_width:imageWidth,
                image_height:imageHeight
              };
            }catch(error){
              console.error('Team Chat 썸네일 메타데이터 저장 실패:',error);
              if(thumbnailObjectPath)await cleanup(thumbnailObjectPath,key);
            }
          }else if(thumbnailObjectPath){
            await cleanup(thumbnailObjectPath,key);
          }
          return res.status(200).json(payload);
        }catch(error){
          await cleanup(objectPath,key);
          if(thumbnailObjectPath)await cleanup(thumbnailObjectPath,key);
          throw error;
        }
      }

      if(action==='cleanup'){
        const objectPath=body?.objectPath?assertAcademyPath(body.objectPath,academyId):null;
        const thumbnailObjectPath=body?.thumbnailObjectPath?assertThumbnailPath(body.thumbnailObjectPath,academyId):null;
        if(!objectPath&&!thumbnailObjectPath)throw new Error('정리할 파일 경로가 없습니다.');
        if(objectPath)await cleanup(objectPath,key);
        if(thumbnailObjectPath)await cleanup(thumbnailObjectPath,key);
        return res.status(200).json({ok:true});
      }

      if(action==='delete'){
        const attachmentId=Number(body?.attachmentId||0);
        if(!Number.isSafeInteger(attachmentId)||attachmentId<1)throw new Error('첨부파일 ID가 올바르지 않습니다.');

        const deleted=await rpc('olli_team_chat_delete_attachment',{
          p_session_token:sessionToken,p_academy_id:academyId,p_attachment_id:attachmentId
        },key);
        if(!deleted?.ok)throw new Error(deleted?.message||'사진을 삭제하지 못했습니다.');

        const bucket=String(deleted?.storage_bucket||BUCKET);
        const originalPath=deleted?.storage_path?assertAcademyPath(deleted.storage_path,academyId):null;
        const thumbnailPath=deleted?.thumbnail_storage_path?assertThumbnailPath(deleted.thumbnail_storage_path,academyId):null;
        let storageCleanupComplete=true;
        if(originalPath)storageCleanupComplete=(await deleteStoredObject(originalPath,bucket,key))&&storageCleanupComplete;
        if(thumbnailPath)storageCleanupComplete=(await deleteStoredObject(thumbnailPath,bucket,key))&&storageCleanupComplete;

        return res.status(200).json({
          ok:true,
          attachmentId:Number(deleted.attachment_id||attachmentId),
          messageId:Number(deleted.message_id||0),
          storageCleanupComplete
        });
      }

      return res.status(400).json({error:'알 수 없는 파일 요청입니다.'});
    }

    if(req.method==='GET'){
      const attachmentId=String(req.query?.attachmentId||'').trim();
      if(!/^\d+$/.test(attachmentId))return res.status(400).json({error:'첨부파일 ID가 올바르지 않습니다.'});
      const query=new URLSearchParams({
        id:`eq.${attachmentId}`,academy_id:`eq.${academyId}`,
        select:'id,message_id,storage_bucket,storage_path,file_name,mime_type,file_size,kind,thumbnail_storage_path,thumbnail_mime_type,thumbnail_size,image_width,image_height',limit:'1'
      });
      const metaRes=await fetch(`${SUPABASE_URL}/rest/v1/olli_team_chat_attachments?${query.toString()}`,{
        headers:{apikey:key,Authorization:`Bearer ${key}`}
      });
      if(!metaRes.ok)throw new Error('첨부파일 정보를 확인하지 못했습니다.');
      const rows=await metaRes.json();
      const meta=Array.isArray(rows)?rows[0]:null;
      if(!meta)return res.status(404).json({error:'첨부파일을 찾지 못했습니다.'});

      const messageQuery=new URLSearchParams({
        id:`eq.${meta.message_id}`,academy_id:`eq.${academyId}`,
        deleted_at:'is.null',select:'id',limit:'1'
      });
      const messageRes=await fetch(`${SUPABASE_URL}/rest/v1/olli_team_chat_messages?${messageQuery.toString()}`,{
        headers:{apikey:key,Authorization:`Bearer ${key}`}
      });
      if(!messageRes.ok)throw new Error('사진 메시지 상태를 확인하지 못했습니다.');
      const activeMessages=await messageRes.json();
      if(!Array.isArray(activeMessages)||!activeMessages.length){
        return res.status(404).json({error:'삭제된 사진입니다.'});
      }

      const wantsThumbnail=String(req.query?.variant||'').trim().toLowerCase()==='thumbnail';
      const hasThumbnail=wantsThumbnail&&String(meta.thumbnail_storage_path||'').trim();
      const storagePath=hasThumbnail?meta.thumbnail_storage_path:meta.storage_path;
      const contentType=hasThumbnail?(meta.thumbnail_mime_type||'image/webp'):(meta.mime_type||'application/octet-stream');

      const objectRes=await fetch(
        `${STORAGE_BASE}/object/authenticated/${encodeURIComponent(meta.storage_bucket||BUCKET)}/${encodePath(storagePath)}`,
        {headers:{apikey:key,Authorization:`Bearer ${key}`}}
      );
      if(!objectRes.ok)return res.status(404).json({error:'저장된 파일을 찾지 못했습니다.'});
      const data=Buffer.from(await objectRes.arrayBuffer());
      const name=String(meta.file_name||'file');
      res.setHeader('Content-Type',contentType);
      res.setHeader('Content-Length',String(data.length));
      res.setHeader('X-Olli-Asset-Variant',hasThumbnail?'thumbnail':'original');
      res.setHeader('Content-Disposition',hasThumbnail
        ? 'inline'
        : `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(name)}`);
      return res.status(200).send(data);
    }

    return res.status(405).json({error:'Method not allowed'});
  }catch(error){
    return res.status(400).json({error:error?.message||'팀톡 파일 처리에 실패했습니다.'});
  }
}
