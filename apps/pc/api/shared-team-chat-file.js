const UPSTREAM=process.env.OLLI_SHARED_CHAT_FILE_SERVER_URL||'https://vivizac-feedback.vercel.app/api/shared-team-chat-file';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  const url=new URL(UPSTREAM);
  if(req.method==='GET')url.searchParams.set('attachmentId',String(req.query?.attachmentId||''));
  const requestId=String(req.headers['x-vercel-id']||req.headers['x-request-id']||'').slice(0,120);
  let stage='fetch',expectedBytes=0,sentBytes=0,completed=false,failed=false;
  res.on?.('close',()=>{
    if(req.method==='GET'&&stage==='stream'&&!completed&&!failed)
      console.error('teamchat.pc_file_relay.client_closed',{
        requestId,stage,sentBytes,expectedBytes
      });
  });
  try{
    const upstream=await fetch(url,{method:req.method,redirect:'error',headers:{
      'X-Olli-Session-Token':String(req.headers['x-olli-session-token']||''),
      'X-Olli-Academy-Id':String(req.headers['x-olli-academy-id']||''),
      'X-Olli-Room-Id':String(req.headers['x-olli-room-id']||''),
      ...(req.method==='POST'?{'Content-Type':'application/json'}:{})
    },...(req.method==='POST'?{body:JSON.stringify(req.body||{})}:{})});
    res.statusCode=upstream.status;
    for(const header of ['content-type','content-length','content-disposition','x-content-type-options']){
      const value=upstream.headers.get(header);if(value)res.setHeader(header,value);
    }
    stage='stream';
    expectedBytes=Number(upstream.headers.get('content-length'))||0;
    if(upstream.body?.getReader){
      const reader=upstream.body.getReader();
      try{
        while(true){
          const {done,value}=await reader.read();
          if(done)break;
          sentBytes+=value.byteLength;
          if(sentBytes>20971520)throw new Error('Transfer limit exceeded');
          res.write(Buffer.from(value));
        }
      }finally{reader.releaseLock();}
      if(expectedBytes>0&&sentBytes!==expectedBytes)throw new Error('Incomplete file stream');
      completed=true;
      return res.end();
    }
    const bytes=Buffer.from(await upstream.arrayBuffer());
    sentBytes=bytes.length;
    if(expectedBytes>0&&sentBytes!==expectedBytes)throw new Error('Incomplete file stream');
    completed=true;
    return res.end(bytes);
  }catch(error){
    failed=true;
    console.error('teamchat.pc_file_relay.failure',{
      requestId,stage,sentBytes,expectedBytes,headersSent:!!res.headersSent,
      code:stage==='stream'?'INCOMPLETE_TRANSFER':'UPSTREAM_UNAVAILABLE'
    });
    if(!res.headersSent)return res.status(502).json({
      error:'통합 첨부파일을 전달하지 못했습니다.',
      code:stage==='stream'?'INCOMPLETE_TRANSFER':'UPSTREAM_UNAVAILABLE'
    });
    // Abort partial responses instead of silently reporting a completed file.
    if(typeof res.destroy==='function')res.destroy(error);
    else res.end();
  }
}
