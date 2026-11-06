// Persist only numeric icon badge totals across service worker restarts.
const OLLI_BADGE_CACHE='olli-push-badge-v1';
const OLLI_BADGE_KEY=new URL('./__olli_badge_state_v1__',self.registration.scope).href;
function olliKstDay(){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
const safeCount=v=>Math.max(0,Math.floor(Number(v)||0));
async function readOlliBadge(){
  try{
    const cache=await caches.open(OLLI_BADGE_CACHE);
    const result=await cache.match(OLLI_BADGE_KEY);
    if(result){const state=await result.json();if(state?.day===olliKstDay())return state;}
  }catch(_){}
  return {day:olliKstDay(),academyId:'',workCount:0,consultationCount:0};
}
async function writeOlliBadge(state){
  try{
    const cache=await caches.open(OLLI_BADGE_CACHE);
    await cache.put(OLLI_BADGE_KEY,new Response(JSON.stringify(state),{
      headers:{'Content-Type':'application/json'}
    }));
  }catch(_){}
}
async function updateOlliBadge(state){
  const count=safeCount(state.workCount)+safeCount(state.consultationCount);
  try{
    if(count>0&&typeof self.navigator?.setAppBadge==='function')
      await self.navigator.setAppBadge(count);
    else if(count===0&&typeof self.navigator?.clearAppBadge==='function')
      await self.navigator.clearAppBadge();
    else if(count===0&&typeof self.navigator?.setAppBadge==='function')
      await self.navigator.setAppBadge(0);
  }catch(_){}
}
self.addEventListener('message',event=>{
  if(event.data?.type!=='OLLI_BADGE_SYNC')return;
  event.waitUntil((async()=>{
    const prev=await readOlliBadge();
    const academyId=String(event.data.academyId||'');
    const state={
      day:olliKstDay(),academyId,
      workCount:safeCount(event.data.workCount),
      consultationCount:safeCount(event.data.consultationCount),
    };
    // Only the foreground authenticated app is allowed to set active academy.
    if(academyId||!prev.academyId){
      await writeOlliBadge(state);
      await updateOlliBadge(state);
    }
  })());
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch (_) {
      try { payload = { body: event.data ? event.data.text() : '' }; } catch (_) {}
    }

    const title = String(payload.title || '올리톡');
    const body = String(payload.body || '');
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    if(data.type==='olli-shared-chat'){
      // Shared-room IDs never enter academy Work/payroll badge state.
      const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      for(const client of windows)client.postMessage({type:'OLLI_SHARED_CHAT_REFRESH',roomId:data.roomId});
      await self.registration.showNotification('올리 공동 팀챗',{
        body:'공동 대화방에 새 메시지가 있습니다.',tag:'olli-shared-chat-'+String(data.roomId)+'-'+String(data.messageId),
        renotify:false,silent:false,icon:'./icon.png',badge:'./icon.png',data
      });
      return;
    }
    const tag = String(payload.tag || ('olli-talk-' + (data.messageId || Date.now())));
    const badgeCount=safeCount(data.badgeCount);
    const isConsultation=data.type==='olli-consultation-reminder';
    const previous=await readOlliBadge();
    const academyId=String(data.academyId||previous.academyId||'');
    const sameAcademy=!previous.academyId||!academyId||previous.academyId===academyId;
    const next={
      day:olliKstDay(),academyId,
      workCount:sameAcademy?safeCount(previous.workCount):0,
      consultationCount:sameAcademy?safeCount(previous.consultationCount):0
    };
    if(isConsultation&&String(data.consultationDate||'')===next.day)
      next.consultationCount=safeCount(data.consultationCount);
    else if(!isConsultation)next.workCount=badgeCount;
    await writeOlliBadge(next);
    await updateOlliBadge(next);

    // 푸시를 받은 순간 열린 올리 화면에도 배지 변경을 알려
    // Work / Work Hub가 화면 진입을 기다리지 않고 서버 원본을 다시 읽게 합니다.
    try {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      windows.forEach((client) => {
        try {
          client.postMessage({
            type: isConsultation?'OLLI_CONSULTATION_BADGE_PUSH':'OLLI_WORK_BADGE_PUSH',
            badgeCount,
            consultationCount:next.consultationCount,
            academyId,
            notificationType: String(data.type || ''),
            messageId: data.messageId || null,
            requestId: data.requestId || null,
          });
        } catch (_) {}
      });
    } catch (_) {}

    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      silent: false,
      icon: './icon.png',
      badge: './icon.png',
      data,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data && typeof event.notification.data === 'object'
      ? event.notification.data
      : {};
    const targetUrl = String(data.url || './?olliTalk=1');

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        await client.focus();
        client.postMessage(data.type === 'olli-shared-chat'
          ? {type:'OLLI_SHARED_CHAT_OPEN',roomId:data.roomId}
          : data.type === 'olli-consultation-reminder'
          ? { type:'OLLI_CONSULTATION_OPEN_FROM_NOTIFICATION' }
          : data.type === 'olli-material-request'
          ? { type:'OLLI_WORK_OPEN_MATERIALS', requestId:data.requestId||null }
          : { type:'OLLI_TALK_OPEN_FROM_NOTIFICATION', messageId:data.messageId||null });
        return;
      } catch (_) {}
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
