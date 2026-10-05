(function initializeOlliPcTeamTalk(global) {
  'use strict';

  if (global.OlliPcTeamTalk?.version) return;

  const VERSION = '1.2.0';
  const ACCOUNT_SESSION_TOKEN_KEY = 'olli_account_session_token_v1';
  // Shared Work notification summary. The RPC name is historical; the contract is used by both PC and mobile.
  const TEAM_TALK_NOTIFICATION_SUMMARY_RPC = 'olli_mobile_work_notification_summary';
  const state = {
    archiveTab: 'files',
    workspaceTab: 'materials',
    messages: [],
    members: [],
    archivePayload: null,
    messageLoadSequence: 0,
    archiveLoadSequence: 0,
    sendBusy: false,
    olliModeActive: false,
    olliAiMentionSelected: false,
    assistantReplyPending: false,
    aiConversationMessages: [],
    pendingActionReason: null,
    pendingTextInputMessageId: '',
    pendingMakeupDialogue: null,
    actionBusy: new Set(),
    olliReplyBusy: new Set(),
    uploadBusy: false,
    realtimeWatcher: null,
    blobUrls: new Map(),
    desktopNotificationContextKey: '',
    desktopNotificationLatestMessageId: 0,
    desktopNotificationSyncBusy: false,
    desktopNotificationSyncPending: false,
    started: false
  };

  const byId = (id) => document.getElementById(id);

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function context() {
    let academyContext = null;
    try { academyContext = global.OlliStorageCore?.AcademyContext?.getCurrent?.() || null; } catch (_) {}
    let sessionToken = '';
    let academyId = '';
    let memberId = '';
    let memberName = '';
    try {
      sessionToken = clean(localStorage.getItem(ACCOUNT_SESSION_TOKEN_KEY));
      academyId = clean(localStorage.getItem('olli_current_academy_id'));
      memberId = clean(localStorage.getItem('olli_current_member_id'));
      memberName = clean(localStorage.getItem('olli_current_member_name'));
    } catch (_) {}

    return {
      academyId: clean(academyContext?.academyId || academyContext?.academy_id || academyId),
      memberId: clean(academyContext?.memberId || academyContext?.member_id || memberId),
      memberName: clean(academyContext?.memberName || academyContext?.member_name || memberName),
      sessionToken
    };
  }

  function isVisible() {
    const screen = byId('olliPcTeamTalkScreen');
    if (!screen) return false;
    const shell = byId('olliPcShell');
    return shell?.dataset?.pcSection === 'talk' && getComputedStyle(screen).display !== 'none';
  }

  async function rpc(name, params) {
    const call = typeof global.supabase === 'function'
      ? global.supabase
      : (typeof supabase === 'function' ? supabase : null);
    if (!call) throw new Error('Supabase 연결이 준비되지 않았습니다.');
    return call('POST', `rpc/${name}`, params);
  }

  const TEAM_TALK_PUSH_FUNCTION_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co/functions/v1/olli-team-chat-push';

  async function dispatchTeamTalkPush(messageId, current = context()) {
    const id = Number(messageId || 0);
    if (!id || !current?.sessionToken || !current?.academyId) return false;

    try {
      const response = await fetch(TEAM_TALK_PUSH_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dispatch',
          session_token: current.sessionToken,
          academy_id: current.academyId,
          message_id: id
        })
      });
      const raw = await response.text();
      let result = {};
      try { result = raw ? JSON.parse(raw) : {}; } catch (_) { result = { error: raw }; }
      if (!response.ok || result?.ok !== true) {
        throw new Error(result?.error || `푸시 서버 요청 실패 (${response.status})`);
      }
      return true;
    } catch (error) {
      console.warn('PC 팀톡 푸시 요청 실패:', error?.message || error);
      return false;
    }
  }

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function formatTime(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '';
    let hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, '0');
    const meridiem = hour < 12 ? '오전' : '오후';
    hour %= 12;
    if (!hour) hour = 12;
    return `${meridiem} ${hour}:${minute}`;
  }

  function dateKey(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  function formatDate(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '';
    const today = new Date();
    if (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    ) return '오늘';
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value || 0));
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function fileExtension(name) {
    const match = clean(name).match(/\.([a-zA-Z0-9]{1,8})$/);
    return match ? match[1].toUpperCase() : 'FILE';
  }

  function firstUrl(text) {
    const match = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
    return match ? match[0].replace(/[),.!?]+$/, '') : '';
  }

  function urlDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ''); }
    catch (_) { return '링크'; }
  }

  function emptyState(title, description) {
    const wrap = create('div', 'olliPcTeamTalkEmpty');
    const icon = create('div', 'olliPcTeamTalkEmptyIcon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 48 48"><path d="M10 12.5h28a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H23l-8.5 6v-6H10a5 5 0 0 1-5-5v-14a5 5 0 0 1 5-5Z"></path><path d="M15 24h18"></path></svg>';
    wrap.append(icon, create('div', 'olliPcTeamTalkEmptyTitle', title));
    if (description) wrap.appendChild(create('div', 'olliPcTeamTalkEmptyText', description));
    return wrap;
  }

  function setBadge(count) {
    const badge = byId('olliPcTeamTalkBadge');
    if (!badge) return;
    const value = Math.max(0, Number(count || 0));
    badge.hidden = value < 1;
    badge.textContent = value > 99 ? '99+' : String(value || '');
    badge.setAttribute('aria-label', value ? `읽지 않은 팀톡 알림 ${value}개` : '읽지 않은 팀톡 알림 없음');
  }

  async function refreshBadge() {
    const current = context();
    if (!current.sessionToken || !current.academyId) {
      setBadge(0);
      return false;
    }
    try {
      const payload = await rpc('olli_team_chat_mention_summary', {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId
      });
      if (!payload?.ok) return false;
      setBadge(payload.unread_count || 0);
      return true;
    } catch (error) {
      console.warn('PC 팀톡 알림 배지 확인 실패:', error?.message || error);
      return false;
    }
  }

  async function markRead(messageId) {
    const current = context();
    if (!current.sessionToken || !current.academyId) return false;
    try {
      const payload = await rpc('olli_team_chat_mark_read', {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId,
        p_up_to_message_id: Number(messageId || 0) || null
      });
      if (!payload?.ok) return false;
      setBadge(0);
      return true;
    } catch (error) {
      console.warn('PC 팀톡 읽음 처리 실패:', error?.message || error);
      return false;
    }
  }

  function desktopNotificationContextKey(current = context()) {
    const academyId = clean(current?.academyId);
    const memberId = clean(current?.memberId);
    return academyId && memberId ? `${academyId}:${memberId}` : '';
  }

  function pcSystemNotificationsEnabled() {
    try {
      const cached = typeof global.settingsGetCachedState === 'function'
        ? global.settingsGetCachedState()
        : null;
      return cached?.notificationEnabled !== false;
    } catch (_) {
      return true;
    }
  }

  async function fetchTeamTalkNotificationSummary(current = context()) {
    if (!current?.sessionToken || !current?.academyId) return null;
    const payload = await rpc(TEAM_TALK_NOTIFICATION_SUMMARY_RPC, {
      p_session_token: current.sessionToken,
      p_academy_id: current.academyId
    });
    if (!payload?.ok) return null;
    return payload;
  }

  function isCurrentMemberMention(body, current = context()) {
    const memberName = clean(current?.memberName);
    return !!memberName && String(body || '').includes(`@${memberName}`);
  }

  function isTeamTalkActivelyViewed() {
    return isVisible()
      && document.visibilityState === 'visible'
      && typeof document.hasFocus === 'function'
      && document.hasFocus();
  }

  async function openDesktopNotificationMessage(messageId) {
    try { global.focus?.(); } catch (_) {}
    try {
      await open();
      const id = String(Number(messageId || 0) || '');
      if (!id) return;
      const row = document.querySelector(`#olliPcTeamTalkMessages [data-message-id="${id}"]`);
      row?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    } catch (error) {
      console.warn('PC Team Chat 알림 이동 실패:', error?.message || error);
    }
  }

  function showDesktopTeamTalkNotification(summary, current = context()) {
    if (!pcSystemNotificationsEnabled()) return false;
    if (!('Notification' in global) || global.Notification.permission !== 'granted') return false;
    if (isTeamTalkActivelyViewed()) return false;

    const messageId = Number(summary?.latest_message_id || 0);
    if (!messageId) return false;

    const senderName = clean(summary?.latest_sender_name) || '선생님';
    const rawBody = clean(summary?.latest_body);
    const body = rawBody || '사진 또는 파일을 보냈습니다.';
    const mentioned = isCurrentMemberMention(rawBody, current);
    const title = mentioned ? 'Team Chat · 멘션' : 'Team Chat 새 메시지';

    try {
      const notification = new global.Notification(title, {
        body: `${senderName}: ${body}`,
        tag: `olli-pc-team-chat-${messageId}`,
        silent: false
      });
      notification.onclick = () => {
        try { notification.close(); } catch (_) {}
        openDesktopNotificationMessage(messageId);
      };
      return true;
    } catch (error) {
      console.warn('PC Team Chat Windows 알림 표시 실패:', error?.message || error);
      return false;
    }
  }

  async function primeDesktopNotificationState() {
    const current = context();
    const key = desktopNotificationContextKey(current);
    if (!key) return false;

    try {
      const summary = await fetchTeamTalkNotificationSummary(current);
      if (!summary) return false;
      state.desktopNotificationContextKey = key;
      const latestMessageId = Number(summary.latest_message_id || 0);
      state.desktopNotificationLatestMessageId = latestMessageId > 0 ? latestMessageId : 0;
      return true;
    } catch (error) {
      console.warn('PC Team Chat Windows 알림 기준점 확인 실패:', error?.message || error);
      return false;
    }
  }

  async function refreshDesktopNotificationFromRealtime() {
    const current = context();
    const key = desktopNotificationContextKey(current);
    if (!key) return false;

    if (state.desktopNotificationContextKey !== key) {
      return primeDesktopNotificationState();
    }

    if (state.desktopNotificationSyncBusy) {
      state.desktopNotificationSyncPending = true;
      return false;
    }

    state.desktopNotificationSyncBusy = true;
    try {
      const summary = await fetchTeamTalkNotificationSummary(current);
      if (!summary) return false;

      const latestMessageId = Number(summary.latest_message_id || 0);
      if (!latestMessageId) return false;

      const previousMessageId = Number(state.desktopNotificationLatestMessageId || 0);
      if (latestMessageId <= previousMessageId) return false;

      state.desktopNotificationLatestMessageId = latestMessageId;
      if (Number(summary.chat_unread_count || 0) < 1) return false;

      return showDesktopTeamTalkNotification(summary, current);
    } catch (error) {
      console.warn('PC Team Chat Windows 알림 동기화 실패:', error?.message || error);
      return false;
    } finally {
      state.desktopNotificationSyncBusy = false;
      if (state.desktopNotificationSyncPending) {
        state.desktopNotificationSyncPending = false;
        Promise.resolve().then(() => refreshDesktopNotificationFromRealtime());
      }
    }
  }

  async function loadMembers() {
    const current = context();
    const count = byId('olliPcTeamTalkMemberCount');
    if (!current.sessionToken || !current.academyId) {
      state.members = [];
      if (count) count.textContent = '';
      return [];
    }
    try {
      const payload = await rpc('olli_team_chat_members', {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId
      });
      state.members = Array.isArray(payload?.members) ? payload.members : [];
      if (count) count.textContent = state.members.length ? `선생님 ${state.members.length}명` : '';
      renderMentionMenu();
      return state.members;
    } catch (error) {
      state.members = [];
      if (count) count.textContent = '';
      console.warn('PC 팀톡 멤버 조회 실패:', error?.message || error);
      return [];
    }
  }

  function attachmentUrl(id) {
    return `/api/team-talk-file?attachmentId=${encodeURIComponent(String(id || ''))}`;
  }

  async function getAttachmentBlobUrl(attachment) {
    const id = clean(attachment?.id);
    if (!id) throw new Error('첨부파일 정보가 없습니다.');
    if (state.blobUrls.has(id)) return state.blobUrls.get(id);

    const current = context();
    const promise = fetch(attachmentUrl(id), {
      method: 'GET',
      headers: {
        'X-Olli-Session-Token': current.sessionToken,
        'X-Olli-Academy-Id': current.academyId
      }
    }).then(async (response) => {
      if (!response.ok) {
        let message = '파일을 불러오지 못했습니다.';
        try {
          const payload = await response.json();
          message = payload?.error || message;
        } catch (_) {}
        throw new Error(message);
      }
      return URL.createObjectURL(await response.blob());
    }).catch((error) => {
      state.blobUrls.delete(id);
      throw error;
    });

    state.blobUrls.set(id, promise);
    return promise;
  }

  async function downloadAttachment(attachment) {
    try {
      const url = await getAttachmentBlobUrl(attachment);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = clean(attachment?.file_name) || 'file';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      alert(error?.message || '파일을 내려받지 못했습니다.');
    }
  }

  function makeAttachmentCard(item) {
    const attachment = item?.attachment || {};
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'olliPcTeamTalkAttachment';
    card.addEventListener('click', () => downloadAttachment(attachment));

    if (attachment.kind === 'media' && /^image\//i.test(clean(attachment.mime_type))) {
      const thumb = create('span', 'olliPcTeamTalkAttachmentThumb');
      thumb.appendChild(create('span', 'olliPcTeamTalkAttachmentFallback', '사진'));
      getAttachmentBlobUrl(attachment).then((url) => {
        if (!thumb.isConnected) return;
        const image = document.createElement('img');
        image.alt = clean(attachment.file_name);
        image.loading = 'lazy';
        image.src = url;
        thumb.replaceChildren(image);
      }).catch(() => {});
      card.appendChild(thumb);
    } else {
      card.appendChild(create('span', 'olliPcTeamTalkFileType', fileExtension(attachment.file_name)));
    }

    const info = create('span', 'olliPcTeamTalkAttachmentInfo');
    info.append(
      create('span', 'olliPcTeamTalkAttachmentName', clean(attachment.file_name) || '첨부파일'),
      create('span', 'olliPcTeamTalkAttachmentMeta', formatBytes(attachment.file_size))
    );
    card.appendChild(info);
    return card;
  }

  function makeTextBubble(item) {
    const bubble = create('div', 'olliPcTeamTalkBubble');
    const text = String(item?.body || '');
    const url = firstUrl(text);
    if (!url) {
      bubble.textContent = text;
      return bubble;
    }

    bubble.classList.add('olliPcTeamTalkLinkBubble');

    const lead = text.replace(url, '').trim();
    if (lead) bubble.appendChild(create('div', 'olliPcTeamTalkLinkLead', lead));

    const link = document.createElement('a');
    link.className = 'olliPcTeamTalkLinkCard';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const domain = urlDomain(url);
    link.append(
      create('span', 'olliPcTeamTalkLinkMark', (domain.charAt(0) || 'L').toUpperCase()),
      create('span', 'olliPcTeamTalkLinkInfo')
    );
    const info = link.lastElementChild;
    info.append(
      create('span', 'olliPcTeamTalkLinkTitle', lead || domain),
      create('span', 'olliPcTeamTalkLinkDomain', domain)
    );
    bubble.appendChild(link);
    return bubble;
  }

  function normalizeActionPrompt(value) {
    return clean(value)
      .replace(/\n?['‘’\"]?확인['‘’\"]?\s*또는\s*['‘’\"]?취소['‘’\"]?라고\s*입력해\s*주세요\.?/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function actionPrimaryLabel() {
    return '확인';
  }

  function actionStatusLabel(action) {
    const status = clean(action?.status);
    const displayLabel = clean(action?.display_label);
    if (displayLabel) return displayLabel;
    if (status === 'completed') return '완료';
    if (status === 'cancelled') return '취소됨';
    if (status === 'failed') return '처리 실패';
    return '';
  }

  async function handleActionCard(action, operation) {
    const actionId = clean(action?.id);
    if (!actionId || state.actionBusy.has(actionId)) return;

    const current = context();
    if (!current.sessionToken || !current.academyId) {
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    state.actionBusy.add(actionId);
    try {
      const rpcName = operation === 'execute'
        ? 'olli_team_chat_action_execute'
        : 'olli_team_chat_action_cancel';
      const payload = await rpc(rpcName, {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId,
        p_action_id: actionId
      });

      if (!payload?.action) {
        throw new Error(payload?.message || '작업 상태를 확인하지 못했습니다.');
      }

      if (operation === 'execute' && clean(payload.action.status) === 'completed') {
        try {
          global.dispatchEvent(new CustomEvent('olli:schedule-changed', {
            detail:{ source:'team_talk_action', actionId, intent:clean(action?.action_type) }
          }));
        } catch (_) {}
        try {
          if (typeof global.olliTtRefreshSchedule === 'function') await global.olliTtRefreshSchedule();
        } catch (error) {
          console.warn('팀톡 액션 실행 후 시간표 갱신 실패:', error?.message || error);
        }
      }

      await loadMessages({ showLoading:false, followBottom:true });
      if (payload?.ok === false && clean(payload?.action?.status) !== 'failed') {
        alert(payload?.message || '작업을 처리하지 못했습니다.');
      }
    } catch (error) {
      console.warn('PC 팀톡 액션 처리 실패:', error?.message || error);
      alert(error?.message || '작업을 처리하지 못했습니다.');
      await loadMessages({ showLoading:false, followBottom:true });
    } finally {
      state.actionBusy.delete(actionId);
    }
  }

  async function handleSessionGroupChoice(action, group) {
    const actionId=clean(action?.id);
    const classGroup=clean(group).toUpperCase();
    if(!actionId || !['A','B'].includes(classGroup) || state.actionBusy.has(actionId)) return;

    const current=context();
    if(!current.sessionToken || !current.academyId){
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    state.actionBusy.add(actionId);
    document.querySelectorAll('[data-action-id]').forEach(card=>{
      if(clean(card.dataset.actionId)!==actionId) return;
      card.querySelectorAll('button').forEach(button=>{ button.disabled=true; });
    });

    try{
      const actionType=clean(action?.action_type);
      const rpcName=actionType==='choose_trial_group'
        ? 'olli_team_chat_action_select_trial_group'
        : actionType==='choose_waitlist_group'
          ? 'olli_team_chat_action_select_waitlist_group'
          : actionType==='choose_move_group'
            ? 'olli_team_chat_action_select_move_group'
            : 'olli_team_chat_action_select_makeup_group';
      const payload=await rpc(rpcName,{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_action_id:actionId,
        p_class_group:classGroup
      });
      if(!payload?.ok || !payload?.action){
        throw new Error(payload?.message || '반을 선택하지 못했습니다.');
      }
      await loadMessages({showLoading:false,followBottom:true});
    }catch(error){
      console.warn('PC 팀톡 보강 반 선택 실패:',error?.message || error);
      alert(error?.message || '반을 선택하지 못했습니다.');
      await loadMessages({showLoading:false,followBottom:true});
    }finally{
      state.actionBusy.delete(actionId);
    }
  }


  function structuredDateExpressionFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return (date.getMonth() + 1) + '월 ' + date.getDate() + '일';
  }

  function structuredDateInputValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2,'0'),
      String(date.getDate()).padStart(2,'0')
    ].join('-');
  }

  async function continueStructuredWriteDraft(draft,current) {
    const router=global.OlliCommandRouter;
    if(!router || typeof router.prepareStructuredAction!=='function') return null;
    const prepared=await router.prepareStructuredAction(draft,{
      source:'olli_talk_structured_field_choice',
      selectedStudent:null,
      autoSubmitContext:null
    });
    if(prepared?.handled!==true) return null;

    if(prepared.kind==='action_needs_field'){
      if(clean(prepared.payload?.field)==='student_choice' && prepared.payload){
        return saveStructuredStudentChoice(current,prepared.message || '학생을 선택해 주세요.',prepared.payload,null);
      }
      if(clean(prepared.payload?.field)==='target_choice' && prepared.payload){
        return saveStructuredTargetChoice(current,prepared.message || '대상을 선택해 주세요.',prepared.payload,null);
      }
      if(clean(prepared.payload?.field)==='division' && prepared.payload){
        return saveStructuredDivisionChoice(current,prepared.message || '유치부인지 초등부인지 선택해 주세요.',prepared.payload,null);
      }
      if(clean(prepared.payload?.field)==='date' && prepared.payload){
        return saveStructuredDateChoice(current,prepared.message || '날짜를 선택해 주세요.',prepared.payload,null);
      }
      if(clean(prepared.payload?.field)==='time' && prepared.payload){
        return saveStructuredTimeChoice(current,prepared.message || '시간을 선택해 주세요.',prepared.payload,null);
      }
      return saveAssistantReply(current,clean(prepared.message) || '필요한 정보를 선택해 주세요.',null);
    }
    if(prepared.kind==='action_pending' && prepared.payload && draft?.batchStructured===true){
      return finishBatchStructuredCommand(draft,prepared,current);
    }
    if(['action_pending','action_choice'].includes(prepared.kind) && prepared.payload){
      return saveAssistantAction(
        current,
        prepared.message || (prepared.kind==='action_choice' ? '반을 선택해 주세요.' : '이 작업을 진행할까요?'),
        prepared.payload,
        null
      );
    }
    if(prepared.kind==='action_rejected'){
      return saveAssistantReply(current,clean(prepared.message) || '작업을 준비하지 못했어요.',null);
    }
    return null;
  }

  async function handleStructuredDateChoice(action,dateExpression) {
    const actionId=clean(action?.id);
    const selected=clean(dateExpression);
    if(!actionId || !selected || state.actionBusy.has(actionId)) return;

    const current=context();
    if(!current.sessionToken || !current.academyId){
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    state.actionBusy.add(actionId);
    document.querySelectorAll('[data-action-id]').forEach(card=>{
      if(clean(card.dataset.actionId)!==actionId) return;
      card.querySelectorAll('button,input').forEach(control=>{ control.disabled=true; });
    });

    try{
      const payload=await rpc('olli_team_chat_action_select_structured_date',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_action_id:actionId,
        p_date_expression:selected
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '날짜를 선택하지 못했습니다.');
      }
      if(clean(payload?.draft?.action)==='update_waitlist'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=clean(payload?.source_message_text);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('대기 변경 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveStructuredWaitlistUpdateTurn(
          payload.draft,
          current,
          sourceMessageText,
          sourceMessageId
        );
      }else{
        await continueStructuredWriteDraft(payload.draft,current);
      }
      await loadMessages({showLoading:false,followBottom:true});
    }catch(error){
      console.warn('PC 팀톡 구조화 날짜 선택 실패:',error?.message || error);
      alert(error?.message || '날짜를 선택하지 못했습니다.');
      await loadMessages({showLoading:false,followBottom:true});
    }finally{
      state.actionBusy.delete(actionId);
    }
  }

  function appendStructuredDateChoiceButtons(card,action) {
    card.classList.add('structuredDate');
    const interactive=clean(action?.status)==='pending';

    const now=new Date();
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12,0,0,0);
    const tomorrow=new Date(today.getTime());
    tomorrow.setDate(tomorrow.getDate()+1);

    const addQuick=(label,date)=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='olliPcTeamTalkActionButton primary';
      button.textContent=label;
      button.disabled=!interactive;
      if(interactive) button.addEventListener('click',()=>handleStructuredDateChoice(action,structuredDateExpressionFromDate(date)));
      card.appendChild(button);
    };
    addQuick('오늘',today);
    addQuick('내일',tomorrow);

    const dateInput=document.createElement('input');
    dateInput.type='date';
    dateInput.className='olliPcTeamTalkDateInput';
    dateInput.disabled=!interactive;
    dateInput.min=structuredDateInputValue(today);
    const maxDate=new Date(today.getTime());
    maxDate.setDate(maxDate.getDate()+364);
    dateInput.max=structuredDateInputValue(maxDate);
    if(interactive) dateInput.addEventListener('change',()=>{
      const match=String(dateInput.value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(!match) return;
      handleStructuredDateChoice(action,Number(match[2])+'월 '+Number(match[3])+'일');
    });

    const pick=document.createElement('button');
    pick.type='button';
    pick.className='olliPcTeamTalkActionButton secondary dateWide';
    pick.textContent='날짜 선택';
    pick.disabled=!interactive;
    if(interactive) pick.addEventListener('click',()=>{
      try{
        if(typeof dateInput.showPicker==='function') dateInput.showPicker();
        else dateInput.click();
      }catch(_){
        dateInput.click();
      }
    });

    card.append(dateInput,pick);
  }

  async function handleStructuredTargetChoice(action,choiceId) {
    const actionId=clean(action?.id);
    const selectedId=clean(choiceId);
    if(!actionId || !selectedId || state.actionBusy.has(actionId)) return;

    const current=context();
    if(!current.sessionToken || !current.academyId){
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    state.actionBusy.add(actionId);
    document.querySelectorAll('[data-action-id]').forEach(card=>{
      if(clean(card.dataset.actionId)!==actionId) return;
      card.querySelectorAll('button').forEach(button=>{ button.disabled=true; });
      card.classList.add('busy');
    });

    try{
      const payload=await rpc('olli_team_chat_action_select_structured_target',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_action_id:actionId,
        p_choice_id:selectedId
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '대상을 선택하지 못했습니다.');
      }
      if(['set_session_order','set_class_teacher','set_teacher_override'].includes(clean(payload?.draft?.action))){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=clean(payload?.source_message_text);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('수업 순서 변경 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveStructuredTimetableAdminTurn(
          payload.draft,
          current,
          sourceMessageText,
          sourceMessageId
        );
      }else if(['add_timetable_memo','delete_timetable_memo'].includes(clean(payload?.draft?.action))){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=clean(payload?.source_message_text);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('시간표 메모 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveStructuredTimetableMemoTurn(
          payload.draft,
          current,
          sourceMessageText,
          sourceMessageId
        );
      }else if(clean(payload?.draft?.action)==='cancel_move'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=clean(payload?.source_message_text);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('수업 이동 취소 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveStructuredMoveCancelTurn(
          payload.draft,
          current,
          sourceMessageText,
          sourceMessageId
        );
      }else if(clean(payload?.draft?.action)==='cancel_trial'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=clean(payload?.source_message_text);
        const reasonMessageId=Number(payload?.reason_message_id || 0);
        const reasonMessageText=clean(payload?.reason_message_text);
        const reason=clean(payload?.draft?.reason);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText
          ||!Number.isSafeInteger(reasonMessageId)||reasonMessageId<=0||!reasonMessageText||!reason){
          throw new Error('체험 취소 원문 또는 사유 메시지를 확인하지 못했습니다.');
        }
        await resolveStructuredTrialCancelTurn({
          structuredCommand:payload.draft,sourceText:sourceMessageText,sourceMessageId,
          reasonText:reason,reasonMessageText,reasonMessageId,current
        });
      }else if(clean(payload?.draft?.action)==='cancel_makeup'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=clean(payload?.source_message_text);
        const reasonMessageId=Number(payload?.reason_message_id || 0);
        const reasonMessageText=clean(payload?.reason_message_text);
        const reason=clean(payload?.draft?.reason);
        if(
          !Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText
          || !Number.isSafeInteger(reasonMessageId)||reasonMessageId<=0||!reasonMessageText||!reason
        ){
          throw new Error('보강 취소 원문 또는 사유 메시지를 확인하지 못했습니다.');
        }
        await resolveStructuredMakeupCancelTurn({
          structuredCommand:payload.draft,
          sourceText:sourceMessageText,
          sourceMessageId,
          reasonText:reason,
          reasonMessageText,
          reasonMessageId,
          current,
        });
      }else if(clean(payload?.draft?.action)==='update_waitlist'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=clean(payload?.source_message_text);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('대기 변경 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveStructuredWaitlistUpdateTurn(
          payload.draft,
          current,
          sourceMessageText,
          sourceMessageId
        );
      }else{
        await continueStructuredWriteDraft(payload.draft,current);
      }
      await loadMessages({showLoading:false,followBottom:true});
    }catch(error){
      console.warn('PC 팀톡 구조화 대상 선택 실패:',error?.message || error);
      alert(error?.message || '대상을 선택하지 못했습니다.');
      await loadMessages({showLoading:false,followBottom:true});
    }finally{
      state.actionBusy.delete(actionId);
      document.querySelectorAll('[data-action-id]').forEach(card=>{
        if(clean(card.dataset.actionId)===actionId) card.classList.remove('busy');
      });
    }
  }

  async function populateStructuredTargetChoiceCard(card,action) {
    const actionId=clean(action?.id);
    const interactive=clean(action?.status)==='pending';
    const current=context();
    if(!actionId || !current.sessionToken || !current.academyId) return;

    try{
      const payload=await rpc('olli_team_chat_get_structured_target_choice',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_action_id:actionId
      });
      if(!payload?.ok || !Array.isArray(payload?.choices)){
        throw new Error(payload?.message || '선택할 일정을 확인하지 못했습니다.');
      }
      if(!card.isConnected || clean(card.dataset.actionId)!==actionId) return;
      card.replaceChildren();
      if(!payload.choices.length){
        card.appendChild(create('span','olliPcTeamTalkActionStatus','선택할 일정이 없어요.'));
        return;
      }
      payload.choices.forEach(choice=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='olliPcTeamTalkActionButton primary targetChoice';
        button.textContent=clean(choice?.label) || '일정';
        button.disabled=!interactive;
        if(interactive) button.addEventListener('click',()=>handleStructuredTargetChoice(action,clean(choice?.id)));
        card.appendChild(button);
      });
    }catch(error){
      if(!card.isConnected) return;
      card.replaceChildren(create('span','olliPcTeamTalkActionStatus failed',clean(error?.message) || '일정 목록을 불러오지 못했어요.'));
    }
  }

  function appendStructuredTargetChoiceButtons(card,action) {
    card.classList.add('structuredTarget');
    card.appendChild(create('span','olliPcTeamTalkActionStatus','일정 확인 중'));
    void populateStructuredTargetChoiceCard(card,action);
  }

  async function handleStructuredStudentChoice(action,studentName) {
    const actionId=clean(action?.id);
    const selectedName=clean(studentName);
    if(!actionId || !selectedName || state.actionBusy.has(actionId)) return;

    const current=context();
    if(!current.sessionToken || !current.academyId){
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    state.actionBusy.add(actionId);
    document.querySelectorAll('[data-action-id]').forEach(card=>{
      if(clean(card.dataset.actionId)!==actionId) return;
      card.querySelectorAll('button').forEach(button=>{ button.disabled=true; });
      card.classList.add('busy');
    });

    try{
      const payload=await rpc('olli_team_chat_action_select_structured_student',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_action_id:actionId,
        p_student_name:selectedName
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '학생을 선택하지 못했습니다.');
      }
      await continueStructuredWriteDraft(payload.draft,current);
      await loadMessages({showLoading:false,followBottom:true});
    }catch(error){
      console.warn('PC 팀톡 구조화 학생 선택 실패:',error?.message || error);
      alert(error?.message || '학생을 선택하지 못했습니다.');
      await loadMessages({showLoading:false,followBottom:true});
    }finally{
      state.actionBusy.delete(actionId);
      document.querySelectorAll('[data-action-id]').forEach(card=>{
        if(clean(card.dataset.actionId)===actionId) card.classList.remove('busy');
      });
    }
  }

  async function populateStructuredStudentChoiceCard(card,action) {
    const actionId=clean(action?.id);
    const interactive=clean(action?.status)==='pending';
    const current=context();
    if(!actionId || !current.sessionToken || !current.academyId) return;

    try{
      const payload=await rpc('olli_team_chat_get_structured_student_choice',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_action_id:actionId
      });
      if(!payload?.ok || !Array.isArray(payload?.choices)){
        throw new Error(payload?.message || '선택할 학생을 확인하지 못했습니다.');
      }
      if(!card.isConnected || clean(card.dataset.actionId)!==actionId) return;
      card.replaceChildren();
      if(!payload.choices.length){
        card.appendChild(create('span','olliPcTeamTalkActionStatus','선택할 학생이 없어요.'));
        return;
      }
      payload.choices.forEach(choice=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='olliPcTeamTalkActionButton primary studentChoice';
        button.textContent=clean(choice?.label || choice?.studentName) || '학생';
        button.disabled=!interactive;
        if(interactive) button.addEventListener('click',()=>handleStructuredStudentChoice(action,clean(choice?.studentName)));
        card.appendChild(button);
      });
    }catch(error){
      if(!card.isConnected) return;
      card.replaceChildren(create('span','olliPcTeamTalkActionStatus failed',clean(error?.message) || '학생 목록을 불러오지 못했어요.'));
    }
  }

  function appendStructuredStudentChoiceButtons(card,action) {
    card.classList.add('structuredStudent');
    card.appendChild(create('span','olliPcTeamTalkActionStatus','학생 확인 중'));
    void populateStructuredStudentChoiceCard(card,action);
  }

  async function handleStructuredDivisionChoice(action,division) {
    const actionId=clean(action?.id);
    const selected=clean(division).toLowerCase();
    if(!actionId || !['kinder','elementary'].includes(selected) || state.actionBusy.has(actionId)) return;

    const current=context();
    if(!current.sessionToken || !current.academyId){
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    state.actionBusy.add(actionId);
    document.querySelectorAll('[data-action-id]').forEach(card=>{
      if(clean(card.dataset.actionId)!==actionId) return;
      card.querySelectorAll('button').forEach(button=>{ button.disabled=true; });
      card.classList.add('busy');
    });

    try{
      const payload=await rpc('olli_team_chat_action_select_structured_division',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_action_id:actionId,
        p_division:selected
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '수업 구분을 선택하지 못했습니다.');
      }
      await continueStructuredWriteDraft(payload.draft,current);
      await loadMessages({showLoading:false,followBottom:true});
    }catch(error){
      console.warn('PC 팀톡 구조화 수업 구분 선택 실패:',error?.message || error);
      alert(error?.message || '수업 구분을 선택하지 못했습니다.');
      await loadMessages({showLoading:false,followBottom:true});
    }finally{
      state.actionBusy.delete(actionId);
      document.querySelectorAll('[data-action-id]').forEach(card=>{
        if(clean(card.dataset.actionId)===actionId) card.classList.remove('busy');
      });
    }
  }

  function appendStructuredDivisionChoiceButtons(card,action) {
    card.classList.add('structuredDivision');
    const interactive=clean(action?.status)==='pending';
    [
      {value:'kinder',label:'유치부'},
      {value:'elementary',label:'초등부'}
    ].forEach(choice=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='olliPcTeamTalkActionButton primary divisionChoice';
      button.textContent=choice.label;
      button.disabled=!interactive;
      if(interactive) button.addEventListener('click',()=>handleStructuredDivisionChoice(action,choice.value));
      card.appendChild(button);
    });
  }

  async function handleStructuredTimeChoice(action,timeSlot) {
    const actionId=clean(action?.id);
    const selectedTime=Number(timeSlot || 0);
    if(!actionId || !selectedTime || state.actionBusy.has(actionId)) return;
    const current=context();
    if(!current.sessionToken || !current.academyId){
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    state.actionBusy.add(actionId);
    document.querySelectorAll('[data-action-id]').forEach(card=>{
      if(clean(card.dataset.actionId)!==actionId) return;
      card.querySelectorAll('button').forEach(button=>{ button.disabled=true; });
      card.classList.add('busy');
    });

    try{
      const payload=await rpc('olli_team_chat_action_select_structured_time',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_action_id:actionId,
        p_time_slot:selectedTime
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '시간을 선택하지 못했습니다.');
      }
      await continueStructuredWriteDraft(payload.draft,current);
      await loadMessages({showLoading:false,followBottom:true});
    }catch(error){
      console.warn('PC 팀톡 구조화 시간 선택 실패:',error?.message || error);
      alert(error?.message || '시간을 선택하지 못했습니다.');
      await loadMessages({showLoading:false,followBottom:true});
    }finally{
      state.actionBusy.delete(actionId);
      document.querySelectorAll('[data-action-id]').forEach(card=>{
        if(clean(card.dataset.actionId)===actionId) card.classList.remove('busy');
      });
    }
  }

  async function populateStructuredTimeChoiceCard(card,action) {
    const actionId=clean(action?.id);
    const interactive=clean(action?.status)==='pending';
    const current=context();
    if(!actionId || !current.sessionToken || !current.academyId) return;

    try{
      const payload=await rpc('olli_team_chat_get_structured_time_choice',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_action_id:actionId
      });
      if(!payload?.ok || !Array.isArray(payload?.choices)){
        throw new Error(payload?.message || '선택 가능한 시간을 확인하지 못했습니다.');
      }
      if(!card.isConnected || clean(card.dataset.actionId)!==actionId) return;
      card.replaceChildren();
      if(!payload.choices.length){
        card.appendChild(create('span','olliPcTeamTalkActionStatus','선택 가능한 수업 시간이 없어요.'));
        return;
      }
      payload.choices.forEach(choice=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='olliPcTeamTalkActionButton primary timeChoice';
        const label=clean(choice?.label) || Number(choice?.timeSlot || 0)+'시';
        const status=clean(choice?.status);
        const selectable=choice?.selectable===true;
        button.textContent=status==='full'
          ? label+'\n'+(clean(payload?.targetIntent)==='add_waitlist' ? '대기 가능' : '마감')
          : label;
        button.disabled=!selectable || !interactive;
        if(!selectable) button.classList.add('closed');
        if(selectable && interactive) button.addEventListener('click',()=>handleStructuredTimeChoice(action,Number(choice?.timeSlot || 0)));
        card.appendChild(button);
      });
    }catch(error){
      if(!card.isConnected) return;
      card.replaceChildren(create('span','olliPcTeamTalkActionStatus failed',clean(error?.message) || '시간을 불러오지 못했어요.'));
    }
  }

  function appendStructuredTimeChoiceButtons(card,action) {
    card.classList.add('structuredTime');
    card.appendChild(create('span','olliPcTeamTalkActionStatus','시간 확인 중'));
    void populateStructuredTimeChoiceCard(card,action);
  }

  function makeActionCard(action) {
    const card = create('div', 'olliPcTeamTalkActionCard');
    const status = clean(action?.status) || 'pending';
    card.dataset.actionId = clean(action?.id);
    card.dataset.actionStatus = status;

    if (status !== 'pending') {
      const label = create('span', 'olliPcTeamTalkActionStatus', actionStatusLabel(action));
      if (status === 'failed') label.classList.add('failed');
      card.appendChild(label);
      return card;
    }

    const isSessionGroupChoice=['choose_makeup_group','choose_trial_group','choose_waitlist_group','choose_move_group'].includes(clean(action?.action_type));
    if(isSessionGroupChoice){
      ['A','B'].forEach(group=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='olliPcTeamTalkActionButton primary';
        button.textContent=group+'반';
        button.addEventListener('click',()=>handleSessionGroupChoice(action,group));
        card.appendChild(button);
      });
      return card;
    }

    if(clean(action?.action_type)==='choose_structured_student'){
      appendStructuredStudentChoiceButtons(card,action);
      return card;
    }

    if(clean(action?.action_type)==='choose_structured_target'){
      appendStructuredTargetChoiceButtons(card,action);
      return card;
    }

    if(clean(action?.action_type)==='choose_structured_division'){
      appendStructuredDivisionChoiceButtons(card,action);
      return card;
    }

    if(clean(action?.action_type)==='choose_structured_date'){
      appendStructuredDateChoiceButtons(card,action);
      return card;
    }

    if(clean(action?.action_type)==='choose_structured_time'){
      appendStructuredTimeChoiceButtons(card,action);
      return card;
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'olliPcTeamTalkActionButton secondary';
    cancel.textContent = '취소';
    cancel.addEventListener('click', () => handleActionCard(action, 'cancel'));

    const execute = document.createElement('button');
    execute.type = 'button';
    execute.className = 'olliPcTeamTalkActionButton primary';
    execute.textContent = actionPrimaryLabel(action?.action_type);
    execute.addEventListener('click', () => handleActionCard(action, 'execute'));

    card.append(cancel, execute);
    return card;
  }

  function olliReplyTargetIds(messages) {
    return new Set((Array.isArray(messages) ? messages : [])
      .filter((item) => clean(item?.message_type) === 'ai' && Number(item?.reply_to_message_id || 0) > 0)
      .map((item) => String(Number(item.reply_to_message_id))));
  }

  function shouldOfferOlliReply(item, own, replyTargets) {
    const messageId = String(Number(item?.id || 0) || '');
    const body = clean(item?.body);
    const router = global.OlliCommandRouter;
    if (!own || clean(item?.message_type || 'text') !== 'text' || item?.attachment) return false;
    if (!messageId || !body || /^\s*@올리(?:\s|$)/.test(body)) return false;
    if (replyTargets?.has?.(messageId)) return false;
    return !!router && typeof router.isOlliReplyCandidate === 'function' && router.isOlliReplyCandidate(body);
  }

  function removeOlliReplySuggestion(messageId) {
    const id = clean(messageId);
    if (!id) return;
    const row = Array.from(document.querySelectorAll('#olliPcTeamTalkMessages [data-message-id]'))
      .find((node) => clean(node.dataset.messageId) === id);
    row?.querySelector?.('.olliPcTeamTalkReplySuggestion')?.remove();
  }

  async function handleOlliReplySuggestion(item, button) {
    const messageId = String(Number(item?.id || 0) || '');
    const commandText = clean(item?.body);
    if (!messageId || !commandText || state.olliReplyBusy.has(messageId)) return;

    const current = context();
    if (!current.sessionToken || !current.academyId) {
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    const usingAi = isAiEnabled();
    state.olliReplyBusy.add(messageId);
    button.disabled = true;
    button.textContent = '응답 중';

    try {
      if (usingAi) {
        state.assistantReplyPending = true;
        syncAssistantTypingIndicator();
        const turn = await resolveAiTurn(commandText, current, Number(messageId), { allowSuggestedQuery:true });
        state.assistantReplyPending = false;
        replaceAssistantTypingWithMessage(turn.assistantMessage, current.memberId);
        if (turn.recordAi) recordAiConversationTurn(commandText, turn.replyText);
      } else {
        const turn = await resolveBotTurn(commandText, current, Number(messageId), { allowSuggestedQuery:true });
        appendPersistedMessage(turn.assistantMessage, current.memberId);
      }
      removeOlliReplySuggestion(messageId);
      await loadMessages({ showLoading:false, followBottom:true, render:false });
    } catch (error) {
      console.warn(usingAi ? 'PC 올리 응답 버튼 AI 처리 실패:' : 'PC 올리 응답 버튼 봇 처리 실패:', error?.message || error);
      alert('올리 응답을 받지 못했습니다.\n' + (error?.message || error));
      button.disabled = false;
      button.textContent = '올리 응답';
    } finally {
      if (state.assistantReplyPending) {
        state.assistantReplyPending = false;
        syncAssistantTypingIndicator();
      }
      state.olliReplyBusy.delete(messageId);
    }
  }

  function makeOlliReplySuggestion(item) {
    const wrap = create('div', 'olliPcTeamTalkReplySuggestion');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'olliPcTeamTalkReplySuggestionButton';
    button.textContent = '올리 응답';
    button.setAttribute('aria-label', '이 메시지에 올리 응답 받기');
    button.addEventListener('click', () => handleOlliReplySuggestion(item, button));
    wrap.appendChild(button);
    return wrap;
  }

  function getMessageGroupKey(item, currentMemberId) {
    const type = clean(item?.message_type) || 'text';
    if (type === 'system') return '';
    if (type === 'ai') return 'ai:olli';
    const senderId = clean(item?.sender_member_id);
    if (senderId && senderId === clean(currentMemberId)) return 'outgoing:' + senderId;
    return 'incoming:' + (senderId || clean(item?.sender_name) || 'unknown');
  }

  function isConnectedMessage(previousItem, item, currentMemberId) {
    if (!previousItem || !item) return false;
    const previousKey = getMessageGroupKey(previousItem, currentMemberId);
    const currentKey = getMessageGroupKey(item, currentMemberId);
    if (!previousKey || previousKey !== currentKey) return false;
    const previousTime = new Date(previousItem?.created_at || 0).getTime();
    const currentTime = new Date(item?.created_at || 0).getTime();
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return false;
    const diff = currentTime - previousTime;
    return diff >= 0 && diff < 60 * 1000;
  }

  function makeMessage(item, currentMemberId, options = {}) {
    const type = clean(item?.message_type) || 'text';
    if (type === 'system') {
      const system = create('div', 'olliPcTeamTalkSystemMessage', String(item?.body || ''));
      system.dataset.dateKey = dateKey(item?.created_at);
      return system;
    }

    const isAi = type === 'ai';
    const own = !isAi && clean(item?.sender_member_id) === clean(currentMemberId);
    const connectedToPrevious = options.connectedToPrevious === true;
    const row = create('div', `olliPcTeamTalkMessage ${isAi ? 'ai' : (own ? 'outgoing' : 'incoming')}`);
    row.classList.add(connectedToPrevious ? 'olliPcTeamTalkMessageConnected' : 'olliPcTeamTalkMessageGroupStart');
    row.dataset.messageId = clean(item?.id);
    row.dataset.dateKey = dateKey(item?.created_at);

    const content = create('div', 'olliPcTeamTalkMessageContent');
    if (!own) {
      const senderName = isAi ? '올리' : (clean(item?.sender_name) || '선생님');
      if (!connectedToPrevious) {
        const avatar = create('span', `olliPcTeamTalkAvatar${isAi ? ' ai' : ''}`, isAi ? 'Olli' : senderName.slice(0, 1));
        row.appendChild(avatar);
        const sender = create('div', 'olliPcTeamTalkSender');
        sender.appendChild(create('span', 'olliPcTeamTalkSenderName', senderName));
        content.appendChild(sender);
      } else {
        row.appendChild(create('span', 'olliPcTeamTalkAvatarSpacer'));
      }
    }

    const bubbleRow = create('div', 'olliPcTeamTalkBubbleRow');
    bubbleRow.appendChild(item?.attachment ? makeAttachmentCard(item) : makeTextBubble(item));

    const meta = create('div', 'olliPcTeamTalkMessageMeta');
    const unread = isAi ? 0 : Math.max(0, Number(item?.unread_count || 0));
    if (unread) meta.appendChild(create('span', 'olliPcTeamTalkUnreadCount', String(unread)));
    meta.appendChild(create('span', 'olliPcTeamTalkMessageTime', formatTime(item?.created_at)));
    bubbleRow.appendChild(meta);
    content.appendChild(bubbleRow);
    if (item?.action) content.appendChild(makeActionCard(item.action));
    if (shouldShowPendingTextInput(item)) content.appendChild(makePendingTextInputButton());
    row.appendChild(content);
    if (shouldOfferOlliReply(item, own, options.olliReplyTargetIds)) {
      row.appendChild(makeOlliReplySuggestion(item));
    }
    return row;
  }

  function makeAssistantTypingMessage() {
    const row = create('div', 'olliPcTeamTalkMessage ai olliPcTeamTalkMessageGroupStart olliPcTeamTalkTypingMessage');
    row.dataset.olliAssistantTyping = '1';

    const avatar = create('span', 'olliPcTeamTalkAvatar ai', 'Olli');
    row.appendChild(avatar);

    const content = create('div', 'olliPcTeamTalkMessageContent');
    const sender = create('div', 'olliPcTeamTalkSender');
    sender.appendChild(create('span', 'olliPcTeamTalkSenderName', '올리'));
    content.appendChild(sender);

    const bubbleRow = create('div', 'olliPcTeamTalkBubbleRow');
    const bubble = create('div', 'olliPcTeamTalkBubble olliPcTeamTalkTypingBubble');
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-label', '올리가 요청을 확인하는 중');
    bubble.textContent = '확인중…';
    bubbleRow.appendChild(bubble);
    content.appendChild(bubbleRow);
    row.appendChild(content);
    return row;
  }

  function syncAssistantTypingIndicator() {
    const body = byId('olliPcTeamTalkMessages');
    if (!body) return;
    body.querySelectorAll('[data-olli-assistant-typing]').forEach((node) => node.remove());
    if (!state.assistantReplyPending) return;

    let list = body.querySelector('.olliPcTeamTalkMessageList');
    if (!list) {
      list = create('div', 'olliPcTeamTalkMessageList');
      body.replaceChildren(list);
    }
    list.appendChild(makeAssistantTypingMessage());
    requestAnimationFrame(() => {
      if (body.isConnected) body.scrollTop = body.scrollHeight;
    });
  }

  function replaceAssistantTypingWithMessage(item, currentMemberId) {
    const body = byId('olliPcTeamTalkMessages');
    if (!body || !item) return false;
    const typing = body.querySelector('[data-olli-assistant-typing]');
    const next = makeMessage(item, currentMemberId, { connectedToPrevious:false });
    if (typing) typing.replaceWith(next);
    else appendPersistedMessage(item, currentMemberId);
    const messageId = clean(item?.id);
    if (!state.messages.some((message) => clean(message?.id) === messageId)) {
      state.messages = [...state.messages, item];
    }
    requestAnimationFrame(() => {
      if (body.isConnected) body.scrollTop = body.scrollHeight;
    });
    return true;
  }

  function appendPersistedMessage(item, currentMemberId) {
    const body = byId('olliPcTeamTalkMessages');
    if (!body || !item) return false;
    const messageId = clean(item?.id);
    if (messageId) {
      const duplicate = Array.from(body.querySelectorAll('[data-message-id]'))
        .some((node) => clean(node.dataset.messageId) === messageId);
      if (duplicate) return true;
    }

    let list = body.querySelector('.olliPcTeamTalkMessageList');
    if (!list) {
      list = create('div', 'olliPcTeamTalkMessageList');
      body.replaceChildren(list);
    }

    const itemDateKey = dateKey(item?.created_at);
    const renderedMessages = Array.from(list.querySelectorAll('[data-message-id]'));
    const lastRendered = renderedMessages[renderedMessages.length - 1] || null;
    const lastDateKey = clean(lastRendered?.dataset?.dateKey);
    if (itemDateKey && itemDateKey !== lastDateKey) {
      const divider = create('div', 'olliPcTeamTalkDateDivider');
      divider.appendChild(create('span', '', formatDate(item?.created_at)));
      list.appendChild(divider);
    }

    list.appendChild(makeMessage(item, currentMemberId, { connectedToPrevious:false }));
    if (clean(item?.message_type) === 'ai' && Number(item?.reply_to_message_id || 0) > 0) {
      removeOlliReplySuggestion(String(Number(item.reply_to_message_id)));
    }
    if (!state.messages.some((message) => clean(message?.id) === messageId)) {
      state.messages = [...state.messages, item];
    }
    requestAnimationFrame(() => {
      if (body.isConnected) body.scrollTop = body.scrollHeight;
    });
    return true;
  }

  function renderMessages(payload, options = {}) {
    const body = byId('olliPcTeamTalkMessages');
    if (!body) return;
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    state.messages = messages;
    const currentMemberId = clean(payload?.current_member_id || context().memberId);

    if (!messages.length) {
      body.replaceChildren(emptyState('아직 대화가 없어요', '첫 메시지를 보내 팀톡을 시작해 보세요.'));
      return;
    }

    const list = create('div', 'olliPcTeamTalkMessageList');
    const replyTargets = olliReplyTargetIds(messages);
    let lastKey = '';
    let groupStartItem = null;
    messages.forEach((item) => {
      const key = dateKey(item?.created_at);
      if (key && key !== lastKey) {
        const divider = create('div', 'olliPcTeamTalkDateDivider');
        divider.appendChild(create('span', '', formatDate(item?.created_at)));
        list.appendChild(divider);
        lastKey = key;
        groupStartItem = null;
      }
      const connectedToPrevious = isConnectedMessage(groupStartItem, item, currentMemberId);
      list.appendChild(makeMessage(item, currentMemberId, { connectedToPrevious, olliReplyTargetIds:replyTargets }));
      if ((clean(item?.message_type) || 'text') === 'system') groupStartItem = null;
      else if (!connectedToPrevious) groupStartItem = item;
    });

    const wasNearBottom = body.scrollHeight - body.clientHeight - body.scrollTop < 110;
    const previousTop = body.scrollTop;
    body.replaceChildren(list);
    if (state.assistantReplyPending) syncAssistantTypingIndicator();
    requestAnimationFrame(() => {
      if (!body.isConnected) return;
      if (options.followBottom !== false || wasNearBottom) body.scrollTop = body.scrollHeight;
      else body.scrollTop = previousTop;
    });
  }

  async function loadMessages(options = {}) {
    const sequence = ++state.messageLoadSequence;
    const current = context();
    const body = byId('olliPcTeamTalkMessages');
    if (!current.sessionToken || !current.academyId) {
      if (body) body.replaceChildren(emptyState('팀톡을 열 수 없어요', '계정 로그인 또는 현재 학원 정보를 확인해 주세요.'));
      return false;
    }
    if (body && options.showLoading !== false) body.replaceChildren(emptyState('대화를 불러오는 중이에요', '잠시만 기다려 주세요.'));

    try {
      const payload = await rpc('olli_team_chat_list', {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId,
        p_before_message_id: null,
        p_limit: 100
      });
      if (sequence !== state.messageLoadSequence) return false;
      if (!payload?.ok) throw new Error(payload?.message || '대화를 불러오지 못했습니다.');
      if (options.render === false) state.messages = Array.isArray(payload.messages) ? payload.messages : [];
      else renderMessages(payload, { followBottom: options.followBottom });
      const latest = Array.isArray(payload.messages) && payload.messages.length
        ? Number(payload.messages[payload.messages.length - 1]?.id || 0)
        : 0;
      if (isVisible()) await markRead(latest || null);
      else await refreshBadge();
      return true;
    } catch (error) {
      if (sequence !== state.messageLoadSequence) return false;
      if (body) body.replaceChildren(emptyState('대화를 불러오지 못했어요', '잠시 후 다시 확인해 주세요.'));
      console.warn('PC 팀톡 메시지 조회 실패:', error?.message || error);
      return false;
    }
  }

  function archiveItems() {
    return Array.isArray(state.archivePayload?.messages) ? state.archivePayload.messages : [];
  }

  function setArchiveTab(tab) {
    if (!['media', 'files', 'links'].includes(tab)) return;
    state.archiveTab = tab;
    renderArchive();
  }

  function setWorkspaceTab(tab) {
    const next = tab === 'archive' ? 'archive' : 'materials';
    state.workspaceTab = next;
    document.querySelectorAll('#olliPcTeamTalkScreen [data-team-talk-workspace-tab]').forEach((button) => {
      const active = button.dataset.teamTalkWorkspaceTab === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('#olliPcTeamTalkScreen [data-team-talk-workspace-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.teamTalkWorkspacePanel !== next;
    });
    const materialCreate = byId('olliPcTeamTalkMaterialCreate');
    if (materialCreate) materialCreate.hidden = next !== 'materials';
    if (next === 'archive' && !state.archivePayload) loadArchive({ showLoading:true });
    if (next === 'materials' && global.OlliTeamTalkMaterialOrders?.activate) {
      global.OlliTeamTalkMaterialOrders.activate().catch((error) => {
        console.warn('PC 팀톡 재료주문 새로고침 실패:', error?.message || error);
      });
    }
  }

  function archiveSection(label) {
    const section = create('section', 'olliPcTeamTalkArchiveSection');
    section.appendChild(create('div', 'olliPcTeamTalkArchiveDate', label));
    return section;
  }

  function grouped(items) {
    const groups = [];
    let key = '';
    let group = null;
    items.forEach((item) => {
      const next = dateKey(item?.created_at);
      if (next !== key) {
        key = next;
        group = { label: formatDate(item?.created_at), items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });
    return groups;
  }

  function renderArchiveMedia(body, items) {
    const media = items.filter((item) => item?.attachment?.kind === 'media');
    if (!media.length) {
      body.appendChild(emptyState('공유된 사진이나 동영상이 없어요', '채팅에서 사진과 동영상을 올리면 여기에 모입니다.'));
      return;
    }
    grouped(media).forEach((group) => {
      const section = archiveSection(group.label);
      const grid = create('div', 'olliPcTeamTalkMediaGrid');
      group.items.forEach((item) => {
        const attachment = item.attachment || {};
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'olliPcTeamTalkMediaItem';
        button.title = clean(attachment.file_name);
        button.appendChild(create('span', 'olliPcTeamTalkMediaFallback', /^video\//i.test(clean(attachment.mime_type)) ? '동영상' : '사진'));
        button.addEventListener('click', () => downloadAttachment(attachment));
        if (/^image\//i.test(clean(attachment.mime_type))) {
          getAttachmentBlobUrl(attachment).then((url) => {
            if (!button.isConnected) return;
            const image = document.createElement('img');
            image.alt = clean(attachment.file_name);
            image.loading = 'lazy';
            image.src = url;
            button.replaceChildren(image);
          }).catch(() => {});
        }
        grid.appendChild(button);
      });
      section.appendChild(grid);
      body.appendChild(section);
    });
  }

  function renderArchiveFiles(body, items) {
    const files = items.filter((item) => item?.attachment?.kind === 'file');
    if (!files.length) {
      body.appendChild(emptyState('수업파일이 아직 없어요', '자료실에서 파일을 올리거나 채팅에 파일을 첨부해 보세요.'));
      return;
    }
    grouped(files).forEach((group) => {
      const section = archiveSection(group.label);
      const list = create('div', 'olliPcTeamTalkFileList');
      group.items.forEach((item) => {
        const attachment = item.attachment || {};
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'olliPcTeamTalkFileRow';
        button.appendChild(create('span', 'olliPcTeamTalkFileType', fileExtension(attachment.file_name)));
        const info = create('span', 'olliPcTeamTalkFileInfo');
        info.append(
          create('span', 'olliPcTeamTalkFileName', clean(attachment.file_name) || '파일'),
          create('span', 'olliPcTeamTalkFileMeta', formatBytes(attachment.file_size))
        );
        button.appendChild(info);
        button.addEventListener('click', () => downloadAttachment(attachment));
        list.appendChild(button);
      });
      section.appendChild(list);
      body.appendChild(section);
    });
  }

  function renderArchiveLinks(body, items) {
    const links = items.map((item) => ({ item, url: firstUrl(item?.body) })).filter((entry) => entry.url);
    if (!links.length) {
      body.appendChild(emptyState('공유된 링크가 아직 없어요', '채팅에 링크를 보내면 여기에 모입니다.'));
      return;
    }
    grouped(links.map((entry) => ({ ...entry.item, __url: entry.url }))).forEach((group) => {
      const section = archiveSection(group.label);
      const list = create('div', 'olliPcTeamTalkLinkList');
      group.items.forEach((item) => {
        const url = item.__url;
        const link = document.createElement('a');
        link.className = 'olliPcTeamTalkArchiveLink';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const domain = urlDomain(url);
        link.appendChild(create('span', 'olliPcTeamTalkLinkMark', (domain.charAt(0) || 'L').toUpperCase()));
        const info = create('span', 'olliPcTeamTalkLinkInfo');
        info.append(
          create('span', 'olliPcTeamTalkLinkTitle', String(item?.body || '').replace(url, '').trim() || domain),
          create('span', 'olliPcTeamTalkLinkDomain', domain)
        );
        link.appendChild(info);
        list.appendChild(link);
      });
      section.appendChild(list);
      body.appendChild(section);
    });
  }

  function renderArchive() {
    const body = byId('olliPcTeamTalkArchiveBody');
    const meta = byId('olliPcTeamTalkArchiveMeta');
    const upload = byId('olliPcTeamTalkArchiveUpload');
    if (!body || !meta || !upload) return;

    document.querySelectorAll('#olliPcTeamTalkScreen [data-team-talk-archive-tab]').forEach((button) => {
      const active = button.dataset.teamTalkArchiveTab === state.archiveTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const items = archiveItems();
    const counts = {
      media: items.filter((item) => item?.attachment?.kind === 'media').length,
      files: items.filter((item) => item?.attachment?.kind === 'file').length,
      links: items.filter((item) => firstUrl(item?.body)).length
    };
    meta.textContent = `${counts[state.archiveTab] || 0}개`;
    upload.hidden = state.archiveTab !== 'files';
    body.replaceChildren();

    if (state.archiveTab === 'media') renderArchiveMedia(body, items);
    else if (state.archiveTab === 'files') renderArchiveFiles(body, items);
    else renderArchiveLinks(body, items);
    body.scrollTop = 0;
  }

  async function loadArchive(options = {}) {
    const sequence = ++state.archiveLoadSequence;
    const current = context();
    const body = byId('olliPcTeamTalkArchiveBody');
    const meta = byId('olliPcTeamTalkArchiveMeta');
    if (!current.sessionToken || !current.academyId) {
      if (body) body.replaceChildren(emptyState('자료실을 열 수 없어요', '로그인 정보를 확인해 주세요.'));
      return false;
    }
    if (body && options.showLoading !== false) body.replaceChildren(emptyState('자료를 불러오는 중이에요', '잠시만 기다려 주세요.'));
    if (meta) meta.textContent = '';

    try {
      const payload = await rpc('olli_team_chat_archive', {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId,
        p_limit: 1000
      });
      if (sequence !== state.archiveLoadSequence) return false;
      if (!payload?.ok) throw new Error(payload?.message || '자료실을 불러오지 못했습니다.');
      state.archivePayload = payload;
      renderArchive();
      return true;
    } catch (error) {
      if (sequence !== state.archiveLoadSequence) return false;
      if (body) body.replaceChildren(emptyState('자료실을 불러오지 못했어요', '잠시 후 다시 확인해 주세요.'));
      console.warn('PC 팀톡 자료실 조회 실패:', error?.message || error);
      return false;
    }
  }

  function resizeComposer() {
    const input = byId('olliPcTeamTalkInput');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 118)}px`;
  }

  function isAiEnabled() {
    try { return global.OlliTeamTalkSettings?.state?.aiEnabled === true; }
    catch (_) { return false; }
  }

  function hasOlliAiMention(value) {
    return /(^|\s)@올리(?=\s|$|[,.!?，。！？])/.test(String(value || ''));
  }

  function stripOlliAiMention(value) {
    return String(value || '')
      .replace(/(^|\s)@올리(?=\s|$|[,.!?，。！？])/, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function syncAssistantUi() {
    const button = byId('olliPcTeamTalkOlli');
    const input = byId('olliPcTeamTalkInput');
    const aiEnabled = isAiEnabled();
    if (button) {
      button.textContent = aiEnabled ? 'AI' : '봇';
      button.classList.toggle('active', state.olliModeActive);
      button.setAttribute('aria-pressed', state.olliModeActive ? 'true' : 'false');
      button.setAttribute('aria-label', state.olliModeActive
        ? (aiEnabled ? '올리 AI 호출 해제' : '올리봇 호출 해제')
        : (aiEnabled ? '올리 AI 호출' : '올리봇 호출'));
    }
    if (input) {
      input.placeholder = state.olliModeActive
        ? (aiEnabled ? 'AI에게 물어보세요' : '올리에게 요청하세요')
        : '메시지를 입력하세요';
    }
  }

  function setOlliMode(active, options = {}) {
    const nextActive = !!active;
    if (nextActive !== state.olliModeActive) {
      state.aiConversationMessages = [];
      state.pendingMakeupDialogue = null;
    }
    state.olliModeActive = nextActive;
    syncAssistantUi();
    const input = byId('olliPcTeamTalkInput');
    if (input && options.focus !== false) input.focus();
    return state.olliModeActive;
  }

  function toggleOlliMode(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const menu = byId('olliPcTeamTalkMentionMenu');
    if (menu) menu.hidden = true;
    return setOlliMode(!state.olliModeActive);
  }

  function hasPendingOlliCommand() {
    const router = global.OlliCommandRouter;
    if (!router) return false;
    try {
      return !!(
        (typeof router.getPendingWriteCommand === 'function' && router.getPendingWriteCommand())
        || (typeof router.getPendingReasonCommand === 'function' && router.getPendingReasonCommand())
      );
    } catch (_) {
      return false;
    }
  }

  async function resolveBotTurn(commandText, current, replyToMessageId, options = {}) {
    const router = global.OlliCommandRouter;
    const schedule = global.OlliCommandSchedule;

    const saveReply = async (message) => {
      const text = clean(message) || '요청을 확인했어요.';
      return {
        assistantMessage:await saveAssistantReply(current, text, replyToMessageId),
        replyText:text
      };
    };

    try {
      if (interpreterRoute!=='rule' && state.pendingActionReason) {
        if (isPendingReasonCancel(commandText)) {
          state.pendingActionReason = null;
          return saveReply('작업 준비를 취소했어요.');
        }

        const command = Object.assign({}, state.pendingActionReason, { reason:clean(commandText) });
        state.pendingActionReason = null;
        const confirmation = clean(schedule?.writeConfirmationMessage?.(command)) || '이 작업을 진행할까요?';
        return {
          assistantMessage:await saveAssistantAction(current, confirmation, command, replyToMessageId),
          replyText:confirmation
        };
      }

      if (!router || typeof router.prepareAction !== 'function') {
        return saveReply('올리 업무 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      }

      const prepared = await router.prepareAction(commandText, {
        source:'olli_talk_bot',
        selectedStudent:null,
        autoSubmitContext:null
      });

      if (prepared?.handled === true) {
        if (prepared.kind === 'action_pending' && prepared.payload) {
          return {
            assistantMessage:await saveAssistantAction(
              current,
              prepared.message || '이 작업을 진행할까요?',
              prepared.payload,
              replyToMessageId
            ),
            replyText:prepared.message || ''
          };
        }

        if (prepared.kind === 'action_needs_reason' && prepared.payload) {
          state.pendingActionReason = Object.assign({}, prepared.payload);
          return savePendingTextInputReply(current,clean(prepared.message) || '사유를 알려주세요.',replyToMessageId);
        }

        if (prepared.kind === 'action_rejected') {
          return saveReply(clean(prepared.message) || '작업을 준비하지 못했어요.');
        }
      }

      if (typeof router.runQuery === 'function') {
        const queried = await router.runQuery(commandText, {
          source:'olli_talk_bot',
          selectedStudent:null,
          autoSubmitContext:null
        });
        if (queried?.handled === true) {
          return saveReply(clean(queried.message) || '조회 결과를 확인했어요.');
        }
      }

      if (options.allowSuggestedQuery && typeof router.runSuggestedQuery === 'function') {
        const suggested = await router.runSuggestedQuery(commandText, {
          source:'olli_talk_reply_button',
          selectedStudent:null,
          autoSubmitContext:null
        });
        if (suggested?.handled === true) {
          return saveReply(clean(suggested.message) || '조회 결과를 확인했어요.');
        }
      }

      if (/^(확인|확인해|확인해줘|취소|취소해|취소해줘)$/i.test(clean(commandText))) {
        return saveReply('변경 작업은 말풍선 아래 [취소] [확인] 버튼을 눌러주세요.');
      }

      return saveReply('아직 이 요청은 올리 업무 기능에 연결되지 않았어요. 자리 확인, 보강·체험·대기 등록/취소, 픽업·하원 픽업 등록, 수업 이동, 결석 처리를 요청할 수 있어요.');
    } catch (error) {
      console.warn('PC 올리톡 올리봇 처리 실패:', error?.message || error);
      return saveReply(clean(error?.message || error) || '요청을 처리하지 못했어요.');
    }
  }

  function buildAiConversationMessages(commandText) {
    const currentMessage = { role:'user', content:clean(commandText) };
    if (!state.olliModeActive) return [currentMessage];
    return state.aiConversationMessages.concat(currentMessage);
  }

  function recordAiConversationTurn(commandText, replyText) {
    if (!state.olliModeActive || !isAiEnabled()) return;
    const userText = clean(commandText);
    const assistantText = clean(replyText);
    if (!userText || !assistantText) return;
    state.aiConversationMessages.push(
      { role:'user', content:userText },
      { role:'assistant', content:assistantText }
    );
  }

  function handleAiModeChanged() {
    state.aiConversationMessages = [];
    state.pendingActionReason = null;
    state.pendingMakeupDialogue = null;
    syncAssistantUi();
  }

  async function resolveFeedbackAnalysis(commandText,rawCommandText,current,sourceMessageId) {
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'feedback_analysis',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(commandText),
        sourceMessageText:clean(rawCommandText || commandText),
        sourceMessageId:Number(sourceMessageId || 0)
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true){
      throw new Error(data?.error || data?.message || '피드백 분석 응답을 받지 못했습니다.');
    }
    const message=clean(data?.output);
    if(!message) throw new Error('피드백 분석 응답이 비어 있습니다.');
    return {message};
  }

  async function resolveAiReply(commandText, current) {
    const response = await fetch('/api/chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        promptType:'talk',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        messages:buildAiConversationMessages(commandText),
        stream:false
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || data?.message || '올리 AI 응답을 받지 못했습니다.');
    const message = clean(data?.reply);
    if (!message) throw new Error('올리 AI 응답이 비어 있습니다.');
    return { message };
  }

  function parseTimetableAdminRuleCandidate(commandText, router = global.OlliCommandRouter) {
    if (!router) return null;
    try {
      const parsers=[
        'parseClassLayoutMutationIntent',
        'parseTeacherAssignmentMutationIntent',
        'parseSessionOrderMutationIntent',
        'parseNormalClassDayMutationIntent'
      ];
      for (const name of parsers) {
        if (typeof router[name] !== 'function') continue;
        const parsed=router[name](commandText);
        if (parsed) return parsed;
      }
      return null;
    } catch (error) {
      console.warn('PC 시간표 관리 Agent 후보 판별 실패:', error?.message || error);
      return null;
    }
  }

  function parseBatchAgentCandidate(commandText, router = global.OlliCommandRouter) {
    if (!router || typeof router.parseMultiWriteIntent !== 'function') return null;
    try {
      const parsed = router.parseMultiWriteIntent(commandText);
      return clean(parsed?.intent) === 'batch_write' && Array.isArray(parsed?.commands)
        ? parsed
        : null;
    } catch (error) {
      console.warn('PC 복합쓰기 Agent 후보 판별 실패:', error?.message || error);
      return null;
    }
  }

  function batchCommandNeedsReason(command) {
    return ['mark_absent', 'cancel_makeup', 'cancel_trial'].includes(clean(command?.intent));
  }

  function batchReasonPrompt(command) {
    const intent=clean(command?.intent);
    if (intent === 'mark_absent') return clean(command?.studentName) + ' 학생의 결석 사유를 알려주세요.';
    if (intent === 'cancel_makeup') return clean(command?.studentName) + ' 학생의 보강 취소 사유를 알려주세요.';
    if (intent === 'cancel_trial') return clean(command?.guestName || command?.studentName) + ' 학생의 체험 취소 사유를 알려주세요.';
    return '사유를 알려주세요.';
  }

  function batchCommandNeedsClarification(command) {
    return command?.needsClarification === true;
  }

  function batchClarificationPrompt(command) {
    if (clean(command?.intent) === 'add_makeup') {
      return clean(command?.studentName) + ' 학생의 보강 날짜와 시간을 함께 알려주세요.';
    }
    return '작업에 필요한 날짜와 시간을 함께 알려주세요.';
  }

  function applyBatchClarification(command, replyText, replyMessageId, router) {
    const item=Object.assign({},command);
    const reply=clean(replyText);
    if (clean(item.intent) === 'add_makeup' && router && typeof router.parseMakeupMutationIntent === 'function') {
      const contextText=clean(item.text + ' ' + reply);
      const parsed=router.parseMakeupMutationIntent(contextText);
      if (!parsed || clean(parsed.intent) !== 'add_makeup') return null;
      item.needsClarification=false;
      item.contextText=contextText;
      item.clarificationMessageId=Number(replyMessageId || 0);
      item.clarificationMessageText=reply;
      return item;
    }
    return null;
  }

  function buildBatchAgentCommands(batch,sourceMessageId,sourceMessageText,interpretedBatchCommands=[]){
    const parsed=Array.isArray(batch?.commands)?batch.commands:[];
    const structured=Array.isArray(interpretedBatchCommands)?interpretedBatchCommands:[];
    const router=global.OlliCommandRouter;
    return parsed.map((command,index)=>{
      const intent=clean(command?.intent);
      const provided=structured[index]&&typeof structured[index]==='object'?structured[index]:null;
      const derived=router && typeof router.interpretedIntentToStructuredCommand==='function'
        ? router.interpretedIntentToStructuredCommand(intent,clean(command?.originalText))
        : null;
      const system=provided && clean(provided.action)===intent ? provided : (derived || {});
      if(clean(system?.action)!==intent) return null;
      const reason=clean(system?.reason) || clean(command?.reason);
      const item={
        intent,
        text:clean(command?.originalText),
        studentName:clean(system?.studentName) || clean(command?.studentName || command?.guestName),
        division:clean(system?.division) || clean(command?.division),
        dateExpression:clean(system?.dateExpression) || clean(command?.dateLabel || command?.dateSpec?.label),
        timeSlot:Number(system?.timeSlot || command?.timeSlot || 0),
        classGroup:(clean(system?.classGroup) || clean(command?.classGroup)).toUpperCase(),
        reason,
        reasonMessageId:batchCommandNeedsReason(command) && reason ? Number(sourceMessageId || 0) : 0,
        reasonMessageText:batchCommandNeedsReason(command) && reason ? clean(sourceMessageText) : '',
        memoNote:clean(system?.memoNote) || clean(command?.memoNote),
        needsClarification:command?.batchDraft===true || ['add_makeup','add_trial','add_waitlist','add_pickup'].includes(intent),
        structuredSelection:null,
        structuredCommand:Object.assign({},system,{action:intent}),
        contextText:'',
        clarificationMessageId:0,
        clarificationMessageText:''
      };
      return item;
    }).filter(Boolean);
  }

  function batchStructuredCommand(command,index) {
    const intent=clean(command?.intent);
    const base=command?.structuredCommand&&typeof command.structuredCommand==='object'
      ? Object.assign({},command.structuredCommand)
      : {};
    return Object.assign(base,{
      action:intent,
      studentName:clean(base.studentName || command?.studentName),
      division:clean(base.division || command?.division),
      dateExpression:clean(base.dateExpression || command?.dateExpression),
      timeSlot:Number(base.timeSlot || command?.timeSlot || 0),
      classGroup:clean(base.classGroup || command?.classGroup).toUpperCase(),
      batchStructured:true,
      batchCommandIndex:Number(index)
    });
  }


  function activeBatchStructuredCommand(draft) {
    const pending=state.pendingActionReason?.__batchAgent;
    const index=Number(draft?.batchCommandIndex);
    if(
      clean(state.pendingActionReason?.intent)!=='batch_write'
      || !pending
      || draft?.batchStructured!==true
      || !Number.isInteger(index)
      || index<0
    ) return null;
    const commands=Array.isArray(pending.commands)
      ? pending.commands.map(item=>Object.assign({},item))
      : [];
    if(!['add_makeup','add_trial','add_waitlist','add_pickup'].includes(clean(commands[index]?.intent))) return null;
    return {pending,index,commands};
  }

  async function finishBatchStructuredCommand(draft,prepared,current) {
    const active=activeBatchStructuredCommand(draft);
    if(!active || prepared?.kind!=='action_pending' || !prepared?.payload) return null;
    const intent=clean(active.commands[active.index]?.intent);
    let selection=null;
    if(intent==='add_makeup'){
      selection={
        sessionDate:clean(prepared.payload.sessionDate),
        timeSlot:Number(prepared.payload.timeSlot || 0),
        classGroup:clean(prepared.payload.classGroup).toUpperCase()
      };
      if(!/^\d{4}-\d{2}-\d{2}$/.test(selection.sessionDate)||selection.timeSlot<=0||!['A','B'].includes(selection.classGroup)){
        throw new Error('복합쓰기 보강 선택 결과를 확인하지 못했습니다.');
      }
    }else if(intent==='add_trial'){
      selection={
        sessionDate:clean(prepared.payload.sessionDate),
        timeSlot:Number(prepared.payload.timeSlot || 0),
        classGroup:clean(prepared.payload.classGroup).toUpperCase(),
        division:clean(prepared.payload.division)
      };
    }else if(intent==='add_waitlist'){
      selection={
        sessionDate:clean(prepared.payload.sessionDate || prepared.payload.effectiveDate),
        timeSlot:Number(prepared.payload.targetTimeSlot || 0),
        classGroup:clean(prepared.payload.targetClassGroup).toUpperCase(),
        division:clean(prepared.payload.division)
      };
    }else if(intent==='add_pickup'){
      selection={
        weekday:Number(prepared.payload.weekday || 0),
        classTime:Number(prepared.payload.classTime || 0)
      };
    }
    if(!selection) throw new Error('복합쓰기 선택 결과를 확인하지 못했습니다.');

    active.commands[active.index]=Object.assign({},active.commands[active.index],{
      needsClarification:false,
      structuredSelection:selection
    });

    const nextIndex=active.commands.findIndex(batchCommandNeedsClarification);
    const nextPending={
      sourceMessageId:Number(active.pending.sourceMessageId || 0),
      sourceMessageText:clean(active.pending.sourceMessageText),
      commands:active.commands
    };
    if(nextIndex>=0){
      state.pendingActionReason={intent:'batch_write',__batchAgent:nextPending};
      return startBatchStructuredChoice(current,nextPending,nextIndex);
    }

    state.pendingActionReason=null;
    const turn=await resolveBatchAgentTurn({
      sourceText:nextPending.sourceMessageText,
      sourceMessageId:nextPending.sourceMessageId,
      commands:active.commands,
      current
    });
    return turn?.assistantMessage || null;
  }


  async function startBatchStructuredChoice(current,pendingBatch,index) {
    const router=global.OlliCommandRouter;
    const command=Array.isArray(pendingBatch?.commands) ? pendingBatch.commands[index] : null;
    if(
      !router
      || typeof router.prepareStructuredAction!=='function'
      || !['add_makeup','add_trial','add_waitlist','add_pickup'].includes(clean(command?.intent))
    ){
      throw new Error('복합쓰기 선택 기능을 준비하지 못했습니다.');
    }

    const prepared=await router.prepareStructuredAction(
      batchStructuredCommand(command,index),
      {source:'olli_talk_batch_structured_choice',selectedStudent:null,autoSubmitContext:null}
    );
    if(prepared?.handled!==true) throw new Error('복합쓰기 선택을 준비하지 못했습니다.');

    const replyToMessageId=Number(pendingBatch?.sourceMessageId || 0) || null;
    if(prepared.kind==='action_needs_field' && prepared.payload){
      const field=clean(prepared.payload.field);
      if(field==='student_choice') return saveStructuredStudentChoice(current,prepared.message || '학생을 선택해 주세요.',prepared.payload,replyToMessageId);
      if(field==='target_choice') return saveStructuredTargetChoice(current,prepared.message || '보강할 반을 선택해 주세요.',prepared.payload,replyToMessageId);
      if(field==='division') return saveStructuredDivisionChoice(current,prepared.message || '유치부인지 초등부인지 선택해 주세요.',prepared.payload,replyToMessageId);
      if(field==='date') return saveStructuredDateChoice(current,prepared.message || '보강 날짜를 선택해 주세요.',prepared.payload,replyToMessageId);
      if(field==='time') return saveStructuredTimeChoice(current,prepared.message || '보강 시간을 선택해 주세요.',prepared.payload,replyToMessageId);
    }
    if(prepared.kind==='action_pending' && prepared.payload){
      return finishBatchStructuredCommand(batchStructuredCommand(command,index),prepared,current);
    }
    if(prepared.kind==='action_rejected'){
      return saveAssistantReply(current,clean(prepared.message) || '보강 등록을 준비하지 못했어요.',replyToMessageId);
    }
    throw new Error('복합쓰기 선택 상태를 확인하지 못했습니다.');
  }

  function parseTrialCancelAgentCandidate(commandText, router = global.OlliCommandRouter) {
    if (!router || typeof router.parseTrialCancelMutationIntent !== 'function') return null;
    try {
      const parsed = router.parseTrialCancelMutationIntent(commandText);
      return clean(parsed?.intent) === 'cancel_trial' ? parsed : null;
    } catch (error) {
      console.warn('PC 체험 취소 Agent 후보 판별 실패:', error?.message || error);
      return null;
    }
  }

  function parseAbsenceAgentCandidate(commandText, router = global.OlliCommandRouter) {
    if (!router || typeof router.parseAbsenceMutationIntent !== 'function') return null;
    try {
      const parsed = router.parseAbsenceMutationIntent(commandText);
      return clean(parsed?.intent) === 'mark_absent' && clean(parsed?.studentName) ? parsed : null;
    } catch (error) {
      console.warn('PC 결석 Agent 후보 판별 실패:', error?.message || error);
      return null;
    }
  }

  function isClassOnceAgentCandidate(commandText, router = global.OlliCommandRouter) {
    if (!router || typeof router.parseClassMutationIntent !== 'function') return false;
    try {
      return clean(router.parseClassMutationIntent(commandText)?.intent) === 'add_class_once';
    } catch (error) {
      console.warn('PC 1회 수업 Agent 후보 판별 실패:', error?.message || error);
      return false;
    }
  }

  function parseMakeupCancelAgentCandidate(commandText, router = global.OlliCommandRouter) {
    if (!router || typeof router.parseMakeupCancelMutationIntent !== 'function') return null;
    try {
      const parsed = router.parseMakeupCancelMutationIntent(commandText);
      return clean(parsed?.intent) === 'cancel_makeup' ? parsed : null;
    } catch (error) {
      console.warn('PC 보강 취소 Agent 후보 판별 실패:', error?.message || error);
      return null;
    }
  }

  function isMakeupCancelAgentCandidate(commandText, router = global.OlliCommandRouter) {
    return !!parseMakeupCancelAgentCandidate(commandText, router);
  }

  async function resolveAttendanceStatusAgentTurn(commandText, parsed, current, replyToMessageId) {
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
      throw new Error('출석부 상태 변경 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'attendance_status_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(commandText),
        sourceMessageId
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true || !data?.message?.action){
      throw new Error(data?.error || data?.message || '출석부 상태 변경 Agent 응답을 받지 못했습니다.');
    }
    if(clean(data.message.action.action_type)!=='set_attendance_status'){
      throw new Error('출석부 상태 변경 Agent 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  async function resolveTimetableAdminRuleTurn(commandText, parsed, current, replyToMessageId) {
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
      throw new Error('시간표 관리 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    const expectedType=clean(parsed?.intent);
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'timetable_admin_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(commandText),
        sourceMessageId
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true){
      throw new Error(data?.error || data?.message || '시간표 관리 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=clean(data.choiceRequired.message) || '수업 순서를 변경할 수업을 선택해 주세요.';
      return {
        assistantMessage:await saveStructuredTargetChoice(
          current,
          choiceMessage,
          data.choiceRequired.payload,
          sourceMessageId
        ),
        replyText:choiceMessage,
        recordAi:false
      };
    }
    if(!data?.message?.action){
      throw new Error(data?.error || data?.message || '시간표 관리 확인 카드를 받지 못했습니다.');
    }
    if(clean(data.message.action.action_type)!==expectedType){
      throw new Error('시간표 관리 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }


  async function resolveStructuredTimetableAdminTurn(structuredCommand,current,sourceMessageText,sourceMessageId){
    const sourceId=Number(sourceMessageId || 0);
    const sourceText=clean(sourceMessageText);
    if(!Number.isSafeInteger(sourceId)||sourceId<=0||!sourceText){
      throw new Error('수업 순서 변경 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_timetable_admin_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:sourceText,
        sourceMessageId:sourceId,
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true||!data?.message?.action){
      throw new Error(data?.error || data?.message || '시간표 관리 규칙 시스템 응답을 받지 못했습니다.');
    }
    const expectedType=clean(structuredCommand?.action);
    if(!['set_session_order','set_class_teacher','set_teacher_override'].includes(expectedType)
      ||clean(data.message.action.action_type)!==expectedType){
      throw new Error('시간표 관리 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  async function resolveSourceBoundReadAgentTurn({
    mode,
    commandText,
    readIntent=null,
    current,
    replyToMessageId,
  }) {
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
      throw new Error('시간표 조회 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    const body={
      mode,
      academyId:current?.academyId || '',
      sessionToken:current?.sessionToken || '',
      message:clean(commandText),
      sourceMessageId
    };
    if(readIntent) body.readIntent=readIntent;

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true || !clean(data?.output)){
      throw new Error(data?.error || data?.message || '시간표 읽기 Agent 응답을 받지 못했습니다.');
    }
    const replyText=clean(data.output);
    return {
      assistantMessage:await saveAssistantReply(current,replyText,sourceMessageId),
      replyText,
      recordAi:false
    };
  }

  async function resolveBatchAgentTurn({
    sourceText,
    sourceMessageId,
    commands,
    current,
  }) {
    const sourceId=Number(sourceMessageId || 0);
    if(!Number.isSafeInteger(sourceId) || sourceId<=0){
      throw new Error('복합쓰기 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'batch_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(sourceText),
        sourceMessageId:sourceId,
        commands
      })
    });
    const data=await response.json().catch(()=>({}));
    const messages=Array.isArray(data?.messages) ? data.messages : [];
    if(!response.ok || data?.ok!==true || messages.length<2){
      throw new Error(data?.error || data?.message || '복합쓰기 Agent 응답을 받지 못했습니다.');
    }
    return {
      assistantMessage:messages[0],
      assistantMessages:messages,
      replyText:messages.map((message)=>clean(message?.body)).filter(Boolean).join('\n'),
      recordAi:false
    };
  }

  async function resolveStructuredTimetableMemoTurn(structuredCommand,current,sourceMessageText,sourceMessageId){
    const sourceId=Number(sourceMessageId || 0);
    const sourceText=clean(sourceMessageText);
    const memoNote=clean(structuredCommand?.memoNote || structuredCommand?.memo_note);
    if(!Number.isSafeInteger(sourceId)||sourceId<=0||!sourceText){
      throw new Error('시간표 메모 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_memo_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:sourceText,
        sourceMessageId:sourceId,
        memoNote,
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true){
      throw new Error(data?.error || data?.message || '시간표 메모 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=clean(data.choiceRequired.message) || '삭제할 메모를 선택해 주세요.';
      return {
        assistantMessage:await saveStructuredTargetChoice(
          current,
          choiceMessage,
          data.choiceRequired.payload,
          sourceId
        ),
        replyText:choiceMessage,
        recordAi:false
      };
    }
    if(!data?.message?.action){
      throw new Error(data?.error || data?.message || '시간표 메모 확인 카드를 받지 못했습니다.');
    }
    const expectedType=clean(structuredCommand?.action);
    if(clean(data.message.action.action_type)!==expectedType){
      throw new Error('시간표 메모 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  function isSafeMakeupClarification(response,data) {
    const code=clean(data?.code);
    const safeCodes=new Set([
      'OLLI_AGENT_MAKEUP_GROUP_REQUIRED',
      'OLLI_AGENT_MAKEUP_TIME_NOT_AVAILABLE',
      'OLLI_AGENT_MAKEUP_GROUP_NOT_AVAILABLE',
      'OLLI_AGENT_MAKEUP_FULL',
      'OLLI_AGENT_MAKEUP_ALREADY_EXISTS',
      'OLLI_AGENT_MAKEUP_CLOSED_DAY',
      'OLLI_AGENT_MAKEUP_DATE_PAST',
      'OLLI_AGENT_MAKEUP_TARGET_AMBIGUOUS',
      'OLLI_AGENT_MAKEUP_ACTIVE_STUDENT_REQUIRED',
      'OLLI_AGENT_MAKEUP_TIME_INVALID',
      'OLLI_AGENT_MAKEUP_DATE_INVALID'
    ]);
    return [400,404,409].includes(Number(response?.status || 0))
      && safeCodes.has(code)
      && !!clean(data?.error);
  }

  async function resolveMakeupAgentResponse({
    response,
    data,
    current,
    replyToMessageId,
  }) {
    if (!response.ok) {
      if (isSafeMakeupClarification(response,data)) {
        const message=clean(data?.error);
        state.pendingMakeupDialogue=null;
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      throw new Error(data?.error || data?.message || '보강 등록 Agent 응답을 받지 못했습니다.');
    }

    const interactionStatus=clean(data?.interactionStatus);
    const aiReply=clean(data?.output);
    if (data?.ok === true && ['needs_clarification','blocked'].includes(interactionStatus) && aiReply) {
      state.pendingMakeupDialogue={ active:true, status:interactionStatus, prompt:aiReply };
      return {
        assistantMessage:await saveAssistantReply(current,aiReply,replyToMessageId),
        replyText:aiReply,
        recordAi:false
      };
    }

    if (data?.ok !== true || !data?.message?.action) {
      throw new Error(data?.error || data?.message || '보강 등록 Agent 응답을 받지 못했습니다.');
    }
    if (clean(data.message.action.action_type) !== 'add_makeup') {
      throw new Error('보강 등록 Agent 작업 종류가 올바르지 않습니다.');
    }
    state.pendingMakeupDialogue=null;
    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  function mergeStructuredMakeupCancelCommand(previous,current){
    const before=previous && typeof previous==='object' ? previous : {};
    const next=current && typeof current==='object' ? current : {};
    const nextTime=Number(next.timeSlot || 0);
    const nextMinute=Number(next.classMinute || 0);
    return {
      action:'cancel_makeup',
      studentName:clean(next.studentName) || clean(before.studentName),
      oneTimeSessionId:clean(next.oneTimeSessionId || next.one_time_session_id) || clean(before.oneTimeSessionId || before.one_time_session_id),
      dateExpression:clean(next.dateExpression) || clean(before.dateExpression),
      timeSlot:nextTime>0 ? nextTime : Number(before.timeSlot || 0),
      classMinute:(nextTime>0 || nextMinute>0) ? nextMinute : Number(before.classMinute || 0),
      classGroup:clean(next.classGroup).toUpperCase() || clean(before.classGroup).toUpperCase(),
      reason:clean(next.reason) || clean(before.reason),
    };
  }

  async function resolveStructuredMakeupCancelTurn({
    structuredCommand,
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    current,
  }){
    const sourceId=Number(sourceMessageId || 0);
    const reasonId=Number(reasonMessageId || 0);
    if(!Number.isSafeInteger(sourceId) || sourceId<=0){
      throw new Error('보강 취소 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if(!Number.isSafeInteger(reasonId) || reasonId<=0 || !clean(reasonText)){
      throw new Error('보강 취소 사유 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_makeup_cancel_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(sourceText),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:clean(reasonMessageText),
        reason:clean(reasonText),
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true){
      throw new Error(data?.error || data?.message || '보강 취소 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=clean(data.choiceRequired.message) || '취소할 보강을 선택해 주세요.';
      return {
        assistantMessage:await saveStructuredTargetChoice(
          current,
          choiceMessage,
          data.choiceRequired.payload,
          sourceId
        ),
        replyText:choiceMessage,
        recordAi:false
      };
    }
    if(!data?.message?.action){
      throw new Error(data?.error || data?.message || '보강 취소 확인 카드를 받지 못했습니다.');
    }
    if(clean(data.message.action.action_type)!=='cancel_makeup'){
      throw new Error('보강 취소 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  async function resolveMakeupCancelAgentTurn({
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    current,
  }) {
    const sourceId = Number(sourceMessageId || 0);
    const reasonId = Number(reasonMessageId || 0);
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
      throw new Error('보강 취소 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if (!Number.isSafeInteger(reasonId) || reasonId <= 0 || !clean(reasonText)) {
      throw new Error('보강 취소 사유 메시지를 확인하지 못했습니다.');
    }

    const response = await fetch('/api/olli-agent', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        mode:'makeup_cancel_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(sourceText),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:clean(reasonMessageText),
        reason:clean(reasonText)
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true || !data?.message?.action) {
      throw new Error(data?.error || data?.message || '보강 취소 Agent 응답을 받지 못했습니다.');
    }
    if (clean(data.message.action.action_type) !== 'cancel_makeup') {
      throw new Error('보강 취소 Agent 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  function mergeStructuredTrialCancelCommand(previous,current){
    const before=previous && typeof previous==='object' ? previous : {};
    const next=current && typeof current==='object' ? current : {};
    const nextTime=Number(next.timeSlot || 0);
    const nextMinute=Number(next.classMinute || 0);
    return {
      action:'cancel_trial',
      studentName:clean(next.studentName) || clean(before.studentName),
      oneTimeSessionId:clean(next.oneTimeSessionId || next.one_time_session_id) || clean(before.oneTimeSessionId || before.one_time_session_id),
      division:clean(next.division) || clean(before.division),
      dateExpression:clean(next.dateExpression) || clean(before.dateExpression),
      timeSlot:nextTime>0 ? nextTime : Number(before.timeSlot || 0),
      classMinute:(nextTime>0 || nextMinute>0) ? nextMinute : Number(before.classMinute || 0),
      classGroup:clean(next.classGroup).toUpperCase() || clean(before.classGroup).toUpperCase(),
      reason:clean(next.reason) || clean(before.reason),
    };
  }

  async function resolveStructuredTrialCancelTurn({
    structuredCommand,
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    current,
  }){
    const sourceId=Number(sourceMessageId || 0);
    const reasonId=Number(reasonMessageId || 0);
    if(!Number.isSafeInteger(sourceId)||sourceId<=0){
      throw new Error('체험 취소 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if(!Number.isSafeInteger(reasonId)||reasonId<=0||!clean(reasonText)){
      throw new Error('체험 취소 사유 메시지를 확인하지 못했습니다.');
    }

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_trial_cancel_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(sourceText),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:clean(reasonMessageText),
        reason:clean(reasonText),
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true){
      throw new Error(data?.error || data?.message || '체험 취소 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=clean(data.choiceRequired.message) || '취소할 체험수업을 선택해 주세요.';
      return {
        assistantMessage:await saveStructuredTargetChoice(current,choiceMessage,data.choiceRequired.payload,sourceId),
        replyText:choiceMessage,
        recordAi:false
      };
    }
    if(!data?.message?.action){
      throw new Error(data?.error || data?.message || '체험 취소 확인 카드를 받지 못했습니다.');
    }
    if(clean(data.message.action.action_type)!=='cancel_trial'){
      throw new Error('체험 취소 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  async function resolveTrialCancelAgentTurn({
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    current,
  }) {
    const sourceId = Number(sourceMessageId || 0);
    const reasonId = Number(reasonMessageId || 0);
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
      throw new Error('체험 취소 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if (!Number.isSafeInteger(reasonId) || reasonId <= 0 || !clean(reasonText)) {
      throw new Error('체험 취소 사유 메시지를 확인하지 못했습니다.');
    }

    const response = await fetch('/api/olli-agent', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        mode:'trial_cancel_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(sourceText),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:clean(reasonMessageText),
        reason:clean(reasonText)
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true || !data?.message?.action) {
      throw new Error(data?.error || data?.message || '체험 취소 Agent 응답을 받지 못했습니다.');
    }
    if (clean(data.message.action.action_type) !== 'cancel_trial') {
      throw new Error('체험 취소 Agent 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  async function resolveStructuredWaitlistUpdateTurn(structuredCommand,current,sourceText,replyToMessageId){
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
      throw new Error('대기 변경 요청의 원문 메시지를 확인하지 못했습니다.');
    }

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_waitlist_update_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(sourceText),
        sourceMessageId,
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true){
      throw new Error(data?.error || data?.message || '대기 변경 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=clean(data.choiceRequired.message) || '변경할 대기를 선택해 주세요.';
      return {
        assistantMessage:await saveStructuredTargetChoice(current,choiceMessage,data.choiceRequired.payload,sourceMessageId),
        replyText:choiceMessage,
        recordAi:false
      };
    }
    if(!data?.message?.action){
      throw new Error(data?.error || data?.message || '대기 변경 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(clean(data.message.action.action_type)!=='update_waitlist'){
      throw new Error('대기 변경 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  async function resolveAbsenceAgentTurn({
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    current,
  }) {
    const sourceId = Number(sourceMessageId || 0);
    const reasonId = Number(reasonMessageId || 0);
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
      throw new Error('결석 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if (!Number.isSafeInteger(reasonId) || reasonId <= 0 || !clean(reasonText)) {
      throw new Error('결석 사유 메시지를 확인하지 못했습니다.');
    }

    const response = await fetch('/api/olli-agent', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        mode:'absence_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(sourceText),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:clean(reasonMessageText),
        reason:clean(reasonText)
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true || !data?.message?.action) {
      throw new Error(data?.error || data?.message || '결석 Agent 응답을 받지 못했습니다.');
    }
    if (clean(data.message.action.action_type) !== 'mark_absent') {
      throw new Error('결석 Agent 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  async function resolveClassOnceAgentTurn(commandText, current, replyToMessageId) {
    const sourceMessageId = Number(replyToMessageId || 0);
    if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
      throw new Error('1회 수업 등록 요청의 원문 메시지를 확인하지 못했습니다.');
    }

    const response = await fetch('/api/olli-agent', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        mode:'class_once_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(commandText),
        sourceMessageId
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true || !data?.message?.action) {
      throw new Error(data?.error || data?.message || '1회 수업 Agent 응답을 받지 못했습니다.');
    }
    if (clean(data.message.action.action_type) !== 'add_class_once') {
      throw new Error('1회 수업 Agent 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  async function resolveStructuredMoveCancelTurn(structuredCommand,current,sourceMessageText,sourceMessageId){
    const sourceId=Number(sourceMessageId || 0);
    if(!Number.isSafeInteger(sourceId)||sourceId<=0||!clean(sourceMessageText)){
      throw new Error('수업 이동 취소 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_move_cancel_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(sourceMessageText),
        sourceMessageId:sourceId,
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true){
      throw new Error(data?.error || data?.message || '수업 이동 취소 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=clean(data.choiceRequired.message) || '취소할 수업 이동 예약을 선택해 주세요.';
      return {
        assistantMessage:await saveStructuredTargetChoice(
          current,
          choiceMessage,
          data.choiceRequired.payload,
          sourceId
        ),
        replyText:choiceMessage,
        recordAi:false
      };
    }
    if(!data?.message?.action){
      throw new Error(data?.error || data?.message || '수업 이동 취소 확인 카드를 받지 못했습니다.');
    }
    if(clean(data.message.action.action_type)!=='cancel_move'){
      throw new Error('수업 이동 취소 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:clean(data.message.body),
      recordAi:false
    };
  }

  async function saveAssistantReply(current, body, replyToMessageId) {
    const payload = await rpc('olli_team_chat_send_ai', {
      p_session_token: current.sessionToken,
      p_academy_id: current.academyId,
      p_body: clean(body),
      p_client_message_id: clientMessageId(),
      p_reply_to_message_id: Number(replyToMessageId || 0) || null
    });
    if (!payload?.ok || !payload?.message) {
      throw new Error(payload?.message || '올리 응답을 저장하지 못했습니다.');
    }
    return payload.message;
  }

  async function savePendingTextInputReply(current,message,replyToMessageId) {
    const text=clean(message) || '내용을 입력해 주세요.';
    const assistantMessage=await saveAssistantReply(current,text,replyToMessageId);
    state.pendingTextInputMessageId=clean(assistantMessage?.id);
    return {
      assistantMessage,
      replyText:text,
      recordAi:false
    };
  }

  function focusPendingTextInput() {
    const input=byId('olliPcTeamTalkInput');
    if(!input) return false;
    try { input.focus({preventScroll:true}); } catch (_) { input.focus(); }
    return true;
  }

  function makePendingTextInputButton() {
    const wrap=create('div','olliPcTeamTalkPendingInput');
    const button=document.createElement('button');
    button.type='button';
    button.className='olliPcTeamTalkPendingInputButton';
    button.textContent='입력하기';
    button.setAttribute('aria-label','요청한 내용을 입력하기');
    button.addEventListener('click',focusPendingTextInput);
    wrap.appendChild(button);
    return wrap;
  }

  function shouldShowPendingTextInput(item) {
    return !!state.pendingActionReason
      && clean(item?.message_type)==='ai'
      && clean(item?.id)===clean(state.pendingTextInputMessageId);
  }

  async function saveStructuredTargetChoice(current,body,payload,replyToMessageId) {
    const result=await rpc('olli_team_chat_send_structured_target_choice',{
      p_session_token:current.sessionToken,
      p_academy_id:current.academyId,
      p_body:normalizeActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:clientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveStructuredStudentChoice(current,body,payload,replyToMessageId) {
    const result=await rpc('olli_team_chat_send_structured_student_choice',{
      p_session_token:current.sessionToken,
      p_academy_id:current.academyId,
      p_body:normalizeActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:clientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '학생 선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveStructuredDivisionChoice(current,body,payload,replyToMessageId) {
    const result=await rpc('olli_team_chat_send_structured_division_choice',{
      p_session_token:current.sessionToken,
      p_academy_id:current.academyId,
      p_body:normalizeActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:clientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '수업 구분 선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveStructuredTimeChoice(current,body,payload,replyToMessageId) {
    const result=await rpc('olli_team_chat_send_structured_time_choice',{
      p_session_token:current.sessionToken,
      p_academy_id:current.academyId,
      p_body:normalizeActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:clientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '시간 선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveStructuredDateChoice(current,body,payload,replyToMessageId) {
    const result=await rpc('olli_team_chat_send_structured_date_choice',{
      p_session_token:current.sessionToken,
      p_academy_id:current.academyId,
      p_body:normalizeActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:clientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '날짜 선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveAssistantAction(current, body, command, replyToMessageId) {
    const actionType = clean(command?.intent);
    if (!actionType) throw new Error('작업 종류를 확인하지 못했습니다.');

    const rpcName=actionType==='choose_makeup_group'
      ? 'olli_team_chat_send_makeup_group_choice'
      : actionType==='choose_trial_group'
        ? 'olli_team_chat_send_trial_group_choice'
        : actionType==='choose_waitlist_group'
          ? 'olli_team_chat_send_waitlist_group_choice'
          : actionType==='choose_move_group'
            ? 'olli_team_chat_send_move_group_choice'
            : 'olli_team_chat_send_action';
    const rpcPayload={
      p_session_token:current.sessionToken,
      p_academy_id:current.academyId,
      p_body:normalizeActionPrompt(body),
      p_action_payload:command,
      p_client_message_id:clientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    };
    if(rpcName==='olli_team_chat_send_action') rpcPayload.p_action_type=actionType;
    const payload = await rpc(rpcName, rpcPayload);
    if (!payload?.ok || !payload?.message?.action) {
      throw new Error(payload?.message || '작업 카드를 저장하지 못했습니다.');
    }
    return payload.message;
  }

  function isPendingReasonCancel(text) {
    return /^(취소|취소해|취소해줘|그만|중단|하지마|아니|아니야)$/i.test(clean(text));
  }


  async function resolveBatchRuleTurn(parsed,commandText,current,replyToMessageId,batchCommands=[]){
    const sourceId=Number(replyToMessageId || 0);
    const commands=buildBatchAgentCommands(parsed,sourceId,commandText,batchCommands);
    if(commands.length!==(Array.isArray(parsed?.commands)?parsed.commands.length:0)){
      throw new Error('복합명령 구조화 결과와 규칙 시스템 작업 수가 일치하지 않습니다.');
    }
    const missingIndex=commands.findIndex((item)=>batchCommandNeedsReason(item) && !clean(item.reason));
    if(missingIndex>=0){
      state.pendingActionReason={intent:'batch_write',__batchAgent:{
        sourceMessageId:sourceId,sourceMessageText:clean(commandText),commands
      }};
      const prompt=batchReasonPrompt(commands[missingIndex]);
      return {assistantMessage:await saveAssistantReply(current,prompt,replyToMessageId),replyText:prompt,recordAi:false};
    }
    const clarificationIndex=commands.findIndex(batchCommandNeedsClarification);
    if(clarificationIndex>=0){
      const pendingBatch={sourceMessageId:sourceId,sourceMessageText:clean(commandText),commands};
      state.pendingActionReason={intent:'batch_write',__batchAgent:pendingBatch};
      const assistantMessage=await startBatchStructuredChoice(current,pendingBatch,clarificationIndex);
      return {assistantMessage,replyText:clean(assistantMessage?.body) || '보강 날짜를 선택해 주세요.',recordAi:false};
    }
    return resolveBatchAgentTurn({sourceText:clean(commandText),sourceMessageId:sourceId,commands,current});
  }

  async function resolveSharedAgentRouteTurn(route, commandText, current, replyToMessageId, batchCommands=[]) {
    if (!route || !route.key) return null;
    const parsed = route.parsed || null;

    switch (route.key) {
      case 'attendance_status':
        return resolveAttendanceStatusAgentTurn(commandText, parsed, current, replyToMessageId);
      case 'class_once': return resolveClassOnceAgentTurn(commandText,current,replyToMessageId);
      case 'attendance_read':
        return resolveSourceBoundReadAgentTurn({mode:'attendance_read',commandText,current,replyToMessageId});
      case 'pickup_read':
        return resolveSourceBoundReadAgentTurn({mode:'pickup_read',commandText,current,replyToMessageId});
      default: return null;
    }
  }

  async function resolveContextualMakeupTurn(commandText,current,replyToMessageId) {
    if (!state.pendingMakeupDialogue) return null;
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0) return null;

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'context_makeup_prepare',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(commandText),
        sourceMessageId,
        conversation:state.aiConversationMessages.map((item)=>({
          role:item.role,
          content:item.content
        }))
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      throw new Error(data?.error || data?.message || '보강 문맥 응답을 받지 못했습니다.');
    }
    if(data?.ok!==true || data?.handled!==true){
      const pendingStatus=clean(state.pendingMakeupDialogue?.status);
      const retryMessage=pendingStatus==='blocked'
        ? '보강 등록을 이어서 진행 중이에요. 변경할 날짜·시간·반을 알려 주세요. 그만하려면 "취소"라고 말해 주세요.'
        : (clean(state.pendingMakeupDialogue?.prompt) || '보강 등록을 이어서 진행 중이에요. 필요한 내용을 다시 알려 주세요. 그만하려면 "취소"라고 말해 주세요.');
      return {
        assistantMessage:await saveAssistantReply(current,retryMessage,sourceMessageId),
        replyText:retryMessage,
        recordAi:false
      };
    }
    return resolveMakeupAgentResponse({
      response,
      data,
      current,
      replyToMessageId:sourceMessageId,
    });
  }



  async function interpretOlliSystemLanguage(commandText,current,replyToMessageId) {
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
      throw new Error('올리 해석에 필요한 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'interpret',
        academyId:current?.academyId || '',
        sessionToken:current?.sessionToken || '',
        message:clean(commandText),
        sourceMessageId,
        conversation:(Array.isArray(state.aiConversationMessages) ? state.aiConversationMessages : []).map((item)=>({
          role:item.role,
          content:item.content
        }))
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      throw new Error(data?.error || data?.message || '올리 공통 해석 응답을 받지 못했습니다.');
    }
    const language=data?.systemLanguage || {};
    const lane=clean(language.lane) || 'routine';
    const route=clean(language.route);
    const intent=clean(language.intent);
    const standaloneCommand=clean(language.standaloneCommand);
    const structuredRaw=language.structuredCommand && typeof language.structuredCommand==='object'
      ? language.structuredCommand
      : {};
    const structuredCommand={
      action:clean(structuredRaw.action),
      studentName:clean(structuredRaw.studentName),
      division:clean(structuredRaw.division),
      dateExpression:clean(structuredRaw.dateExpression),
      timeSlot:Number(structuredRaw.timeSlot || 0),
      classGroup:clean(structuredRaw.classGroup).toUpperCase(),
      weekday:Number(structuredRaw.weekday || 0),
      classTime:Number(structuredRaw.classTime || 0),
      classMinute:Number(structuredRaw.classMinute || 0),
      pickupKind:clean(structuredRaw.pickupKind),
      pickupLabel:clean(structuredRaw.pickupLabel),
      pickupTime:clean(structuredRaw.pickupTime),
      sourceDateExpression:clean(structuredRaw.sourceDateExpression),
      sourceWeekday:Number(structuredRaw.sourceWeekday || 0),
      sourceTimeSlot:Number(structuredRaw.sourceTimeSlot || 0),
      sourceMinute:Number(structuredRaw.sourceMinute || 0),
      sourceClassGroup:clean(structuredRaw.sourceClassGroup).toUpperCase(),
      targetDateExpression:clean(structuredRaw.targetDateExpression),
      targetWeekday:Number(structuredRaw.targetWeekday || 0),
      targetTimeSlot:Number(structuredRaw.targetTimeSlot || 0),
      targetMinute:Number(structuredRaw.targetMinute || 0),
      targetClassGroup:clean(structuredRaw.targetClassGroup).toUpperCase(),
      reason:clean(structuredRaw.reason),
      memoNote:clean(structuredRaw.memoNote),
      availabilityPurpose:clean(structuredRaw.availabilityPurpose),
      rosterKind:clean(structuredRaw.rosterKind)
    };
    const readCommands=(Array.isArray(language.readCommands)?language.readCommands:[]).slice(0,3).map((command)=>({
      action:clean(command?.action),
      studentName:clean(command?.studentName),
      division:clean(command?.division),
      dateExpression:clean(command?.dateExpression),
      timeSlot:Number(command?.timeSlot || 0),
      classGroup:clean(command?.classGroup).toUpperCase(),
      weekday:Number(command?.weekday || 0),
      classTime:Number(command?.classTime || 0),
      pickupKind:clean(command?.pickupKind),
      availabilityPurpose:clean(command?.availabilityPurpose),
      rosterKind:clean(command?.rosterKind)
    }));
    const batchCommands=(Array.isArray(language.batchCommands)?language.batchCommands:[]).slice(0,3).map((command)=>({
      action:clean(command?.action),
      studentName:clean(command?.studentName),
      division:clean(command?.division),
      dateExpression:clean(command?.dateExpression),
      timeSlot:Number(command?.timeSlot || 0),
      classGroup:clean(command?.classGroup).toUpperCase(),
      weekday:Number(command?.weekday || 0),
      classTime:Number(command?.classTime || 0),
      classMinute:Number(command?.classMinute || 0),
      pickupKind:clean(command?.pickupKind),
      pickupLabel:clean(command?.pickupLabel),
      pickupTime:clean(command?.pickupTime),
      sourceDateExpression:clean(command?.sourceDateExpression),
      sourceWeekday:Number(command?.sourceWeekday || 0),
      sourceTimeSlot:Number(command?.sourceTimeSlot || 0),
      sourceMinute:Number(command?.sourceMinute || 0),
      sourceClassGroup:clean(command?.sourceClassGroup).toUpperCase(),
      targetDateExpression:clean(command?.targetDateExpression),
      targetWeekday:Number(command?.targetWeekday || 0),
      targetTimeSlot:Number(command?.targetTimeSlot || 0),
      targetMinute:Number(command?.targetMinute || 0),
      targetClassGroup:clean(command?.targetClassGroup).toUpperCase(),
      reason:clean(command?.reason),
      memoNote:clean(command?.memoNote)
    }));
    const reply=clean(language.reply);
    if(data?.ok!==true || !['routine','feedback','chat'].includes(lane) || !['rule','agent','chat'].includes(route) || !intent || !standaloneCommand){
      throw new Error('올리 공통 해석 결과가 올바르지 않습니다.');
    }
    return {
      lane,
      route,
      intent,
      standaloneCommand,
      structuredCommand,
      batchCommands,
      readCommands,
      reply,
      contextUsed:language.contextUsed===true
    };
  }



  function ruleCommandMatchesInterpretation(router,intent,commandText) {
    const expected=clean(intent);
    if(!router || !expected) return false;
    if(expected==='open_student_info'){
      try{
        return typeof router.parseStudentInfoLookupIntent==='function'
          && !!router.parseStudentInfoLookupIntent(commandText);
      }catch(_){ return false; }
    }
    try{
      const classified=typeof router.classifyRequest==='function'
        ? router.classifyRequest(commandText)
        : null;
      return clean(classified?.intent)===expected;
    }catch(_){
      return false;
    }
  }


  function reportAiLegacyRouteOutcome(current, outcome, routeKey, sharedRoute, classifierAvailable) {
    if (!current?.academyId || !current?.sessionToken) return;
    void fetch('/api/olli-agent', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        mode:'route_outcome',
        academyId:current.academyId,
        sessionToken:current.sessionToken,
        surface:'pc',
        outcome:clean(outcome),
        routeKey:clean(routeKey),
        sharedRouteKey:clean(sharedRoute?.key),
        classifierAvailable:classifierAvailable === true
      })
    }).catch(() => {});
  }

 async function resolveAiTurn(commandText, current, replyToMessageId, options = {}) {
    const router = global.OlliCommandRouter;
    const schedule = global.OlliCommandSchedule;
    const rawCommandText=clean(commandText);
    let localRuleClassification=null;
    let localRuleIntent='';
    if(router && typeof router.classifyRequest==='function'){
      try{
        localRuleClassification=router.classifyRequest(rawCommandText);
        localRuleIntent=clean(localRuleClassification?.intent);
      }catch(_){
        localRuleClassification=null;
        localRuleIntent='';
      }
    }
    if(!localRuleIntent && router && typeof router.parseStudentInfoLookupIntent==='function'){
      try{
        if(router.parseStudentInfoLookupIntent(rawCommandText)) localRuleIntent='open_student_info';
      }catch(_){}
    }
    const localRuleHandled=!!localRuleIntent
      && clean(localRuleClassification?.type || (localRuleIntent==='open_student_info' ? 'ui_query' : ''))!=='other';
    const localStructuredCommand=localRuleHandled
      && router
      && typeof router.interpretedIntentToStructuredCommand==='function'
      ? router.interpretedIntentToStructuredCommand(localRuleIntent,rawCommandText)
      : null;
    const interpretation=localRuleHandled
      ? {
          lane:'routine',
          route:'rule',
          intent:localRuleIntent,
          standaloneCommand:rawCommandText,
          structuredCommand:localStructuredCommand,
          batchCommands:[],
          readCommands:[],
          reply:'',
          contextUsed:false
        }
      : await interpretOlliSystemLanguage(
          rawCommandText,
          current,
          replyToMessageId
        );
    const interpreterLane=clean(interpretation.lane) || 'routine';
    const interpreterRoute=clean(interpretation.route);
    const interpreterIntent=clean(interpretation.intent);
    let structuredCommand=interpretation.structuredCommand || null;
    const batchCommands=Array.isArray(interpretation.batchCommands)?interpretation.batchCommands:[];
    const readCommands=Array.isArray(interpretation.readCommands)?interpretation.readCommands:[];
    commandText=clean(interpretation.standaloneCommand) || rawCommandText;
    if(
      interpreterLane==='routine'
      && (!structuredCommand || !clean(structuredCommand.action) || clean(structuredCommand.action)==='none')
      && router
      && typeof router.interpretedIntentToStructuredCommand==='function'
    ){
      structuredCommand=router.interpretedIntentToStructuredCommand(interpreterIntent,commandText) || structuredCommand;
    }

    if (options.allowSuggestedQuery && router && typeof router.runSuggestedQuery === 'function') {
      const suggested = await router.runSuggestedQuery(commandText, {
        source:'olli_talk_reply_button',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if (suggested?.handled === true) {
        reportAiLegacyRouteOutcome(
          current,
          'suggested',
          clean(suggested.intent || suggested.payload?.intent),
          null,
          false
        );
        const suggestedMessage = clean(suggested.message) || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveAssistantReply(current, suggestedMessage, replyToMessageId),
          replyText:suggestedMessage,
          recordAi:false
        };
      }
    }

    if(interpreterLane==='chat'){
      const resolved=await resolveAiReply(rawCommandText,current);
      return {
        assistantMessage:await saveAssistantReply(current,resolved.message,replyToMessageId),
        replyText:resolved.message,
        recordAi:true
      };
    }

    if(interpreterLane==='feedback'){
      const resolved=await resolveFeedbackAnalysis(
        commandText,
        rawCommandText,
        current,
        replyToMessageId
      );
      return {
        assistantMessage:await saveAssistantReply(current,resolved.message,replyToMessageId),
        replyText:resolved.message,
        recordAi:true
      };
    }

    if(
      interpreterLane==='routine'
      && interpreterIntent==='multi_read_query'
      && readCommands.length>=2
      && router
      && typeof router.runStructuredMultiQuery==='function'
    ){
      const queried=await router.runStructuredMultiQuery(readCommands,commandText,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(queried?.handled===true){
        const message=clean(queried.message) || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && clean(structuredCommand?.action)==='find_pickups'
      && router
      && typeof router.runStructuredQuery==='function'
    ){
      const queried=await router.runStructuredQuery(structuredCommand,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(queried?.handled===true){
        const message=clean(queried.message) || '픽업 일정을 확인했어요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && clean(structuredCommand?.action)==='find_roster_entries'
      && router
      && typeof router.runStructuredQuery==='function'
    ){
      const queried=await router.runStructuredQuery(structuredCommand,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(queried?.handled===true){
        const message=clean(queried.message) || '학생 명단을 확인했어요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && clean(structuredCommand?.action)==='find_available_slots'
      && router
      && typeof router.runStructuredQuery==='function'
    ){
      const queried=await router.runStructuredQuery(structuredCommand,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(queried?.handled===true){
        const message=clean(queried.message) || '빈자리 조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && clean(structuredCommand?.action)==='get_student_schedule'
      && router
      && typeof router.runStructuredQuery==='function'
    ){
      const queried=await router.runStructuredQuery(structuredCommand,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(queried?.handled===true){
        const message=clean(queried.message) || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && clean(structuredCommand?.action)==='cancel_makeup'
    ){
      const pending=state.pendingActionReason?.__structuredMakeupCancel || null;
      if(pending && isPendingReasonCancel(rawCommandText)){
        state.pendingActionReason=null;
        const message='작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }

      const merged=mergeStructuredMakeupCancelCommand(
        pending?.structuredCommand,
        structuredCommand
      );
      const reason=clean(merged.reason);
      if(!reason){
        const sourceMessageId=Number(replyToMessageId || 0);
        state.pendingActionReason={
          intent:'cancel_makeup',
          __structuredMakeupCancel:{
            sourceMessageId,
            sourceMessageText:clean(rawCommandText),
            structuredCommand:merged
          }
        };
        const reasonMessage=(clean(merged.studentName) || '학생')+' 학생의 보강 취소 사유를 알려주세요.';
        return {
          assistantMessage:await saveAssistantReply(current,reasonMessage,replyToMessageId),
          replyText:reasonMessage,
          recordAi:false
        };
      }

      const sourceMessageId=pending
        ? Number(pending.sourceMessageId || 0)
        : Number(replyToMessageId || 0);
      const sourceText=pending
        ? clean(pending.sourceMessageText)
        : clean(rawCommandText);
      const reasonMessageId=Number(replyToMessageId || 0);
      const reasonMessageText=clean(rawCommandText);
      state.pendingActionReason=null;
      return resolveStructuredMakeupCancelTurn({
        structuredCommand:merged,
        sourceText,
        sourceMessageId,
        reasonText:pending ? reasonMessageText : reason,
        reasonMessageText,
        reasonMessageId,
        current,
      });
    }

    if(
      interpreterLane==='routine'
      && clean(structuredCommand?.action)==='cancel_move'
    ){
      return resolveStructuredMoveCancelTurn(
        structuredCommand,
        current,
        rawCommandText,
        replyToMessageId
      );
    }

    if(
      interpreterLane==='routine'
      && ['add_timetable_memo','delete_timetable_memo'].includes(clean(structuredCommand?.action))
    ){
      return resolveStructuredTimetableMemoTurn(
        structuredCommand,
        current,
        rawCommandText,
        replyToMessageId
      );
    }

    if(
      interpreterLane==='routine'
      && clean(structuredCommand?.action)==='update_waitlist'
    ){
      return resolveStructuredWaitlistUpdateTurn(
        structuredCommand,
        current,
        rawCommandText,
        replyToMessageId
      );
    }

    if(
      interpreterLane==='routine'
      && clean(structuredCommand?.action)==='cancel_trial'
    ){
      const pending=state.pendingActionReason?.__structuredTrialCancel || null;
      if(pending && isPendingReasonCancel(rawCommandText)){
        state.pendingActionReason=null;
        const message='작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }

      const merged=mergeStructuredTrialCancelCommand(
        pending?.structuredCommand,
        structuredCommand
      );
      const reason=clean(merged.reason);
      if(!reason){
        const sourceMessageId=Number(replyToMessageId || 0);
        state.pendingActionReason={
          intent:'cancel_trial',
          __structuredTrialCancel:{
            sourceMessageId,
            sourceMessageText:clean(rawCommandText),
            structuredCommand:merged
          }
        };
        const reasonMessage=(clean(merged.studentName) || '체험 학생')+' 체험 취소 사유를 알려주세요.';
        return {
          assistantMessage:await saveAssistantReply(current,reasonMessage,replyToMessageId),
          replyText:reasonMessage,
          recordAi:false
        };
      }

      const sourceMessageId=pending
        ? Number(pending.sourceMessageId || 0)
        : Number(replyToMessageId || 0);
      const sourceText=pending
        ? clean(pending.sourceMessageText)
        : clean(rawCommandText);
      const reasonMessageId=Number(replyToMessageId || 0);
      const reasonMessageText=clean(rawCommandText);
      state.pendingActionReason=null;
      return resolveStructuredTrialCancelTurn({
        structuredCommand:merged,
        sourceText,
        sourceMessageId,
        reasonText:pending ? reasonMessageText : reason,
        reasonMessageText,
        reasonMessageId,
        current,
      });
    }


    if(
      interpreterLane==='routine'
      && ['add_makeup','update_makeup','add_trial','update_trial','add_waitlist','cancel_waitlist','add_pickup','update_pickup','cancel_pickup','move_class','mark_absent'].includes(clean(structuredCommand?.action))
      && router
      && typeof router.prepareStructuredAction==='function'
    ){
      const prepared=await router.prepareStructuredAction(structuredCommand,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(prepared?.handled===true){
        if(prepared.kind==='action_needs_field' && prepared.payload){
          if(clean(prepared.payload.field)==='student_choice'){
            return {
              assistantMessage:await saveStructuredStudentChoice(
                current,
                prepared.message || '학생을 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:prepared.message || '',
              recordAi:false
            };
          }
          if(clean(prepared.payload.field)==='target_choice'){
            return {
              assistantMessage:await saveStructuredTargetChoice(
                current,
                prepared.message || '대상을 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:prepared.message || '',
              recordAi:false
            };
          }
          if(clean(prepared.payload.field)==='division'){
            return {
              assistantMessage:await saveStructuredDivisionChoice(
                current,
                prepared.message || '유치부인지 초등부인지 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:prepared.message || '',
              recordAi:false
            };
          }
          if(['date','target_date'].includes(clean(prepared.payload.field))){
            return {
              assistantMessage:await saveStructuredDateChoice(
                current,
                prepared.message || '날짜를 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:prepared.message || '',
              recordAi:false
            };
          }
          if(['time','target_time'].includes(clean(prepared.payload.field))){
            return {
              assistantMessage:await saveStructuredTimeChoice(
                current,
                prepared.message || '시간을 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:prepared.message || '',
              recordAi:false
            };
          }
          const fieldMessage=clean(prepared.message) || '필요한 정보를 선택해 주세요.';
          return {
            assistantMessage:await saveAssistantReply(current,fieldMessage,replyToMessageId),
            replyText:fieldMessage,
            recordAi:false
          };
        }
        if(['action_pending','action_choice'].includes(prepared.kind) && prepared.payload){
          return {
            assistantMessage:await saveAssistantAction(
              current,
              prepared.message || (prepared.kind==='action_choice' ? '반을 선택해 주세요.' : '이 작업을 진행할까요?'),
              prepared.payload,
              replyToMessageId
            ),
            replyText:prepared.message || '',
            recordAi:false
          };
        }
        if(prepared.kind==='action_needs_reason' && prepared.payload){
          state.pendingActionReason=Object.assign({},prepared.payload);
          const reasonMessage=clean(prepared.message) || '사유를 알려주세요.';
          return savePendingTextInputReply(current,reasonMessage,replyToMessageId);
        }
        if(prepared.kind==='action_rejected'){
          const rejectedMessage=clean(prepared.message) || '작업을 준비하지 못했어요.';
          return {
            assistantMessage:await saveAssistantReply(current,rejectedMessage,replyToMessageId),
            replyText:rejectedMessage,
            recordAi:false
          };
        }
      }
    }

    if(interpreterRoute==='rule'){
      if(interpreterIntent==='cancel_pending'){
        state.pendingMakeupDialogue=null;
        state.pendingActionReason=null;
        const message='진행 중인 작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      if(!ruleCommandMatchesInterpretation(router,interpreterIntent,commandText)){
        const message='올리가 이해한 업무와 규칙 시스템 명령이 일치하지 않아 실행하지 않았어요. 요청을 조금 더 구체적으로 알려 주세요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      state.pendingMakeupDialogue=null;
      state.pendingActionReason=null;
    }

    if (interpreterRoute!=='rule' && state.pendingActionReason) {
      if (isPendingReasonCancel(commandText)) {
        state.pendingActionReason = null;
        const message = '작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveAssistantReply(current, message, replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }

      const pendingBatch = state.pendingActionReason.__batchAgent;
      if (clean(state.pendingActionReason.intent) === 'batch_write' && pendingBatch) {
        const commands=Array.isArray(pendingBatch.commands)
          ? pendingBatch.commands.map((item)=>Object.assign({},item))
          : [];
        const reasonIndex=commands.findIndex((item)=>batchCommandNeedsReason(item) && !clean(item.reason));
        if(reasonIndex>=0){
          commands[reasonIndex].reason=clean(commandText);
          commands[reasonIndex].reasonMessageId=Number(replyToMessageId || 0);
          commands[reasonIndex].reasonMessageText=clean(commandText);
          const nextReasonIndex=commands.findIndex((item)=>batchCommandNeedsReason(item) && !clean(item.reason));
          if(nextReasonIndex>=0){
            state.pendingActionReason={
              intent:'batch_write',
              __batchAgent:{
                sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
                sourceMessageText:clean(pendingBatch.sourceMessageText),
                commands
              }
            };
            const prompt=batchReasonPrompt(commands[nextReasonIndex]);
            return {
              assistantMessage:await saveAssistantReply(current,prompt,replyToMessageId),
              replyText:prompt,
              recordAi:false
            };
          }

          const clarificationIndex=commands.findIndex(batchCommandNeedsClarification);
          if(clarificationIndex>=0){
            const nextPending={
              sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
              sourceMessageText:clean(pendingBatch.sourceMessageText),
              commands
            };
            state.pendingActionReason={intent:'batch_write',__batchAgent:nextPending};
            const assistantMessage=await startBatchStructuredChoice(current,nextPending,clarificationIndex);
            return {
              assistantMessage,
              replyText:clean(assistantMessage?.body) || '보강 날짜를 선택해 주세요.',
              recordAi:false
            };
          }
        }else{
          const clarificationIndex=commands.findIndex(batchCommandNeedsClarification);
          if(clarificationIndex>=0){
            const clarified=applyBatchClarification(
              commands[clarificationIndex],
              commandText,
              replyToMessageId,
              router
            );
            if(!clarified){
              const prompt=batchClarificationPrompt(commands[clarificationIndex]);
              state.pendingActionReason={
                intent:'batch_write',
                __batchAgent:{
                  sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
                  sourceMessageText:clean(pendingBatch.sourceMessageText),
                  commands
                }
              };
              return {
                assistantMessage:await saveAssistantReply(current,prompt,replyToMessageId),
                replyText:prompt,
                recordAi:false
              };
            }
            commands[clarificationIndex]=clarified;
            const nextClarificationIndex=commands.findIndex(batchCommandNeedsClarification);
            if(nextClarificationIndex>=0){
              state.pendingActionReason={
                intent:'batch_write',
                __batchAgent:{
                  sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
                  sourceMessageText:clean(pendingBatch.sourceMessageText),
                  commands
                }
              };
              const prompt=batchClarificationPrompt(commands[nextClarificationIndex]);
              return {
                assistantMessage:await saveAssistantReply(current,prompt,replyToMessageId),
                replyText:prompt,
                recordAi:false
              };
            }
          }
        }

        state.pendingActionReason=null;
        return resolveBatchAgentTurn({
          sourceText:clean(pendingBatch.sourceMessageText),
          sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
          commands,
          current,
        });
      }

      const pendingTrialCancel = state.pendingActionReason.__trialCancelAgent;
      if (clean(state.pendingActionReason.intent) === 'cancel_trial' && pendingTrialCancel) {
        state.pendingActionReason = null;
        return resolveTrialCancelAgentTurn({
          sourceText:clean(pendingTrialCancel.sourceMessageText),
          sourceMessageId:Number(pendingTrialCancel.sourceMessageId || 0),
          reasonText:clean(commandText),
          reasonMessageText:clean(commandText),
          reasonMessageId:Number(replyToMessageId || 0),
          current,
        });
      }

      const pendingMakeupCancel = state.pendingActionReason.__makeupCancelAgent;
      if (clean(state.pendingActionReason.intent) === 'cancel_makeup' && pendingMakeupCancel) {
        state.pendingActionReason = null;
        return resolveMakeupCancelAgentTurn({
          sourceText:clean(pendingMakeupCancel.sourceMessageText),
          sourceMessageId:Number(pendingMakeupCancel.sourceMessageId || 0),
          reasonText:clean(commandText),
          reasonMessageText:clean(commandText),
          reasonMessageId:Number(replyToMessageId || 0),
          current,
        });
      }

      const pendingAbsence = state.pendingActionReason.__absenceAgent;
      if (clean(state.pendingActionReason.intent) === 'mark_absent' && pendingAbsence) {
        state.pendingActionReason = null;
        return resolveAbsenceAgentTurn({
          sourceText:clean(pendingAbsence.sourceMessageText),
          sourceMessageId:Number(pendingAbsence.sourceMessageId || 0),
          reasonText:clean(commandText),
          reasonMessageText:clean(commandText),
          reasonMessageId:Number(replyToMessageId || 0),
          current,
        });
      }

      const command = Object.assign({}, state.pendingActionReason, { reason:clean(commandText) });
      state.pendingActionReason = null;
      const confirmation = clean(schedule?.writeConfirmationMessage?.(command)) || '이 작업을 진행할까요?';
      return {
        assistantMessage:await saveAssistantAction(current, confirmation, command, replyToMessageId),
        replyText:confirmation,
        recordAi:false
      };
    }

    if(
      interpreterRoute==='rule'
      && ['set_class_layout','set_class_teacher','set_teacher_override','set_session_order','set_normal_class_day'].includes(interpreterIntent)
    ){
      const parsed=parseTimetableAdminRuleCandidate(commandText,router);
      if(!parsed || clean(parsed.intent)!==interpreterIntent){
        const message='시간표 관리 요청을 규칙 시스템에서 확인하지 못했어요. 날짜·시간·대상을 조금 더 구체적으로 알려 주세요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      return resolveTimetableAdminRuleTurn(commandText,parsed,current,replyToMessageId);
    }

    if(interpreterRoute==='rule' && interpreterIntent==='batch_write'){
      const parsed=parseBatchAgentCandidate(commandText,router);
      if(!parsed){
        const message='복합명령 구조가 원문과 일치하지 않아 실행하지 않았어요. 요청을 조금 더 구체적으로 알려 주세요.';
        return {
          assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      return resolveBatchRuleTurn(parsed,commandText,current,replyToMessageId,batchCommands);
    }

    const routeClassifier=global.OlliTeamTalkAgentRouteClassifier;
    const classifierAvailable=!!(routeClassifier && typeof routeClassifier.classify==='function');
    const sharedRoute=interpreterRoute==='agent' && classifierAvailable
      ? routeClassifier.classify(commandText,{router})
      : null;
    if(interpreterRoute==='agent'){
      if(sharedRoute){
        const routedTurn=await resolveSharedAgentRouteTurn(sharedRoute,commandText,current,replyToMessageId,batchCommands);
        if(routedTurn) return routedTurn;
      }
      const resolved=await resolveAiReply(rawCommandText,current);
      return {
        assistantMessage:await saveAssistantReply(current,resolved.message,replyToMessageId),
        replyText:resolved.message,
        recordAi:true
      };
    }

    if (router && typeof router.prepareAction === 'function') {
      const prepared = await router.prepareAction(commandText, {
        source:'olli_talk_ai',
        selectedStudent:null,
        autoSubmitContext:null
      });

      if (prepared?.handled === true) {
        if (['action_pending','action_needs_reason','action_rejected'].includes(clean(prepared.kind))) {
          reportAiLegacyRouteOutcome(
            current,
            'legacy_write',
            clean(prepared.intent || prepared.payload?.intent),
            sharedRoute,
            classifierAvailable
          );
        }
        if (prepared.kind === 'action_pending' && prepared.payload) {
          return {
            assistantMessage:await saveAssistantAction(
              current,
              prepared.message || '이 작업을 진행할까요?',
              prepared.payload,
              replyToMessageId
            ),
            replyText:prepared.message || '',
            recordAi:false
          };
        }

        if (prepared.kind === 'action_needs_reason' && prepared.payload) {
          const pendingPayload = Object.assign({}, prepared.payload);
          if (clean(pendingPayload.intent) === 'cancel_trial') {
            const parsedTrialCancel = parseTrialCancelAgentCandidate(commandText, router);
            const sourceMessageId = Number(replyToMessageId || 0);
            if (parsedTrialCancel && Number.isSafeInteger(sourceMessageId) && sourceMessageId > 0) {
              pendingPayload.__trialCancelAgent = {
                sourceMessageId,
                sourceMessageText:clean(commandText)
              };
            }
          }
          if (clean(pendingPayload.intent) === 'cancel_makeup') {
            const parsedMakeupCancel = parseMakeupCancelAgentCandidate(commandText, router);
            const sourceMessageId = Number(replyToMessageId || 0);
            if (parsedMakeupCancel && Number.isSafeInteger(sourceMessageId) && sourceMessageId > 0) {
              pendingPayload.__makeupCancelAgent = {
                sourceMessageId,
                sourceMessageText:clean(commandText)
              };
            }
          }
          if (clean(pendingPayload.intent) === 'mark_absent') {
            const parsedAbsence = parseAbsenceAgentCandidate(commandText, router);
            const sourceMessageId = Number(replyToMessageId || 0);
            if (parsedAbsence && Number.isSafeInteger(sourceMessageId) && sourceMessageId > 0) {
              pendingPayload.__absenceAgent = {
                sourceMessageId,
                sourceMessageText:clean(commandText)
              };
            }
          }
          state.pendingActionReason = pendingPayload;
          const reasonMessage = clean(prepared.message) || '사유를 알려주세요.';
          return savePendingTextInputReply(current,reasonMessage,replyToMessageId);
        }

        if (prepared.kind === 'action_rejected') {
          const rejectedMessage = clean(prepared.message) || '작업을 준비하지 못했어요.';
          return {
            assistantMessage:await saveAssistantReply(current, rejectedMessage, replyToMessageId),
            replyText:rejectedMessage,
            recordAi:false
          };
        }
      }
    }

    if (router && typeof router.runQuery === 'function') {
      const queried = await router.runQuery(commandText, {
        source:'olli_talk_ai',
        selectedStudent:null,
        autoSubmitContext:null
      });

      if (queried?.handled === true) {
        reportAiLegacyRouteOutcome(
          current,
          'legacy_read',
          clean(queried.intent || queried.payload?.intent),
          sharedRoute,
          classifierAvailable
        );
        const queryMessage = clean(queried.message) || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveAssistantReply(current, queryMessage, replyToMessageId),
          replyText:queryMessage,
          recordAi:false
        };
      }
    }

    if(interpreterRoute==='rule'){
      const message='요청을 시스템 명령으로 해석했지만 규칙 시스템에 연결하지 못했어요. 필요한 정보를 조금 더 구체적으로 알려 주세요.';
      return {
        assistantMessage:await saveAssistantReply(current,message,replyToMessageId),
        replyText:message,
        recordAi:false
      };
    }

    const resolved = await resolveAiReply(rawCommandText, current);
    return {
      assistantMessage:await saveAssistantReply(current, resolved.message, replyToMessageId),
      replyText:resolved.message,
      recordAi:true
    };
  }

  function updateComposerState() {
    const input = byId('olliPcTeamTalkInput');
    const send = byId('olliPcTeamTalkSend');
    if (!input || !send) return;
    const enabled = clean(input.value).length > 0 && !state.sendBusy;
    send.disabled = !enabled;
    send.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  }

  function renderMentionMenu() {
    const menu = byId('olliPcTeamTalkMentionMenu');
    if (!menu) return;
    const current = context();
    menu.replaceChildren();

    const olliButton = document.createElement('button');
    olliButton.type = 'button';
    olliButton.className = 'olliPcTeamTalkMentionOption';
    olliButton.append(
      create('span', 'olliPcTeamTalkMentionAvatar', 'AI'),
      create('span', '', '올리 · AI')
    );
    olliButton.addEventListener('click', () => {
      const input = byId('olliPcTeamTalkInput');
      if (!input) return;
      const prefix = input.value && !/\s$/.test(input.value) ? ' ' : '';
      input.value += `${prefix}@올리 `;
      state.olliAiMentionSelected = true;
      menu.hidden = true;
      resizeComposer();
      updateComposerState();
      input.focus();
    });
    menu.appendChild(olliButton);

    state.members
      .filter((member) => clean(member?.member_id) !== clean(current.memberId) && !member?.is_current_member)
      .forEach((member) => {
        const name = clean(member?.display_name || member?.member_name);
        if (!name) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'olliPcTeamTalkMentionOption';
        button.append(create('span', 'olliPcTeamTalkMentionAvatar', name.slice(0, 1)), create('span', '', name));
        button.addEventListener('click', () => {
          const input = byId('olliPcTeamTalkInput');
          if (!input) return;
          const prefix = input.value && !/\s$/.test(input.value) ? ' ' : '';
          input.value += `${prefix}@${name} `;
          menu.hidden = true;
          resizeComposer();
          updateComposerState();
          input.focus();
        });
        menu.appendChild(button);
      });
    if (!menu.childElementCount) menu.appendChild(create('div', 'olliPcTeamTalkMentionEmpty', '선생님 목록이 없습니다.'));
  }

  function toggleMentionMenu(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const menu = byId('olliPcTeamTalkMentionMenu');
    if (!menu) return;
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      renderMentionMenu();
      if (!state.members.length) loadMembers();
    }
  }

  function resolveMentionIds(body) {
    const text = String(body || '');
    return state.members
      .filter((member) => {
        const name = clean(member?.display_name || member?.member_name);
        return name && text.includes(`@${name}`);
      })
      .map((member) => clean(member?.member_id))
      .filter(Boolean);
  }

  function clientMessageId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `pc-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  }

  async function sendMessage(event) {
    event?.preventDefault?.();
    if (state.sendBusy) return;
    const input = byId('olliPcTeamTalkInput');
    const send = byId('olliPcTeamTalkSend');
    const rawBody = clean(input?.value);
    const olliAiMentionRequested = state.olliAiMentionSelected && hasOlliAiMention(rawBody);
    const olliRequested = state.olliModeActive || olliAiMentionRequested || /^\s*@올리(?:\s|$)/.test(rawBody);
    const commandText = olliRequested
      ? (olliAiMentionRequested
        ? stripOlliAiMention(rawBody)
        : rawBody.replace(/^\s*@올리(?:\s+|$)/, '').trim())
      : '';
    const body = olliRequested ? ('@올리 ' + commandText).trim() : rawBody;
    if (!input || !rawBody || (olliRequested && !commandText)) {
      updateComposerState();
      return;
    }

    if (olliAiMentionRequested && !isAiEnabled()) {
      alert('올리 AI를 사용하려면 설정에서 올리 AI를 켜 주세요.');
      updateComposerState();
      return;
    }

    const current = context();
    if (!current.sessionToken || !current.academyId) {
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    const isOlliWorkflowFollowup = olliRequested && (
      hasPendingOlliCommand()
      || !!state.pendingActionReason
      || !!state.pendingMakeupDialogue
    );
    state.sendBusy = true;
    if (send) send.classList.add('sending');
    updateComposerState();

    try {
      const payload = await rpc('olli_team_chat_send', {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId,
        p_body: body,
        p_client_message_id: clientMessageId(),
        p_reply_to_message_id: null
      });
      if (!payload?.ok || !payload?.message) throw new Error(payload?.message || '메시지를 저장하지 못했습니다.');

      input.value = '';
      state.olliAiMentionSelected = false;
      resizeComposer();
      updateComposerState();
      appendPersistedMessage(payload.message, current.memberId);
      let firstReplyStartedAt=0;
      if (olliRequested && !isOlliWorkflowFollowup) {
        state.assistantReplyPending = true;
        firstReplyStartedAt=Date.now();
        syncAssistantTypingIndicator();
      }

      const mentionIds = olliRequested ? [] : resolveMentionIds(body);
      if (mentionIds.length) {
        try {
          await rpc('olli_team_chat_set_mentions', {
            p_session_token: current.sessionToken,
            p_academy_id: current.academyId,
            p_message_id: Number(payload.message.id),
            p_member_ids: mentionIds
          });
        } catch (error) {
          console.warn('PC 팀톡 멘션 저장 실패:', error?.message || error);
        }
      }

      if (!olliRequested) {
        await dispatchTeamTalkPush(Number(payload.message.id), current);
      }

      if (olliRequested) {
        const usingAi = olliAiMentionRequested || isAiEnabled();
        try {
          if (usingAi) {
            const turn = await resolveAiTurn(commandText, current, Number(payload.message.id));
            if(firstReplyStartedAt){
              const remaining=1000-(Date.now()-firstReplyStartedAt);
              if(remaining>0) await new Promise(resolve=>setTimeout(resolve,remaining));
            }
            state.assistantReplyPending = false;
            const assistantMessages=Array.isArray(turn.assistantMessages) && turn.assistantMessages.length
              ? turn.assistantMessages
              : [turn.assistantMessage].filter(Boolean);
            if(assistantMessages.length){
              replaceAssistantTypingWithMessage(assistantMessages[0], current.memberId);
              assistantMessages.slice(1).forEach((message)=>appendPersistedMessage(message,current.memberId));
            }else{
              syncAssistantTypingIndicator();
            }
            recordAiConversationTurn(commandText, turn.replyText);
          } else {
            const turn = await resolveBotTurn(commandText, current, Number(payload.message.id));
            if(firstReplyStartedAt){
              const remaining=1000-(Date.now()-firstReplyStartedAt);
              if(remaining>0) await new Promise(resolve=>setTimeout(resolve,remaining));
              state.assistantReplyPending=false;
              replaceAssistantTypingWithMessage(turn.assistantMessage,current.memberId);
            }else{
              appendPersistedMessage(turn.assistantMessage, current.memberId);
            }
          }
        } catch (error) {
          console.warn(usingAi ? 'PC 올리톡 AI 응답 실패:' : 'PC 올리톡 올리봇 응답 실패:', error?.message || error);
          alert((usingAi ? 'AI' : '올리봇') + ' 응답을 받지 못했습니다.\n' + (error?.message || error));
        } finally {
          if (state.assistantReplyPending) {
            state.assistantReplyPending = false;
            syncAssistantTypingIndicator();
          }
        }
      }

      await Promise.all([
        loadMessages({ showLoading: false, followBottom: true, render:false }),
        loadArchive({ showLoading: false })
      ]);
      input.focus();
    } catch (error) {
      state.assistantReplyPending = false;
      syncAssistantTypingIndicator();
      alert(`메시지를 보내지 못했습니다.\n${error?.message || error}`);
    } finally {
      state.sendBusy = false;
      if (send) send.classList.remove('sending');
      updateComposerState();
    }
  }

  async function callFileApi(action, payload) {
    const current = context();
    const response = await fetch('/api/team-talk-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Olli-Session-Token': current.sessionToken,
        'X-Olli-Academy-Id': current.academyId
      },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || data?.message || '파일 요청에 실패했습니다.');
    return data;
  }

  async function uploadFile(file) {
    const current = context();
    if (!file || state.uploadBusy || !current.sessionToken || !current.academyId) return false;
    const maxBytes = 20 * 1024 * 1024;
    if (file.size > maxBytes) {
      alert('팀톡 파일은 20MB 이하만 올릴 수 있습니다.');
      return false;
    }

    state.uploadBusy = true;
    const archiveUpload = byId('olliPcTeamTalkArchiveUpload');
    if (archiveUpload) {
      archiveUpload.disabled = true;
      archiveUpload.textContent = '올리는 중...';
    }

    let prepared = null;
    try {
      const kind = /^(image|video)\//i.test(clean(file.type)) ? 'media' : 'file';
      prepared = await callFileApi('prepare', {
        fileName: file.name || 'file',
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        kind
      });

      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', file, file.name || 'file');
      const uploadResponse = await fetch(prepared.uploadUrl, {
        method: 'PUT',
        headers: { 'x-upsert': 'false' },
        body: form
      });
      if (!uploadResponse.ok) {
        let detail = '';
        try { detail = await uploadResponse.text(); } catch (_) {}
        throw new Error(detail || '파일 저장에 실패했습니다.');
      }

      await callFileApi('finalize', {
        objectPath: prepared.objectPath,
        fileName: file.name || 'file',
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        kind
      });

      await Promise.all([
        loadMessages({ showLoading: false, followBottom: true }),
        loadArchive({ showLoading: false })
      ]);
      return true;
    } catch (error) {
      if (prepared?.objectPath) callFileApi('cleanup', { objectPath: prepared.objectPath }).catch(() => {});
      alert(error?.message || '파일을 올리지 못했습니다.');
      return false;
    } finally {
      state.uploadBusy = false;
      if (archiveUpload) {
        archiveUpload.disabled = false;
        archiveUpload.textContent = '파일 올리기';
      }
    }
  }

  function bindEvents() {
    const input = byId('olliPcTeamTalkInput');
    const send = byId('olliPcTeamTalkSend');
    const mention = byId('olliPcTeamTalkMention');
    const olli = byId('olliPcTeamTalkOlli');
    const addFile = byId('olliPcTeamTalkAddFile');
    const composerFile = byId('olliPcTeamTalkComposerFile');
    const archiveUpload = byId('olliPcTeamTalkArchiveUpload');
    const archiveFile = byId('olliPcTeamTalkArchiveFile');
    const refresh = byId('olliPcTeamTalkRefresh');
    const materialCreate = byId('olliPcTeamTalkMaterialCreate');

    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('input', () => {
        if (state.olliAiMentionSelected && !hasOlliAiMention(input.value)) {
          state.olliAiMentionSelected = false;
        }
        resizeComposer();
        updateComposerState();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          sendMessage(event);
        }
      });
    }
    if (send && !send.dataset.bound) {
      send.dataset.bound = '1';
      send.addEventListener('click', sendMessage);
    }
    if (mention && !mention.dataset.bound) {
      mention.dataset.bound = '1';
      mention.addEventListener('click', toggleMentionMenu);
    }
    if (olli && !olli.dataset.bound) {
      olli.dataset.bound = '1';
      olli.addEventListener('click', toggleOlliMode);
    }
    if (addFile && !addFile.dataset.bound) {
      addFile.dataset.bound = '1';
      addFile.addEventListener('click', () => composerFile?.click());
    }
    if (composerFile && !composerFile.dataset.bound) {
      composerFile.dataset.bound = '1';
      composerFile.addEventListener('change', async () => {
        const file = composerFile.files?.[0] || null;
        composerFile.value = '';
        if (file) await uploadFile(file);
      });
    }
    if (archiveUpload && !archiveUpload.dataset.bound) {
      archiveUpload.dataset.bound = '1';
      archiveUpload.addEventListener('click', () => archiveFile?.click());
    }
    if (archiveFile && !archiveFile.dataset.bound) {
      archiveFile.dataset.bound = '1';
      archiveFile.addEventListener('change', async () => {
        const file = archiveFile.files?.[0] || null;
        archiveFile.value = '';
        if (file) await uploadFile(file);
      });
    }
    if (materialCreate && !materialCreate.dataset.bound) {
      materialCreate.dataset.bound = '1';
      materialCreate.addEventListener('click', () => {
        if (state.workspaceTab !== 'materials') return;
        global.OlliTeamTalkMaterialOrders?.openCreate?.();
      });
    }
    if (refresh && !refresh.dataset.bound) {
      refresh.dataset.bound = '1';
      refresh.addEventListener('click', () => {
        const jobs = [
          loadMembers(),
          loadMessages({ showLoading: false, followBottom: false }),
          loadArchive({ showLoading: false }),
          refreshBadge()
        ];
        if (global.OlliTeamTalkMaterialOrders?.refresh) {
          jobs.push(global.OlliTeamTalkMaterialOrders.refresh({ showLoading: false }));
        }
        return Promise.all(jobs);
      });
    }

    document.querySelectorAll('#olliPcTeamTalkScreen [data-team-talk-workspace-tab]').forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', () => setWorkspaceTab(button.dataset.teamTalkWorkspaceTab));
    });

    document.querySelectorAll('#olliPcTeamTalkScreen [data-team-talk-archive-tab]').forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', () => setArchiveTab(button.dataset.teamTalkArchiveTab));
    });

    if (!document.documentElement.dataset.olliPcTeamTalkDocBound) {
      document.documentElement.dataset.olliPcTeamTalkDocBound = '1';
      document.addEventListener('click', (event) => {
        const menu = byId('olliPcTeamTalkMentionMenu');
        const trigger = byId('olliPcTeamTalkMention');
        if (!menu || menu.hidden) return;
        if (menu.contains(event.target) || trigger?.contains(event.target)) return;
        menu.hidden = true;
      });
    }
  }

  async function refreshFromRealtime() {
    const jobs = [refreshBadge(), refreshDesktopNotificationFromRealtime()];
    if (isVisible()) {
      jobs.push(loadMessages({ showLoading: false, followBottom: false }));
      jobs.push(loadArchive({ showLoading: false }));
    }
    const result = await Promise.allSettled(jobs);
    return result.some((entry) => entry.status === 'fulfilled' && entry.value === true);
  }

  function bindRealtime() {
    if (state.realtimeWatcher || !global.OlliRealtime?.watchDomain) return;
    try {
      state.realtimeWatcher = global.OlliRealtime.watchDomain('chat', refreshFromRealtime);
      global.OlliRealtime.ensureConnected?.({ reason: 'pc_team_talk_start' }).catch(() => {});
    } catch (error) {
      console.warn('PC 팀톡 Realtime 연결 실패:', error?.message || error);
    }
  }

  async function open() {
    global.OlliPcCore?.hideMainScreensExcept?.('olliPcTeamTalkScreen');
    const screen = byId('olliPcTeamTalkScreen');
    if (!screen) return false;
    screen.style.display = 'flex';
    screen.setAttribute('aria-hidden', 'false');
    bindEvents();
    bindRealtime();
    syncAssistantUi();
    resizeComposer();
    updateComposerState();
    setWorkspaceTab(state.workspaceTab);

    await Promise.all([
      loadMembers(),
      loadMessages({ showLoading: true, followBottom: true }),
      loadArchive({ showLoading: true })
    ]);
    return true;
  }

  function start() {
    if (state.started) return;
    state.started = true;
    bindEvents();
    bindRealtime();
    syncAssistantUi();
    global.addEventListener('olli-team-talk-ai-mode-changed', handleAiModeChanged);
    refreshBadge();
    primeDesktopNotificationState();
    global.addEventListener('storage', (event) => {
      if (!event || event.key === ACCOUNT_SESSION_TOKEN_KEY || event.key === 'olli_current_academy_id') {
        refreshBadge();
        primeDesktopNotificationState();
      }
    });
    global.addEventListener('olli:realtime-status', (event) => {
      if (event?.detail?.status === 'SUBSCRIBED' && !state.desktopNotificationContextKey) {
        primeDesktopNotificationState();
      }
    });
  }

  global.OlliPcTeamTalk = Object.freeze({
    version: VERSION,
    open,
    refreshBadge,
    loadMessages,
    loadArchive,
    setArchiveTab
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
