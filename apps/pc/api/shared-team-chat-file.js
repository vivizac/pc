const UPSTREAM=process.env.OLLI_SHARED_CHAT_FILE_SERVER_URL||'https://vivizac-feedback.vercel.app/api/shared-team-chat-file';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  const url=new URL(UPSTREAM);
  if(req.method==='GET')url.searchParams.set('attachmentId',String(req.query?.attachmentId||''));
  try{
    const upstream=await fetch(url,{method:req.method,redirect:'error',headers:{
      'X-Olli-Session-Token':String(req.headers['x-olli-session-token']||''),
      'X-Olli-Academy-Id':String(req.headers['x-olli-academy-id']||''),
      'X-Olli-Room-Id':String(req.headers['x-olli-room-id']||''),
      ...(req.method==='POST'?{'Content-Type':'application/json'}:{})
    },...(req.method==='POST'?{body:JSON.stringify(req.body||{})}:{})});
    res.statusCode=upstream.status;
    for(const header of ['content-type','content-disposition','x-content-type-options']){
      const value=upstream.headers.get(header);if(value)res.setHeader(header,value);
    }
    if(upstream.body?.getReader){const reader=upstream.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;res.write(Buffer.from(value));}}finally{reader.releaseLock();}return res.end();}
    return res.end(Buffer.from(await upstream.arrayBuffer()));
  }catch(_){if(!res.headersSent)return res.status(502).json({error:'첨부 서버에 연결하지 못했습니다.'});res.end();}
}
