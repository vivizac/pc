(function initializeOlliPcTeamTalk(global) {
  'use strict';

  if (global.OlliPcTeamTalk?.version) return;

  const VERSION = '1.0.2';
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
    uploadBusy: false,
    realtimeWatcher: null,
    blobUrls: new Map(),
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
    row.appendChild(content);
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
      list.appendChild(makeMessage(item, currentMemberId, { connectedToPrevious }));
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
      renderMessages(payload, { followBottom: options.followBottom });
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

  async function resolveBotReply(commandText) {
    const router = global.OlliCommandRouter;
    if (!router || typeof router.route !== 'function') {
      return { message:'올리 업무 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
    try {
      const route = await router.route(commandText, {
        source:'olli_talk',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if (!route || route.handled !== true) {
        return {
          message:'아직 이 요청은 올리 업무 기능에 연결되지 않았어요. 자리 확인, 보강·체험·대기 등록/취소, 수업 이동, 결석 처리를 요청할 수 있어요.'
        };
      }
      return { message:clean(route.message) || '요청을 확인했어요.' };
    } catch (error) {
      console.warn('PC 올리톡 올리봇 처리 실패:', error?.message || error);
      return { message:clean(error?.message || error) || '요청을 처리하지 못했어요.' };
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
          const resolved = usingAi
            ? await resolveAiReply(commandText, current)
            : await resolveBotReply(commandText);
          await saveAssistantReply(current, resolved.message, Number(payload.message.id));
          if (usingAi) recordAiConversationTurn(commandText, resolved.message);
        } catch (error) {
          console.warn(usingAi ? 'PC 올리톡 AI 응답 실패:' : 'PC 올리톡 올리봇 응답 실패:', error?.message || error);
          alert((usingAi ? 'AI' : '올리봇') + ' 응답을 받지 못했습니다.\n' + (error?.message || error));
        } finally {
          state.assistantReplyPending = false;
          syncAssistantTypingIndicator();
        }
      }

      await Promise.all([
        loadMessages({ showLoading: false, followBottom: true }),
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
