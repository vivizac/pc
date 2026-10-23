// PC forwards to the single mobile-hosted consultation summary engine.
const UPSTREAM='https://vivizac-feedback.vercel.app/api/consultation-summary';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try {
    const upstream=await fetch(UPSTREAM,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(req.body||{})});
    res.status(upstream.status);
    res.setHeader('Content-Type','application/json');
    return res.send(await upstream.text());
  }catch(err){return res.status(502).json({ok:false,error:'UPSTREAM_UNAVAILABLE',message:'공통 종합 피드백 서버 연결 실패'});}
}
