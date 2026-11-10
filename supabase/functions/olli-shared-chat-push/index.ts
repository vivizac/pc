import webpush from 'npm:web-push@3.6.7';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
function safeEndpoint(value:string){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
    (['fcm.googleapis.com','web.push.apple.com','updates.push.services.mozilla.com'].includes(url.hostname)||url.hostname.endsWith('.notify.windows.com'));}catch{return false;}
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors});
  if(req.method!=='POST')return json({ok:false},405);
  const base=Deno.env.get('SUPABASE_URL')||'';
  const key=Deno.env.get('SUPABASE_SECRET_KEY')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!base||!key)return json({ok:false},503);
  async function rpc(name:string,body:Record<string,unknown>={}){
    const res=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,
      ...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error'});
    const result=await res.json();if(!res.ok)throw new Error('RPC failed');return result;
  }
  try{
    const text=await req.text();if(text.length>16384)return json({ok:false},413);
    const body=JSON.parse(text);
    if(!body.session_token||!body.academy_id||!body.room_id||!Number.isSafeInteger(body.message_id))return json({ok:false},400);
    // Validate sender and current membership before obtaining any target or VAPID key.
    const payload=await rpc('olli_shared_chat_push_claim',{p_session_token:body.session_token,p_academy_id:body.academy_id,p_room_id:body.room_id,p_message_id:body.message_id});
    if(payload?.ok!==true)return json({ok:false},403);
    const vapid=await rpc('olli_push_server_vapid');
    if(!vapid?.public_key||!vapid?.private_key)return json({ok:false},503);
    webpush.setVapidDetails(Deno.env.get('OLLI_VAPID_SUBJECT')||base,vapid.public_key,vapid.private_key);
    let sent=0,failed=0;
    // Bounded serial delivery avoids unbounded provider fanout.
    for(const target of payload.targets||[]){
      if(!safeEndpoint(target.endpoint)){failed++;continue;}
      try{
        await webpush.sendNotification({endpoint:target.endpoint,keys:{p256dh:target.p256dh,auth:target.auth}},JSON.stringify({
          title:'올리 공동 팀챗',body:'공동 대화방에 새 메시지가 있습니다.',tag:'olli-shared-chat-'+body.room_id+'-'+body.message_id,
          data:{type:'olli-shared-chat',roomId:body.room_id,messageId:body.message_id,academyId:target.academy_id,
            url:'./?sharedChat='+encodeURIComponent(body.room_id)}
        }),{TTL:300,urgency:'normal'});
        await rpc('olli_shared_chat_push_complete',{p_message_id:body.message_id,p_endpoint:target.endpoint});sent++;
      }catch{failed++;}
    }
    return json({ok:true,sent,failed});
  }catch{return json({ok:false,error:'공동 알림 권한 또는 연결을 확인해 주세요.'},403);}
});
