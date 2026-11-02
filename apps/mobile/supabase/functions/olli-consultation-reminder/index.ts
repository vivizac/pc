// Scheduled 10:00 KST consultation notifications. The same existing VAPID
// identity and Olli mobile web-push subscriptions are used by Work/Team Chat.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"Content-Type":"application/json;charset=utf-8","Cache-Control":"no-store"}
});
const str=(x:unknown)=>String(x??"").trim();
function serviceKey(){
  const direct=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(direct)return direct;
  try{return str(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default)}catch{return ""}
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")||"";
  const key=serviceKey();
  if(!url||!key)return json({ok:false,error:"Push server not configured"},500);
  let request:any;
  try{request=await req.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  if(request?.action!=="dispatch-daily"||!str(request?.internal_token))
    return json({ok:false,error:"Unauthorized"},401);

  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    // This token is already used for the authenticated Olli system push
    // dispatch; neither the token nor VAPID private key are ever sent to clients.
    const secret=await admin.rpc("olli_team_chat_system_push_secret");
    if(secret.error||!str(secret.data)||str(secret.data)!==str(request.internal_token))
      return json({ok:false,error:"Unauthorized"},401);

    const vapid=await admin.rpc("olli_push_server_vapid");
    if(vapid.error)throw vapid.error;
    const publicKey=str(vapid.data?.public_key),privateKey=str(vapid.data?.private_key);
    if(!publicKey||!privateKey)throw new Error("Existing VAPID keys unavailable");
    const subject=str(Deno.env.get("OLLI_VAPID_SUBJECT"));
    webpush.setVapidDetails(/^(https:\/\/|mailto:)/i.test(subject)?subject:url,publicKey,privateKey);

    const list=await admin.rpc("olli_consultation_reminder_claim_targets",{p_limit:100});
    if(list.error||list.data?.ok!==true)throw list.error||new Error("Reminder targets unavailable");
    const targets=Array.isArray(list.data?.targets)?list.data.targets:[];
    let sent=0,failed=0;
    await Promise.all(targets.map(async(target:any)=>{
      const academyId=str(target.academy_id);
      const subscriptionId=str(target.subscription_id);
      const day=str(target.reminder_date);
      const claimToken=str(target.claim_token);
      const count=Math.max(0,Math.floor(Number(target.consultation_count||0)));
      let delivered=false,code="unknown";
      try{
        if(!academyId||!subscriptionId||!claimToken||!day||!count)
          throw new Error("Invalid reminder target");
        const subscription={endpoint:str(target.endpoint),keys:{
          p256dh:str(target.p256dh),auth:str(target.auth)
        }};
        const payload=JSON.stringify({
          title:"올리 · 오늘의 상담",
          body:"오늘 예약된 상담이 "+count+"건 있습니다. 상담 일정을 확인해 주세요.",
          tag:"olli-consultation-"+day+"-"+academyId,
          data:{
            type:"olli-consultation-reminder",
            consultationCount:count,
            consultationDate:day,
            academyId,
            url:"./?olliConsultation=1"
          }
        });
        await webpush.sendNotification(subscription,payload,{
          TTL:60*60,urgency:"high"
        });
        delivered=true;
        sent++;
      }catch(error:any){
        failed++;
        const status=Number(error?.statusCode||error?.status||0);
        code=status?String(status):"send_failed";
        if(status===404||status===410){
          await admin.from("olli_team_chat_push_subscriptions")
            .update({disabled_at:new Date().toISOString()})
            .eq("academy_id",academyId).eq("id",subscriptionId);
        }
        console.warn("Consultation push failed",status,str(error?.message).slice(0,120));
      }finally{
        if(academyId&&subscriptionId&&day&&claimToken){
          const ack=await admin.rpc("olli_consultation_reminder_finish",{
            p_academy_id:academyId,p_subscription_id:subscriptionId,
            p_reminder_date:day,p_claim_token:claimToken,
            p_success:delivered,p_error_code:delivered?null:code
          });
          if(ack.error)console.error("Consultation reminder ack failed",ack.error.message);
        }
      }
    }));
    return json({ok:true,claimed:targets.length,sent,failed,date:list.data?.date});
  }catch(error:any){
    console.error("Consultation daily reminder worker failed",str(error?.message).slice(0,160));
    return json({ok:false,error:"Reminder dispatch failed"},500);
  }
});
