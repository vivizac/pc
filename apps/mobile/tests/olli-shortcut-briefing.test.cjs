'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createHandler,speak}=require('../api/olli-shortcut-briefing.js');

function res(){
  return {code:0,payload:null,headers:{},
    setHeader(k,v){this.headers[k]=v;return this;},
    status(n){this.code=n;return this;},
    json(body){this.payload=body;return this;}
  };
}
const token='A'.repeat(43);
test('rejects non-POST methods and malformed credentials without hitting database',async()=>{
  let calls=0;
  const handle=createHandler({env:{SUPABASE_SECRET_KEY:'test'},fetchFn:async()=>{calls++;throw Error('should not call');}});
  const method=res();await handle({method:'GET'},method);
  assert.equal(method.code,405);
  const bad=res();await handle({method:'POST',body:{token:'wrong'}},bad);
  assert.equal(bad.code,401);assert.equal(calls,0);
});
test('reads only the hashed token and returns Korean briefing text',async()=>{
  let sent;
  const handle=createHandler({
    env:{SUPABASE_SECRET_KEY:'server-secret',SUPABASE_URL:'https://example.supabase.co'},
    fetchFn:async(url,opts)=>{
      sent={url,opts};
      return {ok:true,json:async()=>({ok:true,date:'2026-11-06',
        consultations:[{time:'13:00',kind:'신규 상담'},{time:'17:30',kind:'재원생 상담'}],
        tasks:['상담 자료 준비']})};
    }
  });
  const out=res();await handle({method:'POST',body:{token}},out);
  assert.equal(out.code,200);
  assert.match(out.payload.text,/오후 1시, 신규 상담/);
  assert.match(out.payload.text,/오후 5시 30분, 재원생 상담/);
  assert.match(out.payload.text,/상담 자료 준비/);
  assert.equal(out.headers['Cache-Control'],'no-store, private, max-age=0');
  assert.equal(JSON.parse(sent.opts.body).p_token_hash,crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.stringify(sent).includes(token),false);
});
test('revoked tokens never produce briefing content',async()=>{
  const handle=createHandler({env:{SUPABASE_SECRET_KEY:'server-secret'},
    fetchFn:async()=>({ok:true,json:async()=>({ok:false,code:'TOKEN_EXPIRED_OR_REVOKED'})})});
  const out=res();await handle({method:'POST',body:{token}},out);
  assert.equal(out.code,401);assert.equal(out.payload.text,undefined);
});
test('blank days and 24-hour times have stable spoken output',()=>{
  assert.match(speak({consultations:[],tasks:[]}),/상담은 없습니다/);
  assert.match(speak({consultations:[{time:'00:05',kind:'신규 상담'}],tasks:[]}),/오전 12시 5분/);
});


test('new sb_secret key is only sent via apikey header, never Authorization',async()=>{
  let headers;
  const handler=createHandler({
    env:{SUPABASE_SECRET_KEY:'sb_secret_mock_key'},
    fetchFn:async (_url, options)=>{
      headers=options.headers;
      return {ok:true,json:async()=>({ok:true,date:'2026-11-06',consultations:[],tasks:[]})};
    }
  });
  const out=res();
  await handler({method:'POST',body:{token}},out);
  assert.equal(out.code,200);
  assert.equal(headers.apikey,'sb_secret_mock_key');
  assert.equal(Object.hasOwn(headers,'Authorization'),false);
});

test('legacy service-role JWT keeps bearer authentication',async()=>{
  let headers;
  const handler=createHandler({
    env:{SUPABASE_SERVICE_ROLE_KEY:'legacy.jwt.key'},
    fetchFn:async (_url,options)=>{
      headers=options.headers;
      return {ok:true,json:async()=>({ok:true,date:'2026-11-06',consultations:[],tasks:[]})};
    }
  });
  const out=res();
  await handler({method:'POST',body:{token}},out);
  assert.equal(out.code,200);
  assert.equal(headers.Authorization,'Bearer legacy.jwt.key');
  assert.equal(headers.apikey,'legacy.jwt.key');
});
