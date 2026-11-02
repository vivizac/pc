(() => {
  'use strict';
  // Keep owner/manager's today's consultation badge separate from Work unread,
  // then combine them only when setting the installed app icon badge.
  const state={academyId:'',day:'',consultationCount:0,workCount:0,lastSync:0,requestId:0};
  const count=v=>Math.max(0,Math.floor(Number(v)||0));
  const kstDay=()=>{
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
      timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date()).map(x=>[x.type,x.value]));
    return p.year+'-'+p.month+'-'+p.day;
  };
  function context(){
    let academyId='';
    try{academyId=String(window.OlliStorageCore?.AcademyContext?.getCurrent?.()?.academyId||'')}catch(_){}
    if(!academyId){try{academyId=String(localStorage.getItem('olli_current_academy_id')||'')}catch(_){}}
    let sessionToken='';
    try{sessionToken=String(window.getOlliPhoneWritableAccountSessionToken?.()||'')}catch(_){}
    if(!sessionToken){try{sessionToken=String(localStorage.getItem('olli_account_session_token_v1')||'')}catch(_){}}
    return {academyId:academyId.trim(),sessionToken:sessionToken.trim()};
  }
  function sendBadgeToWorker(){
    const controller=navigator.serviceWorker?.controller;
    if(!controller)return;
    try{controller.postMessage({
      type:'OLLI_BADGE_SYNC',academyId:state.academyId,
      day:state.day,consultationCount:state.consultationCount,
      workCount:state.workCount
    })}catch(_){}
  }
  function combineWorkCount(workUnread){
    state.workCount=count(workUnread);
    if(state.day!==kstDay())state.consultationCount=0;
    sendBadgeToWorker();
    return state.workCount+state.consultationCount;
  }
  function updateIcon(){
    window.OlliTalkPush?.setAppBadge?.(state.workCount);
    const badge=document.querySelectorAll('[data-olli-booking-count]');
    badge.forEach(node=>{
      node.textContent=String(state.consultationCount);
      node.setAttribute('aria-label','오늘 예약된 상담 '+state.consultationCount+'건');
    });
  }
  async function refresh({force=false}={}){
    if(document.hidden&&!force)return false;
    const {academyId,sessionToken}=context();
    const day=kstDay();
    if(state.academyId!==academyId||state.day!==day){
      state.academyId=academyId;state.day=day;state.consultationCount=0;state.lastSync=0;
      updateIcon();
    }
    if(!academyId||!sessionToken){
      state.consultationCount=0;updateIcon();return false;
    }
    if(!force&&Date.now()-state.lastSync<60*1000)return true;
    state.lastSync=Date.now();
    const seq=++state.requestId;
    try{
      const call=typeof window.supabase==='function'?window.supabase:null;
      if(!call)return false;
      const data=await call('POST','rpc/olli_consultation_today_count',{
        p_session_token:sessionToken,p_academy_id:academyId
      });
      if(seq!==state.requestId||context().academyId!==academyId||kstDay()!==day)return false;
      if(data?.ok!==true||data.date!==day)throw new Error('Invalid consultation badge data');
      state.consultationCount=count(data.consultation_count);
      updateIcon();
      return true;
    }catch(error){
      // Do not display stale, cross-tenant consultation badges on auth errors.
      if(seq===state.requestId){
        state.consultationCount=0;
        updateIcon();
      }
      console.warn('오늘의 상담 알림 수 조회 실패',error?.message||error);
      return false;
    }
  }
  function openFromNotification(){
    const open=()=>window.OlliBookingDashboard?.open?.('mobile');
    if(typeof window.OlliBookingDashboard?.open==='function')open();
    else setTimeout(open,300);
    void refresh({force:true});
  }
  function init(){
    navigator.serviceWorker?.addEventListener?.('message',event=>{
      if(event?.data?.type==='OLLI_CONSULTATION_BADGE_PUSH'){
        if(event.data.academyId&&event.data.academyId!==context().academyId)return;
        state.academyId=context().academyId;
        state.day=kstDay();
        state.consultationCount=count(event.data.consultationCount);
        updateIcon();
        void refresh({force:true});
      }else if(event?.data?.type==='OLLI_CONSULTATION_OPEN_FROM_NOTIFICATION')
        openFromNotification();
    });
    window.addEventListener('focus',()=>void refresh({force:true}));
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden)void refresh({force:true});
    });
    window.addEventListener('olli:booking-changed',()=>void refresh({force:true}));
    window.addEventListener('olli:realtime-status',()=>void refresh());
    window.setInterval(()=>{if(!document.hidden)void refresh()},5*60*1000);
    const params=new URLSearchParams(location.search||'');
    if(params.get('olliConsultation')==='1'){
      setTimeout(openFromNotification,550);
      params.delete('olliConsultation');
      const query=params.toString();
      try{history.replaceState(history.state,'',location.pathname+(query?'?'+query:'')+location.hash)}catch(_){}
    }
    void refresh({force:true});
  }
  window.OlliConsultationReminders=Object.freeze({
    refresh,combineWorkCount,getTodayCount:()=>state.day===kstDay()?state.consultationCount:0
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
