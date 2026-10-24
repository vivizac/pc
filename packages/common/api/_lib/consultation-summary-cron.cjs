'use strict';
const summary=require('./consultation-summary-handler.cjs');
const SUPABASE='https://fvkxipjwgeyosgnfhdnx.supabase.co';
function key(){return process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';}
function allowed(req){
  const secret=String(process.env.CRON_SECRET||'');
  return secret.length>=16 && req.headers?.authorization === 'Bearer '+secret;
}
async function rpc(name,body){
  const token=key();
  if(!token)throw new Error('SERVER_KEY_MISSING');
  const response=await fetch(SUPABASE+'/rest/v1/rpc/'+name,{
    method:'POST',headers:{'Content-Type':'application/json',apikey:token,Authorization:'Bearer '+token},
    body:JSON.stringify(body)
  });
  const data=await response.json();
  if(!response.ok||!data?.ok)throw new Error(data?.code||data?.message||'CRON_RPC_FAILED');
  return data;
}
async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});
  if(!allowed(req))return res.status(401).json({ok:false,code:'UNAUTHORIZED'});
  if(process.env.VERCEL_ENV!=='production'||process.env.OLLI_CONSULTATION_CRON_ENABLED!=='enabled')
    return res.status(200).json({ok:true,status:'disabled'});
  try {
    const snapshot=await rpc('olli_consultation_summary_cron_candidates',{p_limit:6});
    const results=[];
    for(const task of snapshot.candidates||[]){
      try {
        const answer=await summary.runScheduled(task);
        results.push({status:answer.status||'unknown'});
      }catch(error){results.push({status:'error',code:error.code||'SUMMARY_FAILED'});}
    }
    return res.status(200).json({
      ok:true,processed:results.length,
      ready:results.filter(x=>x.status==='ready').length,
      insufficient:results.filter(x=>x.status==='insufficient').length,
      errors:results.filter(x=>x.status==='error').length
    });
  }catch(error){return res.status(500).json({ok:false,code:error.message||'CRON_ERROR'});}
}
module.exports=handler;
module.exports.__test={allowed};
