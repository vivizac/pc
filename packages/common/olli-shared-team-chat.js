/* Shared conversation UI. Academy business/AI routing stays in the original chat. */
(function(global){
'use strict';
if(global.OlliSharedTeamChat)return;
const state={room:null,status:null,epoch:'',messages:[],members:[],reply:null,edit:null,lastRead:0,ready:false,busy:false,sequence:0,pendingUpload:null};
let dialog=null,mode='',watcher=null,configRequest=null,previousFocus=null;
const clean=value=>String(value??'').trim();
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;};
function context(){
  const ctx=global.OlliStorageCore?.AcademyContext?.getCurrent?.()||{};
  return {academyId:clean(ctx.academyId||localStorage.getItem('olli_current_academy_id')),
    sessionToken:clean(localStorage.getItem('olli_account_session_token_v1')),
    memberId:clean(ctx.memberId||localStorage.getItem('olli_current_member_id')),version:ctx.contextVersion||0};
}
const key=ctx=>[ctx.academyId,ctx.memberId,ctx.sessionToken,ctx.version].join(':');
const params=(ctx,room)=>({p_session_token:ctx.sessionToken,p_academy_id:ctx.academyId,...(room?{p_room_id:room.id}:{})});
function assertCurrent(ctx){if(key(ctx)!==key(context()))throw new Error('학원 또는 계정이 변경되었습니다. 다시 열어 주세요.');}
function chatContext(){
  const ctx=context();
  if(!state.room||state.epoch!==key(ctx)+':'+state.room.id+':'+state.room.participation_id){reset();throw new Error('학원 또는 계정이 변경되었습니다. 다시 열어 주세요.');}
  return ctx;
}
async function rpc(name,body,ctx){
  assertCurrent(ctx);
  const {url,apiKey}=supabaseConfig();
  if(!url||!apiKey)throw new Error('서버 연결을 확인할 수 없습니다.');
  const token=global.getOlliAuthAccessToken?.()||apiKey;
  const res=await fetch(url+'/rest/v1/rpc/olli_shared_chat_'+name,{
    method:'POST',headers:{apikey:apiKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'
  });
  const result=await res.json();assertCurrent(ctx);
  if(!res.ok||result?.ok!==true)throw new Error(result?.message||result?.error||'공동 팀챗 요청에 실패했습니다.');
  return result;
}
function supabaseConfig(){
  let url=clean(global.SUPABASE_URL),apiKey=clean(global.SUPABASE_KEY);
  try{if(typeof SUPABASE_URL!=='undefined')url=SUPABASE_URL;if(typeof SUPABASE_KEY!=='undefined')apiKey=SUPABASE_KEY;}catch(_){}
  return {url:clean(url).replace(/\/+$/,''),apiKey};
}
function button(text,action,cls){const el=node('button',text,cls);el.type='button';el.addEventListener('click',action);return el;}
function announce(message){const target=dialog?.querySelector('[data-shared-status]');if(target)target.textContent=message;}
function clearContent(){
  state.sequence++;state.room=null;state.status=null;state.epoch='';state.messages=[];state.members=[];
  state.reply=null;state.edit=null;state.lastRead=0;state.ready=false;state.busy=false;state.pendingUpload=null;configRequest=null;
}
function close(){
  if(dialog?.open)dialog.close();
  dialog?.remove();dialog=null;mode='';clearContent();
  previousFocus?.focus?.();previousFocus=null;
}
function reset(){close();for(const el of document.querySelectorAll('[data-shared-chat-entry]')){el.hidden=true;el.textContent='공동 대화';}}
function createDialog(title){
  close();previousFocus=document.activeElement;
  dialog=node('dialog',null,'olliSharedChatDialog');dialog.setAttribute('aria-label',title);
  const head=node('header');head.append(node('strong',title),button('내 학원 대화로 돌아가기',close));
  const status=node('p','연결 확인 중…','olliSharedChatStatus');status.dataset.sharedStatus='';status.setAttribute('role','status');
  dialog.append(head,status);document.body.append(dialog);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();
  return dialog;
}
async function refreshEntry(){
  const ctx=context();if(!ctx.sessionToken||!ctx.academyId){reset();return null;}
  try{
    const status=await rpc('status',params(ctx),ctx);
    let summary=null;if(status.enabled&&status.room)summary=await rpc('summary',params(ctx,status.room),ctx);
    assertCurrent(ctx);
    for(const el of document.querySelectorAll('[data-shared-chat-entry]')){
      el.hidden=!(status.enabled&&status.room);el.textContent='공동 대화'+(summary?.unread_count?' · '+summary.unread_count:'');
    }
    return status;
  }catch(_){for(const el of document.querySelectorAll('[data-shared-chat-entry]'))el.hidden=true;return null;}
}
function errorState(error){
  state.ready=false;state.messages=[];dialog?.querySelector('[data-shared-messages]')?.replaceChildren();
  announce(clean(error?.message)||'연결이 끊어졌습니다. 새로고침 후 다시 시도해 주세요.');
  const send=dialog?.querySelector('[data-shared-send]');if(send)send.disabled=true;
}
async function refresh(){
  if(mode!=='chat'||!dialog?.open||document.hidden)return true;
  if(state.busy)return false;
  const ctx=context(),seq=++state.sequence,active=dialog;
  try{
    const status=await rpc('status',params(ctx),ctx);
    if(!status.enabled||!status.room)throw new Error('공동 대화 참여가 해제되었습니다. 내 학원 대화로 돌아가 주세요.');
    const epoch=key(ctx)+':'+status.room.id+':'+status.room.participation_id;
    const [payload,members]=await Promise.all([
      rpc('list',{...params(ctx,status.room),p_limit:100},ctx),rpc('members',params(ctx,status.room),ctx)
    ]);
    if(seq!==state.sequence||dialog!==active)return true;
    if(epoch!==state.epoch){state.messages=[];state.reply=null;state.edit=null;state.lastRead=0;}
    const merged=new Map(state.messages.map(m=>[m.id,m]));
    for(const msg of payload.messages)merged.set(msg.id,msg);
    for(const id of payload.deleted_message_ids)merged.delete(id);
    state.messages=[...merged.values()].sort((a,b)=>a.seq-b.seq);state.members=members.members;
    state.status=status;state.room=status.room;state.epoch=epoch;state.ready=true;
    renderMessages();renderMembers();updateComposer();announce('참여 지점: '+status.room.academies.map(a=>a.display_name).join(' · '));
    const latest=payload.messages.at(-1)?.seq||0;
    if(latest>state.lastRead){
      await rpc('mark_read',{...params(ctx,status.room),p_up_to_seq:latest},ctx);
      if(seq===state.sequence)state.lastRead=latest;
    }
    refreshEntry();return true;
  }catch(error){if(seq===state.sequence&&dialog===active)errorState(error);return false;}
}
function updateComposer(){
  const target=dialog?.querySelector('[data-shared-reply]');
  if(target)target.textContent=state.edit?'메시지 수정 중':state.reply?'답장: '+state.reply.sender_name+' · '+state.reply.branch_name:'';
  const send=dialog?.querySelector('[data-shared-send]');if(send)send.disabled=!state.ready||state.busy;
  const input=dialog?.querySelector('textarea');if(input)input.disabled=!state.ready||state.busy;
  const file=dialog?.querySelector('input[type=file]');if(file)file.disabled=!state.ready||state.busy||!!state.edit;
  dialog?.querySelectorAll('[data-shared-members] input').forEach(el=>{el.disabled=!state.ready||state.busy;});
}
function renderMessages(){
  const list=dialog?.querySelector('[data-shared-messages]');if(!list)return;
  const firstRender=!list.childElementCount,previousScroll=list.scrollTop;
  const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<100;
  list.replaceChildren();
  for(const msg of state.messages){
    const row=node('article',null,'olliSharedChatMessage'+(msg.is_mine?' mine':'')+(msg.message_type==='system'?' system':''));
    row.dataset.messageId=msg.id;
    const name=node('div',msg.sender_name,'olliSharedChatSender');
    if(msg.branch_name)name.append(node('span',msg.branch_name,'olliSharedChatBranch'));
    row.append(name);
    if(msg.reply_to_message_id){
      const parent=state.messages.find(m=>m.id===msg.reply_to_message_id);
      row.append(node('small',parent?'↳ '+parent.sender_name+': '+parent.body.slice(0,70):'↳ 이전 메시지에 답장'));
    }
    row.append(node('p',msg.body));
    if(msg.mention_all)row.append(node('small','@전체','olliSharedChatBranch'));
    else for(const mention of msg.mentions||[])row.append(node('small','@'+mention.display_name+' · '+mention.branch_name,'olliSharedChatBranch'));
    if(msg.attachment)row.append(button('첨부파일 받기 · '+msg.attachment.file_name,()=>downloadFile(msg.attachment)));
    const time=new Date(msg.created_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    row.append(node('small',time+(msg.edited_at?' · 수정됨':'')+(msg.unread_count?' · 안 읽음 '+msg.unread_count:'')));
    if(msg.message_type!=='system'){
      const tools=node('div',null,'olliSharedChatMessageTools');
      tools.append(button('답장',()=>{state.reply=msg;state.edit=null;updateComposer();dialog.querySelector('textarea').focus();}));
      if(msg.is_mine){
        tools.append(button('수정',()=>{state.edit=msg;state.reply=null;dialog.querySelector('textarea').value=msg.body;updateComposer();}),
          button('삭제',async()=>{if(!global.confirm('이 공동 메시지를 삭제할까요?'))return;try{
            const ctx=chatContext();await rpc('update_message',{...params(ctx,state.room),p_message_id:msg.id,p_body:null,p_delete:true},ctx);await refresh();
          }catch(error){announce(error.message);}}));
      }
      row.append(tools);
    }
    list.append(row);
  }
  list.scrollTop=nearBottom||firstRender?list.scrollHeight:previousScroll;
}
function renderMembers(){
  const picker=dialog?.querySelector('[data-shared-members]');if(!picker)return;
  const checked=new Set([...picker.querySelectorAll('input:checked')].map(el=>el.value));
  picker.replaceChildren();
  for(const item of state.members.filter(m=>!m.is_current_member)){
    const label=node('label');const input=node('input');input.type='checkbox';input.value=item.member_id;input.checked=checked.has(item.member_id);
    label.append(input,node('span',item.display_name),node('span',item.branch_name,'olliSharedChatBranch'));picker.append(label);
  }
}
function mentionParams(){const ids=[...dialog.querySelectorAll('[data-shared-members] input:checked')].map(el=>el.value);return {p_member_ids:ids,p_mention_all:false};}
async function submit(event){
  event?.preventDefault();if(state.busy||!state.ready)return;
  let ctx;try{ctx=chatContext();}catch(_){return;}
  const room=state.room,active=dialog,input=dialog.querySelector('textarea');const body=input.value.trim();if(!body)return;
  const fingerprint=state.epoch,edit=state.edit;state.busy=true;updateComposer();
  const retryKey=input.dataset.clientId||(input.dataset.clientId=crypto.randomUUID());
  let sendError='';try{
    if(edit)await rpc('update_message',{...params(ctx,room),p_message_id:edit.id,p_body:body,p_delete:false},ctx);
    else{
      const sent=await rpc('send',{...params(ctx,room),p_body:body,p_client_message_id:retryKey,
        p_reply_to_message_id:state.reply?.id||null,...mentionParams()},ctx);
      dispatchPush(ctx,room,sent.message_id);
    }
    if(dialog!==active||fingerprint!==state.epoch)return;
    input.value='';delete input.dataset.clientId;state.reply=null;state.edit=null;
    dialog.querySelectorAll('[data-shared-members] input').forEach(el=>{el.checked=false;});
  }catch(error){sendError=error.message;}
  finally{if(dialog===active){state.busy=false;updateComposer();await refresh();if(sendError)announce(sendError);}}
}
async function dispatchPush(ctx,room,messageId){
  try{
    await fetch(supabaseConfig().url+'/functions/v1/olli-shared-chat-push',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_token:ctx.sessionToken,academy_id:ctx.academyId,room_id:room.id,message_id:messageId})
    });
  }catch(_){/* Message remains saved; reattempt is safe through server delivery claims. */}
}
async function enablePush(interactive=true){
  if(global.OlliTalkPush?.ensureSubscription)return global.OlliTalkPush.ensureSubscription({interactive});
  const ctx=context();
  try{
    if(!('serviceWorker' in navigator)||!('PushManager' in global)||!('Notification' in global))throw new Error('이 브라우저에서는 푸시 알림을 지원하지 않습니다.');
    let permission=Notification.permission;
    if(permission!=='granted'&&interactive)permission=await Notification.requestPermission();
    if(permission!=='granted'){if(interactive)announce('브라우저 알림 권한을 허용해 주세요.');return false;}
    const response=await fetch(supabaseConfig().url+'/functions/v1/olli-team-chat-push',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'public-key',session_token:ctx.sessionToken,academy_id:ctx.academyId})
    });const vapid=await response.json();if(!response.ok||!vapid.public_key)throw new Error('알림 공개키를 확인하지 못했습니다.');assertCurrent(ctx);
    // A separate scope preserves any existing PC service worker registration.
    const registration=await navigator.serviceWorker.register('./olli-shared-chat-sw.js?v=20261106-shared-chat-1',{scope:'./shared-chat-push/'});
    if(!registration.active)await new Promise((resolve,reject)=>{
      const worker=registration.installing||registration.waiting;if(!worker)return reject(new Error('알림 등록에 실패했습니다.'));
      worker.addEventListener('statechange',()=>{if(worker.state==='activated')resolve();if(worker.state==='redundant')reject(new Error('알림 등록에 실패했습니다.'));});
    });
    const base64=vapid.public_key.replace(/-/g,'+').replace(/_/g,'/');
    const bytes=Uint8Array.from(atob(base64+'='.repeat((4-base64.length%4)%4)),ch=>ch.charCodeAt(0));
    const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
    assertCurrent(ctx);const value=subscription.toJSON();
    const call=typeof global.supabase==='function'?global.supabase:typeof supabase==='function'?supabase:null;
    if(!call)throw new Error('서버 연결을 확인하지 못했습니다.');
    const result=await call('POST','rpc/olli_team_chat_push_subscribe',{p_session_token:ctx.sessionToken,p_academy_id:ctx.academyId,
      p_endpoint:value.endpoint,p_p256dh:value.keys.p256dh,p_auth:value.keys.auth,p_user_agent:navigator.userAgent});
    assertCurrent(ctx);if(result?.ok!==true)throw new Error('알림 구독을 저장하지 못했습니다.');
    if(interactive)announce('공동 대화 알림을 켰습니다.');return true;
  }catch(error){if(interactive)announce(error.message);return false;}
}
async function fileRequest(ctx,room,body,attachmentId){
  const res=await fetch('/api/shared-team-chat-file'+(attachmentId?'?attachmentId='+encodeURIComponent(attachmentId):''),{
    method:body?'POST':'GET',cache:'no-store',headers:{'X-Olli-Session-Token':ctx.sessionToken,'X-Olli-Academy-Id':ctx.academyId,'X-Olli-Room-Id':room.id,
      ...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})
  });assertCurrent(ctx);if(!res.ok)throw new Error('첨부파일 권한 또는 연결을 확인해 주세요.');return res;
}
async function uploadFile(event){
  const file=event.target.files?.[0];if(!file||state.busy||!state.ready)return;
  if(file.size<1||file.size>20*1024*1024){announce('첨부파일은 20MB 이하로 선택해 주세요.');return;}
  let ctx;try{ctx=chatContext();}catch(_){return;}
  const room=state.room,active=dialog;state.busy=true;updateComposer();
  try{
    const fingerprint=state.epoch+':'+file.name+':'+file.size+':'+file.lastModified;
    if(state.pendingUpload?.fingerprint!==fingerprint){
      const prepared=await(await fileRequest(ctx,room,{action:'prepare',file_name:file.name,mime_type:file.type,file_size:file.size})).json();
      if(dialog!==active)return;
      state.pendingUpload={fingerprint,...prepared,uploaded:false};
    }
    const prepared=state.pendingUpload;
    if(!prepared.uploaded){const uploaded=await fetch(prepared.upload_url,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
      if(!uploaded.ok)throw new Error('파일을 업로드하지 못했습니다.');assertCurrent(ctx);if(dialog!==active)return;prepared.uploaded=true;}
    const result=await(await fileRequest(ctx,room,{action:'commit',attachment_id:prepared.attachment_id,reply_to_message_id:state.reply?.id||null,...mentionParams()})).json();
    dispatchPush(ctx,room,result.message_id);
    if(dialog===active){state.reply=null;state.pendingUpload=null;dialog.querySelectorAll('[data-shared-members] input').forEach(el=>{el.checked=false;});}
  }catch(error){if(dialog===active)announce(error.message);}
  finally{event.target.value='';if(dialog===active){state.busy=false;updateComposer();await refresh();}}
}
async function downloadFile(file){
  let ctx;try{ctx=chatContext();}catch(_){return;}
  const room=state.room;let objectUrl='';
  try{
    const res=await fileRequest(ctx,room,null,file.id);const blob=await res.blob();assertCurrent(ctx);
    objectUrl=URL.createObjectURL(blob);const a=node('a');a.href=objectUrl;a.download=file.file_name;a.click();
  }catch(error){announce(error.message);}
  finally{if(objectUrl)setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
}
async function older(){
  if(state.busy||!state.ready||!state.messages.length)return;
  let ctx;try{ctx=chatContext();}catch(_){return;}
  const room=state.room,active=dialog,epoch=state.epoch;
  try{
    const result=await rpc('list',{...params(ctx,room),p_before_seq:state.messages[0].seq,p_limit:100},ctx);
    if(dialog!==active||state.epoch!==epoch)return;
    const merged=new Map([...result.messages,...state.messages].map(m=>[m.id,m]));
    for(const id of result.deleted_message_ids)merged.delete(id);
    state.messages=[...merged.values()].sort((a,b)=>a.seq-b.seq);renderMessages();
    if(!result.messages.length)announce('참여 이후의 첫 메시지입니다.');
  }catch(error){errorState(error);}
}
async function open(){
  if(global.OlliPcTeamTalk?.open)return global.OlliPcTeamTalk.open();
  if(typeof global.openOlliTalkBetaPage==='function')return global.openOlliTalkBetaPage();
  return false;
}
async function privateQuestion(){
  if(!state.ready||state.busy)return;
  let ctx;try{ctx=chatContext();}catch(_){return;}
  const draft=dialog.querySelector('textarea').value.trim();
  // Explicit handoff preserves the selected business academy; no group context
  // or shared history is ever forwarded to an AI endpoint or action executor.
  close();
  try{
    if(global.OlliPcTeamTalk?.open)await global.OlliPcTeamTalk.open();
    else if(global.openOlliTalkBetaPage)await global.openOlliTalkBetaPage();
    assertCurrent(ctx);
    const input=document.getElementById('olliPcTeamTalkInput')||document.getElementById('olliTalkBetaInput');
    if(input&&draft){input.value='@올리 '+draft.replace(/^@올리\s*/, '');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}
  }catch(_){/* Context changes discard the private handoff rather than forwarding it. */}
}
function renderManagement(status){
  const body=dialog.querySelector('[data-shared-management]');body.replaceChildren();
  if(!status.enabled){announce('팀챗 통합 기능은 아직 준비 중입니다.');return;}
  if(!status.can_manage){announce('원장만 팀챗 통합을 관리할 수 있습니다.');return;}
  announce('학원별 업무 권한과 기존 대화 기록은 유지됩니다. 해제 즉시 공동 대화 접근이 중단되고, 재가입하면 재가입 이후 대화만 볼 수 있습니다.');
  const selected=new Map((status.room?.academies||[]).map(a=>[a.academy_id,a]));
  const ctx=context();
  for(const academy of status.academies){
    const row=node('label',null,'olliSharedChatAcademy');row.dataset.academyId=academy.academy_id;
    const check=node('input');check.type='checkbox';check.checked=selected.has(academy.academy_id)||academy.academy_id===ctx.academyId;
    check.disabled=academy.academy_id===ctx.academyId||!!(academy.room_id&&academy.room_id!==status.room?.id);
    const name=node('input');name.type='text';name.maxLength=20;name.value=selected.get(academy.academy_id)?.display_name||'';name.placeholder='팀챗 표시 이름';name.setAttribute('aria-label',academy.academy_name+' 팀챗 표시 이름');
    row.append(check,node('span',academy.academy_name),name);body.append(row);
  }
  body.append(button('통합 설정 저장',saveManagement));
  if(status.room)body.append(button('현재 학원 통합 해제',async()=>{
    if(!global.confirm('현재 학원의 공동 대화 접근이 즉시 중단됩니다. 통합을 해제할까요?'))return;
    await manageMutation(async()=>rpc('leave',{...params(ctx,status.room),p_expected_revision:status.room.revision},ctx));
  }));
}
async function manageMutation(run){
  if(state.busy)return;state.busy=true;const active=dialog;
  const disabled=[...active.querySelectorAll('button,input')].map(el=>[el,el.disabled]);
  disabled.forEach(([el])=>{el.disabled=true;});
  try{const status=await run();if(dialog!==active)return;state.status=status;state.room=status.room;configRequest=null;renderManagement(status);announce('서버에 저장되었습니다.');refreshEntry();}
  catch(error){if(dialog===active)announce(error.message);}
  finally{if(dialog===active){state.busy=false;disabled.forEach(([el,value])=>{if(el.isConnected)el.disabled=value;});}}
}
async function saveManagement(){
  if(state.epoch!==key(context())){reset();return;}
  const academies=[...dialog.querySelectorAll('[data-academy-id]')].filter(row=>row.querySelector('input[type=checkbox]').checked)
    .map(row=>({academy_id:row.dataset.academyId,display_name:row.querySelector('input[type=text]').value.trim()}));
  const payload=JSON.stringify(academies);if(configRequest?.payload!==payload)configRequest={id:crypto.randomUUID(),payload};
  const ctx=context();await manageMutation(()=>rpc('configure',{...params(ctx),p_room_id:state.room?.id||null,
    p_expected_revision:state.room?.revision||null,p_academies:academies,p_request_id:configRequest.id},ctx));
}
async function manage(){
  const root=document.querySelector('#settingsDetailBody [data-olli-shared-inline-settings]');
  if(!root)return false;
  root.scrollIntoView({block:'nearest',behavior:'smooth'});
  mountSettings(root);
  return true;
}
function start(){
  
  global.OlliStorageCore?.AcademyContext?.registerRuntimeCleaner?.(reset);
  global.addEventListener('olli:account-session-invalidated',reset);
  global.addEventListener('storage',event=>{if(!event.key||['olli_account_session_token_v1','olli_current_academy_id','olli_current_member_id'].includes(event.key))reset();});
  global.addEventListener('online',()=>{refreshEntry();refresh();});global.addEventListener('focus',()=>{refreshEntry();refresh();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){state.messages=[];dialog?.querySelector('[data-shared-messages]')?.replaceChildren();state.ready=false;}else{refreshEntry();refresh();}});
  watcher=global.OlliRealtime?.watchDomain?.('chat',()=>{refreshEntry();return refresh();});
  navigator.serviceWorker?.addEventListener?.('message',event=>{
    if(event.data?.type==='OLLI_SHARED_CHAT_REFRESH'){refreshEntry();refresh();}
    if(event.data?.type==='OLLI_SHARED_CHAT_OPEN')openNotification(event.data.roomId);
  });
  const query=new URLSearchParams(global.location.search),target=query.get('sharedChat');
  if(target){query.delete('sharedChat');global.history.replaceState(global.history.state,'',global.location.pathname+(query.size?'?'+query:'')+global.location.hash);openNotification(target);}
}
async function openNotification(roomId){
  // A notification never switches academy or grants a room. Verify the selected academy.
  const status=await refreshEntry();if(status?.room?.id===roomId)await open();
  else if(status?.enabled){global.alert?.('현재 선택한 학원은 해당 팀챗 통합에 참여하지 않습니다.');}
}

/* Single Team Chat integration: use the existing PC / mobile message surface.
 * Shared messages are never written to the legacy academy cache. */
async function unifiedExtension(options={}){
  const ctx=context();
  if(!ctx.academyId||!ctx.sessionToken)return {joined:false,messages:[],members:[]};
  const status=await rpc('status',params(ctx),ctx);
  if(!status.enabled||!status.room)return {joined:false,messages:[],members:[],status};
  const room=status.room,epoch=key(ctx);
  const requests=[];
  if(options.messages)requests.push(rpc('list',{...params(ctx,room),p_limit:100},ctx));
  if(options.members)requests.push(rpc('members',params(ctx,room),ctx));
  const responses=await Promise.all(requests);
  assertCurrent(ctx);
  let cursor=0;
  const list=options.messages?responses[cursor++]:null;
  const memberPayload=options.members?responses[cursor++]:null;
  if(list&&(list.room_id!==room.id||list.participation_id!==room.participation_id))throw new Error('팀챗 참여 상태가 변경되었습니다.');
  // Shared storage is for ordinary conversation and files, never Olli work actions.
  const messages=(list?.messages||[]).filter(msg=>
    ['text','system','file'].includes(String(msg?.message_type||''))
    && !msg?.material_request_id && !msg?.material_event_id && !msg?.action
  ).map(msg=>({
    ...msg,
    id:'shared:'+msg.id,
    shared_message_id:msg.id,
    shared_seq:msg.seq,
    is_shared:true,
    sender_member_id:msg.is_mine?ctx.memberId:msg.sender_member_id,
    body:msg.body,
    attachment:msg.attachment?{...msg.attachment,is_shared:true}:null,
    reply_to_message_id:null
  }));
  return {joined:true,room,status,epoch,messages,members:memberPayload?.members||[],latestSeq:(list?.messages||[]).at(-1)?.seq||0};
}
async function sendUnified(body,clientId){
  const ctx=context(),status=await rpc('status',params(ctx),ctx);
  if(!status.enabled||!status.room)return {joined:false};
  const room=status.room;
  const memberResult=await rpc('members',params(ctx,room),ctx);
  const memberIds=(memberResult.members||[]).filter(m=>!m.is_current_member&&
    (String(body).includes('@'+String(m.display_name||''))&&String(m.display_name||'').trim())).map(m=>m.member_id);
  // No cross-academy @all target. Direct @teacher mentions remain available.
  const result=await rpc('send',{...params(ctx,room),p_body:String(body),
    p_client_message_id:clientId||crypto.randomUUID(),p_reply_to_message_id:null,
    p_member_ids:[...new Set(memberIds)],p_mention_all:false},ctx);
  assertCurrent(ctx);
  dispatchPush(ctx,room,result.message_id);
  return {joined:true,message_id:result.message_id};
}
async function markUnifiedRead(roomId,seq){
  if(!roomId||!Number(seq))return false;
  const ctx=context(),status=await rpc('status',params(ctx),ctx);
  if(!status.room||status.room.id!==roomId)return false;
  await rpc('mark_read',{...params(ctx,status.room),p_up_to_seq:Number(seq)},ctx);
  return true;
}
async function uploadUnified(file){
  if(!file||file.size<1||file.size>20*1024*1024)throw new Error('첨부파일은 20MB 이하만 올릴 수 있습니다.');
  const ctx=context(),status=await rpc('status',params(ctx),ctx);
  if(!status.enabled||!status.room)return {joined:false};
  const room=status.room;
  const prepared=await (await fileRequest(ctx,room,{action:'prepare',file_name:file.name,mime_type:file.type||'application/octet-stream',file_size:file.size})).json();
  if(!prepared.ok||!prepared.upload_url||!prepared.attachment_id)throw new Error('공동 첨부파일 업로드를 준비하지 못했습니다.');
  const uploaded=await fetch(prepared.upload_url,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
  if(!uploaded.ok)throw new Error('공동 첨부파일 업로드에 실패했습니다.');
  assertCurrent(ctx);
  const result=await (await fileRequest(ctx,room,{action:'commit',attachment_id:prepared.attachment_id})).json();
  if(!result.ok)throw new Error('공동 첨부파일 저장에 실패했습니다.');
  dispatchPush(ctx,room,result.message_id);
  return {joined:true,message_id:result.message_id};
}

/* One authorized media read path for both PC and Phone.
 * The shared bucket is private: no direct Storage URL and no persistent cache. */
const UNIFIED_MEDIA_MIME=/^(?:image\/(?:jpeg|png|gif|webp|bmp|avif|heic|heif)|video\/(?:mp4|quicktime|webm|ogg|x-m4v))$/i;
function unifiedMediaType(attachment){
  const mime=clean(attachment?.mime_type).split(';')[0].toLowerCase();
  return UNIFIED_MEDIA_MIME.test(mime)?mime:'';
}
async function fetchUnifiedBlob(attachment){
  const id=clean(attachment?.id);
  if(!id)throw new Error('파일 정보를 찾을 수 없습니다.');
  const ctx=context(),status=await rpc('status',params(ctx),ctx);
  if(!status.enabled||!status.room)throw new Error('현재 팀챗에 참여하지 않습니다.');
  const response=await fileRequest(ctx,status.room,null,id);
  const blob=await response.blob();
  assertCurrent(ctx);
  if(!blob.size)throw new Error('원본 파일 데이터가 비어 있습니다.');
  const mime=unifiedMediaType(attachment);
  return mime?new Blob([blob],{type:mime}):blob;
}
function mountUnifiedThumbnail(attachment,target){
  const mime=unifiedMediaType(attachment);
  if(!mime||!target)return false;
  const showImage=url=>{
    const img=node('img',null,'olliUnifiedThumbnailImage');img.alt='';
    img.onload=()=>{
      if(target.isConnected){
        target.append(img);
        const fallback=target.querySelector('.olliPcTeamTalkAttachmentFallback,.olliTalkBetaAttachmentImageFallback');
        if(fallback)fallback.style.display='none';
      }
      if(url.startsWith('blob:'))URL.revokeObjectURL(url);
    };
    img.onerror=()=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url);};
    img.src=url;
  };
  const load=async()=>{
    try{
      const blob=await fetchUnifiedBlob(attachment);
      if(!target.isConnected)return;
      const url=URL.createObjectURL(blob);
      if(mime.startsWith('image/')){showImage(url);return;}
      // A video poster is generated locally only when the browser supports its codec.
      // QuickTime MOV can be unplayable in Chrome: retain the visible video fallback.
      const video=node('video');video.muted=true;video.playsInline=true;video.preload='auto';
      let finished=false;
      const finish=()=>{
        if(finished)return;finished=true;clearTimeout(timeout);
        try{if(video.videoWidth&&video.videoHeight&&target.isConnected){
          const canvas=node('canvas'),scale=Math.min(1,360/Math.max(video.videoWidth,video.videoHeight));
          canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
          canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
          canvas.getContext('2d')?.drawImage(video,0,0,canvas.width,canvas.height);
          showImage(canvas.toDataURL('image/jpeg',0.72));
        }}catch(_){}
        video.removeAttribute('src');video.load();URL.revokeObjectURL(url);
      };
      video.addEventListener('loadeddata',()=>{
        try{video.currentTime=Math.min(0.1,Math.max(0,video.duration||0)/2);}
        catch(_){finish();}
      },{once:true});
      video.addEventListener('seeked',finish,{once:true});
      video.addEventListener('error',finish,{once:true});
      const timeout=setTimeout(finish,8000);
      video.src=url;video.load();
    }catch(_){
      // Keep the original fallback card visible; private files never use a public URL.
    }
  };
  if(typeof global.IntersectionObserver==='function'){
    const observer=new global.IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load();}
    },{rootMargin:'160px'});
    observer.observe(target);
  }else load();
  return true;
}
async function downloadUnified(attachment){
  const blob=await fetchUnifiedBlob(attachment);
  const url=URL.createObjectURL(blob),a=node('a');
  a.href=url;a.download=clean(attachment?.file_name)||'파일';
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  return true;
}
let inlineSettingsSequence=0;
function mountSettings(root){
  if(!root)return;
  const renderSequence=++inlineSettingsSequence,ctx=context();
  root.replaceChildren();
  const heading=node('div',null,'olliTeamTalkSettingsHead');
  const copy=node('div');
  copy.append(node('strong','학원 팀챗 통합'),node('small','통합 학원을 선택하면 기존 Team Chat 한 곳에서 함께 대화합니다.'));
  heading.append(copy);root.append(heading);
  const message=node('p','통합 상태 확인 중…','olliSharedInlineStatus');
  message.setAttribute('role','status');root.append(message);
  rpc('status',params(ctx),ctx).then(status=>{
    if(renderSequence!==inlineSettingsSequence||!root.isConnected)return;
    assertCurrent(ctx);
    renderInlineSettings(root,status,ctx,message);
  }).catch(error=>{
    if(renderSequence!==inlineSettingsSequence||!root.isConnected)return;
    message.textContent=error.message||'팀챗 연결 상태를 불러오지 못했습니다.';
  });
}
function renderInlineSettings(root,status,ctx,message){
  if(!status.enabled){message.textContent='현재 통합 기능이 비활성화되어 있습니다.';return;}
  if(!status.can_manage){message.textContent='원장 계정에서만 통합 설정을 변경할 수 있습니다.';return;}
  message.textContent=status.room?'통합 중 · 참여 학원 '+(status.room.academies||[]).length+'곳':'통합할 학원을 선택해 주세요.';
  const selected=new Map((status.room?.academies||[]).map(item=>[item.academy_id,item]));
  const body=node('div',null,'olliSharedInlineAcademies');
  for(const academy of status.academies||[]){
    const row=node('div',null,'olliSharedInlineAcademy');
    row.dataset.academyId=academy.academy_id;
    const check=node('input');check.type='checkbox';check.checked=selected.has(academy.academy_id)||academy.academy_id===ctx.academyId;
    check.disabled=academy.academy_id===ctx.academyId||!!(academy.room_id&&academy.room_id!==status.room?.id);
    check.setAttribute('aria-label',academy.academy_name+' 참여');
    const nameLabel=node('span',academy.academy_name,'olliSharedInlineAcademyName');
    const display=node('input');display.type='text';display.maxLength=20;
    display.value=selected.get(academy.academy_id)?.display_name||'';
    display.placeholder='팀챗 표시 이름 (예: 대천점)';
    display.setAttribute('aria-label',academy.academy_name+' 팀챗 표시 이름');
    display.disabled=!check.checked;
    check.addEventListener('change',()=>{display.disabled=!check.checked;});
    row.append(check,nameLabel,display);body.append(row);
  }
  root.append(body);
  root.append(node('p','기존 학원 대화·개인 업무·급여 기록은 다른 학원에 공개되지 않습니다.','olliSharedInlineHint'));
  const controls=node('div',null,'olliSharedInlineActions');
  const save=button('변경사항 저장',async()=>{
    const academies=[...body.querySelectorAll('[data-academy-id]')].filter(row=>row.querySelector('input[type=checkbox]').checked)
      .map(row=>({academy_id:row.dataset.academyId,display_name:row.querySelector('input[type=text]').value.trim()}));
    if(academies.length<2){message.textContent='통합하려면 학원을 두 곳 이상 선택해 주세요.';return;}
    if(academies.some(item=>!item.display_name)){message.textContent='선택한 학원의 표시 이름을 입력해 주세요.';return;}
    controls.querySelectorAll('button').forEach(btn=>{btn.disabled=true;});
    message.textContent='서버에 저장하는 중…';
    try{
      const saved=await rpc('configure',{...params(ctx),p_room_id:status.room?.id||null,
        p_expected_revision:status.room?.revision||null,p_academies:academies,p_request_id:crypto.randomUUID()},ctx);
      if(!root.isConnected||key(ctx)!==key(context()))return;
      mountSettings(root);
      global.dispatchEvent(new CustomEvent('olli:shared-team-chat-changed'));
      return saved;
    }catch(error){message.textContent=error.message||'통합 설정 저장에 실패했습니다.';controls.querySelectorAll('button').forEach(btn=>{btn.disabled=false;});}
  },'olliSharedInlinePrimary');
  if(status.room){
    const leave=button('현재 학원 통합 해제',async()=>{
      if(!global.confirm('이 학원의 공동 대화 참여를 해제할까요? 기존 메시지는 삭제되지 않습니다.'))return;
      controls.querySelectorAll('button').forEach(btn=>{btn.disabled=true;});
      message.textContent='통합을 해제하는 중…';
      try{
        await rpc('leave',{...params(ctx,status.room),p_expected_revision:status.room.revision},ctx);
        if(!root.isConnected||key(ctx)!==key(context()))return;
        mountSettings(root);global.dispatchEvent(new CustomEvent('olli:shared-team-chat-changed'));
      }catch(error){message.textContent=error.message||'통합 해제에 실패했습니다.';controls.querySelectorAll('button').forEach(btn=>{btn.disabled=false;});}
    },'olliSharedInlineSecondary');
    controls.append(leave);
  }
  controls.append(save);root.append(controls);
}

global.OlliSharedTeamChat=Object.freeze({version:'2.0.0',open,manage,close,refreshEntry,reset,context,unifiedExtension,sendUnified,markUnifiedRead,uploadUnified,downloadUnified,fetchUnifiedBlob,mountUnifiedThumbnail,mountSettings});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
