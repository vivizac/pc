/* Olli PC: persistent guardian makeup request notifications.
 * Separate view-only polling/UI; does not alter existing Realtime or sync logic.
 * Realtime's existing schedule revision is a refresh hint, never data source.
 */
(function(global){
  'use strict';
  const rpcName='olli_makeup_staff_notifications';
  let fetching=false,acknowledging=false,current=null,layer=null,queue=[];
  let contextKey='';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function ctx(){
    try{return {
      academy:String(global.localStorage.getItem('olli_current_academy_id')||''),
      token:String(global.localStorage.getItem('olli_account_session_token_v1')||'')
    };}catch{return {academy:'',token:''};}
  }
  function key(x){return x.academy+':'+x.token;}
  function itemLabel(x){
    const date=String(x.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
    const dt=new Date(date+'T12:00:00Z');
    const caption=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',
      day:'numeric',weekday:'short'}).format(dt);
    return caption+' · '+String(x.label||x.time_slot+'시')+(x.group==='B'?' · B반':'');
  }
  async function request(action,id,source){
    const c=source||ctx();
    if(!c.academy||!c.token||typeof global.callOlliRpc!=='function')return null;
    const result=await global.callOlliRpc(rpcName,{
      p_session_token:c.token,p_academy_id:c.academy,
      p_action:action,p_request_id:id||null
    });
    if(key(ctx())!==key(c))return null;
    if(!result||result.ok!==true)throw new Error('REQUEST_FAILED');
    return result;
  }
  function close(){
    layer?.remove();layer=null;current=null;queue=[];
  }
  function display(){
    const c=ctx();
    if(key(c)!==contextKey){close();return;}
    if(current||!queue.length)return;
    current=queue.shift();
    const list=Array.isArray(current.items)?current.items:[];
    const abs=list.filter(x=>x.kind==='absence');
    const makeup=list.filter(x=>x.kind==='makeup');
    const rows=(items)=>items.length?
      '<ul>'+items.map(x=>'<li>'+esc(itemLabel(x))+'</li>').join('')+'</ul>':
      '<p class="ommEmpty">해당 일정 없음</p>';
    layer=global.document.createElement('div');
    layer.className='olliMakeupNoticeOverlay';
    layer.innerHTML='<div class="olliMakeupNoticeDialog" role="dialog" aria-modal="true" aria-labelledby="olliMakeupNoticeTitle">'+
      '<div class="olliMakeupNoticeEyebrow">학부모 신청 알림</div>'+
      '<h2 id="olliMakeupNoticeTitle">'+esc(current.student_name)+' 학생 일정 신청</h2>'+
      '<p class="olliMakeupNoticeCaption">학부모가 신청한 결석·보강 일정이 올리 시간표에 등록되었습니다.</p>'+
      '<section><h3>결석 예정 '+abs.length+'건</h3>'+rows(abs)+'</section>'+
      '<section><h3>보강 수업 '+makeup.length+'건</h3>'+rows(makeup)+'</section>'+
      '<p class="olliMakeupNoticeError" role="alert" hidden></p>'+
      '<button type="button" class="olliMakeupNoticeConfirm">확인</button></div>';
    global.document.body.appendChild(layer);
    layer.querySelector('button').focus();
  }
  async function acknowledge(){
    if(!current||acknowledging)return;
    const id=current.id,c=ctx();
    acknowledging=true;
    const button=layer?.querySelector('button');
    if(button)button.disabled=true;
    try{
      const result=await request('ack',id,c);
      if(!result)return;
      layer?.remove();layer=null;current=null;
      display();
      if(!current)void poll();
    }catch{
      const error=layer?.querySelector('.olliMakeupNoticeError');
      if(error){error.hidden=false;error.textContent='알림 확인 상태를 저장하지 못했습니다. 다시 시도해 주세요.';}
    }finally{
      acknowledging=false;
      if(layer?.querySelector('button'))layer.querySelector('button').disabled=false;
    }
  }
  async function poll(){
    const c=ctx(),k=key(c);
    if(!c.academy||!c.token){
      contextKey='';close();return;
    }
    if(k!==contextKey){contextKey=k;close();}
    if(fetching||current||acknowledging)return;
    fetching=true;
    try{
      const result=await request('list',null,c);
      if(!result||key(ctx())!==k)return;
      queue=Array.isArray(result.requests)?result.requests:[];
      display();
    }catch{
      // A transient network failure must never mark a persistent event as seen.
    }finally{fetching=false;}
  }
  global.document.addEventListener('click',event=>{
    if(event.target.closest('.olliMakeupNoticeConfirm'))void acknowledge();
  });
  global.addEventListener('olli:realtime-change',event=>{
    if(event.detail?.domain==='schedule')void poll();
  });
  global.addEventListener('focus',()=>void poll());
  global.document.addEventListener('visibilitychange',()=>{
    if(!global.document.hidden)void poll();
  });
  global.addEventListener('storage',event=>{
    if(['olli_current_academy_id','olli_account_session_token_v1'].includes(event.key))
      void poll();
  });
  global.setInterval(()=>void poll(),20000);
  void poll();
})(window);
