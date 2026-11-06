/* PC shared conversation push, registered under /shared-chat-push/ only. */
self.addEventListener('push',event=>event.waitUntil((async()=>{
  let payload;try{payload=event.data.json();}catch{return;}
  const data=payload?.data;if(data?.type!=='olli-shared-chat')return;
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'OLLI_SHARED_CHAT_REFRESH',roomId:data.roomId});
  await self.registration.showNotification('올리 공동 팀챗',{
    body:'공동 대화방에 새 메시지가 있습니다.',tag:'olli-shared-chat-'+String(data.roomId)+'-'+String(data.messageId),renotify:false,silent:false,
    data:{type:'olli-shared-chat',roomId:String(data.roomId||'')}
  });
})()));
self.addEventListener('notificationclick',event=>event.waitUntil((async()=>{
  event.notification.close();const roomId=String(event.notification.data?.roomId||'');
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
    await client.focus();client.postMessage({type:'OLLI_SHARED_CHAT_OPEN',roomId});return;
  }
  const url=new URL('../',self.registration.scope);url.searchParams.set('sharedChat',roomId);await self.clients.openWindow(url.href);
})()));
