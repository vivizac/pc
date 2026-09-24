(function initializeOlliPcTeamTalk(global) {
  'use strict';

  if (global.OlliPcTeamTalk?.version) return;

  const VERSION = '1.1.0';
  const ACCOUNT_SESSION_TOKEN_KEY = 'olli_account_session_token_v1';
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
    assistantReplyPending: false,
    aiConversationMessages: [],
    pendingActionReason: null,
    actionBusy: new Set(),
    olliReplyBusy: new Set(),
    uploadBusy: false,
    realtimeWatcher: null,
    blobUrls: new Map(),
    deltaUnavailable: false,
    deltaCheckpoint: null,
    deltaAcademyId: '',
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
    let accountId = '';
    try {
      sessionToken = clean(localStorage.getItem(ACCOUNT_SESSION_TOKEN_KEY));
      academyId = clean(localStorage.getItem('olli_current_academy_id'));
      memberId = clean(localStorage.getItem('olli_current_member_id'));
      memberName = clean(localStorage.getItem('olli_current_member_name'));
      accountId = clean(localStorage.getItem('olli_account_id_v1'));
    } catch (_) {}

    return {
      academyId: clean(academyContext?.academyId || academyContext?.academy_id || academyId),
      memberId: clean(academyContext?.memberId || academyContext?.member_id || memberId),
      memberName: clean(academyContext?.memberName || academyContext?.member_name || memberName),
      accountId,
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

  function captureDeltaContext(current) {
    const academyContext = global.OlliStorageCore?.AcademyContext;
    const token = academyContext?.captureToken?.() || null;
    return () => {
      const latest = context();
      if (latest.academyId !== current.academyId || latest.sessionToken !== current.sessionToken) return false;
      if (token && academyContext?.isTokenCurrent) {
        try { return !!academyContext.isTokenCurrent(token); } catch (_) { return false; }
      }
      return true;
    };
  }

  function deltaStorageContext(current) {
    return { academyId:current.academyId, accountId:current.accountId || 'account' };
  }

  async function baselineTeamTalkDelta(current) {
    const api = global.OlliTeamChatDelta;
    if (!api || state.deltaUnavailable || !current?.sessionToken || !current?.academyId) return false;
    const isCurrent = captureDeltaContext(current);
    try {
      const checkpoint = await api.createBaseline({
        rpc,
        academyId:current.academyId,
        sessionToken:current.sessionToken,
        isCurrent
      });
      if (!isCurrent()) return false;
      state.deltaCheckpoint = checkpoint;
      state.deltaAcademyId = current.academyId;
      api.writeCheckpoint(deltaStorageContext(current), checkpoint);
      return true;
    } catch (error) {
      if (api.isUnavailableError?.(error)) state.deltaUnavailable = true;
      else console.warn('PC Team Chat delta baseline 준비 실패:', error?.message || error);
      return false;
    }
  }

  async function syncTeamTalkDelta(options = {}) {
    const api = global.OlliTeamChatDelta;
    const current = context();
    if (!api || state.deltaUnavailable || !current.sessionToken || !current.academyId) {
      return loadMessages({ showLoading:false, followBottom:options.followBottom !== false });
    }

    if (state.deltaAcademyId !== current.academyId) {
      state.deltaCheckpoint = api.readCheckpoint(deltaStorageContext(current));
      state.deltaAcademyId = current.academyId;
    }
    if (!state.deltaCheckpoint) {
      return loadMessages({ showLoading:false, followBottom:options.followBottom !== false });
    }

    const isCurrent = captureDeltaContext(current);
    try {
      const delta = await api.pull({
        rpc,
        academyId:current.academyId,
        sessionToken:current.sessionToken,
        checkpoint:state.deltaCheckpoint,
        isCurrent
      });
      if (!isCurrent()) return false;

      const basePayload = {
        ok:true,
        academy_id:current.academyId,
        current_member_id:current.memberId,
        current_member_name:current.memberName,
        messages:Array.isArray(state.messages) ? state.messages : []
      };
      const nextPayload = api.applyToPayload(basePayload, delta, { maxMessages:100 });
      const changed = JSON.stringify(basePayload.messages) !== JSON.stringify(nextPayload.messages);
      if (changed && isVisible()) renderMessages(nextPayload, { followBottom:options.followBottom });
      else state.messages = nextPayload.messages;

      if (state.archivePayload) {
        const nextArchive = api.applyToArchive(state.archivePayload, delta, { maxMessages:1000 });
        if (nextArchive) {
          const archiveChanged = JSON.stringify(state.archivePayload.messages || []) !== JSON.stringify(nextArchive.messages || []);
          state.archivePayload = nextArchive;
          if (archiveChanged && state.workspaceTab === 'archive') renderArchive();
        }
      }

      // Cursor advances only after the in-memory payload has been applied.
      state.deltaCheckpoint = delta.checkpoint;
      state.deltaAcademyId = current.academyId;
      api.writeCheckpoint(deltaStorageContext(current), delta.checkpoint);

      const latest = api.maxMessageId(state.messages);
      if (isVisible()) await markRead(latest || null);
      else await refreshBadge();
      return delta.complete === true;
    } catch (error) {
      if (api.isUnavailableError?.(error)) state.deltaUnavailable = true;
      else console.warn('PC Team Chat delta 동기화 실패, 전체 조회로 복구:', error?.message || error);
      return loadMessages({ showLoading:false, followBottom:options.followBottom !== false });
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

  function actionStatusLabel(status) {
    const value = clean(status);
    if (value === 'completed') return '처리 완료';
    if (value === 'cancelled') return '취소됨';
    if (value === 'failed') return '처리 실패';
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

  function makeActionCard(action) {
    const card = create('div', 'olliPcTeamTalkActionCard');
    const status = clean(action?.status) || 'pending';
    card.dataset.actionId = clean(action?.id);
    card.dataset.actionStatus = status;

    if (status !== 'pending') {
      const label = create('span', 'olliPcTeamTalkActionStatus', actionStatusLabel(status));
      if (status === 'failed') label.classList.add('failed');
      card.appendChild(label);
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
    bubble.setAttribute('aria-label', '올리가 답변을 작성하는 중');
    for (let index = 0; index < 3; index += 1) {
      const dot = create('span', 'olliPcTeamTalkTypingDot');
      dot.setAttribute('aria-hidden', 'true');
      bubble.appendChild(dot);
    }
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
      await baselineTeamTalkDelta(current);
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
    if (nextActive !== state.olliModeActive) state.aiConversationMessages = [];
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
      if (state.pendingActionReason) {
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
          return saveReply(clean(prepared.message) || '사유를 알려주세요.');
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
    syncAssistantUi();
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

  async function saveAssistantAction(current, body, command, replyToMessageId) {
    const actionType = clean(command?.intent);
    if (!actionType) throw new Error('작업 종류를 확인하지 못했습니다.');

    const payload = await rpc('olli_team_chat_send_action', {
      p_session_token: current.sessionToken,
      p_academy_id: current.academyId,
      p_body: normalizeActionPrompt(body),
      p_action_type: actionType,
      p_action_payload: command,
      p_client_message_id: clientMessageId(),
      p_reply_to_message_id: Number(replyToMessageId || 0) || null
    });
    if (!payload?.ok || !payload?.message?.action) {
      throw new Error(payload?.message || '작업 카드를 저장하지 못했습니다.');
    }
    return payload.message;
  }

  function isPendingReasonCancel(text) {
    return /^(취소|취소해|취소해줘|그만|중단|하지마|아니|아니야)$/i.test(clean(text));
  }

  async function resolveAiTurn(commandText, current, replyToMessageId, options = {}) {
    const router = global.OlliCommandRouter;
    const schedule = global.OlliCommandSchedule;

    if (state.pendingActionReason) {
      if (isPendingReasonCancel(commandText)) {
        state.pendingActionReason = null;
        const message = '작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveAssistantReply(current, message, replyToMessageId),
          replyText:message,
          recordAi:false
        };
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

    if (router && typeof router.prepareAction === 'function') {
      const prepared = await router.prepareAction(commandText, {
        source:'olli_talk_ai',
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
            replyText:prepared.message || '',
            recordAi:false
          };
        }

        if (prepared.kind === 'action_needs_reason' && prepared.payload) {
          state.pendingActionReason = Object.assign({}, prepared.payload);
          const reasonMessage = clean(prepared.message) || '사유를 알려주세요.';
          return {
            assistantMessage:await saveAssistantReply(current, reasonMessage, replyToMessageId),
            replyText:reasonMessage,
            recordAi:false
          };
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
        const queryMessage = clean(queried.message) || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveAssistantReply(current, queryMessage, replyToMessageId),
          replyText:queryMessage,
          recordAi:false
        };
      }
    }

    if (options.allowSuggestedQuery && router && typeof router.runSuggestedQuery === 'function') {
      const suggested = await router.runSuggestedQuery(commandText, {
        source:'olli_talk_reply_button',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if (suggested?.handled === true) {
        const suggestedMessage = clean(suggested.message) || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveAssistantReply(current, suggestedMessage, replyToMessageId),
          replyText:suggestedMessage,
          recordAi:false
        };
      }
    }

    const resolved = await resolveAiReply(commandText, current);
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
    if (!menu.hidden && !state.members.length) loadMembers();
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
    const olliRequested = state.olliModeActive || /^\s*@올리(?:\s|$)/.test(rawBody);
    const commandText = olliRequested
      ? rawBody.replace(/^\s*@올리(?:\s+|$)/, '').trim()
      : '';
    const body = olliRequested ? ('@올리 ' + commandText).trim() : rawBody;
    if (!input || !rawBody || (olliRequested && !commandText)) {
      updateComposerState();
      return;
    }

    const current = context();
    if (!current.sessionToken || !current.academyId) {
      alert('팀톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

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
      resizeComposer();
      updateComposerState();
      appendPersistedMessage(payload.message, current.memberId);
      if (olliRequested && isAiEnabled()) {
        state.assistantReplyPending = true;
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

      if (olliRequested) {
        const usingAi = isAiEnabled();
        try {
          if (usingAi) {
            const turn = await resolveAiTurn(commandText, current, Number(payload.message.id));
            state.assistantReplyPending = false;
            replaceAssistantTypingWithMessage(turn.assistantMessage, current.memberId);
            if (turn.recordAi) recordAiConversationTurn(commandText, turn.replyText);
          } else {
            const turn = await resolveBotTurn(commandText, current, Number(payload.message.id));
            appendPersistedMessage(turn.assistantMessage, current.memberId);
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
    const jobs = [refreshBadge()];
    if (isVisible()) {
      jobs.push(syncTeamTalkDelta({ followBottom:false }));
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
    global.addEventListener('storage', (event) => {
      if (!event || event.key === ACCOUNT_SESSION_TOKEN_KEY || event.key === 'olli_current_academy_id') refreshBadge();
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
