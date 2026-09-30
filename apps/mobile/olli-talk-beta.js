(() => {
  'use strict';

  window.__olliCommandsMovedToTalk = true;

  let olliTalkBetaReturnToFeedback = true;
  let olliTalkBetaReturnPageId = 'recordRoomScreen';
  let olliTalkBetaViewportBound = false;
  let olliTalkViewportSettleTimer = null;
  let olliTalkLastViewportSignature = '';
  let olliTalkKeyboardBaselineBottom = 0;
  let olliTalkChatMeasureRaf = 0;
  let olliTalkChatTrackingBound = false;
  let olliTalkComposerResizeObserver = null;
  let olliTalkKeyboardMessageMotion = null;
  let olliTalkChatGestureActive = false;
  let olliTalkChatGestureSettleTimer = null;
  let olliTalkComposerViewportLock = null;
  let olliTalkComposerViewportLockTimer = null;
  let olliTalkKeyboardTransitionActive = false;
  let olliTalkArchiveTab = 'materials';
  let olliTalkArchivePayload = null;
  let olliTalkArchiveLoadSequence = 0;
  let olliTalkCurrentPayload = null;
  let olliTalkHistoryLoading = false;
  let olliTalkHistoryExhausted = false;
  let olliTalkHistoryScrollRaf = 0;
  const OLLI_TALK_INITIAL_RENDER_LIMIT = 100;
  const OLLI_TALK_LOCAL_HISTORY_STEP = 100;
  let olliTalkRenderedMessageLimit = 0;
  const OLLI_TALK_ARCHIVE_CACHE_PREFIX = 'olli_team_chat_archive_cache_v1:';
  const OLLI_TALK_LAST_CACHE_CONTEXT_KEY = 'olli_team_chat_last_cache_context_v1';
  const olliTalkAttachmentBlobUrls = new Map();
  const olliTalkAttachmentResolvedBlobUrls = new Map();
  const olliTalkAttachmentPreviewBlobUrls = new Map();
  const olliTalkAttachmentPreviewResolvedBlobUrls = new Map();
  const olliTalkAttachmentPreviewFallbackIds = new Set();
  let olliTalkChatImageViewportObserver = null;
  let olliTalkArchiveImageViewportObserver = null;
  let olliTalkPhotoViewerState = null;
  let olliTalkPhotoViewerLoadSequence = 0;
  let olliTalkArchiveFileTransferState = null;
  let olliTalkArchiveFileTransferSequence = 0;
  const OLLI_TALK_TRANSFER_RING_CIRCUMFERENCE = 2 * Math.PI * 31;
  let olliTalkMembers = [];
  const OLLI_TALK_AI_MENTION_ID = '__olli_ai__';
  const OLLI_TALK_AI_MENTION = Object.freeze({
    member_id:OLLI_TALK_AI_MENTION_ID,
    display_name:'올리',
    role:'ai',
    is_olli_ai:true,
    is_current_member:false
  });
  let olliTalkMentionSelections = new Map();
  let olliTalkMentionModeActive = false;
  let olliTalkAiConversationMessages = [];
  let olliTalkAiConversationAcademyId = '';
  let olliTalkMentionBadgeWatcher = null;
  let olliTalkMentionSummaryInitialized = false;
  let olliTalkLastUnreadMentionCount = 0;
  let olliTalkLastMentionMessageId = 0;
  let olliTalkLastUnreadMaterialCount = 0;
  let olliTalkLastMaterialEventId = 0;
  let olliTalkSearchMatches = [];
  let olliTalkSearchIndex = -1;
  let olliTalkPendingActionReason = null;
  const olliTalkActionBusy = new Set();
  const olliTalkOlliReplyBusy = new Set();
  const OLLI_TALK_LINK_PREVIEW_REFRESH_MS = 24 * 60 * 60 * 1000;
  const olliTalkLinkPreviewCache = new Map();
  const olliTalkLinkPreviewResolvedBlobUrls = new Map();

  function getScreen(){
    return document.getElementById('olliTalkBetaScreen');
  }

  function parseOlliTalkCssColor(value){
    const text = String(value || '').trim();
    if (!text) return null;

    const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const raw = hex[1].length === 3
        ? hex[1].split('').map(ch => ch + ch).join('')
        : hex[1];
      return [
        parseInt(raw.slice(0, 2), 16),
        parseInt(raw.slice(2, 4), 16),
        parseInt(raw.slice(4, 6), 16)
      ];
    }

    const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i);
    if (!rgb) return null;
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  function getOlliTalkRelativeLuminance(rgb){
    if (!Array.isArray(rgb) || rgb.length < 3) return 0;
    const linear = rgb.slice(0, 3).map(value => {
      const channel = Math.max(0, Math.min(255, Number(value) || 0)) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  }

  function applyOlliTalkControlTheme(theme){
    const screen = getScreen();
    if (!screen) return '';

    const controlTheme = theme === 'light' ? 'light' : 'dark';
    screen.dataset.olliTalkControlTheme = controlTheme;
    return controlTheme;
  }

  function syncOlliTalkContrastTheme(){
    const screen = getScreen();
    if (!screen) return 'dark';

    const style = getComputedStyle(screen);
    const rawBackground = String(style.getPropertyValue('--olli-talk-bg') || '').trim()
      || String(style.backgroundColor || '').trim();
    const rgb = parseOlliTalkCssColor(rawBackground);
    const theme = rgb && getOlliTalkRelativeLuminance(rgb) > 0.48 ? 'light' : 'dark';
    const selectedTheme = String(screen.dataset.olliTalkTheme || '').trim();
    const preserveSelectedVariant = ['light-blue','dark-blue','olli-light','olli-dark'].includes(selectedTheme);

    screen.dataset.olliTalkContrast = theme;
    applyOlliTalkControlTheme(theme);
    if (!preserveSelectedVariant) screen.dataset.olliTalkTheme = theme;
    return theme;
  }

  function isOlliTalkChatNearBottom(chatArea, threshold = 96){
    if (!chatArea) return true;
    const distance = Math.max(0, chatArea.scrollHeight - chatArea.clientHeight - chatArea.scrollTop);
    return distance <= Math.max(0, Number(threshold) || 0);
  }

  function resetOlliTalkKeyboardMessageShift(){
    getScreen()?.style.setProperty('--olli-talk-message-shift-y', '0px');
  }

  function beginOlliTalkKeyboardMessageMotion(){
    const screen = getScreen();
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    const composerWrap = screen?.querySelector('.olliTalkBetaComposerWrap');
    const list = chatArea?.querySelector('.olliTalkBetaMessageList');
    if (!screen || !chatArea || !composerWrap || !list) {
      olliTalkKeyboardMessageMotion = null;
      resetOlliTalkKeyboardMessageShift();
      return false;
    }

    const composerTop = Number(composerWrap.getBoundingClientRect().top);
    const listTop = Number(list.getBoundingClientRect().top);
    if (!Number.isFinite(composerTop) || !Number.isFinite(listTop)) return false;

    olliTalkKeyboardMessageMotion = {
      startComposerTop: composerTop,
      startListTop: listTop,
      shiftY: 0
    };
    resetOlliTalkKeyboardMessageShift();
    return true;
  }

  function updateOlliTalkKeyboardMessageMotion(composerTop){
    const motion = olliTalkKeyboardMessageMotion;
    const screen = getScreen();
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    const list = chatArea?.querySelector('.olliTalkBetaMessageList');
    if (!motion || !screen || !chatArea || !list || olliTalkChatGestureActive) return;

    const currentComposerTop = Number(composerTop);
    const currentVisualListTop = Number(list.getBoundingClientRect().top);
    if (!Number.isFinite(currentComposerTop) || !Number.isFinite(currentVisualListTop)) return;

    const currentLayoutListTop = currentVisualListTop - Number(motion.shiftY || 0);
    const composerDelta = Number(motion.startComposerTop) - currentComposerTop;
    const desiredListTop = Number(motion.startListTop) - composerDelta;
    const nextShift = desiredListTop - currentLayoutListTop;
    if (!Number.isFinite(nextShift)) return;

    motion.shiftY = nextShift;
    screen.style.setProperty('--olli-talk-message-shift-y', nextShift.toFixed(2) + 'px');
  }

  function commitOlliTalkKeyboardMessageMotion(){
    const motion = olliTalkKeyboardMessageMotion;
    olliTalkKeyboardMessageMotion = null;

    const chatArea = document.getElementById('olliTalkBetaChatArea');
    const shiftY = Number(motion?.shiftY || 0);
    if (chatArea && Number.isFinite(shiftY) && Math.abs(shiftY) > 0.5) {
      const maxScroll = Math.max(0, chatArea.scrollHeight - chatArea.clientHeight);
      chatArea.scrollTop = Math.max(0, Math.min(maxScroll, Number(chatArea.scrollTop || 0) - shiftY));
    }
    resetOlliTalkKeyboardMessageShift();
  }

  function syncOlliTalkChatToComposer(){
    olliTalkChatMeasureRaf = 0;

    const screen = getScreen();
    const viewport = screen?.querySelector('.olliTalkBetaViewport');
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    const composerWrap = screen?.querySelector('.olliTalkBetaComposerWrap');
    if (!screen || !viewport || !chatArea || !composerWrap || !isOlliTalkBetaVisible()) return;

    const viewportRect = viewport.getBoundingClientRect();
    const composerRect = composerWrap.getBoundingClientRect();
    if (
      !Number.isFinite(viewportRect.bottom)
      || !Number.isFinite(viewportRect.top)
      || !Number.isFinite(composerRect.top)
    ) return;

    const bottomGap = Math.max(
      0,
      Math.min(
        Math.ceil(viewportRect.height),
        Math.ceil(viewportRect.bottom - composerRect.top)
      )
    );

    // The message scroller physically ends at the composer's top edge.
    // This replaces the old full-height scroller + bottom padding reserve.
    screen.style.setProperty('--olli-talk-chat-bottom-gap', bottomGap + 'px');

    // During keyboard motion, move only the rendered message layer.
    // scrollTop is committed once after the viewport settles.
    updateOlliTalkKeyboardMessageMotion(composerRect.top);
  }

  function scheduleOlliTalkChatToComposer(){
    if (olliTalkChatMeasureRaf) cancelAnimationFrame(olliTalkChatMeasureRaf);
    olliTalkChatMeasureRaf = requestAnimationFrame(syncOlliTalkChatToComposer);
  }

  function bindOlliTalkChatComposerTracking(){
    if (olliTalkChatTrackingBound) return;
    olliTalkChatTrackingBound = true;

    const screen = getScreen();
    const composerWrap = screen?.querySelector('.olliTalkBetaComposerWrap');

    if (composerWrap && typeof ResizeObserver === 'function') {
      olliTalkComposerResizeObserver = new ResizeObserver(() => {
        scheduleOlliTalkChatToComposer();
      });
      olliTalkComposerResizeObserver.observe(composerWrap);
    }

    window.addEventListener('resize', scheduleOlliTalkChatToComposer, { passive:true });
  }

  function readOlliTalkComposerViewportGeometry(){
    const viewport = window.visualViewport;
    const layoutWidth = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
    const layoutHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    return {
      left: viewport ? Number(viewport.offsetLeft || 0) : 0,
      top: viewport ? Number(viewport.offsetTop || 0) : 0,
      width: viewport ? Number(viewport.width || layoutWidth) : layoutWidth,
      height: viewport ? Number(viewport.height || layoutHeight) : layoutHeight
    };
  }

  function applyOlliTalkComposerViewportGeometry(layer, geometry){
    if (!layer || !geometry) return;
    layer.style.setProperty('--olli-talk-composer-vv-left', Math.round(Number(geometry.left) || 0) + 'px');
    layer.style.setProperty('--olli-talk-composer-vv-top', Math.round(Number(geometry.top) || 0) + 'px');
    layer.style.setProperty('--olli-talk-composer-vv-width', Math.max(1, Math.round(Number(geometry.width) || 1)) + 'px');
    layer.style.setProperty('--olli-talk-composer-vv-height', Math.max(1, Math.round(Number(geometry.height) || 1)) + 'px');
  }

  function releaseOlliTalkComposerViewportLock(){
    if (olliTalkComposerViewportLockTimer) clearTimeout(olliTalkComposerViewportLockTimer);
    olliTalkComposerViewportLockTimer = null;
    olliTalkComposerViewportLock = null;
    getScreen()?.classList.remove('olliTalkComposerViewportLocked');
  }

  function lockOlliTalkComposerViewport(){
    const screen = getScreen();
    const input = getOlliTalkBetaInput();
    if (!screen || !input || document.activeElement !== input) return false;
    if (getOlliTalkKeyboardOffset() <= 24) return false;
    olliTalkComposerViewportLock = readOlliTalkComposerViewportGeometry();
    const layer = document.getElementById('olliTalkBetaComposerLayer');
    applyOlliTalkComposerViewportGeometry(layer, olliTalkComposerViewportLock);
    screen.classList.add('olliTalkComposerViewportLocked');
    olliTalkKeyboardTransitionActive = false;
    return true;
  }

  function scheduleOlliTalkComposerViewportLock(){
    if (olliTalkComposerViewportLockTimer) clearTimeout(olliTalkComposerViewportLockTimer);
    olliTalkComposerViewportLockTimer = setTimeout(() => {
      olliTalkComposerViewportLockTimer = null;
      lockOlliTalkComposerViewport();
    }, 120);
  }

  function syncOlliTalkComposerViewport(options = {}){
    if (olliTalkChatGestureActive && options.force !== true) return;
    const layer = document.getElementById('olliTalkBetaComposerLayer');
    if (!layer) return;

    // Keyboard-open lock is authoritative. visualViewport scroll/pan events may
    // continue on iOS while the user scrolls chat, but they must not move composer.
    if (olliTalkComposerViewportLock && options.followKeyboard !== true) {
      applyOlliTalkComposerViewportGeometry(layer, olliTalkComposerViewportLock);
      return;
    }

    applyOlliTalkComposerViewportGeometry(layer, readOlliTalkComposerViewportGeometry());
  }

  function getOlliTalkViewportBottom(){
    const viewport = window.visualViewport;
    if (!viewport) return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    return Number(viewport.offsetTop || 0) + Number(viewport.height || 0);
  }

  function captureOlliTalkKeyboardBaseline(force = false){
    const currentBottom = getOlliTalkViewportBottom();
    if (!currentBottom) return;
    const layoutBottom = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    const candidate = Math.max(currentBottom, layoutBottom);
    if (force || !olliTalkKeyboardBaselineBottom) olliTalkKeyboardBaselineBottom = candidate;
  }

  function getOlliTalkKeyboardOffset(){
    const currentBottom = getOlliTalkViewportBottom();
    if (!olliTalkKeyboardBaselineBottom) captureOlliTalkKeyboardBaseline(true);
    return Math.max(0, Math.round(olliTalkKeyboardBaselineBottom - currentBottom));
  }

  function finishOlliTalkViewportTransition(){
    const screen = getScreen();
    if (!screen) return;
    screen.classList.remove('olliTalkViewportMoving');
    olliTalkViewportSettleTimer = null;

    syncOlliTalkChatToComposer();
    commitOlliTalkKeyboardMessageMotion();
  }

  function scheduleOlliTalkViewportSettle(){
    if (olliTalkViewportSettleTimer) clearTimeout(olliTalkViewportSettleTimer);
    olliTalkViewportSettleTimer = setTimeout(finishOlliTalkViewportTransition, 130);
  }

  function syncViewport(options = {}){
    const screen = getScreen();
    if (!screen) return;
    const vv = window.visualViewport;
    const top = vv ? Number(vv.offsetTop || 0) : 0;
    const left = vv ? Number(vv.offsetLeft || 0) : 0;
    const width = vv ? Number(vv.width || window.innerWidth) : window.innerWidth;
    const height = vv ? Number(vv.height || window.innerHeight) : window.innerHeight;
    const input = getOlliTalkBetaInput();
    const inputFocused = !!input && document.activeElement === input;
    if (inputFocused && !olliTalkKeyboardBaselineBottom) captureOlliTalkKeyboardBaseline(true);
    const keyboardTracking = inputFocused
      || screen.classList.contains('olliTalkKeyboardOpen')
      || olliTalkKeyboardTransitionActive;
    const keyboardOffset = keyboardTracking ? getOlliTalkKeyboardOffset() : 0;
    const keyboardOpen = keyboardTracking && keyboardOffset > 24;
    const signature = [Math.round(top), Math.round(left), Math.round(width), Math.round(height)].join(':');
    const viewportChanged = signature !== olliTalkLastViewportSignature;

    if (olliTalkChatGestureActive) {
      olliTalkLastViewportSignature = signature;
      return;
    }

    const keyboardInteraction = inputFocused
      || screen.classList.contains('olliTalkKeyboardOpen')
      || screen.classList.contains('olliTalkViewportMoving');

    if (keyboardInteraction && viewportChanged) {
      screen.classList.add('olliTalkViewportMoving');
      scheduleOlliTalkViewportSettle();
    }
    olliTalkLastViewportSignature = signature;

    if (keyboardOpen) {
      if (!inputFocused) {
        // Keyboard is physically closing: follow its viewport until it reaches the bottom.
        syncOlliTalkComposerViewport({ followKeyboard:true });
      } else if (olliTalkKeyboardTransitionActive || !olliTalkComposerViewportLock) {
        // Keyboard is opening/resizing: follow it, then lock the final geometry.
        syncOlliTalkComposerViewport({ followKeyboard:true });
        scheduleOlliTalkComposerViewportLock();
      } else {
        // Keyboard is fully open: the locked geometry is authoritative.
        syncOlliTalkComposerViewport();
      }
    } else {
      syncOlliTalkComposerViewport({ followKeyboard:true });
    }

    screen.classList.toggle('olliTalkKeyboardOpen', keyboardOpen);
    if (!keyboardOpen && !inputFocused) {
      releaseOlliTalkComposerViewportLock();
      olliTalkKeyboardTransitionActive = false;
      hideOlliTalkMentionMenu();
      olliTalkKeyboardBaselineBottom = 0;
    }
    updateOlliTalkBetaComposerState();
  }

  function bindViewport(){
    if (olliTalkBetaViewportBound) return;
    olliTalkBetaViewportBound = true;
    window.addEventListener('resize', () => syncViewport({ source:'window-resize' }), { passive:true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => syncViewport({ source:'visual-resize' }), { passive:true });
      window.visualViewport.addEventListener('scroll', () => {
        // During keyboard-open lock, scroll/pan must never recalculate composer coordinates.
        if (olliTalkComposerViewportLock) {
          syncOlliTalkComposerViewport();
          return;
        }
        syncViewport({ source:'visual-scroll' });
      }, { passive:true });
    }
  }

  function resizeInput(){
    const input = document.getElementById('olliTalkBetaInput');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 112) + 'px';
    scheduleOlliTalkChatToComposer();
  }

  function getOlliTalkBetaInput(){
    return document.getElementById('olliTalkBetaInput');
  }

  function getOlliTalkBetaSendButton(){
    return document.getElementById('olliTalkBetaSendBtn');
  }

  function getOlliTalkSelectedMentionPrefix(){
    return document.getElementById('olliTalkSelectedMentionPrefix');
  }

  function syncOlliTalkSelectedMentionPrefix(){
    const prefix = getOlliTalkSelectedMentionPrefix();
    if (!prefix) return;
    const labels = [];
    olliTalkMentionSelections.forEach(member => {
      const name = String(member?.display_name || '').trim();
      if (name) labels.push('@' + name);
    });
    prefix.textContent = labels.join(' ');
    prefix.hidden = labels.length === 0;
  }

  function isOlliTalkAiEnabled(){
    try { return window.OlliTeamTalkSettings?.state?.aiEnabled === true; }
    catch (_) { return false; }
  }

  function isOlliTalkAiMentionConversationActive(){
    const selected = olliTalkMentionSelections.get(OLLI_TALK_AI_MENTION_ID);
    return olliTalkMentionModeActive && selected?.is_olli_ai === true;
  }

  function resetOlliTalkAiConversation(){
    olliTalkAiConversationMessages = [];
    olliTalkAiConversationAcademyId = '';
  }

  function buildOlliTalkAiConversationMessages(commandText, context){
    const current = { role:'user', content:String(commandText || '').trim() };
    if (!isOlliTalkAiMentionConversationActive()) return [current];

    const academyId = String(context?.academyId || '').trim();
    if (olliTalkAiConversationAcademyId && olliTalkAiConversationAcademyId !== academyId) {
      resetOlliTalkAiConversation();
    }
    olliTalkAiConversationAcademyId = academyId;
    return olliTalkAiConversationMessages.concat(current);
  }

  function recordOlliTalkAiConversationTurn(commandText, replyText){
    if (!isOlliTalkAiMentionConversationActive()) return;
    const userText = String(commandText || '').trim();
    const assistantText = String(replyText || '').trim();
    if (!userText || !assistantText) return;
    olliTalkAiConversationMessages.push(
      { role:'user', content:userText },
      { role:'assistant', content:assistantText }
    );
    if (olliTalkAiConversationMessages.length > 12) {
      olliTalkAiConversationMessages = olliTalkAiConversationMessages.slice(-12);
    }
  }

  function stripOlliTalkOlliPrefix(value){
    return String(value || '').replace(/^\s*@올리(?:\s+|$)/, '').trim();
  }

  function hasOlliTalkAiMentionSelection(){
    const selected = olliTalkMentionSelections.get(OLLI_TALK_AI_MENTION_ID);
    return selected?.is_olli_ai === true;
  }

  function hasOlliTalkPendingCommand(){
    const router = window.OlliCommandRouter;
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

  function resolveOlliTalkStudentInfoCommand(commandText){
    const router=window.OlliCommandRouter;
    if(!router || typeof router.parseStudentInfoLookupIntent!=='function') return null;

    const intent=router.parseStudentInfoLookupIntent(commandText);
    if(!intent) return null;

    const studentName=String(intent.studentName || '').trim();
    const students=typeof window.getAllStudents==='function'
      ? window.getAllStudents()
      : [];
    const matches=(Array.isArray(students) ? students : []).filter(student =>
      String(student?.name || '').trim()===studentName
    );

    if(!matches.length){
      return {
        handled:true,
        message:studentName + ' 학생을 찾지 못했어요.'
      };
    }

    if(matches.length>1){
      return {
        handled:true,
        message:studentName + ' 이름의 학생이 ' + matches.length + '명 있어요. 출석부에서 해당 학생을 선택해 주세요.'
      };
    }

    const studentId=String(matches[0]?.id || '').trim();
    if(!studentId){
      return {
        handled:true,
        message:studentName + ' 학생의 학생정보를 연결하지 못했어요.'
      };
    }

    return {
      handled:true,
      message:studentName + ' 학생 정보\n[학생정보 열기](olli-student-info:' + encodeURIComponent(studentId) + ')'
    };
  }

  async function resolveOlliTalkBotTurn(commandText,context,replyToMessageId,options={}){
    const router=window.OlliCommandRouter;
    const schedule=window.OlliCommandSchedule;

    const saveReply=async (message)=>{
      const text=String(message || '').trim() || '요청을 확인했어요.';
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,text,replyToMessageId),
        replyText:text
      };
    };

    try{
      if(olliTalkPendingActionReason){
        if(isOlliTalkPendingReasonCancel(commandText)){
          olliTalkPendingActionReason=null;
          return saveReply('작업 준비를 취소했어요.');
        }

        const command=Object.assign({},olliTalkPendingActionReason,{reason:String(commandText || '').trim()});
        olliTalkPendingActionReason=null;
        const confirmation=String(schedule?.writeConfirmationMessage?.(command) || '').trim() || '이 작업을 진행할까요?';
        return {
          assistantMessage:await saveOlliTalkActionReply(context,confirmation,command,replyToMessageId),
          replyText:confirmation
        };
      }

      const studentInfo=resolveOlliTalkStudentInfoCommand(commandText);
      if(studentInfo?.handled===true){
        return saveReply(studentInfo.message);
      }

      if(!router || typeof router.prepareAction!=='function'){
        return saveReply('올리 업무 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      }

      const prepared=await router.prepareAction(commandText,{
        source:'olli_talk_bot',
        selectedStudent:null,
        autoSubmitContext:null
      });

      if(prepared?.handled===true){
        if(prepared.kind==='action_pending' && prepared.payload){
          return {
            assistantMessage:await saveOlliTalkActionReply(
              context,
              prepared.message || '이 작업을 진행할까요?',
              prepared.payload,
              replyToMessageId
            ),
            replyText:String(prepared.message || '')
          };
        }

        if(prepared.kind==='action_needs_reason' && prepared.payload){
          olliTalkPendingActionReason=Object.assign({},prepared.payload);
          return saveReply(String(prepared.message || '').trim() || '사유를 알려주세요.');
        }

        if(prepared.kind==='action_rejected'){
          return saveReply(String(prepared.message || '').trim() || '작업을 준비하지 못했어요.');
        }
      }

      if(typeof router.runQuery==='function'){
        const queried=await router.runQuery(commandText,{
          source:'olli_talk_bot',
          selectedStudent:null,
          autoSubmitContext:null
        });
        if(queried?.handled===true){
          return saveReply(String(queried.message || '').trim() || '조회 결과를 확인했어요.');
        }
      }

      if(options.allowSuggestedQuery && typeof router.runSuggestedQuery==='function'){
        const suggested=await router.runSuggestedQuery(commandText,{
          source:'olli_talk_reply_button',
          selectedStudent:null,
          autoSubmitContext:null
        });
        if(suggested?.handled===true){
          return saveReply(String(suggested.message || '').trim() || '조회 결과를 확인했어요.');
        }
      }

      if(/^(확인|확인해|확인해줘|취소|취소해|취소해줘)$/i.test(String(commandText || '').trim())){
        return saveReply('변경 작업은 말풍선 아래 [취소] [확인] 버튼을 눌러주세요.');
      }

      return saveReply('아직 이 요청은 올리 업무 기능에 연결되지 않았어요. 자리 확인, 보강·체험·대기 등록/취소, 픽업·하원 픽업 등록, 수업 이동, 결석 처리를 요청할 수 있어요.');
    }catch(error){
      console.warn('올리톡 올리 업무 처리 실패:',error);
      return saveReply(String(error?.message || error || '요청을 처리하지 못했어요.'));
    }
  }

  function handleOlliTalkAiModeChanged(){
    olliTalkPendingActionReason = null;
    resetOlliTalkAiConversation();
  }

  async function resolveOlliTalkAiReply(commandText, context){
    const response = await fetch('/api/chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        promptType:'talk',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        messages:buildOlliTalkAiConversationMessages(commandText, context),
        stream:false
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || data?.message || '올리 AI 응답을 받지 못했습니다.');
    }
    const message = String(data?.reply || '').trim();
    if (!message) throw new Error('올리 AI 응답이 비어 있습니다.');
    return { route:null, message };
  }

  async function saveOlliTalkOlliReply(context, body, replyToMessageId){
    const payload = await callOlliTalkRpc('olli_team_chat_send_ai', {
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_body:String(body || '').trim(),
      p_client_message_id:createOlliTalkClientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if (!payload || payload.ok !== true || !payload.message) {
      throw new Error(payload?.message || '올리 응답을 저장하지 못했습니다.');
    }
    return payload.message;
  }

  async function saveOlliTalkActionReply(context,body,command,replyToMessageId){
    const actionType=String(command?.intent || '').trim();
    if(!actionType) throw new Error('작업 종류를 확인하지 못했습니다.');

    const payload=await callOlliTalkRpc('olli_team_chat_send_action',{
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_body:normalizeOlliTalkActionPrompt(body),
      p_action_type:actionType,
      p_action_payload:command,
      p_client_message_id:createOlliTalkClientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!payload?.ok || !payload?.message?.action){
      throw new Error(payload?.message || '작업 카드를 저장하지 못했습니다.');
    }
    return payload.message;
  }

  function isOlliTalkPendingReasonCancel(text){
    return /^(취소|취소해|취소해줘|그만|중단|하지마|아니|아니야)$/i.test(String(text || '').trim());
  }

  async function resolveOlliTalkAiTurn(commandText,context,replyToMessageId,options={}){
    const router=window.OlliCommandRouter;
    const schedule=window.OlliCommandSchedule;

    if(olliTalkPendingActionReason){
      if(isOlliTalkPendingReasonCancel(commandText)){
        olliTalkPendingActionReason=null;
        const message='작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }

      const command=Object.assign({},olliTalkPendingActionReason,{reason:String(commandText || '').trim()});
      olliTalkPendingActionReason=null;
      const confirmation=String(schedule?.writeConfirmationMessage?.(command) || '').trim() || '이 작업을 진행할까요?';
      return {
        assistantMessage:await saveOlliTalkActionReply(context,confirmation,command,replyToMessageId),
        replyText:confirmation,
        recordAi:false
      };
    }

    const studentInfo=resolveOlliTalkStudentInfoCommand(commandText);
    if(studentInfo?.handled===true){
      const message=String(studentInfo.message || '').trim() || '학생정보를 확인했어요.';
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
        replyText:message,
        recordAi:false
      };
    }

    if(router && typeof router.prepareAction==='function'){
      const prepared=await router.prepareAction(commandText,{
        source:'olli_talk_ai',
        selectedStudent:null,
        autoSubmitContext:null
      });

      if(prepared?.handled===true){
        if(prepared.kind==='action_pending' && prepared.payload){
          return {
            assistantMessage:await saveOlliTalkActionReply(
              context,
              prepared.message || '이 작업을 진행할까요?',
              prepared.payload,
              replyToMessageId
            ),
            replyText:String(prepared.message || ''),
            recordAi:false
          };
        }

        if(prepared.kind==='action_needs_reason' && prepared.payload){
          olliTalkPendingActionReason=Object.assign({},prepared.payload);
          const reasonMessage=String(prepared.message || '').trim() || '사유를 알려주세요.';
          return {
            assistantMessage:await saveOlliTalkOlliReply(context,reasonMessage,replyToMessageId),
            replyText:reasonMessage,
            recordAi:false
          };
        }

        if(prepared.kind==='action_rejected'){
          const rejectedMessage=String(prepared.message || '').trim() || '작업을 준비하지 못했어요.';
          return {
            assistantMessage:await saveOlliTalkOlliReply(context,rejectedMessage,replyToMessageId),
            replyText:rejectedMessage,
            recordAi:false
          };
        }
      }
    }

    if(router && typeof router.runQuery==='function'){
      const queried=await router.runQuery(commandText,{
        source:'olli_talk_ai',
        selectedStudent:null,
        autoSubmitContext:null
      });

      if(queried?.handled===true){
        const queryMessage=String(queried.message || '').trim() || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,queryMessage,replyToMessageId),
          replyText:queryMessage,
          recordAi:false
        };
      }
    }

    if(options.allowSuggestedQuery && router && typeof router.runSuggestedQuery==='function'){
      const suggested=await router.runSuggestedQuery(commandText,{
        source:'olli_talk_reply_button',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(suggested?.handled===true){
        const suggestedMessage=String(suggested.message || '').trim() || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,suggestedMessage,replyToMessageId),
          replyText:suggestedMessage,
          recordAi:false
        };
      }
    }

    const resolved=await resolveOlliTalkAiReply(commandText,context);
    return {
      assistantMessage:await saveOlliTalkOlliReply(context,resolved.message,replyToMessageId),
      replyText:resolved.message,
      recordAi:true
    };
  }

  function getOlliTalkMentionMessageText(value){
    return String(value || '')
      .replace(/(^|\s)@[^\s@]+/g, ' ')
      .replace(/(^|\s)@(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasOlliTalkSelectedMentionInInput(){
    return olliTalkMentionSelections.size > 0;
  }

  function getOlliTalkPersistentMentionPrefix(){
    const mentions = [];
    olliTalkMentionSelections.forEach(member => {
      const name = String(member?.display_name || '').trim();
      if (name) mentions.push('@' + name);
    });
    return mentions.length ? mentions.join(' ') + ' ' : '';
  }

  function isOlliTalkMentionMessageReady(){
    const input = getOlliTalkBetaInput();
    if (!input || !olliTalkMentionModeActive) return false;
    return hasOlliTalkSelectedMentionInInput()
      && getOlliTalkMentionMessageText(input.value).length > 0;
  }

  function syncOlliTalkMentionModeUi(){
    const screen = getScreen();
    const trigger = document.getElementById('olliTalkMentionTriggerBtn');
    const awaitingMessage = olliTalkMentionModeActive && !isOlliTalkMentionMessageReady();

    if (screen) screen.classList.toggle('olliTalkMentionAwaitingMessage', awaitingMessage);
    if (trigger) {
      trigger.classList.toggle('active', olliTalkMentionModeActive);
      trigger.setAttribute('aria-pressed', olliTalkMentionModeActive ? 'true' : 'false');
      trigger.setAttribute('aria-label', olliTalkMentionModeActive ? '선생님 멘션 취소' : '선생님 멘션');
    }
    return awaitingMessage;
  }

  function updateOlliTalkBetaComposerState(){
    const input = getOlliTalkBetaInput();
    const sendButton = getOlliTalkBetaSendButton();
    if (!input || !sendButton) return;

    const hasText = String(input.value || '').trim().length > 0;
    const canSend = olliTalkMentionModeActive ? isOlliTalkMentionMessageReady() : hasText;
    sendButton.disabled = !canSend;
    sendButton.setAttribute('aria-disabled', canSend ? 'false' : 'true');
    syncOlliTalkSelectedMentionPrefix();
    syncOlliTalkMentionModeUi();
  }

  function getOlliTalkLocalAccountId(){
    try{return String(localStorage.getItem('olli_account_id_v1')||'').trim()}catch(_){return ''}
  }

  function readOlliTalkLastCacheContext(){
    try{
      const raw=localStorage.getItem(OLLI_TALK_LAST_CACHE_CONTEXT_KEY);
      const parsed=raw?JSON.parse(raw):null;
      const accountId=getOlliTalkLocalAccountId();
      if(!parsed?.academy_id||!accountId||String(parsed.account_id||'')!==accountId)return null;
      return parsed;
    }catch(_){return null}
  }

  function rememberOlliTalkLastCacheContext(academyId){
    const id=String(academyId||'').trim();
    const accountId=getOlliTalkLocalAccountId();
    if(!id||!accountId)return false;
    try{
      localStorage.setItem(OLLI_TALK_LAST_CACHE_CONTEXT_KEY,JSON.stringify({
        academy_id:id,
        account_id:accountId,
        saved_at:new Date().toISOString()
      }));
      return true;
    }catch(_){return false}
  }

  function resolveOlliTalkCachedAcademyId(preferredAcademyId){
    const preferred=String(preferredAcademyId||'').trim();
    if(preferred)return preferred;
    try{
      const current=String(localStorage.getItem('olli_current_academy_id')||'').trim();
      if(current)return current;
    }catch(_){}
    return String(readOlliTalkLastCacheContext()?.academy_id||'').trim();
  }

  function getOlliTalkBetaContext(){
    let context = null;
    try {
      context = window.OlliStorageCore?.AcademyContext?.getCurrent?.() || null;
    } catch(e) {}

    let academyId = String(
      context?.academyId ||
      context?.academy_id ||
      (typeof window.getOlliCurrentAcademyId === 'function' ? window.getOlliCurrentAcademyId() : '') ||
      localStorage.getItem('olli_current_academy_id') ||
      ''
    ).trim();
    if(!academyId)academyId=resolveOlliTalkCachedAcademyId('');

    const memberId = String(
      context?.memberId ||
      context?.member_id ||
      localStorage.getItem('olli_current_member_id') ||
      ''
    ).trim();

    const memberName = String(
      context?.memberName ||
      context?.member_name ||
      localStorage.getItem('olli_current_member_name') ||
      ''
    ).trim();

    let sessionToken = '';
    try {
      sessionToken = typeof window.getOlliPhoneWritableAccountSessionToken === 'function'
        ? window.getOlliPhoneWritableAccountSessionToken()
        : '';
    } catch(e) {}
    if (!sessionToken) {
      try { sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim(); } catch(e) {}
    }

    return { academyId, memberId, memberName, sessionToken };
  }

  function getOlliTalkMessageCacheKey(academyId){
    const safeAcademyId = String(academyId || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '_');
    return safeAcademyId ? ('olli_team_chat_cache_v1:' + safeAcademyId) : '';
  }

  function normalizeOlliTalkMemberCount(value){
    if(value===null||value===undefined||value==='')return null;
    const count=Number(value);
    return Number.isFinite(count)?Math.max(0,Math.floor(count)):null;
  }

  function readOlliTalkMessageCache(context = getOlliTalkBetaContext()){
    const academyId=resolveOlliTalkCachedAcademyId(context?.academyId);
    const key = getOlliTalkMessageCacheKey(academyId);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      const cached = raw ? JSON.parse(raw) : null;
      if (!cached || String(cached.academy_id || '') !== academyId) return null;
      const accountId=getOlliTalkLocalAccountId();
      if(accountId && String(cached.account_id||'')!==accountId)return null;
      return {
        ok:true,
        academy_id:cached.academy_id,
        current_member_id:cached.current_member_id || context?.memberId || '',
        current_member_name:cached.current_member_name || context?.memberName || '',
        member_count:normalizeOlliTalkMemberCount(cached.member_count),
        messages:Array.isArray(cached.messages) ? cached.messages : []
      };
    } catch(error) {
      console.warn('올리톡 로컬 캐시 읽기 실패:', error);
      return null;
    }
  }

  function writeOlliTalkMessageCache(context, payload){
    const academyId=resolveOlliTalkCachedAcademyId(context?.academyId||payload?.academy_id);
    const key = getOlliTalkMessageCacheKey(academyId);
    if (!key || !payload || payload.ok !== true) return false;
    try {
      let previous=null;
      try{
        const previousRaw=localStorage.getItem(key);
        previous=previousRaw?JSON.parse(previousRaw):null;
      }catch(_){}
      const payloadMemberCount=normalizeOlliTalkMemberCount(payload.member_count);
      const previousMemberCount=normalizeOlliTalkMemberCount(previous?.member_count);
      const cachedMemberCount=payloadMemberCount!==null?payloadMemberCount:previousMemberCount;
      localStorage.setItem(key, JSON.stringify({
        schema_version:1,
        academy_id:academyId,
        account_id:getOlliTalkLocalAccountId(),
        current_member_id:String(payload.current_member_id || context?.memberId || ''),
        current_member_name:String(payload.current_member_name || context?.memberName || ''),
        member_count:cachedMemberCount,
        messages:Array.isArray(payload.messages) ? payload.messages.slice(-500) : [],
        cached_at:new Date().toISOString()
      }));
      rememberOlliTalkLastCacheContext(academyId);
      return true;
    } catch(error) {
      console.warn('올리톡 로컬 캐시 저장 실패:', error);
      return false;
    }
  }

  function areOlliTalkMessagePayloadsEquivalent(left,right){
    if(!left||!right)return false;
    if(String(left.current_member_id||'')!==String(right.current_member_id||''))return false;
    try{
      return JSON.stringify(Array.isArray(left.messages)?left.messages:[])===JSON.stringify(Array.isArray(right.messages)?right.messages:[]);
    }catch(_){return false}
  }

  function mergeOlliTalkMessagePayloads(basePayload,nextPayload){
    const deletedIds=new Set(
      (Array.isArray(nextPayload?.deleted_message_ids)?nextPayload.deleted_message_ids:[])
        .map(id=>String(id||''))
        .filter(Boolean)
    );
    const merged=new Map();
    [basePayload,nextPayload].forEach(payload=>{
      (Array.isArray(payload?.messages)?payload.messages:[]).forEach(item=>{
        const id=String(item?.id||item?.client_message_id||'');
        if(id&&!deletedIds.has(id))merged.set(id,item);
      });
    });
    deletedIds.forEach(id=>merged.delete(id));
    const messages=Array.from(merged.values()).sort((a,b)=>Number(a?.id||0)-Number(b?.id||0));
    return{
      ok:true,
      academy_id:nextPayload?.academy_id||basePayload?.academy_id||'',
      current_member_id:nextPayload?.current_member_id||basePayload?.current_member_id||'',
      current_member_name:nextPayload?.current_member_name||basePayload?.current_member_name||'',
      member_count:normalizeOlliTalkMemberCount(nextPayload?.member_count) ?? normalizeOlliTalkMemberCount(basePayload?.member_count),
      deleted_message_ids:Array.from(deletedIds),
      messages
    };
  }

  function renderOlliTalkCachedMessages(context = getOlliTalkBetaContext()){
    const cached = readOlliTalkMessageCache(context);
    if (!cached) return null;
    olliTalkCurrentPayload=cached;
    renderOlliTalkServerMessages(cached, {
      scrollMode:'bottom',
      messageLimit:OLLI_TALK_INITIAL_RENDER_LIMIT
    });
    return cached;
  }

  function createOlliTalkClientMessageId(){
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function formatOlliTalkBetaMessageTime(value){
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    let hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, '0');
    const period = hour < 12 ? '오전' : '오후';
    hour = hour % 12 || 12;
    return `${period} ${hour}:${minute}`;
  }

  function getOlliTalkDateKey(value){
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function formatOlliTalkDateLabel(value){
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const todayKey = getOlliTalkDateKey(today);
    const dateKey = getOlliTalkDateKey(date);
    if (dateKey === todayKey) return '오늘';

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (dateKey === getOlliTalkDateKey(yesterday)) return '어제';

    if (date.getFullYear() === today.getFullYear()) {
      return `${date.getMonth() + 1}월 ${date.getDate()}일`;
    }
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  }

  function createMessageText(tag, className, text){
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  }

  function getOlliTalkUrlFromText(value){
    const match = String(value || '').match(/https?:\/\/[^\s<>"']+/i);
    if (!match?.[0]) return '';
    return String(match[0]).replace(/[),.!?\]}]+$/g, '');
  }

  function getOlliTalkLinkDomain(url){
    try {
      return new URL(url).hostname || url;
    } catch (_) {
      return url;
    }
  }

  function createOlliTalkLinkPreviewCard(url, options = {}){
    const card = document.createElement('a');
    card.className = 'olliTalkBetaLinkPreviewCard';
    card.href = url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.dataset.previewUrl = url;

    const body = document.createElement('div');
    body.className = 'olliTalkBetaLinkPreviewBody';

    const title = createMessageText('div', 'olliTalkBetaLinkPreviewTitle', getOlliTalkLinkDomain(url));
    const description = createMessageText('div', 'olliTalkBetaLinkPreviewDescription', '여기를 눌러 링크를 확인하세요.');
    const domain = createMessageText('div', 'olliTalkBetaLinkPreviewDomain', getOlliTalkLinkDomain(url));

    body.appendChild(title);
    body.appendChild(description);
    body.appendChild(domain);
    card.appendChild(body);

    if(options.deferHydration===true){
      card.dataset.olliDeferredPreview='1';
    }else{
      hydrateOlliTalkLinkPreview(card, url);
    }
    return card;
  }

  function getOlliTalkLinkPreviewCacheInput(url){
    const context=getOlliTalkBetaContext();
    return {
      accountId:getOlliTalkLocalAccountId(),
      academyId:resolveOlliTalkCachedAcademyId(context?.academyId),
      url:String(url||'').trim()
    };
  }

  async function readOlliTalkPersistentLinkPreview(url){
    const persistentCache=window.OlliTalkAttachmentCachePhone;
    if(typeof persistentCache?.getLinkPreview!=='function')return null;
    const input=getOlliTalkLinkPreviewCacheInput(url);
    if(!input.accountId||!input.academyId||!input.url)return null;
    try{
      return await persistentCache.getLinkPreview(input);
    }catch(error){
      console.warn('Team Chat 링크 프리뷰 로컬 캐시 조회 실패:',error);
      return null;
    }
  }

  function setOlliTalkLinkPreviewImage(card,src,options={}){
    if(!card)return false;
    const source=String(src||'').trim();
    const existing=card.querySelector('.olliTalkBetaLinkPreviewImage');

    if(!source){
      if(existing)existing.remove();
      card.classList.remove('hasImage');
      return false;
    }
    if(existing?.dataset?.previewSrc===source){
      if(existing.complete&&existing.naturalWidth>0){
        existing.hidden=false;
        card.classList.add('hasImage');
      }
      return true;
    }
    if(existing)existing.remove();

    const image=document.createElement('img');
    image.className='olliTalkBetaLinkPreviewImage';
    image.alt='';
    image.loading=options.local===true?'eager':'lazy';
    image.decoding='async';
    image.referrerPolicy='no-referrer';
    image.hidden=true;
    image.dataset.previewSrc=source;
    image.addEventListener('load',()=>{
      if(!image.isConnected)return;
      const chatArea=document.getElementById('olliTalkBetaChatArea');
      const keepBottom=options.followBottom===true&&!!chatArea&&isOlliTalkChatNearBottom(chatArea,120);
      image.hidden=false;
      card.classList.add('hasImage');
      if(keepBottom&&chatArea?.isConnected){
        requestAnimationFrame(()=>{
          if(chatArea.isConnected)chatArea.scrollTop=chatArea.scrollHeight;
        });
      }
    },{once:true});
    image.addEventListener('error',()=>{
      if(image.isConnected)image.remove();
      card.classList.remove('hasImage');
    },{once:true});
    image.src=source;
    card.insertBefore(image,card.firstChild);
    return true;
  }

  function applyOlliTalkLinkPreview(card,url,preview){
    if(!preview||!card?.isConnected)return false;

    const chatArea=document.getElementById('olliTalkBetaChatArea');
    const keepBottom=!!chatArea&&isOlliTalkChatNearBottom(chatArea,120);
    const title=card.querySelector('.olliTalkBetaLinkPreviewTitle');
    const description=card.querySelector('.olliTalkBetaLinkPreviewDescription');
    const domain=card.querySelector('.olliTalkBetaLinkPreviewDomain');

    if(title)title.textContent=String(preview.title||preview.site_name||preview.domain||getOlliTalkLinkDomain(url));
    if(description){
      const descriptionText=String(preview.description||'').trim();
      description.textContent=descriptionText||'여기를 눌러 링크를 확인하세요.';
      description.hidden=false;
    }
    if(domain)domain.textContent=String(preview.domain||getOlliTalkLinkDomain(url));

    let imageSource='';
    let localImage=false;
    if(preview.image_blob instanceof Blob&&preview.image_blob.size>0){
      const objectUrl=URL.createObjectURL(preview.image_blob);
      imageSource=rememberOlliTalkResolvedBlobUrl(
        olliTalkLinkPreviewResolvedBlobUrls,
        'link:'+String(url||''),
        objectUrl,
        40
      );
      localImage=true;
    }else{
      imageSource=String(preview.image||'').trim();
    }
    setOlliTalkLinkPreviewImage(card,imageSource,{local:localImage,followBottom:keepBottom});
    if(keepBottom&&chatArea?.isConnected){
      requestAnimationFrame(()=>{
        if(chatArea.isConnected)chatArea.scrollTop=chatArea.scrollHeight;
      });
    }
    return true;
  }

  function loadOlliTalkLinkPreview(url){
    const key=String(url||'').trim();
    if(!key)return Promise.resolve(null);
    if(olliTalkLinkPreviewCache.has(key))return olliTalkLinkPreviewCache.get(key);

    const request=fetch('/api/link-preview?url='+encodeURIComponent(key),{
      method:'GET',
      headers:{Accept:'application/json'}
    })
      .then(async response=>{
        if(!response.ok)throw new Error('링크 미리보기 요청 실패');
        const payload=await response.json();
        return payload?.ok?payload:null;
      })
      .catch(()=>null);

    olliTalkLinkPreviewCache.set(key,request);
    return request;
  }

  async function fetchOlliTalkLinkPreviewImageBlob(url){
    const key=String(url||'').trim();
    if(!key)return null;
    try{
      const response=await fetch('/api/link-preview?asset=image&url='+encodeURIComponent(key),{
        method:'GET',
        headers:{Accept:'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp'}
      });
      if(!response.ok)return null;
      const blob=await response.blob();
      return blob instanceof Blob&&blob.size>0?blob:null;
    }catch(_){
      return null;
    }
  }

  async function persistOlliTalkLinkPreview(url,preview,options={}){
    const persistentCache=window.OlliTalkAttachmentCachePhone;
    if(typeof persistentCache?.putLinkPreview!=='function'||!preview)return false;
    const input=getOlliTalkLinkPreviewCacheInput(url);
    if(!input.accountId||!input.academyId||!input.url)return false;

    try{
      await persistentCache.putLinkPreview(input,preview,null);
      if(!String(preview.image||'').trim())return true;
      if(options.image===false)return true;
      const imageBlob=await fetchOlliTalkLinkPreviewImageBlob(url);
      if(imageBlob)await persistentCache.putLinkPreview(input,preview,imageBlob);
      return true;
    }catch(error){
      console.warn('Team Chat 링크 프리뷰 로컬 캐시 저장 실패:',error);
      return false;
    }
  }

  async function hydrateOlliTalkLinkPreview(card,url){
    const localPreview=await readOlliTalkPersistentLinkPreview(url);
    if(localPreview&&card?.isConnected)applyOlliTalkLinkPreview(card,url,localPreview);

    const savedAt=Math.max(0,Number(localPreview?.saved_at||0));
    const localFresh=savedAt>0&&(Date.now()-savedAt)<OLLI_TALK_LINK_PREVIEW_REFRESH_MS;
    if(localFresh){
      if(String(localPreview?.image||'').trim()&&!(localPreview?.image_blob instanceof Blob)){
        persistOlliTalkLinkPreview(url,localPreview).catch(()=>{});
      }
      return;
    }

    const preview=await loadOlliTalkLinkPreview(url);
    if(!preview)return;
    if(card?.isConnected)applyOlliTalkLinkPreview(card,url,preview);
    persistOlliTalkLinkPreview(url,preview).catch(()=>{});
  }

  function formatOlliTalkArchiveBytes(value){
    const bytes=Math.max(0,Number(value||0));
    if(bytes<1024) return bytes+' B';
    if(bytes<1024*1024) return Math.round(bytes/1024)+' KB';
    return (bytes/(1024*1024)).toFixed(bytes>=10*1024*1024?0:1)+' MB';
  }
  function formatOlliTalkArchiveDate(value){
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    return date.getFullYear()+'. '+(date.getMonth()+1)+'. '+date.getDate();
  }
  function getOlliTalkFileExtension(name){
    const match=String(name||'').match(/\.([a-zA-Z0-9]{1,8})$/);
    return match?match[1].toUpperCase():'FILE';
  }
  function isOlliTalkObjectUrlInUse(url){
    if(!url)return false;
    try{
      return Array.from(document.images||[]).some(image=>image?.isConnected&&image.src===url);
    }catch(_){
      return false;
    }
  }

  function rememberOlliTalkResolvedBlobUrl(map,id,url,limit){
    const key=String(id||'');
    if(!key||!url)return url||'';
    const existing=map.get(key);
    if(existing&&existing!==url&&!isOlliTalkObjectUrlInUse(existing)){
      try{URL.revokeObjectURL(existing)}catch(_){}
    }
    map.delete(key);
    map.set(key,url);

    const max=Math.max(1,Number(limit||1));
    let guard=0;
    while(map.size>max&&guard<map.size+4){
      guard+=1;
      const oldest=map.entries().next().value;
      if(!oldest)break;
      const [oldestKey,oldestUrl]=oldest;
      if(isOlliTalkObjectUrlInUse(oldestUrl)){
        map.delete(oldestKey);
        map.set(oldestKey,oldestUrl);
        continue;
      }
      map.delete(oldestKey);
      try{URL.revokeObjectURL(oldestUrl)}catch(_){}
    }
    return url;
  }

  function getOlliTalkResolvedBlobUrl(map,id){
    const key=String(id||'');
    const url=key?map.get(key):'';
    if(!url)return '';
    map.delete(key);
    map.set(key,url);
    return url;
  }

  function emitOlliTalkTransferProgress(options,payload){
    if(typeof options?.onProgress!=='function')return;
    try{options.onProgress(payload)}catch(_){}
  }

  function getOlliTalkTransferTotalBytes(attachment,response){
    const headerBytes=Math.max(0,Number(response?.headers?.get?.('Content-Length')||0));
    const metadataBytes=Math.max(0,Number(attachment?.file_size||0));
    return headerBytes||metadataBytes;
  }

  async function readOlliTalkAttachmentResponseBlob(response,attachment,options={}){
    const total=getOlliTalkTransferTotalBytes(attachment,response);
    const contentType=String(response?.headers?.get?.('Content-Type')||attachment?.mime_type||'application/octet-stream');
    const body=response?.body;

    if(!body||typeof body.getReader!=='function'){
      const blob=await response.blob();
      emitOlliTalkTransferProgress(options,{
        phase:'done',
        loaded:blob.size,
        total:total||blob.size
      });
      return blob;
    }

    const reader=body.getReader();
    const chunks=[];
    let loaded=0;
    while(true){
      const part=await reader.read();
      if(part.done)break;
      const value=part.value;
      if(!value||!value.byteLength)continue;
      chunks.push(value);
      loaded+=value.byteLength;
      emitOlliTalkTransferProgress(options,{
        phase:'receiving',
        loaded,
        total
      });
    }

    const blob=new Blob(chunks,{type:contentType});
    emitOlliTalkTransferProgress(options,{
      phase:'done',
      loaded:blob.size,
      total:total||blob.size
    });
    return blob;
  }

  async function fetchOlliTalkAttachmentBlobUrl(attachment,options={}){
    const id=String(attachment?.id||'');
    if(!id)return '';

    const context=getOlliTalkBetaContext();
    const academyId=resolveOlliTalkCachedAcademyId(context?.academyId);
    if(!context.sessionToken||!academyId){
      throw new Error('이미지 서버 갱신을 위한 로그인 정보가 아직 준비되지 않았습니다.');
    }

    emitOlliTalkTransferProgress(options,{
      phase:'waiting',
      loaded:0,
      total:Math.max(0,Number(attachment?.file_size||0))
    });

    const response=await fetch('/api/team-talk-file?attachmentId='+encodeURIComponent(id),{
      method:'GET',
      headers:{'X-Olli-Session-Token':context.sessionToken,'X-Olli-Academy-Id':academyId},
      signal:options?.signal
    });
    if(!response.ok){
      let message='파일을 불러오지 못했습니다.';
      try{const payload=await response.json();message=payload?.error||message}catch(_){}
      throw new Error(message);
    }

    const blob=await readOlliTalkAttachmentResponseBlob(response,attachment,options);
    if(!(blob instanceof Blob)||blob.size<1)throw new Error('파일 데이터가 비어 있습니다.');
    const url=URL.createObjectURL(blob);
    return rememberOlliTalkResolvedBlobUrl(olliTalkAttachmentResolvedBlobUrls,id,url,6);
  }

  async function getOlliTalkAttachmentBlobUrl(attachment,options={}){
    const id=String(attachment?.id||'');
    if(!id)return '';
    const resolved=getOlliTalkResolvedBlobUrl(olliTalkAttachmentResolvedBlobUrls,id);
    if(resolved){
      const total=Math.max(0,Number(attachment?.file_size||0));
      emitOlliTalkTransferProgress(options,{
        phase:'done',
        loaded:total,
        total,
        cached:true
      });
      return resolved;
    }

    const dedicated=!!options?.signal||typeof options?.onProgress==='function';
    if(!dedicated&&olliTalkAttachmentBlobUrls.has(id))return olliTalkAttachmentBlobUrls.get(id);
    if(dedicated)return fetchOlliTalkAttachmentBlobUrl(attachment,options);

    const request=fetchOlliTalkAttachmentBlobUrl(attachment).catch(error=>{
      olliTalkAttachmentBlobUrls.delete(id);
      throw error;
    });

    olliTalkAttachmentBlobUrls.set(id,request);
    request.finally(()=>{
      if(olliTalkAttachmentBlobUrls.get(id)===request)olliTalkAttachmentBlobUrls.delete(id);
    }).catch(()=>{});
    return request;
  }

  async function getOlliTalkAttachmentPreviewBlobUrl(attachment){
    const id=String(attachment?.id||'');
    if(!id)return '';

    const resolvedPreview=getOlliTalkResolvedBlobUrl(olliTalkAttachmentPreviewResolvedBlobUrls,id);
    if(resolvedPreview)return resolvedPreview;

    if(olliTalkAttachmentPreviewFallbackIds.has(id)){
      const resolvedOriginal=getOlliTalkResolvedBlobUrl(olliTalkAttachmentResolvedBlobUrls,id);
      if(resolvedOriginal)return resolvedOriginal;
    }

    if(olliTalkAttachmentPreviewBlobUrls.has(id))return olliTalkAttachmentPreviewBlobUrls.get(id);

    const context=getOlliTalkBetaContext();
    const academyId=resolveOlliTalkCachedAcademyId(context?.academyId);
    const accountId=getOlliTalkLocalAccountId();
    const persistentCache=window.OlliTalkAttachmentCachePhone;
    const cacheInput={accountId,academyId,attachmentId:id,variant:'thumbnail'};

    const request=(async()=>{
      if(accountId&&academyId&&typeof persistentCache?.getBlob==='function'){
        try{
          const cachedBlob=await persistentCache.getBlob(cacheInput);
          if(cachedBlob){
            olliTalkAttachmentPreviewFallbackIds.delete(id);
            const cachedUrl=URL.createObjectURL(cachedBlob);
            return rememberOlliTalkResolvedBlobUrl(olliTalkAttachmentPreviewResolvedBlobUrls,id,cachedUrl,80);
          }
        }catch(error){
          console.warn('Team Chat 썸네일 로컬 캐시 조회 실패:',error);
        }
      }

      if(!context.sessionToken||!academyId){
        throw new Error('이미지 서버 갱신을 위한 로그인 정보가 아직 준비되지 않았습니다.');
      }

      const response=await fetch('/api/team-talk-file?attachmentId='+encodeURIComponent(id)+'&variant=thumbnail',{
        method:'GET',
        headers:{'X-Olli-Session-Token':context.sessionToken,'X-Olli-Academy-Id':academyId}
      });
      if(!response.ok){
        let message='썸네일을 불러오지 못했습니다.';
        try{const payload=await response.json();message=payload?.error||message}catch(_){}
        throw new Error(message);
      }

      const blob=await response.blob();
      if(!(blob instanceof Blob)||blob.size<1)throw new Error('이미지 데이터가 비어 있습니다.');
      const assetVariant=String(response.headers.get('X-Olli-Asset-Variant')||'original').trim().toLowerCase();
      const url=URL.createObjectURL(blob);

      if(assetVariant==='thumbnail'){
        olliTalkAttachmentPreviewFallbackIds.delete(id);
        if(accountId&&typeof persistentCache?.putBlob==='function'){
          persistentCache.putBlob(cacheInput,blob,{
            mimeType:attachment?.thumbnail_mime_type||blob.type,
            fileName:attachment?.file_name||''
          }).catch(()=>{});
        }
        return rememberOlliTalkResolvedBlobUrl(olliTalkAttachmentPreviewResolvedBlobUrls,id,url,80);
      }

      // Legacy/stale local metadata is allowed: the server is the source of truth.
      // When no thumbnail exists, display the returned original without starting a second request.
      olliTalkAttachmentPreviewFallbackIds.add(id);
      return rememberOlliTalkResolvedBlobUrl(olliTalkAttachmentResolvedBlobUrls,id,url,6);
    })().catch(error=>{
      olliTalkAttachmentPreviewBlobUrls.delete(id);
      console.warn('Team Chat 썸네일 조회 실패, 원본으로 대체합니다.',error?.message||error);
      olliTalkAttachmentPreviewFallbackIds.add(id);
      return getOlliTalkAttachmentBlobUrl(attachment);
    });

    olliTalkAttachmentPreviewBlobUrls.set(id,request);
    request.finally(()=>{
      if(olliTalkAttachmentPreviewBlobUrls.get(id)===request)olliTalkAttachmentPreviewBlobUrls.delete(id);
    }).catch(()=>{});
    return request;
  }
  function triggerOlliTalkAttachmentDownload(url,attachment){
    if(!url)return false;
    const a=document.createElement('a');
    a.href=url;
    a.download=String(attachment?.file_name||'file');
    a.rel='noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  async function downloadOlliTalkAttachment(attachment){
    try{
      const url=await getOlliTalkAttachmentBlobUrl(attachment);
      return triggerOlliTalkAttachmentDownload(url,attachment);
    }catch(error){
      alert(error?.message||'파일을 내려받지 못했습니다.');
      return false;
    }
  }

  function getOlliTalkCurrentMemberRole(){
    const currentId=String(olliTalkCurrentPayload?.current_member_id||getOlliTalkBetaContext().memberId||'').trim();
    const member=olliTalkMembers.find(item=>String(item?.member_id||'').trim()===currentId);
    return String(member?.role||'').trim().toLowerCase();
  }

  function canDeleteOlliTalkImageItem(item){
    const currentId=String(olliTalkCurrentPayload?.current_member_id||getOlliTalkBetaContext().memberId||'').trim();
    const senderId=String(item?.sender_member_id||'').trim();
    const role=getOlliTalkCurrentMemberRole();
    if(currentId&&senderId&&currentId===senderId)return true;
    if(role==='owner'||role==='manager')return true;
    return !olliTalkMembers.length;
  }

  function revokeOlliTalkResolvedAttachmentUrl(map,id){
    const key=String(id||'');
    if(!key)return;
    const url=map.get(key);
    map.delete(key);
    if(url){
      try{URL.revokeObjectURL(url)}catch(_){}
    }
  }

  async function purgeOlliTalkAttachmentCaches(attachment){
    const id=String(attachment?.id||'').trim();
    if(!id)return;
    olliTalkAttachmentBlobUrls.delete(id);
    olliTalkAttachmentPreviewBlobUrls.delete(id);
    olliTalkAttachmentPreviewFallbackIds.delete(id);
    revokeOlliTalkResolvedAttachmentUrl(olliTalkAttachmentResolvedBlobUrls,id);
    revokeOlliTalkResolvedAttachmentUrl(olliTalkAttachmentPreviewResolvedBlobUrls,id);

    const context=getOlliTalkBetaContext();
    const accountId=getOlliTalkLocalAccountId();
    if(accountId&&context.academyId&&typeof window.OlliTalkAttachmentCachePhone?.removeAttachment==='function'){
      try{
        await window.OlliTalkAttachmentCachePhone.removeAttachment({
          accountId,
          academyId:context.academyId,
          attachmentId:id
        });
      }catch(error){
        console.warn('Team Chat 삭제 사진 로컬 캐시 정리 실패:',error);
      }
    }
  }

  function removeOlliTalkImageMessageLocally(item){
    const context=getOlliTalkBetaContext();
    const messageId=String(item?.id||'').trim();
    const attachmentId=String(item?.attachment?.id||'').trim();
    const keepMessage=message=>{
      const id=String(message?.id||'').trim();
      const mediaId=String(message?.attachment?.id||'').trim();
      return (!messageId||id!==messageId)&&(!attachmentId||mediaId!==attachmentId);
    };

    const chatSource=olliTalkCurrentPayload||readOlliTalkMessageCache(context);
    if(chatSource){
      const nextChat={...chatSource,messages:(Array.isArray(chatSource.messages)?chatSource.messages:[]).filter(keepMessage)};
      olliTalkCurrentPayload=nextChat;
      writeOlliTalkMessageCache(context,nextChat);
      if(isOlliTalkBetaVisible()){
        renderOlliTalkServerMessages(nextChat,{scrollMode:'preserve'});
      }
    }

    const archiveSource=olliTalkArchivePayload||readOlliTalkArchiveCache(context);
    if(archiveSource){
      const nextArchive={...archiveSource,messages:(Array.isArray(archiveSource.messages)?archiveSource.messages:[]).filter(keepMessage)};
      olliTalkArchivePayload=nextArchive;
      writeOlliTalkArchiveCache(context,nextArchive);
      const archive=document.getElementById('olliTalkArchiveScreen');
      if(archive&&archive.style.display!=='none'&&olliTalkArchiveTab!=='materials'){
        renderOlliTalkArchive();
      }
    }
  }

  async function deleteOlliTalkImageItem(item,button){
    const attachment=item?.attachment||{};
    const attachmentId=String(attachment?.id||'').trim();
    const context=getOlliTalkBetaContext();
    if(!attachmentId||!context.sessionToken||!context.academyId){
      alert('사진 삭제를 위한 로그인 정보를 확인하지 못했습니다.');
      return false;
    }
    if(!window.confirm('이 사진을 팀챗에서 삭제할까요?\n삭제한 사진은 되돌릴 수 없습니다.'))return false;

    if(button){
      button.disabled=true;
      button.setAttribute('aria-busy','true');
    }
    try{
      const result=await callOlliTalkFileApi('delete',{attachmentId},context);
      await purgeOlliTalkAttachmentCaches(attachment);
      removeOlliTalkImageMessageLocally(item);
      if(result?.storageCleanupComplete===false){
        console.warn('Team Chat 사진 메시지는 삭제되었지만 저장소 파일 정리는 완료되지 않았습니다.');
      }
      return true;
    }catch(error){
      alert(error?.message||'사진을 삭제하지 못했습니다.');
      return false;
    }finally{
      if(button?.isConnected){
        button.disabled=false;
        button.removeAttribute('aria-busy');
      }
    }
  }

  function formatOlliTalkTransferPair(loaded,total){
    const safeLoaded=Math.max(0,Number(loaded||0));
    const safeTotal=Math.max(0,Number(total||0));
    if(safeTotal>=1024*1024){
      return (safeLoaded/(1024*1024)).toFixed(2)+' / '+(safeTotal/(1024*1024)).toFixed(2)+'MB';
    }
    if(safeTotal>=1024){
      return (safeLoaded/1024).toFixed(1)+' / '+(safeTotal/1024).toFixed(1)+'KB';
    }
    if(safeTotal>0)return Math.round(safeLoaded)+' / '+Math.round(safeTotal)+'B';
    if(safeLoaded>=1024*1024)return (safeLoaded/(1024*1024)).toFixed(2)+'MB';
    if(safeLoaded>=1024)return (safeLoaded/1024).toFixed(1)+'KB';
    if(safeLoaded>0)return Math.round(safeLoaded)+'B';
    return '불러오는 중…';
  }

  function updateOlliTalkTransferProgress(circleId,textId,progress={}){
    const circle=document.getElementById(circleId);
    const text=document.getElementById(textId);
    const loaded=Math.max(0,Number(progress?.loaded||0));
    const total=Math.max(0,Number(progress?.total||0));
    const phase=String(progress?.phase||'waiting');

    if(text)text.textContent=formatOlliTalkTransferPair(loaded,total);
    if(!circle)return;

    const determinate=phase!=='waiting'&&total>0;
    circle.classList.toggle('indeterminate',!determinate);
    if(!determinate){
      circle.style.removeProperty('stroke-dashoffset');
      return;
    }

    const ratio=Math.max(0,Math.min(1,loaded/total));
    circle.style.strokeDashoffset=String(OLLI_TALK_TRANSFER_RING_CIRCUMFERENCE*(1-ratio));
  }

  function setOlliTalkPhotoViewerProgress(progress){
    updateOlliTalkTransferProgress('olliTalkPhotoViewerProgressCircle','olliTalkPhotoViewerProgressText',progress);
  }

  function setOlliTalkArchiveFileProgress(progress){
    updateOlliTalkTransferProgress('olliTalkArchiveFileProgressCircle','olliTalkArchiveFileProgressText',progress);
  }

  function formatOlliTalkPhotoViewerDate(value){
    const date=value instanceof Date?value:new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    return date.getFullYear()+'. '+(date.getMonth()+1)+'. '+date.getDate()+'. '+formatOlliTalkBetaMessageTime(date);
  }

  function getOlliTalkPhotoViewerScreen(){
    return document.getElementById('olliTalkPhotoViewerScreen');
  }

  function clearOlliTalkPhotoViewerImage(){
    const preview=document.getElementById('olliTalkPhotoViewerPreview');
    const image=document.getElementById('olliTalkPhotoViewerImage');
    const loading=document.getElementById('olliTalkPhotoViewerLoading');
    if(preview){
      preview.removeAttribute('src');
      preview.hidden=true;
    }
    if(image){
      image.removeAttribute('src');
      image.hidden=true;
    }
    if(loading)loading.hidden=false;
    setOlliTalkPhotoViewerProgress({phase:'waiting',loaded:0,total:0});
  }

  function restoreOlliTalkPhotoViewerSource(source){
    const talk=getScreen();
    const archive=document.getElementById('olliTalkArchiveScreen');
    if(source==='archive'){
      if(talk){talk.style.display='none';talk.setAttribute('aria-hidden','true')}
      if(archive){archive.style.display='flex';archive.setAttribute('aria-hidden','false')}
      requestAnimationFrame(()=>hydrateOlliTalkArchiveDeferredMedia());
      return;
    }

    if(archive){archive.style.display='none';archive.setAttribute('aria-hidden','true')}
    if(talk){talk.style.display='flex';talk.setAttribute('aria-hidden','false')}
    syncOlliTalkComposerViewport();
    syncViewport();
    scheduleOlliTalkChatToComposer();
  }

  function closeOlliTalkPhotoViewer(event,options={}){
    if(event){event.preventDefault();event.stopPropagation()}
    const screen=getOlliTalkPhotoViewerScreen();
    const activeState=olliTalkPhotoViewerState;
    const source=activeState?.source||'chat';
    try{activeState?.abortController?.abort()}catch(_){}
    olliTalkPhotoViewerLoadSequence+=1;
    olliTalkPhotoViewerState=null;
    clearOlliTalkPhotoViewerImage();
    if(screen){
      screen.style.display='none';
      screen.setAttribute('aria-hidden','true');
    }
    if(options.restore!==false)restoreOlliTalkPhotoViewerSource(source);
    return true;
  }

  async function hydrateOlliTalkPhotoViewer(item,sequence){
    const attachment=item?.attachment||{};
    const loading=document.getElementById('olliTalkPhotoViewerLoading');
    const preview=document.getElementById('olliTalkPhotoViewerPreview');
    const image=document.getElementById('olliTalkPhotoViewerImage');
    const state=olliTalkPhotoViewerState;
    if(!state||state.sequence!==sequence)return false;

    const controller=new AbortController();
    state.abortController=controller;
    setOlliTalkPhotoViewerProgress({
      phase:'waiting',
      loaded:0,
      total:Math.max(0,Number(attachment?.file_size||0))
    });

    const hasThumbnail=!!String(attachment?.thumbnail_storage_path||'').trim()||Number(attachment?.thumbnail_size||0)>0;
    if(hasThumbnail&&preview){
      getOlliTalkAttachmentPreviewBlobUrl(attachment).then(url=>{
        if(
          !url
          || sequence!==olliTalkPhotoViewerLoadSequence
          || olliTalkPhotoViewerState?.sequence!==sequence
          || olliTalkPhotoViewerState?.originalReady
        )return;
        preview.src=url;
        preview.hidden=false;
      }).catch(()=>{});
    }

    try{
      const url=await getOlliTalkAttachmentBlobUrl(attachment,{
        signal:controller.signal,
        onProgress:progress=>{
          if(
            sequence!==olliTalkPhotoViewerLoadSequence
            || olliTalkPhotoViewerState?.sequence!==sequence
          )return;
          setOlliTalkPhotoViewerProgress(progress);
        }
      });
      if(
        sequence!==olliTalkPhotoViewerLoadSequence
        || olliTalkPhotoViewerState?.item!==item
        || !getOlliTalkPhotoViewerScreen()?.isConnected
      )return false;

      olliTalkPhotoViewerState.originalReady=true;
      if(image){
        image.src=url;
        image.alt=String(attachment.file_name||'원본 사진');
        image.hidden=false;
        try{
          if(typeof image.decode==='function')await image.decode();
        }catch(_){}
      }

      if(
        sequence!==olliTalkPhotoViewerLoadSequence
        || olliTalkPhotoViewerState?.item!==item
      )return false;
      if(preview)preview.hidden=true;
      if(loading)loading.hidden=true;
      return true;
    }catch(error){
      if(error?.name==='AbortError')return false;
      if(sequence!==olliTalkPhotoViewerLoadSequence)return false;
      if(loading){
        loading.hidden=false;
        const text=document.getElementById('olliTalkPhotoViewerProgressText');
        if(text)text.textContent=error?.message||'원본 사진을 불러오지 못했어요.';
      }
      return false;
    }finally{
      if(olliTalkPhotoViewerState?.sequence===sequence&&olliTalkPhotoViewerState?.abortController===controller){
        olliTalkPhotoViewerState.abortController=null;
      }
    }
  }

  function openOlliTalkPhotoViewer(item,options={}){
    const attachment=item?.attachment||{};
    if(!isOlliTalkImageAttachment(attachment))return false;

    const screen=getOlliTalkPhotoViewerScreen();
    if(!screen)return false;
    const source=options?.source==='archive'?'archive':'chat';
    const talk=getScreen();
    const archive=document.getElementById('olliTalkArchiveScreen');
    const sender=document.getElementById('olliTalkPhotoViewerSender');
    const date=document.getElementById('olliTalkPhotoViewerDate');
    const deleteItem=document.getElementById('olliTalkPhotoViewerDeleteItem');

    getOlliTalkBetaInput()?.blur();
    closeOlliTalkSearch({blur:false});
    clearOlliTalkPhotoViewerImage();

    if(sender)sender.textContent=String(item?.sender_name||'선생님').trim()||'선생님';
    if(date)date.textContent=formatOlliTalkPhotoViewerDate(item?.created_at);
    if(deleteItem)deleteItem.hidden=!canDeleteOlliTalkImageItem(item);

    if(talk){talk.style.display='none';talk.setAttribute('aria-hidden','true')}
    if(archive){archive.style.display='none';archive.setAttribute('aria-hidden','true')}
    screen.style.display='flex';
    screen.setAttribute('aria-hidden','false');

    const sequence=++olliTalkPhotoViewerLoadSequence;
    olliTalkPhotoViewerState={item,source,sequence,abortController:null,originalReady:false};
    setOlliTalkPhotoViewerProgress({
      phase:'waiting',
      loaded:0,
      total:Math.max(0,Number(attachment?.file_size||0))
    });
    hydrateOlliTalkPhotoViewer(item,sequence).catch(()=>{});
    return true;
  }

  async function saveOlliTalkPhotoViewer(event){
    if(event){event.preventDefault();event.stopPropagation()}
    const attachment=olliTalkPhotoViewerState?.item?.attachment;
    if(!attachment)return false;
    return downloadOlliTalkAttachment(attachment);
  }

  async function deleteOlliTalkPhotoViewer(event){
    if(event){event.preventDefault();event.stopPropagation()}
    const state=olliTalkPhotoViewerState;
    if(!state?.item)return false;
    const button=document.getElementById('olliTalkPhotoViewerDeleteBtn');
    const source=state.source;
    const ok=await deleteOlliTalkImageItem(state.item,button);
    if(!ok)return false;

    closeOlliTalkPhotoViewer(null,{restore:true});
    if(source==='archive'){
      renderOlliTalkArchive();
    }else if(olliTalkCurrentPayload){
      renderOlliTalkServerMessages(olliTalkCurrentPayload,{scrollMode:'preserve'});
    }
    return true;
  }

  function openOlliTalkPhotoReviewFromViewer(event){
    if(event){event.preventDefault();event.stopPropagation()}
    if(!olliTalkPhotoViewerState)return false;

    closeOlliTalkPhotoViewer(null,{restore:false});
    const talk=getScreen();
    const archive=document.getElementById('olliTalkArchiveScreen');
    if(talk){talk.style.display='flex';talk.setAttribute('aria-hidden','false')}
    if(archive){archive.style.display='none';archive.setAttribute('aria-hidden','true')}
    return openOlliTalkArchivePage(null,{tab:'media'});
  }

  function isOlliTalkImageAttachment(attachment){
    const mime=String(attachment?.mime_type||'').toLowerCase();
    if(mime.startsWith('image/')) return true;
    return /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i.test(String(attachment?.file_name||''));
  }

  function getOlliTalkImageViewportObserver(kind='chat'){
    const archiveMode=kind==='archive';
    let observer=archiveMode?olliTalkArchiveImageViewportObserver:olliTalkChatImageViewportObserver;
    if(observer)return observer;
    if(typeof window.IntersectionObserver!=='function')return null;

    const observerRoot=archiveMode
      ? document.getElementById('olliTalkArchiveBody')
      : document.getElementById('olliTalkBetaChatArea');

    observer=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{
        const target=entry.target;
        if(!target)return;
        const wanted=!!entry.isIntersecting;
        target.dataset.olliViewportWanted=wanted?'1':'0';

        if(wanted){
          if(target.dataset.olliViewportHydrated==='1'||target.dataset.olliViewportLoading==='1')return;
          const hydrate=target.__olliTalkViewportHydrate;
          if(typeof hydrate!=='function')return;
          target.dataset.olliViewportLoading='1';
          Promise.resolve().then(()=>hydrate()).then(success=>{
            target.dataset.olliViewportLoading='';
            if(success!==false)target.dataset.olliViewportHydrated='1';
            if(target.dataset.olliViewportWanted!=='1'){
              try{target.__olliTalkViewportRelease?.()}catch(_){}
              target.dataset.olliViewportHydrated='0';
            }
          }).catch(()=>{
            target.dataset.olliViewportLoading='';
          });
          return;
        }

        if(target.dataset.olliViewportHydrated==='1'){
          try{target.__olliTalkViewportRelease?.()}catch(_){}
          target.dataset.olliViewportHydrated='0';
        }
      });
    },{
      root:observerRoot||null,
      rootMargin:'900px 0px 900px 0px',
      threshold:0.01
    });

    if(archiveMode)olliTalkArchiveImageViewportObserver=observer;
    else olliTalkChatImageViewportObserver=observer;
    return observer;
  }

  function disconnectOlliTalkImageViewportObserver(kind='chat'){
    const archiveMode=kind==='archive';
    const observer=archiveMode?olliTalkArchiveImageViewportObserver:olliTalkChatImageViewportObserver;
    try{observer?.disconnect?.()}catch(_){}
    if(archiveMode)olliTalkArchiveImageViewportObserver=null;
    else olliTalkChatImageViewportObserver=null;
  }

  function observeOlliTalkImageViewportTarget(target,kind,hydrate,release){
    if(!target)return false;
    target.__olliTalkViewportHydrate=hydrate;
    target.__olliTalkViewportRelease=release;
    target.dataset.olliViewportHydrated='0';
    target.dataset.olliViewportWanted='0';

    const observer=getOlliTalkImageViewportObserver(kind);
    if(observer){
      observer.observe(target);
      return true;
    }

    target.dataset.olliViewportWanted='1';
    Promise.resolve().then(()=>hydrate()).then(success=>{
      if(success!==false)target.dataset.olliViewportHydrated='1';
    }).catch(()=>{});
    return true;
  }

  function releaseOlliTalkAttachmentImageFrame(frame,image){
    if(!frame||!image)return;
    image.hidden=true;
    image.removeAttribute('src');
    const fallback=frame.querySelector('.olliTalkBetaAttachmentImageFallback');
    if(fallback){
      fallback.hidden=false;
      fallback.textContent='이미지 불러오는 중…';
    }
    frame.classList.remove('ready','error');
  }

  function loadOlliTalkThumbnailIntoImage(image,url){
    return new Promise((resolve,reject)=>{
      if(!image||!url){
        reject(new Error('썸네일 주소가 없습니다.'));
        return;
      }
      let settled=false;
      const cleanup=()=>{
        image.onload=null;
        image.onerror=null;
      };
      const fail=()=>{
        if(settled)return;
        settled=true;
        cleanup();
        image.hidden=true;
        image.removeAttribute('src');
        reject(new Error('썸네일 이미지를 표시하지 못했습니다.'));
      };
      const ready=()=>{
        if(settled)return;
        if(!Number(image.naturalWidth||0)||!Number(image.naturalHeight||0)){
          fail();
          return;
        }
        settled=true;
        cleanup();
        resolve(true);
      };
      image.hidden=true;
      image.onload=ready;
      image.onerror=fail;
      image.src=url;
      if(image.complete){
        Promise.resolve().then(()=>{
          if(Number(image.naturalWidth||0)&&Number(image.naturalHeight||0))ready();
        });
      }
    });
  }

  async function hydrateOlliTalkAttachmentImage(frame,image,attachment){
    try{
      const id=String(attachment?.id||'');
      const resolved=id
        ? (getOlliTalkResolvedBlobUrl(olliTalkAttachmentPreviewResolvedBlobUrls,id)
          || (olliTalkAttachmentPreviewFallbackIds.has(id)
            ? getOlliTalkResolvedBlobUrl(olliTalkAttachmentResolvedBlobUrls,id)
            : ''))
        : '';
      const url=resolved||await getOlliTalkAttachmentPreviewBlobUrl(attachment);
      if(!frame?.isConnected||frame.dataset.olliViewportWanted==='0')return false;

      await loadOlliTalkThumbnailIntoImage(image,url);
      if(!frame?.isConnected||frame.dataset.olliViewportWanted==='0'){
        image.hidden=true;
        image.removeAttribute('src');
        return false;
      }

      image.hidden=false;
      const fallback=frame.querySelector('.olliTalkBetaAttachmentImageFallback');
      if(fallback)fallback.hidden=true;
      frame.classList.remove('error');
      frame.classList.add('ready');
      return true;
    }catch(_){
      if(!frame?.isConnected||frame.dataset.olliViewportWanted==='0')return false;
      image.hidden=true;
      image.removeAttribute('src');
      const fallback=frame.querySelector('.olliTalkBetaAttachmentImageFallback');
      if(fallback){
        fallback.hidden=false;
        fallback.textContent='이미지를 불러오지 못했어요.';
      }
      frame.classList.remove('ready');
      frame.classList.add('error');
      return false;
    }
  }

  function observeOlliTalkAttachmentImage(frame,image,attachment){
    return observeOlliTalkImageViewportTarget(
      frame,
      'chat',
      ()=>hydrateOlliTalkAttachmentImage(frame,image,attachment),
      ()=>releaseOlliTalkAttachmentImageFrame(frame,image)
    );
  }

  function createOlliTalkAttachmentMessageBubble(item, options = {}){
    const attachment=item?.attachment||{};
    const bubble=document.createElement('div');
    bubble.className='olliTalkBetaBubble olliTalkBetaAttachmentBubble';

    if(isOlliTalkImageAttachment(attachment)){
      bubble.classList.add('olliTalkBetaImageAttachmentBubble');
      const frame=document.createElement('div');
      frame.className='olliTalkBetaAttachmentImageFrame';
      const imageWidth=Math.max(0,Number(attachment?.image_width||0));
      const imageHeight=Math.max(0,Number(attachment?.image_height||0));
      if(imageWidth&&imageHeight)frame.style.aspectRatio=`${imageWidth} / ${imageHeight}`;
      const fallback=createMessageText('span','olliTalkBetaAttachmentImageFallback','이미지 불러오는 중…');
      const image=document.createElement('img');
      image.className='olliTalkBetaAttachmentImage';
      image.alt='';
      image.setAttribute('aria-hidden','true');
      image.loading='lazy';
      image.decoding='async';
      image.hidden=true;
      frame.append(fallback,image);
      frame.setAttribute('role','button');
      frame.setAttribute('tabindex','0');
      frame.setAttribute('aria-label','원본 사진 보기');
      frame.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        openOlliTalkPhotoViewer(item,{source:'chat'});
      });
      frame.addEventListener('keydown',event=>{
        if(event.key!=='Enter'&&event.key!==' ')return;
        event.preventDefault();
        event.stopPropagation();
        openOlliTalkPhotoViewer(item,{source:'chat'});
      });
      bubble.appendChild(frame);
      if(options.deferHydration===true){
        frame.dataset.olliDeferredImage='1';
        frame.__olliTalkAttachment=attachment;
        frame.__olliTalkImage=image;
      }else{
        observeOlliTalkAttachmentImage(frame,image,attachment);
      }
      return bubble;
    }

    const card=document.createElement('button');
    card.type='button';card.className='olliTalkBetaAttachmentCard';
    card.appendChild(createMessageText('span','olliTalkBetaAttachmentIcon',getOlliTalkFileExtension(attachment.file_name)));
    const info=document.createElement('span');
    info.appendChild(createMessageText('span','olliTalkBetaAttachmentName',String(attachment.file_name||item?.body||'파일')));
    info.appendChild(createMessageText('span','olliTalkBetaAttachmentMeta',formatOlliTalkArchiveBytes(attachment.file_size)));
    card.appendChild(info);card.addEventListener('click',()=>downloadOlliTalkAttachment(attachment));
    bubble.appendChild(card);return bubble;
  }
  function getOlliTalkArchiveCacheKey(academyId){
    const safeAcademyId=String(academyId||'').trim();
    return safeAcademyId?(OLLI_TALK_ARCHIVE_CACHE_PREFIX+safeAcademyId):'';
  }
  function readOlliTalkArchiveCache(context=getOlliTalkBetaContext()){
    const academyId=resolveOlliTalkCachedAcademyId(context?.academyId);
    const key=getOlliTalkArchiveCacheKey(academyId);
    if(!key)return null;
    try{
      const raw=localStorage.getItem(key);
      const cached=raw?JSON.parse(raw):null;
      if(!cached||String(cached.academy_id||'')!==academyId)return null;
      const accountId=getOlliTalkLocalAccountId();
      if(accountId&&String(cached.account_id||'')!==accountId)return null;
      return{
        ok:true,
        academy_id:cached.academy_id,
        messages:Array.isArray(cached.messages)?cached.messages:[],
        cached_at:cached.cached_at||''
      };
    }catch(_){return null}
  }
  function writeOlliTalkArchiveCache(context,payload){
    const academyId=resolveOlliTalkCachedAcademyId(context?.academyId||payload?.academy_id);
    const key=getOlliTalkArchiveCacheKey(academyId);
    if(!key||!payload)return false;
    try{
      localStorage.setItem(key,JSON.stringify({
        academy_id:academyId,
        account_id:getOlliTalkLocalAccountId(),
        messages:Array.isArray(payload.messages)?payload.messages:[],
        cached_at:new Date().toISOString()
      }));
      rememberOlliTalkLastCacheContext(academyId);
      return true;
    }catch(_){return false}
  }
  function areOlliTalkArchivePayloadsEquivalent(left,right){
    if(!left||!right)return false;
    try{
      return JSON.stringify(Array.isArray(left.messages)?left.messages:[])===JSON.stringify(Array.isArray(right.messages)?right.messages:[]);
    }catch(_){return false}
  }
  function renderOlliTalkArchiveCache(context=getOlliTalkBetaContext()){
    const cached=readOlliTalkArchiveCache(context);
    if(!cached)return null;
    olliTalkArchivePayload=cached;
    renderOlliTalkArchive();
    return cached;
  }
  function getOlliTalkArchiveMessages(){
    return Array.isArray(olliTalkArchivePayload?.messages)?olliTalkArchivePayload.messages:[];
  }
  function groupOlliTalkArchiveItems(items){
    const groups=[];let key='';let group=null;
    items.forEach(item=>{
      const next=getOlliTalkDateKey(item?.created_at);
      if(next!==key){key=next;group={key,label:formatOlliTalkArchiveDate(item?.created_at),items:[]};groups.push(group)}
      group.items.push(item);
    });
    return groups;
  }
  function createOlliTalkArchiveEmpty(text){return createMessageText('div','olliTalkArchiveEmpty',text)}
  function createOlliTalkArchiveSection(label){
    const section=document.createElement('section');section.className='olliTalkArchiveSection';
    section.appendChild(createMessageText('div','olliTalkArchiveDate',label));return section;
  }
  function releaseOlliTalkArchiveMedia(button){
    if(!button)return;
    button.querySelector('.olliTalkArchiveMediaImage')?.remove();
    const fallback=button.querySelector('.olliTalkArchiveMediaFallback');
    if(fallback)fallback.hidden=false;
  }

  async function hydrateOlliTalkArchiveMedia(button,attachment){
    if(!isOlliTalkImageAttachment(attachment))return false;
    try{
      const id=String(attachment?.id||'');
      const resolved=id
        ? (getOlliTalkResolvedBlobUrl(olliTalkAttachmentPreviewResolvedBlobUrls,id)
          || (olliTalkAttachmentPreviewFallbackIds.has(id)
            ? getOlliTalkResolvedBlobUrl(olliTalkAttachmentResolvedBlobUrls,id)
            : ''))
        : '';
      const url=resolved||await getOlliTalkAttachmentPreviewBlobUrl(attachment);
      if(!button?.isConnected||button.dataset.olliViewportWanted==='0')return false;

      let img=button.querySelector('.olliTalkArchiveMediaImage');
      if(!img){
        img=document.createElement('img');
        img.className='olliTalkArchiveMediaImage';
        img.alt='';
        img.setAttribute('aria-hidden','true');
        img.loading='lazy';
        img.decoding='async';
        img.hidden=true;
        button.appendChild(img);
      }
      await loadOlliTalkThumbnailIntoImage(img,url);
      if(!button?.isConnected||button.dataset.olliViewportWanted==='0'){
        img.remove();
        return false;
      }
      img.hidden=false;
      const fallback=button.querySelector('.olliTalkArchiveMediaFallback');
      if(fallback)fallback.hidden=true;
      return true;
    }catch(_){
      if(!button?.isConnected||button.dataset.olliViewportWanted==='0')return false;
      const img=button.querySelector('.olliTalkArchiveMediaImage');
      if(img)img.remove();
      const fallback=button.querySelector('.olliTalkArchiveMediaFallback');
      if(fallback){
        fallback.hidden=false;
        fallback.textContent='이미지를 불러오지 못했어요.';
      }
      return false;
    }
  }

  function observeOlliTalkArchiveMedia(button,attachment){
    if(!isOlliTalkImageAttachment(attachment))return false;
    return observeOlliTalkImageViewportTarget(
      button,
      'archive',
      ()=>hydrateOlliTalkArchiveMedia(button,attachment),
      ()=>releaseOlliTalkArchiveMedia(button)
    );
  }

  function renderOlliTalkArchiveMedia(body,items,options={}){
    const media=items.filter(item=>item?.attachment?.kind==='media');
    if(!media.length){body.appendChild(createOlliTalkArchiveEmpty('채팅에 공유된 사진이나 동영상이 아직 없어요.'));return}
    groupOlliTalkArchiveItems(media).forEach(group=>{
      const section=createOlliTalkArchiveSection(group.label),grid=document.createElement('div');grid.className='olliTalkArchiveMediaGrid';
      group.items.forEach(item=>{
        const attachment=item.attachment,button=document.createElement('button');
        button.type='button';button.className='olliTalkArchiveMediaItem';
        button.appendChild(createMessageText('span','olliTalkArchiveMediaFallback',attachment.file_name||'미디어'));
        button.addEventListener('click',()=>{
          if(isOlliTalkImageAttachment(attachment))openOlliTalkPhotoViewer(item,{source:'archive'});
          else downloadOlliTalkAttachment(attachment);
        });grid.appendChild(button);
        if(options.deferHydration===true){
          button.dataset.olliArchiveDeferredMedia='1';
          button.__olliTalkArchiveAttachment=attachment;
        }else{
          observeOlliTalkArchiveMedia(button,attachment);
        }
      });
      section.appendChild(grid);body.appendChild(section);
    });
  }
  function renderOlliTalkArchiveFiles(body,items){
    const files=items.filter(item=>item?.attachment?.kind==='file');
    if(!files.length){body.appendChild(createOlliTalkArchiveEmpty('올려둔 수업 레시피가 아직 없어요.'));return}
    groupOlliTalkArchiveItems(files).forEach(group=>{
      const section=createOlliTalkArchiveSection(group.label),list=document.createElement('div');list.className='olliTalkArchiveFileList';
      group.items.forEach(item=>{
        const attachment=item.attachment,row=document.createElement('button');row.type='button';row.className='olliTalkArchiveFileRow';
        row.appendChild(createMessageText('span','olliTalkArchiveFileIcon',getOlliTalkFileExtension(attachment.file_name)));
        const info=document.createElement('span');
        info.appendChild(createMessageText('div','olliTalkArchiveFileName',attachment.file_name||item.body||'파일'));
        info.appendChild(createMessageText('div','olliTalkArchiveFileMeta',formatOlliTalkArchiveBytes(attachment.file_size)));
        row.appendChild(info);row.addEventListener('click',()=>openOlliTalkArchiveFile(attachment));list.appendChild(row);
      });
      section.appendChild(list);body.appendChild(section);
    });
  }
  function hydrateOlliTalkArchiveDeferredMedia(){
    const screen=document.getElementById('olliTalkArchiveScreen');
    if(!screen)return false;
    screen.querySelectorAll('[data-olli-archive-deferred-media="1"]').forEach(button=>{
      button.removeAttribute('data-olli-archive-deferred-media');
      const attachment=button.__olliTalkArchiveAttachment;
      delete button.__olliTalkArchiveAttachment;
      if(attachment)observeOlliTalkArchiveMedia(button,attachment);
    });
    return true;
  }

  function renderOlliTalkArchive(options={}){
    const screen=document.getElementById('olliTalkArchiveScreen'),body=document.getElementById('olliTalkArchiveBody'),meta=document.getElementById('olliTalkArchiveMeta'),upload=document.getElementById('olliTalkArchiveUploadBtn'),createButton=document.getElementById('olliTalkArchiveMaterialCreateBtn');
    if(!screen||!body||!meta||!upload)return;
    disconnectOlliTalkImageViewportObserver('archive');

    screen.querySelectorAll('[data-archive-tab]').forEach(button=>{
      const active=button.dataset.archiveTab===olliTalkArchiveTab;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',active?'true':'false');
    });

    const materialMode=olliTalkArchiveTab==='materials';
    meta.hidden=materialMode;
    upload.hidden=olliTalkArchiveTab!=='files';
    if(createButton)createButton.hidden=!materialMode;

    if(!materialMode){
      try{window.OlliMobileTeamTalkMaterialOrders?.destroy?.()}catch(_){}
    }
    body.replaceChildren();

    if(materialMode){
      const materialOrders=window.OlliMobileTeamTalkMaterialOrders;
      if(!materialOrders?.mount){
        body.appendChild(createOlliTalkArchiveEmpty('커피 주문 기능을 불러오지 못했어요.'));
        return;
      }
      materialOrders.mount(body,{localOnly:options.localOnly===true}).catch(error=>{
        console.warn('팀톡 재료주문 화면 시작 실패:',error);
        if(body.isConnected)body.replaceChildren(createOlliTalkArchiveEmpty('커피 주문을 불러오지 못했어요.'));
      });
      body.scrollTop=0;
      return;
    }

    const items=getOlliTalkArchiveMessages();
    const counts={
      media:items.filter(item=>item?.attachment?.kind==='media').length,
      files:items.filter(item=>item?.attachment?.kind==='file').length
    };
    meta.textContent=(counts[olliTalkArchiveTab]||0)+'개';
    if(olliTalkArchiveTab==='media')renderOlliTalkArchiveMedia(body,items,options);
    else renderOlliTalkArchiveFiles(body,items);
    body.scrollTop=0;
  }

  async function markOlliTalkMaterialNotificationsRead(){
    const context=getOlliTalkBetaContext();
    if(!context.sessionToken||!context.academyId)return false;
    try{
      const payload=await callOlliTalkRpc('olli_mobile_work_mark_material_read',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId
      });
      if(!payload?.ok)return false;
      olliTalkLastUnreadMaterialCount=0;
      document.querySelectorAll('.olliTalkBetaMaterialConfirmCard .olliTalkBetaActionButton').forEach(button=>{
        button.disabled=true;
        button.textContent='확인됨';
        button.classList.add('confirmed');
      });
      await refreshOlliTalkMentionBadge();
      return true;
    }catch(error){
      console.warn('재료주문 알림 읽음 처리 실패:',error);
      return false;
    }
  }

  function setOlliTalkArchiveTab(tab){
    if(!['media','files','materials'].includes(tab))return;
    olliTalkArchiveTab=tab;
    renderOlliTalkArchive();
    const archive=document.getElementById('olliTalkArchiveScreen');
    if(tab==='materials'&&archive&&archive.style.display!=='none'){
      markOlliTalkMaterialNotificationsRead().catch(()=>{});
    }
  }
  async function loadOlliTalkArchive(options={}){
    const sequence=++olliTalkArchiveLoadSequence,context=getOlliTalkBetaContext(),body=document.getElementById('olliTalkArchiveBody'),meta=document.getElementById('olliTalkArchiveMeta');
    const cachedPayload=readOlliTalkArchiveCache(context);
    const renderedLocal=!!cachedPayload;
    if(cachedPayload&&options.renderLocal!==false){
      olliTalkArchivePayload=cachedPayload;
      renderOlliTalkArchive();
    }else if(!cachedPayload&&options.renderLocal!==false){
      if(olliTalkArchiveTab==='materials')renderOlliTalkArchive();
      else{
        if(body)body.replaceChildren(createOlliTalkArchiveEmpty('자료를 불러오는 중이에요.'));
        if(meta)meta.textContent='';
      }
    }
    if(!context.sessionToken||!context.academyId){
      const retryCount=Number(options.contextRetry||0);
      if(retryCount<10){
        setTimeout(()=>{
          const archive=document.getElementById('olliTalkArchiveScreen');
          if(!archive||archive.style.display==='none')return;
          loadOlliTalkArchive({...options,renderLocal:false,contextRetry:retryCount+1}).catch(()=>{});
        },220);
      }
      return renderedLocal||olliTalkArchiveTab==='materials';
    }
    try{
      const payload=await callOlliTalkRpc('olli_team_chat_archive',{p_session_token:context.sessionToken,p_academy_id:context.academyId,p_limit:1000});
      if(sequence!==olliTalkArchiveLoadSequence)return false;
      if(!payload?.ok)throw new Error(payload?.message||'자료실을 불러오지 못했습니다.');
      const changed=!areOlliTalkArchivePayloadsEquivalent(cachedPayload,payload);
      olliTalkArchivePayload=payload;
      writeOlliTalkArchiveCache(context,payload);
      if(olliTalkArchiveTab!=='materials'&&changed)renderOlliTalkArchive();
      return true;
    }catch(error){
      if(!renderedLocal&&olliTalkArchiveTab!=='materials'&&body)body.replaceChildren(createOlliTalkArchiveEmpty('자료실을 불러오지 못했어요.'));
      console.warn('팀톡 자료실 조회 실패:',error);
      return false;
    }
  }
  function openOlliTalkArchivePage(event,options={}){
    if(event){event.preventDefault();event.stopPropagation()}
    const input=getOlliTalkBetaInput();if(input)input.blur();closeOlliTalkSearch({blur:false});
    const talk=getScreen(),archive=document.getElementById('olliTalkArchiveScreen');if(!archive)return;

    const requestedTab=String(options?.tab||'').trim();
    if(['media','files','materials'].includes(requestedTab))olliTalkArchiveTab=requestedTab;

    // 현재 탭의 로컬 내용을 먼저 완성한 뒤 Work Hub를 공개합니다.
    const context=getOlliTalkBetaContext();
    const body=document.getElementById('olliTalkArchiveBody'),meta=document.getElementById('olliTalkArchiveMeta');
    const cachedArchive=readOlliTalkArchiveCache(context);
    olliTalkArchivePayload=cachedArchive||null;

    if(olliTalkArchiveTab==='materials'){
      renderOlliTalkArchive({localOnly:true,deferHydration:true});
    }else if(cachedArchive){
      renderOlliTalkArchive({localOnly:true,deferHydration:true});
    }else{
      if(body)body.replaceChildren(createOlliTalkArchiveEmpty('자료를 불러오는 중이에요.'));
      if(meta)meta.textContent='';
    }

    if(talk){talk.style.display='none';talk.setAttribute('aria-hidden','true')}
    disconnectOlliTalkImageViewportObserver('chat');
    archive.style.display='flex';archive.setAttribute('aria-hidden','false');
    if(olliTalkArchiveTab==='materials'){
      markOlliTalkMaterialNotificationsRead().catch(()=>{});
    }

    requestAnimationFrame(()=>{
      setTimeout(()=>{
        if(!archive.isConnected||archive.style.display==='none')return;

        if(olliTalkArchiveTab==='materials'){
          window.OlliMobileTeamTalkMaterialOrders?.activate?.().catch?.(()=>{});
        }else{
          hydrateOlliTalkArchiveDeferredMedia();
        }
        loadOlliTalkArchive({renderLocal:false});
      },0);
    });
    return true;
  }

  function openOlliTalkQuickOrder(event){
    if(event){
      event.preventDefault();
      event.stopPropagation();
    }
    const input=getOlliTalkBetaInput();
    if(input)input.blur();
    closeOlliTalkSearch({blur:false});

    const materialOrders=window.OlliMobileTeamTalkMaterialOrders;
    if(!materialOrders?.openQuickOrder){
      alert('재료 요청 기능을 불러오지 못했습니다.');
      return false;
    }
    return materialOrders.openQuickOrder();
  }

  function setOlliTalkArchiveFileLoading(active,attachment){
    const overlay=document.getElementById('olliTalkArchiveFileLoading');
    if(!overlay)return;
    overlay.hidden=!active;
    if(active){
      setOlliTalkArchiveFileProgress({
        phase:'waiting',
        loaded:0,
        total:Math.max(0,Number(attachment?.file_size||0))
      });
    }
  }

  function cancelOlliTalkArchiveFileTransfer(event){
    if(event){event.preventDefault();event.stopPropagation()}
    const active=olliTalkArchiveFileTransferState;
    olliTalkArchiveFileTransferState=null;
    olliTalkArchiveFileTransferSequence+=1;
    try{active?.controller?.abort()}catch(_){}
    setOlliTalkArchiveFileLoading(false);
    return true;
  }

  async function openOlliTalkArchiveFile(attachment){
    if(!attachment)return false;
    if(olliTalkArchiveFileTransferState)cancelOlliTalkArchiveFileTransfer();

    const sequence=++olliTalkArchiveFileTransferSequence;
    const controller=new AbortController();
    olliTalkArchiveFileTransferState={sequence,controller,attachment};
    setOlliTalkArchiveFileLoading(true,attachment);

    try{
      const url=await getOlliTalkAttachmentBlobUrl(attachment,{
        signal:controller.signal,
        onProgress:progress=>{
          if(olliTalkArchiveFileTransferState?.sequence!==sequence)return;
          setOlliTalkArchiveFileProgress(progress);
        }
      });
      if(olliTalkArchiveFileTransferState?.sequence!==sequence)return false;
      olliTalkArchiveFileTransferState=null;
      setOlliTalkArchiveFileLoading(false);
      return triggerOlliTalkAttachmentDownload(url,attachment);
    }catch(error){
      if(olliTalkArchiveFileTransferState?.sequence===sequence){
        olliTalkArchiveFileTransferState=null;
        setOlliTalkArchiveFileLoading(false);
      }
      if(error?.name==='AbortError')return false;
      alert(error?.message||'파일을 내려받지 못했습니다.');
      return false;
    }
  }

  function closeOlliTalkArchivePage(event){
    if(event){event.preventDefault();event.stopPropagation()}
    if(olliTalkArchiveFileTransferState)cancelOlliTalkArchiveFileTransfer();
    try{window.OlliMobileTeamTalkMaterialOrders?.destroy?.()}catch(_){}
    const archive=document.getElementById('olliTalkArchiveScreen'),talk=getScreen();
    if(archive){archive.style.display='none';archive.setAttribute('aria-hidden','true')}
    if(talk){talk.style.display='flex';talk.setAttribute('aria-hidden','false')}
    syncOlliTalkComposerViewport();syncViewport();scheduleOlliTalkChatToComposer();
  }
  async function callOlliTalkFileApi(action,payload,context){
    const response=await fetch('/api/team-talk-file',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-Olli-Session-Token':context.sessionToken,
        'X-Olli-Academy-Id':context.academyId
      },
      body:JSON.stringify({action,...payload})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data?.ok)throw new Error(data?.error||data?.message||'파일 요청에 실패했습니다.');
    return data;
  }

  async function uploadOlliTalkArchiveFile(file,options={}){
    const context=getOlliTalkBetaContext();
    const refresh=options.refresh!==false;
    const button=options.manageArchiveButton===false?null:document.getElementById('olliTalkArchiveUploadBtn');
    if(!file||!context.sessionToken||!context.academyId)return false;
    const maxBytes=20*1024*1024;
    if(file.size>maxBytes){alert('수업 레시피 파일은 20MB 이하만 올릴 수 있습니다.');return false}
    if(button){button.classList.add('uploading');button.textContent='올리는 중...'}

    let prepared=null;
    let thumbnail=null;
    let thumbnailUploaded=false;
    try{
      const isImage=!!window.OlliTalkImageThumbnailPhone?.isImageFile?.(file)||/^image\//i.test(String(file.type||''));
      const uploadKind=(isImage||/^video\//i.test(String(file.type||'')))?'media':'file';
      if(isImage&&window.OlliTalkImageThumbnailPhone?.create){
        try{thumbnail=await window.OlliTalkImageThumbnailPhone.create(file)}
        catch(error){console.warn('Team Chat 썸네일 준비 실패:',error?.message||error)}
      }

      prepared=await callOlliTalkFileApi('prepare',{
        fileName:file.name||'file',
        mimeType:file.type||'application/octet-stream',
        fileSize:file.size,
        kind:uploadKind,
        thumbnail:thumbnail?{
          mimeType:thumbnail.mimeType,
          fileSize:thumbnail.bytes
        }:null
      },context);

      const form=new FormData();
      form.append('cacheControl','3600');
      form.append('',file,file.name||'file');

      const uploadResponse=await fetch(prepared.uploadUrl,{
        method:'PUT',
        headers:{'x-upsert':'false'},
        body:form
      });
      if(!uploadResponse.ok){
        let detail='';
        try{detail=await uploadResponse.text()}catch(_){}
        throw new Error(detail||'파일 저장에 실패했습니다.');
      }

      if(thumbnail&&prepared.thumbnailUploadUrl&&prepared.thumbnailObjectPath){
        try{
          const thumbnailForm=new FormData();
          thumbnailForm.append('cacheControl','31536000');
          thumbnailForm.append('',thumbnail.blob,thumbnail.fileName);
          const thumbnailResponse=await fetch(prepared.thumbnailUploadUrl,{
            method:'PUT',
            headers:{'x-upsert':'false'},
            body:thumbnailForm
          });
          if(!thumbnailResponse.ok)throw new Error('썸네일 저장에 실패했습니다.');
          thumbnailUploaded=true;
        }catch(error){
          console.warn('Team Chat 썸네일 업로드 실패, 원본 전송은 계속합니다.',error?.message||error);
          callOlliTalkFileApi('cleanup',{thumbnailObjectPath:prepared.thumbnailObjectPath},context).catch(()=>{});
        }
      }

      const finalized=await callOlliTalkFileApi('finalize',{
        objectPath:prepared.objectPath,
        fileName:file.name||'file',
        mimeType:file.type||'application/octet-stream',
        fileSize:file.size,
        kind:uploadKind,
        thumbnailObjectPath:thumbnailUploaded?prepared.thumbnailObjectPath:null,
        thumbnailMimeType:thumbnailUploaded?thumbnail.mimeType:null,
        thumbnailSize:thumbnailUploaded?thumbnail.bytes:null,
        imageWidth:thumbnail?.imageWidth||null,
        imageHeight:thumbnail?.imageHeight||null
      },context);
      const messageId=Number(finalized?.message?.id||0);
      if(messageId){
        try{
          await registerOlliTalkMessageRecipients(messageId,[],context);
        }catch(error){
          console.warn('올리톡 첨부 알림 대상 저장 실패:',error);
        }
      }

      if(refresh){
        await Promise.all([
          loadOlliTalkArchive(),
          loadOlliTalkBetaMessages({showLoading:false,localFirst:false,scrollMode:'bottom'})
        ]);
      }
      return true;
    }catch(error){
      if(prepared?.objectPath||prepared?.thumbnailObjectPath){
        callOlliTalkFileApi('cleanup',{
          objectPath:prepared?.objectPath||null,
          thumbnailObjectPath:prepared?.thumbnailObjectPath||null
        },context).catch(()=>{});
      }
      alert(error?.message||'파일을 올리지 못했습니다.');
      return false;
    }finally{
      if(button){button.classList.remove('uploading');button.textContent='레시피 파일 올리기'}
    }
  }

  async function uploadOlliTalkComposerFiles(files){
    const list=Array.from(files||[]).filter(Boolean);
    if(!list.length)return false;
    let changed=false;
    for(const file of list){
      const ok=await uploadOlliTalkArchiveFile(file,{refresh:false,manageArchiveButton:false});
      changed=changed||ok;
    }
    if(changed){
      await Promise.all([
        loadOlliTalkArchive(),
        loadOlliTalkBetaMessages({showLoading:false,localFirst:false,scrollMode:'bottom'})
      ]);
    }
    return changed;
  }

  function parseOlliTalkStudentInfoLink(value){
    const text=String(value || '');
    const match=text.match(/\[학생정보 열기\]\(olli-student-info:([^)]+)\)/);
    if(!match) return null;
    let studentId='';
    try{studentId=decodeURIComponent(String(match[1] || ''));}catch(_){studentId=String(match[1] || '');}
    studentId=String(studentId || '').trim();
    if(!studentId) return null;
    return {
      fullMatch:String(match[0] || ''),
      studentId
    };
  }

  function createOlliTalkStudentInfoLinkButton(studentId){
    const button=document.createElement('button');
    button.type='button';
    button.className='olliTalkBetaStudentInfoLinkButton';
    button.textContent='학생정보 열기';
    button.setAttribute('aria-label','학생정보 열기');
    button.addEventListener('click',(event)=>{
      event.preventDefault();
      event.stopPropagation();
      if(typeof window.openStudentInfoById!=='function'){
        alert('학생정보 화면을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const opened=window.openStudentInfoById(String(studentId || ''));
      if(opened===false){
        alert('학생정보 화면을 열지 못했어요. 학생 목록을 새로고침한 뒤 다시 시도해 주세요.');
      }
    });
    return button;
  }

  function createOlliTalkMessageBubble(input, options = {}){
    const item=input&&typeof input==='object'?input:null;
    if(item?.attachment)return createOlliTalkAttachmentMessageBubble(item, options);
    const bubble=document.createElement('div');
    bubble.className='olliTalkBetaBubble';
    const text=String(item?item.body:(input||''));

    const studentInfoLink=parseOlliTalkStudentInfoLink(text);
    if(studentInfoLink){
      bubble.classList.add('olliTalkBetaStudentInfoBubble');
      const leadText=text.replace(studentInfoLink.fullMatch,'').trim();
      if(leadText){
        bubble.appendChild(createMessageText('div','olliTalkBetaStudentInfoLeadText',leadText));
      }
      bubble.appendChild(createOlliTalkStudentInfoLinkButton(studentInfoLink.studentId));
      return bubble;
    }

    const url = getOlliTalkUrlFromText(text);
    if (!url) {
      bubble.textContent = text;
      return bubble;
    }

    bubble.classList.add('olliTalkBetaLinkBubble');
    bubble.dataset.linkUrl = url;

    const leadText = text.replace(url, '').trim();
    if (leadText) {
      bubble.appendChild(createMessageText('div', 'olliTalkBetaLinkLeadText', leadText));
    }
    bubble.appendChild(createOlliTalkLinkPreviewCard(url, options));
    return bubble;
  }

  function hydrateOlliTalkDeferredFirstPaintAssets(){
    const screen=getScreen();
    if(!screen)return false;

    screen.querySelectorAll('[data-olli-deferred-preview="1"]').forEach(card=>{
      card.removeAttribute('data-olli-deferred-preview');
      const url=String(card.dataset.previewUrl||'').trim();
      if(url)hydrateOlliTalkLinkPreview(card,url);
    });

    screen.querySelectorAll('[data-olli-deferred-image="1"]').forEach(frame=>{
      frame.removeAttribute('data-olli-deferred-image');
      const attachment=frame.__olliTalkAttachment;
      const image=frame.__olliTalkImage;
      delete frame.__olliTalkAttachment;
      delete frame.__olliTalkImage;
      if(attachment&&image)observeOlliTalkAttachmentImage(frame,image,attachment);
    });
    return true;
  }

  function createOlliTalkEmptyState(title, text){
    const wrap = document.createElement('div');
    wrap.className = 'olliTalkBetaEmpty';

    const icon = document.createElement('div');
    icon.className = 'olliTalkBetaEmptyIcon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 48 48"><path d="M10 12.5h28a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H23l-8.5 6v-6H10a5 5 0 0 1-5-5v-14a5 5 0 0 1 5-5Z"></path><path d="M15 24h18"></path></svg>';
    wrap.appendChild(icon);
    wrap.appendChild(createMessageText('div', 'olliTalkBetaEmptyTitle', title));
    wrap.appendChild(createMessageText('div', 'olliTalkBetaEmptyText', text));
    return wrap;
  }

  function setOlliTalkLoadingState(title = '대화를 불러오는 중이에요'){
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea) return;
    chatArea.replaceChildren(createOlliTalkEmptyState(title, '잠시만 기다려 주세요.'));
    chatArea.dataset.previewReady = '';
  }

  function getOlliTalkProfile(senderName){
    const rawName = String(senderName || '').trim();
    const normalized = rawName.replace(/\s+/g, '');
    if (normalized === '하주영' || normalized === '루루') {
      return { displayName:'루루', avatar:'olli-talk-profile-hajuyoung.jpg' };
    }
    if (normalized === '영앙' || normalized === '영양' || normalized === '조영아') {
      return { displayName:'조영아', avatar:'olli-talk-profile-joyeonga.jpg' };
    }
    if (normalized === '최민기' || normalized === '원장') {
      return { displayName:'원장', avatar:'', initials:'원장' };
    }
    return { displayName:rawName || '선생님', avatar:'', initials:(rawName || '선생님').slice(0, 1) };
  }

  function createOlliTalkSenderProfile(senderName){
    const profile = getOlliTalkProfile(senderName);
    const sender = document.createElement('div');
    sender.className = 'olliTalkBetaSender';

    const avatar = document.createElement('span');
    avatar.className = 'olliTalkBetaMemberAvatar';
    if (profile.avatar) {
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.src = profile.avatar;
      avatar.appendChild(img);
    } else {
      avatar.classList.add('textAvatar');
      avatar.textContent = profile.initials || profile.displayName.slice(0, 1);
    }

    sender.appendChild(avatar);
    sender.appendChild(createMessageText('span', 'olliTalkBetaSenderName', profile.displayName));
    return sender;
  }

  function normalizeOlliTalkActionPrompt(value){
    return String(value || '')
      .trim()
      .replace(/\n?['‘’\"]?확인['‘’\"]?\s*또는\s*['‘’\"]?취소['‘’\"]?라고\s*입력해\s*주세요\.?/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function getOlliTalkActionPrimaryLabel(){
    return '확인';
  }

  function getOlliTalkActionStatusLabel(status){
    const value=String(status || '').trim();
    if(value==='completed') return '처리 완료';
    if(value==='cancelled') return '취소됨';
    if(value==='failed') return '처리 실패';
    return '';
  }

  function setOlliTalkActionCardBusy(actionId,busy){
    const safe=String(actionId || '').trim();
    if(!safe) return;
    document.querySelectorAll('[data-olli-talk-action-id]').forEach(card=>{
      if(String(card.dataset.olliTalkActionId || '')!==safe) return;
      card.querySelectorAll('button').forEach(button=>{button.disabled=!!busy});
      card.classList.toggle('busy',!!busy);
    });
  }

  async function handleOlliTalkActionCard(action,operation){
    const actionId=String(action?.id || '').trim();
    if(!actionId || olliTalkActionBusy.has(actionId)) return;

    const context=getOlliTalkBetaContext();
    if(!context.sessionToken || !context.academyId){
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    olliTalkActionBusy.add(actionId);
    setOlliTalkActionCardBusy(actionId,true);
    try{
      const rpcName=operation==='execute'
        ? 'olli_team_chat_action_execute'
        : 'olli_team_chat_action_cancel';
      const payload=await callOlliTalkRpc(rpcName,{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId
      });

      if(!payload?.action){
        throw new Error(payload?.message || '작업 상태를 확인하지 못했습니다.');
      }

      if(operation==='execute' && String(payload.action.status || '')==='completed'){
        try{window.OlliPhoneStudentScheduleService?.clearWeekCache?.()}catch(_){}
        try{
          window.dispatchEvent(new CustomEvent('olli:schedule-changed',{
            detail:{source:'team_talk_action',actionId,intent:String(action?.action_type || '')}
          }));
        }catch(_){}
      }

      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });

      if(payload?.ok===false && String(payload?.action?.status || '')!=='failed'){
        alert(payload?.message || '작업을 처리하지 못했습니다.');
      }
    }catch(error){
      console.warn('올리톡 액션 처리 실패:',error);
      alert(error?.message || '작업을 처리하지 못했습니다.');
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
    }finally{
      olliTalkActionBusy.delete(actionId);
      setOlliTalkActionCardBusy(actionId,false);
    }
  }

  async function confirmOlliTalkMaterialMessage(item,button){
    const eventId=Math.max(0,Number(item?.material_event_id||0));
    if(!eventId||button?.disabled)return false;
    const context=getOlliTalkBetaContext();
    if(!context.sessionToken||!context.academyId)return false;

    if(button){
      button.disabled=true;
      button.textContent='확인 중';
    }
    try{
      const payload=await callOlliTalkRpc('olli_mobile_work_mark_material_read_to',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_up_to_event_id:eventId
      });
      if(!payload?.ok)throw new Error(payload?.message||'재료주문 확인을 저장하지 못했습니다.');
      item.material_confirmed=true;
      if(button){
        button.textContent='확인됨';
        button.classList.add('confirmed');
      }
      await refreshOlliTalkMentionBadge();
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
      return true;
    }catch(error){
      console.warn('재료주문 말풍선 확인 실패:',error);
      if(button){
        button.disabled=false;
        button.textContent='확인';
      }
      return false;
    }
  }

  function createOlliTalkMaterialConfirmCard(item){
    const card=document.createElement('div');
    card.className='olliTalkBetaActionCard olliTalkBetaMaterialConfirmCard';
    const button=document.createElement('button');
    button.type='button';
    button.className='olliTalkBetaActionButton primary';
    const confirmed=item?.material_confirmed===true;
    button.textContent=confirmed?'확인됨':'확인';
    button.disabled=confirmed;
    if(confirmed)button.classList.add('confirmed');
    button.addEventListener('click',()=>confirmOlliTalkMaterialMessage(item,button));
    card.appendChild(button);
    return card;
  }

  function createOlliTalkActionCard(action){
    const card=document.createElement('div');
    const status=String(action?.status || 'pending').trim() || 'pending';
    card.className='olliTalkBetaActionCard';
    card.dataset.olliTalkActionId=String(action?.id || '').trim();
    card.dataset.actionStatus=status;

    if(status!=='pending'){
      const label=createMessageText('span','olliTalkBetaActionStatus',getOlliTalkActionStatusLabel(status));
      if(status==='failed') label.classList.add('failed');
      card.appendChild(label);
      return card;
    }

    const cancel=document.createElement('button');
    cancel.type='button';
    cancel.className='olliTalkBetaActionButton secondary';
    cancel.textContent='취소';
    cancel.addEventListener('click',()=>handleOlliTalkActionCard(action,'cancel'));

    const execute=document.createElement('button');
    execute.type='button';
    execute.className='olliTalkBetaActionButton primary';
    execute.textContent=getOlliTalkActionPrimaryLabel(action?.action_type);
    execute.addEventListener('click',()=>handleOlliTalkActionCard(action,'execute'));

    card.append(cancel,execute);
    return card;
  }

  function getOlliTalkReplyTargetIds(messages){
    return new Set((Array.isArray(messages) ? messages : [])
      .filter(item => String(item?.message_type || '').trim() === 'ai' && Number(item?.reply_to_message_id || 0) > 0)
      .map(item => String(Number(item.reply_to_message_id))));
  }

  function shouldOfferOlliTalkReply(item,own,replyTargets){
    const messageId=String(Number(item?.id || 0) || '');
    const body=String(item?.body || '').trim();
    const router=window.OlliCommandRouter;
    if(!own || String(item?.message_type || 'text').trim()!=='text' || item?.attachment) return false;
    if(!messageId || !body || /^\s*@올리(?:\s|$)/.test(body)) return false;
    if(replyTargets?.has?.(messageId)) return false;
    return !!router && typeof router.isOlliReplyCandidate==='function' && router.isOlliReplyCandidate(body);
  }

  function removeOlliTalkReplySuggestion(messageId){
    const id=String(messageId || '').trim();
    if(!id) return;
    const row=Array.from(document.querySelectorAll('#olliTalkBetaChatArea [data-message-id]'))
      .find(node => String(node.dataset.messageId || '').trim()===id);
    row?.querySelector?.('.olliTalkBetaReplySuggestion')?.remove();
  }

  async function handleOlliTalkReplySuggestion(item,button){
    const messageId=String(Number(item?.id || 0) || '');
    const commandText=String(item?.body || '').trim();
    if(!messageId || !commandText || olliTalkOlliReplyBusy.has(messageId)) return;

    const context=getOlliTalkBetaContext();
    if(!context.sessionToken || !context.academyId){
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    const usingAi=isOlliTalkAiEnabled();
    olliTalkOlliReplyBusy.add(messageId);
    button.disabled=true;
    button.textContent='응답 중';

    try{
      if(usingAi){
        olliTalkAssistantReplyPending=true;
        syncOlliTalkAssistantTypingIndicator();
        const turn=await resolveOlliTalkAiTurn(commandText,context,Number(messageId),{allowSuggestedQuery:true});
        olliTalkAssistantReplyPending=false;
        replaceOlliTalkAssistantTypingWithMessage(turn.assistantMessage,context.memberId);
      }else{
        const turn=await resolveOlliTalkBotTurn(commandText,context,Number(messageId),{allowSuggestedQuery:true});
        appendOlliTalkPersistedMessage(turn.assistantMessage,context.memberId);
      }

      removeOlliTalkReplySuggestion(messageId);
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'bottom',
        render:false
      });
    }catch(error){
      console.warn(usingAi ? '올리 응답 버튼 AI 처리 실패:' : '올리 응답 버튼 봇 처리 실패:',error);
      alert('올리 응답을 받지 못했습니다.\n'+(error?.message || error));
      button.disabled=false;
      button.textContent='올리 응답';
    }finally{
      if(olliTalkAssistantReplyPending){
        olliTalkAssistantReplyPending=false;
        syncOlliTalkAssistantTypingIndicator();
      }
      olliTalkOlliReplyBusy.delete(messageId);
    }
  }

  function createOlliTalkReplySuggestion(item){
    const wrap=document.createElement('div');
    wrap.className='olliTalkBetaReplySuggestion';

    const button=document.createElement('button');
    button.type='button';
    button.className='olliTalkBetaReplySuggestionButton';
    button.textContent='올리 응답';
    button.setAttribute('aria-label','이 메시지에 올리 응답 받기');
    button.addEventListener('click',()=>handleOlliTalkReplySuggestion(item,button));

    wrap.appendChild(button);
    return wrap;
  }

  function getOlliTalkMessageGroupKey(item, currentMemberId){
    const type = String(item?.message_type || 'text');
    if (type === 'system') return '';
    if (type === 'ai') return 'ai:olli';
    const senderMemberId = String(item?.sender_member_id || '').trim();
    const currentId = String(currentMemberId || '').trim();
    if (senderMemberId && senderMemberId === currentId) return 'outgoing:' + senderMemberId;
    return 'incoming:' + (senderMemberId || String(item?.sender_name || '').trim() || 'unknown');
  }

  function isOlliTalkConnectedMessage(previousItem, item, currentMemberId){
    if (!previousItem || !item) return false;
    const previousKey = getOlliTalkMessageGroupKey(previousItem, currentMemberId);
    const currentKey = getOlliTalkMessageGroupKey(item, currentMemberId);
    if (!previousKey || previousKey !== currentKey) return false;

    const previousTime = new Date(previousItem?.created_at || 0).getTime();
    const currentTime = new Date(item?.created_at || 0).getTime();
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return false;

    const diff = currentTime - previousTime;
    return diff >= 0 && diff < 60 * 1000;
  }

  function createOlliTalkMessageElement(item, currentMemberId, options = {}){
    const type = String(item?.message_type || 'text');
    const isAi = type === 'ai';
    const own = !isAi && String(item?.sender_member_id || '') === String(currentMemberId || '');
    const message = document.createElement('div');

    if (type === 'system') {
      message.className = 'olliTalkBetaSystemMessage';
      message.textContent = String(item?.body || '');
      message.dataset.dateKey = getOlliTalkDateKey(item?.created_at);
      return message;
    }

    const connectedToPrevious = options.connectedToPrevious === true;
    message.className = 'olliTalkBetaMessage ' + (isAi ? 'ai' : (own ? 'outgoing' : 'incoming'));
    message.classList.add(connectedToPrevious ? 'olliTalkBetaMessageConnected' : 'olliTalkBetaMessageGroupStart');
    message.dataset.messageId = String(item?.id || '');
    message.dataset.dateKey = getOlliTalkDateKey(item?.created_at);

    if (isAi) {
      const incomingLayout = document.createElement('div');
      incomingLayout.className = 'olliTalkBetaIncomingLayout olliTalkBetaAiIncomingLayout';
      const sender = document.createElement('div');
      sender.className = 'olliTalkBetaSender';
      const avatar = document.createElement('span');
      avatar.className = 'olliTalkBetaMemberAvatar olliTalkBetaAiAvatar';
      avatar.textContent = 'Olli';
      avatar.setAttribute('aria-hidden', 'true');
      sender.appendChild(avatar);
      sender.appendChild(createMessageText('span', 'olliTalkBetaSenderName', '올리'));
      incomingLayout.appendChild(sender);
      message.appendChild(incomingLayout);
    } else if (!own) {
      const senderName = String(item?.sender_name || '선생님').trim() || '선생님';
      const incomingLayout = document.createElement('div');
      incomingLayout.className = 'olliTalkBetaIncomingLayout';
      incomingLayout.appendChild(createOlliTalkSenderProfile(senderName));
      message.appendChild(incomingLayout);
    }

    const bubbleRow = document.createElement('div');
    bubbleRow.className = 'olliTalkBetaBubbleRow';
    bubbleRow.appendChild(createOlliTalkMessageBubble(item, options));

    const bubbleMeta = document.createElement('div');
    bubbleMeta.className = 'olliTalkBetaBubbleMeta';
    const unreadCount = isAi ? 0 : Math.max(0, Number(item?.unread_count || 0));
    if (unreadCount > 0) {
      bubbleMeta.appendChild(createMessageText('span', 'olliTalkBetaUnreadCount', String(unreadCount)));
    }
    bubbleMeta.appendChild(createMessageText('div', 'olliTalkBetaMessageTime', formatOlliTalkBetaMessageTime(item?.created_at)));
    bubbleRow.appendChild(bubbleMeta);
    if (isAi || !own) {
      const incomingLayout = message.querySelector('.olliTalkBetaIncomingLayout');
      if (incomingLayout) {
        incomingLayout.appendChild(bubbleRow);
        if (item?.action) incomingLayout.appendChild(createOlliTalkActionCard(item.action));
        if (item?.material_request_id && item?.material_event_id) {
          incomingLayout.appendChild(createOlliTalkMaterialConfirmCard(item));
        }
      } else {
        message.appendChild(bubbleRow);
        if (item?.action) message.appendChild(createOlliTalkActionCard(item.action));
        if (item?.material_request_id && item?.material_event_id) {
          message.appendChild(createOlliTalkMaterialConfirmCard(item));
        }
      }
    } else {
      message.appendChild(bubbleRow);
    }

    if(shouldOfferOlliTalkReply(item,own,options.olliReplyTargetIds)){
      message.appendChild(createOlliTalkReplySuggestion(item));
    }
    return message;
  }

  function createOlliTalkAssistantTypingElement(){
    const message = document.createElement('div');
    message.className = 'olliTalkBetaMessage ai olliTalkBetaMessageGroupStart olliTalkBetaTypingMessage';
    message.dataset.olliAssistantTyping = '1';

    const incomingLayout = document.createElement('div');
    incomingLayout.className = 'olliTalkBetaIncomingLayout olliTalkBetaAiIncomingLayout';

    const sender = document.createElement('div');
    sender.className = 'olliTalkBetaSender';
    const avatar = document.createElement('span');
    avatar.className = 'olliTalkBetaMemberAvatar olliTalkBetaAiAvatar';
    avatar.textContent = 'Olli';
    avatar.setAttribute('aria-hidden', 'true');
    sender.appendChild(avatar);
    sender.appendChild(createMessageText('span', 'olliTalkBetaSenderName', '올리'));

    const bubbleRow = document.createElement('div');
    bubbleRow.className = 'olliTalkBetaBubbleRow';
    const bubble = document.createElement('div');
    bubble.className = 'olliTalkBetaBubble olliTalkBetaTypingBubble';
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-label', '올리가 답변을 작성하는 중');
    for (let index = 0; index < 3; index += 1) {
      const dot = document.createElement('span');
      dot.className = 'olliTalkBetaTypingDot';
      dot.setAttribute('aria-hidden', 'true');
      bubble.appendChild(dot);
    }
    bubbleRow.appendChild(bubble);
    incomingLayout.append(sender, bubbleRow);
    message.appendChild(incomingLayout);
    return message;
  }

  function syncOlliTalkAssistantTypingIndicator(){
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea) return;
    chatArea.querySelectorAll('[data-olli-assistant-typing]').forEach(node => node.remove());
    if (!olliTalkAssistantReplyPending) return;

    let list = chatArea.querySelector('.olliTalkBetaMessageList');
    if (!list) {
      list = document.createElement('div');
      list.className = 'olliTalkBetaMessageList';
      chatArea.replaceChildren(list);
    }
    list.appendChild(createOlliTalkAssistantTypingElement());
    scheduleOlliTalkChatToComposer();
    requestAnimationFrame(() => {
      if (chatArea.isConnected) chatArea.scrollTop = chatArea.scrollHeight;
    });
  }

  function replaceOlliTalkAssistantTypingWithMessage(item, currentMemberId){
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea || !item) return false;
    const typing = chatArea.querySelector('[data-olli-assistant-typing]');
    if(String(item?.message_type || '').trim()==='ai' && Number(item?.reply_to_message_id || 0)>0){
      removeOlliTalkReplySuggestion(String(Number(item.reply_to_message_id)));
    }
    const next = createOlliTalkMessageElement(item, currentMemberId, { connectedToPrevious:false });
    if (typing) typing.replaceWith(next);
    else appendOlliTalkPersistedMessage(item, currentMemberId);
    chatArea.dataset.previewReady = '';
    scheduleOlliTalkChatToComposer();
    requestAnimationFrame(() => {
      if (chatArea.isConnected) chatArea.scrollTop = chatArea.scrollHeight;
    });
    return true;
  }

  function appendOlliTalkPersistedMessage(item, currentMemberId){
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea || !item) return false;
    const messageId = String(item?.id || '').trim();
    if (messageId) {
      const duplicate = Array.from(chatArea.querySelectorAll('[data-message-id]'))
        .some(node => String(node.dataset.messageId || '') === messageId);
      if (duplicate) return true;
    }

    let list = chatArea.querySelector('.olliTalkBetaMessageList');
    if (!list) {
      list = document.createElement('div');
      list.className = 'olliTalkBetaMessageList';
      chatArea.replaceChildren(list);
    }

    const itemDateKey = getOlliTalkDateKey(item?.created_at);
    const renderedMessages = Array.from(list.querySelectorAll('[data-message-id]'));
    const lastRendered = renderedMessages[renderedMessages.length - 1] || null;
    const lastDateKey = String(lastRendered?.dataset?.dateKey || '');
    if (itemDateKey && itemDateKey !== lastDateKey) {
      const divider = document.createElement('div');
      divider.className = 'olliTalkBetaDateDivider';
      divider.appendChild(createMessageText('span', '', formatOlliTalkDateLabel(item?.created_at)));
      list.appendChild(divider);
    }

    list.appendChild(createOlliTalkMessageElement(item, currentMemberId, { connectedToPrevious:false }));
    if(String(item?.message_type || '').trim()==='ai' && Number(item?.reply_to_message_id || 0)>0){
      removeOlliTalkReplySuggestion(String(Number(item.reply_to_message_id)));
    }
    chatArea.dataset.previewReady = '';
    scheduleOlliTalkChatToComposer();
    requestAnimationFrame(() => {
      if (chatArea.isConnected) chatArea.scrollTop = chatArea.scrollHeight;
    });
    return true;
  }

  function renderOlliTalkServerMessages(payload, options = {}){
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea) return;
    disconnectOlliTalkImageViewportObserver('chat');

    const scrollMode = String(options.scrollMode || 'bottom');
    const previousScrollTop = Math.max(0, Number(chatArea.scrollTop || 0));
    const previousScrollHeight = Math.max(0, Number(chatArea.scrollHeight || 0));
    const wasNearBottom = isOlliTalkChatNearBottom(chatArea);

    olliTalkCurrentPayload=payload||null;
    const allMessages = Array.isArray(payload?.messages) ? payload.messages : [];
    const requestedMessageLimit=Math.max(0,Math.floor(Number(options.messageLimit)||0));
    const messages=requestedMessageLimit>0&&allMessages.length>requestedMessageLimit
      ? allMessages.slice(-requestedMessageLimit)
      : allMessages;
    olliTalkRenderedMessageLimit=messages.length;
    const currentMemberId = String(payload?.current_member_id || getOlliTalkBetaContext().memberId || '').trim();
    const olliReplyTargetIds = getOlliTalkReplyTargetIds(allMessages);

    if (!messages.length) {
      chatArea.replaceChildren(createOlliTalkEmptyState('아직 대화가 없어요', '첫 메시지를 보내 올리톡을 시작해 보세요.'));
      chatArea.dataset.previewReady = '';
      return;
    }

    const list = document.createElement('div');
    list.className = 'olliTalkBetaMessageList';

    let lastDateKey = '';
    let groupStartItem = null;
    messages.forEach((item) => {
      const dateKey = getOlliTalkDateKey(item?.created_at);
      const dateChanged = !!(dateKey && dateKey !== lastDateKey);
      if (dateChanged) {
        const divider = document.createElement('div');
        divider.className = 'olliTalkBetaDateDivider';
        divider.appendChild(createMessageText('span', '', formatOlliTalkDateLabel(item?.created_at)));
        list.appendChild(divider);
        lastDateKey = dateKey;
        groupStartItem = null;
      }

      const connectedToPrevious = isOlliTalkConnectedMessage(groupStartItem, item, currentMemberId);
      list.appendChild(createOlliTalkMessageElement(item, currentMemberId, {
        connectedToPrevious,
        olliReplyTargetIds,
        deferHydration:options.deferHydration===true
      }));

      if (String(item?.message_type || 'text') === 'system') {
        groupStartItem = null;
      } else if (!connectedToPrevious) {
        groupStartItem = item;
      }
    });

    chatArea.replaceChildren(list);
    chatArea.dataset.previewReady = '';
    if (olliTalkAssistantReplyPending) syncOlliTalkAssistantTypingIndicator();
    scheduleOlliTalkChatToComposer();

    const searchBar = document.getElementById('olliTalkSearchBar');
    const searchInput = document.getElementById('olliTalkSearchInput');
    const hasActiveSearch = !!searchBar && !searchBar.hidden && !!String(searchInput?.value || '').trim();
    if (hasActiveSearch) {
      refreshOlliTalkSearch({ resetIndex:true, scroll:true });
    } else {
      const shouldFollowBottom = scrollMode === 'bottom'
        || (scrollMode === 'follow-if-near-bottom' && wasNearBottom);

      requestAnimationFrame(() => {
        if (!chatArea.isConnected) return;
        if (shouldFollowBottom) {
          chatArea.scrollTop = chatArea.scrollHeight;
          return;
        }
        if(scrollMode==='preserve-prepend'){
          const addedHeight=Math.max(0,chatArea.scrollHeight-previousScrollHeight);
          chatArea.scrollTop=previousScrollTop+addedHeight;
          return;
        }
        chatArea.scrollTop = previousScrollTop;
      });
    }
  }

  function getOlliTalkSearchRows(){
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea) return [];
    return Array.from(chatArea.querySelectorAll('.olliTalkBetaMessage, .olliTalkBetaSystemMessage'));
  }

  function clearOlliTalkSearchMarks(){
    const screen=getScreen();
    screen?.querySelectorAll('.olliTalkSearchTextMark').forEach(mark=>{
      const parent=mark.parentNode;
      mark.replaceWith(document.createTextNode(mark.textContent||''));
      parent?.normalize?.();
    });
    getOlliTalkSearchRows().forEach(row => {
      row.classList.remove('olliTalkSearchMatch', 'olliTalkSearchCurrent');
    });
    olliTalkSearchMatches = [];
    olliTalkSearchIndex = -1;
  }

  function highlightOlliTalkSearchText(root,query){
    if(!root||!query)return;
    const normalized=String(query).toLocaleLowerCase('ko-KR');
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
      acceptNode(node){
        const text=String(node.nodeValue||'');
        const parent=node.parentElement;
        if(!text||!parent||parent.closest('.olliTalkSearchTextMark'))return NodeFilter.FILTER_REJECT;
        return text.toLocaleLowerCase('ko-KR').includes(normalized)
          ?NodeFilter.FILTER_ACCEPT
          :NodeFilter.FILTER_REJECT;
      }
    });
    const nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(node=>{
      const text=String(node.nodeValue||'');
      const lower=text.toLocaleLowerCase('ko-KR');
      const fragment=document.createDocumentFragment();
      let cursor=0;
      while(cursor<text.length){
        const index=lower.indexOf(normalized,cursor);
        if(index<0){
          fragment.appendChild(document.createTextNode(text.slice(cursor)));
          break;
        }
        if(index>cursor)fragment.appendChild(document.createTextNode(text.slice(cursor,index)));
        const mark=document.createElement('mark');
        mark.className='olliTalkSearchTextMark';
        mark.textContent=text.slice(index,index+normalized.length);
        fragment.appendChild(mark);
        cursor=index+normalized.length;
      }
      node.replaceWith(fragment);
    });
  }

  function updateOlliTalkSearchCount(){
    const count = document.getElementById('olliTalkSearchCount');
    if (!count) return;
    count.textContent = olliTalkSearchMatches.length
      ? (String(olliTalkSearchIndex + 1) + ' / ' + String(olliTalkSearchMatches.length))
      : '';
  }

  function scrollToOlliTalkSearchMatch(index, behavior = 'smooth'){
    if (!olliTalkSearchMatches.length) {
      olliTalkSearchIndex = -1;
      updateOlliTalkSearchCount();
      return false;
    }
    olliTalkSearchIndex = ((Number(index) || 0) % olliTalkSearchMatches.length + olliTalkSearchMatches.length) % olliTalkSearchMatches.length;
    olliTalkSearchMatches.forEach((row, idx) => {
      row.classList.toggle('olliTalkSearchCurrent', idx === olliTalkSearchIndex);
    });
    updateOlliTalkSearchCount();
    const row = olliTalkSearchMatches[olliTalkSearchIndex];
    requestAnimationFrame(() => row?.scrollIntoView?.({ block:'center', behavior }));
    return true;
  }

  function refreshOlliTalkSearch(options = {}){
    const input = document.getElementById('olliTalkSearchInput');
    const query = String(input?.value || '').trim().toLocaleLowerCase('ko-KR');
    clearOlliTalkSearchMarks();

    if (!query) {
      updateOlliTalkSearchCount();
      return false;
    }

    olliTalkSearchMatches = getOlliTalkSearchRows().filter(row => {
      const bubble = row.querySelector?.('.olliTalkBetaBubble');
      const sender = row.querySelector?.('.olliTalkBetaSender');
      const source = bubble
        ? [sender?.textContent || '', bubble.textContent || ''].join(' ')
        : String(row.textContent || '');
      const matched = source.toLocaleLowerCase('ko-KR').includes(query);
      if (matched) {
        row.classList.add('olliTalkSearchMatch');
        if(sender)highlightOlliTalkSearchText(sender,query);
        if(bubble)highlightOlliTalkSearchText(bubble,query);
        else highlightOlliTalkSearchText(row,query);
      }
      return matched;
    });

    if (!olliTalkSearchMatches.length) {
      olliTalkSearchIndex = -1;
      const count = document.getElementById('olliTalkSearchCount');
      if (count) count.textContent = '0 / 0';
      return false;
    }

    const nextIndex = options.resetIndex === false && olliTalkSearchIndex >= 0
      ? Math.min(olliTalkSearchIndex, olliTalkSearchMatches.length - 1)
      : 0;
    if (options.scroll === false) {
      olliTalkSearchIndex = nextIndex;
      olliTalkSearchMatches.forEach((row, idx) => row.classList.toggle('olliTalkSearchCurrent', idx === nextIndex));
      updateOlliTalkSearchCount();
      return true;
    }
    return scrollToOlliTalkSearchMatch(nextIndex, options.behavior || 'smooth');
  }

  function openOlliTalkSearch(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const screen = getScreen();
    const bar = document.getElementById('olliTalkSearchBar');
    const input = document.getElementById('olliTalkSearchInput');
    if (!screen || !bar || !input) return;
    bar.hidden = false;
    screen.classList.add('olliTalkSearchOpen');
    requestAnimationFrame(() => {
      try { input.focus({ preventScroll:true }); } catch (_) { input.focus(); }
    });
  }

  function closeOlliTalkSearch(options = {}){
    const screen = getScreen();
    const bar = document.getElementById('olliTalkSearchBar');
    const input = document.getElementById('olliTalkSearchInput');
    if (input) {
      input.value = '';
      if (options.blur !== false) input.blur();
    }
    clearOlliTalkSearchMarks();
    updateOlliTalkSearchCount();
    if (bar) bar.hidden = true;
    if (screen) screen.classList.remove('olliTalkSearchOpen');
  }

  function toggleOlliTalkSearch(event){
    const bar = document.getElementById('olliTalkSearchBar');
    if (bar && !bar.hidden) closeOlliTalkSearch();
    else openOlliTalkSearch(event);
  }

  function getOlliTalkMentionMenu(){
    return document.getElementById('olliTalkMentionMenu');
  }

  function roleLabel(role){
    if (role === 'owner') return '원장';
    if (role === 'manager') return '관리자';
    return '선생님';
  }

  function setOlliTalkMentionBadge(count){
    const badges = Array.from(document.querySelectorAll('[data-olli-work-badge], #kcfOlliTalkBadge'));
    const value = Math.max(0, Number(count || 0));
    badges.forEach((badge) => {
      if (!value) {
        badge.hidden = true;
        badge.textContent = '';
        return;
      }
      badge.hidden = false;
      badge.textContent = value > 99 ? '99+' : String(value);
    });
    try { window.OlliTalkPush?.setAppBadge?.(value); } catch (_) {}
  }

  async function refreshOlliTalkMentionBadge(options = {}){
    const context = getOlliTalkBetaContext();
    if (!context.sessionToken || !context.academyId) {
      setOlliTalkMentionBadge(0);
      return false;
    }
    try {
      const payload = await callOlliTalkRpc('olli_mobile_work_notification_summary', {
        p_session_token: context.sessionToken,
        p_academy_id: context.academyId
      });
      if (!payload || payload.ok !== true) return false;
      const unreadCount = Math.max(0, Number(payload.unread_count || 0));
      const mentionUnreadCount = Math.max(0, Number(payload.mention_unread_count || 0));
      const materialUnreadCount = Math.max(0, Number(payload.material_unread_count || 0));
      const latestMessageId = Math.max(0, Number(payload.latest_message_id || 0));
      const latestMaterialEventId = Math.max(0, Number(payload.latest_material_event_id || 0));
      const notifyMessageId = Math.max(0, Number(options?.notifyMessageId || 0));

      if (
        notifyMessageId
        && latestMessageId === notifyMessageId
        && latestMessageId !== olliTalkLastMentionMessageId
        && !isOlliTalkBetaVisible()
      ) {
        const sender = String(payload.latest_sender_name || '올리톡').trim() || '올리톡';
        const body = String(payload.latest_body || '').trim();
        const preview = body.length > 58 ? body.slice(0, 58) + '…' : body;
        let notificationEnabled = true;
        try {
          const cached = typeof window.settingsGetCachedState === 'function' ? window.settingsGetCachedState() : {};
          notificationEnabled = cached?.notificationEnabled !== false;
        } catch (_) {}
        if (notificationEnabled && typeof window.showPushToast === 'function') {
          window.showPushToast(sender + (preview ? ': ' + preview : ' 새 메시지가 있어요.'));
        }
      }

      setOlliTalkMentionBadge(unreadCount);
      olliTalkLastUnreadMentionCount = mentionUnreadCount;
      olliTalkLastUnreadMaterialCount = materialUnreadCount;
      olliTalkLastMentionMessageId = latestMessageId;
      olliTalkLastMaterialEventId = latestMaterialEventId;
      olliTalkMentionSummaryInitialized = true;
      return true;
    } catch(error) {
      console.warn('Work 알림 배지 확인 실패:', error);
      return false;
    }
  }

  async function markOlliTalkMessagesRead(upToMessageId){
    const context = getOlliTalkBetaContext();
    if (!context.sessionToken || !context.academyId) return false;
    try {
      const payload = await callOlliTalkRpc('olli_team_chat_mark_read', {
        p_session_token: context.sessionToken,
        p_academy_id: context.academyId,
        p_up_to_message_id: upToMessageId || null
      });
      if (!payload || payload.ok !== true) return false;
      olliTalkLastUnreadMentionCount = 0;
      await refreshOlliTalkMentionBadge();
      return true;
    } catch(error) {
      console.warn('올리톡 멘션 읽음 처리 실패:', error);
      return false;
    }
  }

  function applyOlliTalkMemberCount(value){
    const count=normalizeOlliTalkMemberCount(value);
    const memberCount=document.getElementById('olliTalkBetaMemberCount');
    if(memberCount)memberCount.textContent=count!==null&&count>0?String(count):'';
    return count;
  }

  function renderOlliTalkCachedMemberCount(cachedPayload){
    return applyOlliTalkMemberCount(cachedPayload?.member_count);
  }

  async function loadOlliTalkMembers(){
    const context = getOlliTalkBetaContext();
    const cached = readOlliTalkMessageCache(context);
    if (normalizeOlliTalkMemberCount(cached?.member_count)!==null) {
      renderOlliTalkCachedMemberCount(cached);
    }
    if (!context.sessionToken || !context.academyId) {
      olliTalkMembers = [];
      return [];
    }
    try {
      const payload = await callOlliTalkRpc('olli_team_chat_members', {
        p_session_token: context.sessionToken,
        p_academy_id: context.academyId
      });
      olliTalkMembers = Array.isArray(payload?.members) ? payload.members : [];
      const memberCount=applyOlliTalkMemberCount(olliTalkMembers.length);
      const cacheBase = olliTalkCurrentPayload || cached || {
        ok:true,
        academy_id:context.academyId,
        current_member_id:context.memberId || '',
        current_member_name:context.memberName || '',
        messages:[]
      };
      const nextCache={...cacheBase,member_count:memberCount};
      if (olliTalkCurrentPayload) olliTalkCurrentPayload=nextCache;
      writeOlliTalkMessageCache(context,nextCache);
      return olliTalkMembers;
    } catch(error) {
      console.warn('올리톡 선생님 목록 조회 실패:', error);
      olliTalkMembers = [];
      return [];
    }
  }

  function currentMentionQuery(){
    const input = getOlliTalkBetaInput();
    if (!input) return null;
    const caret = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
    const prefix = input.value.slice(0, caret);
    const match = prefix.match(/(^|\s)@([^\s@]*)$/);
    if (!match) return null;
    return {
      query: String(match[2] || '').trim(),
      start: caret - String(match[2] || '').length - 1,
      end: caret
    };
  }

  function hideOlliTalkMentionMenu(){
    const menu = getOlliTalkMentionMenu();
    if (!menu) return;
    menu.hidden = true;
    menu.replaceChildren();
    scheduleOlliTalkChatToComposer();
  }

  function insertOlliTalkMention(member){
    const input = getOlliTalkBetaInput();
    if (!input || !member) return;
    const info = currentMentionQuery();
    if (!info) return;

    const name = String(member.display_name || '').trim();
    if (!name) return;

    const wasAiSelected = hasOlliTalkAiMentionSelection();
    input.setRangeText('', info.start, info.end, 'end');
    input.value = String(input.value || '').replace(/^\s+/, '');

    olliTalkMentionSelections.set(String(member.member_id), member);
    if (member?.is_olli_ai === true && !wasAiSelected) resetOlliTalkAiConversation();
    if (member?.is_olli_ai !== true && wasAiSelected) resetOlliTalkAiConversation();

    syncOlliTalkSelectedMentionPrefix();
    hideOlliTalkMentionMenu();
    resizeInput();
    updateOlliTalkBetaComposerState();
    try { input.focus({ preventScroll:true }); } catch(e) { input.focus(); }
  }

  function renderOlliTalkMentionMenu(){
    const menu = getOlliTalkMentionMenu();
    if (!menu) return;
    const info = currentMentionQuery();
    if (!info) {
      hideOlliTalkMentionMenu();
      return;
    }

    const query = info.query.toLowerCase();
    const candidates = [OLLI_TALK_AI_MENTION, ...olliTalkMembers]
      .filter(member => member?.is_olli_ai === true || !member.is_current_member)
      .filter(member => !query || String(member.display_name || '').toLowerCase().includes(query));

    menu.replaceChildren();
    if (!candidates.length) {
      menu.appendChild(createMessageText('div', 'olliTalkMentionHint', '일치하는 선생님이 없어요.'));
      menu.hidden = false;
      scheduleOlliTalkChatToComposer();
      return;
    }

    candidates.forEach(member => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'olliTalkMentionOption';
      const displayName = String(member.display_name || '').trim() || '이름 없음';
      const mentionLabel = member?.is_olli_ai === true ? '@올리 · AI' : '@' + displayName;
      const name = createMessageText('span', 'olliTalkMentionName', mentionLabel);
      button.append(name);
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => insertOlliTalkMention(member));
      menu.appendChild(button);
    });
    menu.hidden = false;
    scheduleOlliTalkChatToComposer();
  }

  function clearOlliTalkMentionDraft(){
    const input = getOlliTalkBetaInput();
    if (!input) return;

    const value = String(input.value || '')
      .replace(/(^|\s)@[^\s@]*$/g, '$1')
      .replace(/\s+/g, ' ')
      .trimStart();
    input.value = value;
    olliTalkMentionSelections.clear();
    resetOlliTalkAiConversation();
    syncOlliTalkSelectedMentionPrefix();
  }

  async function openOlliTalkMentionPicker(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const input = getOlliTalkBetaInput();
    if (!input) return false;

    if (olliTalkMentionModeActive) {
      clearOlliTalkMentionDraft();
      olliTalkMentionModeActive = false;
      hideOlliTalkMentionMenu();
      resizeInput();
      updateOlliTalkBetaComposerState();
      input.blur();
      [0, 80, 180].forEach(delay => setTimeout(syncViewport, delay));
      return false;
    }

    olliTalkMentionModeActive = true;
    updateOlliTalkBetaComposerState();

    const caret = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
    const activeQuery = currentMentionQuery();
    if (!activeQuery) {
      const before = input.value.slice(0, caret);
      const insertion = before && !/\s$/.test(before) ? ' @' : '@';
      input.setRangeText(insertion, caret, caret, 'end');
    }

    try { input.focus({ preventScroll:true }); } catch (_) { input.focus(); }
    resizeInput();
    updateOlliTalkBetaComposerState();

    renderOlliTalkMentionMenu();
    if (!olliTalkMembers.length) {
      await loadOlliTalkMembers();
      renderOlliTalkMentionMenu();
    }
    [0, 80, 180].forEach(delay => setTimeout(syncViewport, delay));
    return true;
  }

  function escapeRegExp(value){
    return String(value || '').replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
  }

  function resolveMentionedMembers(body){
    const text = String(body || '');
    const found = new Map();

    olliTalkMentionSelections.forEach((member, id) => {
      if (member?.is_olli_ai === true) return;
      const name = String(member?.display_name || '').trim();
      if (name && text.includes('@' + name)) found.set(String(id), member);
    });

    olliTalkMembers.forEach(member => {
      const name = String(member?.display_name || '').trim();
      if (!name || member.is_current_member) return;
      const pattern = new RegExp('(^|\\s)@' + escapeRegExp(name) + '(?=\\s|$|[,.!?，。！？])');
      if (pattern.test(text)) found.set(String(member.member_id), member);
    });

    return Array.from(found.values());
  }

  function parseOlliTalkTaskItems(body, mentionedMembers){
    const owners = (mentionedMembers || []).filter(member => member.role === 'owner');
    if (!owners.length) return { items:[], assignee:null };

    const lines = String(body || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const items = [];
    lines.forEach(line => {
      const bullet = line.match(/^(?:[-•*]|\d+[.)])\s+(.+)$/);
      if (bullet && bullet[1]) items.push(bullet[1].trim());
    });

    const hasTaskKeyword = /할\s*일|해야\s*할\s*일|업무\s*(?:목록|리스트)?/i.test(String(body || ''));
    if (!items.length || (!hasTaskKeyword && items.length < 2)) return { items:[], assignee:null };

    return {
      items: items.slice(0, 20),
      assignee: owners[0]
    };
  }

  async function callOlliTalkRpc(name, params){
    if (typeof window.supabase !== 'function' && typeof supabase !== 'function') {
      throw new Error('Supabase 연결 함수를 찾지 못했습니다.');
    }
    const call = typeof window.supabase === 'function' ? window.supabase : supabase;
    return call('POST', `rpc/${name}`, params);
  }

  let olliTalkLoadSequence = 0;
  let olliTalkSendInFlight = false;
  let olliTalkAssistantReplyPending = false;

  async function loadOlliTalkBetaMessages(options = {}){
    const sequence = ++olliTalkLoadSequence;
    const context = getOlliTalkBetaContext();
    const cachedPayload = options.cachedPayload || (options.localFirst === false ? readOlliTalkMessageCache(context) : renderOlliTalkCachedMessages(context));
    const basePayload = olliTalkCurrentPayload || cachedPayload;
    const renderedLocal = !!basePayload;

    if (!context.sessionToken || !context.academyId) {
      if(!renderedLocal){
        const chatArea = document.getElementById('olliTalkBetaChatArea');
        if (chatArea && options.showLoading !== false) setOlliTalkLoadingState();
      }
      const retryCount=Number(options.contextRetry||0);
      if(retryCount<10){
        setTimeout(()=>{
          if(!isOlliTalkBetaVisible())return;
          loadOlliTalkBetaMessages({
            ...options,
            showLoading:false,
            localFirst:false,
            cachedPayload:basePayload||undefined,
            contextRetry:retryCount+1
          }).catch(()=>{});
        },220);
      }
      return renderedLocal;
    }

    if (options.showLoading !== false && !renderedLocal) setOlliTalkLoadingState();

    try {
      const payload = await callOlliTalkRpc('olli_team_chat_list', {
        p_session_token: context.sessionToken,
        p_academy_id: context.academyId,
        p_before_message_id: null,
        p_limit: 100
      });

      if (sequence !== olliTalkLoadSequence) return false;

      if (!payload || payload.ok !== true) {
        throw new Error(payload?.message || '대화를 불러오지 못했습니다.');
      }

      const pageMessages=Array.isArray(payload.messages)?payload.messages:[];
      const mergedPayload=basePayload?mergeOlliTalkMessagePayloads(basePayload,payload):payload;
      const changed=!basePayload||!areOlliTalkMessagePayloadsEquivalent(basePayload,mergedPayload);
      olliTalkHistoryExhausted=pageMessages.length<100;
      writeOlliTalkMessageCache(context,mergedPayload);
      if(options.render!==false&&changed){
        const activeRenderLimit=Math.max(0,Math.floor(Math.max(Number(options.messageLimit)||0,Number(olliTalkRenderedMessageLimit)||0)));
        renderOlliTalkServerMessages(mergedPayload,{
          scrollMode:options.scrollMode||'bottom',
          ...(activeRenderLimit>0?{messageLimit:activeRenderLimit}:{})
        });
      }else{
        olliTalkCurrentPayload=mergedPayload;
      }
      const latestMessageId = pageMessages.length
        ? Number(pageMessages[pageMessages.length - 1]?.id || 0)
        : 0;
      if (isOlliTalkBetaVisible()) {
        await markOlliTalkMessagesRead(latestMessageId || null);
      } else {
        await refreshOlliTalkMentionBadge();
      }
      return true;
    } catch(error) {
      if (sequence !== olliTalkLoadSequence) return false;
      if (!renderedLocal) {
        const chatArea = document.getElementById('olliTalkBetaChatArea');
        if (chatArea) {
          chatArea.replaceChildren(createOlliTalkEmptyState('대화를 불러오지 못했어요', '잠시 후 다시 열어 주세요.'));
        }
      }
      console.warn('올리톡 메시지 조회 실패:', error);
      return false;
    }
  }

  async function loadOlderOlliTalkMessages(){
    if(olliTalkHistoryLoading)return false;
    const context=getOlliTalkBetaContext();
    const chatArea=document.getElementById('olliTalkBetaChatArea');
    if(!chatArea)return false;

    const current=olliTalkCurrentPayload||readOlliTalkMessageCache(context);
    const messages=Array.isArray(current?.messages)?current.messages:[];
    const renderedLimit=Math.min(messages.length,Math.max(0,Number(olliTalkRenderedMessageLimit||0)));
    if(renderedLimit>0&&renderedLimit<messages.length){
      const nextLimit=Math.min(messages.length,renderedLimit+OLLI_TALK_LOCAL_HISTORY_STEP);
      renderOlliTalkServerMessages(current,{
        scrollMode:'preserve-prepend',
        messageLimit:nextLimit
      });
      return true;
    }

    if(olliTalkHistoryExhausted)return false;
    if(!context.sessionToken||!context.academyId)return false;

    const oldestId=messages.reduce((min,item)=>{
      const id=Number(item?.id||0);
      return id>0&&(!min||id<min)?id:min;
    },0);
    if(!oldestId){olliTalkHistoryExhausted=true;return false}

    olliTalkHistoryLoading=true;
    try{
      const payload=await callOlliTalkRpc('olli_team_chat_list',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_before_message_id:oldestId,
        p_limit:100
      });
      if(!payload||payload.ok!==true)throw new Error(payload?.message||'이전 대화를 불러오지 못했습니다.');
      const older=Array.isArray(payload.messages)?payload.messages:[];
      if(!older.length){olliTalkHistoryExhausted=true;return true}

      const merged=mergeOlliTalkMessagePayloads(current,payload);
      if(merged.messages.length===messages.length){olliTalkHistoryExhausted=true;return true}
      writeOlliTalkMessageCache(context,merged);
      renderOlliTalkServerMessages(merged,{scrollMode:'preserve-prepend'});
      if(older.length<100)olliTalkHistoryExhausted=true;
      return true;
    }catch(error){
      console.warn('올리톡 이전 대화 조회 실패:',error);
      return false;
    }finally{
      olliTalkHistoryLoading=false;
    }
  }

  async function registerOlliTalkMessageRecipients(messageId,memberIds,context=getOlliTalkBetaContext()){
    const id=Number(messageId||0);
    if(!id||!context?.sessionToken||!context?.academyId)return false;
    const recipients=Array.isArray(memberIds)?memberIds.map(String).filter(Boolean):[];
    await callOlliTalkRpc('olli_team_chat_set_mentions',{
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_message_id:id,
      p_member_ids:recipients
    });
    try{
      const pushPromise=window.OlliTalkPush?.dispatch?.(id);
      if(pushPromise&&typeof pushPromise.catch==='function'){
        pushPromise.catch(error=>console.warn('올리톡 푸시 요청 실패:',error));
      }
    }catch(error){
      console.warn('올리톡 푸시 요청 실패:',error);
    }
    return true;
  }

  async function sendOlliTalkBetaMessage(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (olliTalkSendInFlight) return;

    const input = getOlliTalkBetaInput();
    const sendButton = getOlliTalkBetaSendButton();
    if (!input) return;

    const rawBody = String(input.value || '').trim();
    const persistentMentionPrefix = olliTalkMentionModeActive
      ? getOlliTalkPersistentMentionPrefix()
      : '';
    const olliAiMentionRequested = olliTalkMentionModeActive && hasOlliTalkAiMentionSelection();
    const directOlliRequested = /^\s*@올리(?:\s|$)/.test(rawBody);
    const olliRequested = olliAiMentionRequested || directOlliRequested;
    const commandText = olliRequested
      ? (olliAiMentionRequested ? rawBody : stripOlliTalkOlliPrefix(rawBody))
      : '';
    const body = olliRequested
      ? ('@올리 ' + commandText).trim()
      : (persistentMentionPrefix + rawBody).trim();

    if (
      !rawBody
      || (olliRequested && !commandText)
      || (olliTalkMentionModeActive && !isOlliTalkMentionMessageReady())
    ) {
      updateOlliTalkBetaComposerState();
      return;
    }

    if (olliAiMentionRequested && !isOlliTalkAiEnabled()) {
      alert('올리 AI를 사용하려면 설정에서 올리 AI를 켜 주세요.');
      updateOlliTalkBetaComposerState();
      return;
    }

    const context = getOlliTalkBetaContext();
    if (!context.sessionToken || !context.academyId) {
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    olliTalkSendInFlight = true;
    if (sendButton) {
      sendButton.disabled = true;
      sendButton.classList.add('sending');
    }

    const clientMessageId = createOlliTalkClientMessageId();

    try {
      const payload = await callOlliTalkRpc('olli_team_chat_send', {
        p_session_token: context.sessionToken,
        p_academy_id: context.academyId,
        p_body: body,
        p_client_message_id: clientMessageId,
        p_reply_to_message_id: null
      });

      if (!payload || payload.ok !== true || !payload.message) {
        throw new Error(payload?.message || '메시지를 저장하지 못했습니다.');
      }

      const mentionedMembers=olliRequested?[]:resolveMentionedMembers(body);
      const mentionedIds=mentionedMembers.map(member=>String(member.member_id)).filter(Boolean);

      input.value = '';
      if (!persistentMentionPrefix) {
        olliTalkMentionSelections.clear();
        olliTalkMentionModeActive = false;
        resetOlliTalkAiConversation();
      }
      syncOlliTalkSelectedMentionPrefix();
      hideOlliTalkMentionMenu();
      resizeInput();
      updateOlliTalkBetaComposerState();
      appendOlliTalkPersistedMessage(payload.message, context.memberId);
      if (olliRequested && (olliAiMentionRequested || isOlliTalkAiEnabled())) {
        olliTalkAssistantReplyPending = true;
        syncOlliTalkAssistantTypingIndicator();
      }

      const followupErrors = [];

      if (!olliRequested) {
        try {
          await registerOlliTalkMessageRecipients(Number(payload.message.id),mentionedIds,context);
        } catch(error) {
          console.warn('올리톡 알림 대상 저장 실패:', error);
          followupErrors.push(mentionedIds.length?'지정한 선생님 알림 등록':'전체 선생님 알림 등록');
        }
      }

      if (!olliRequested) {
        const taskInfo = parseOlliTalkTaskItems(body, mentionedMembers);
        if (taskInfo.items.length && taskInfo.assignee) {
          try {
            await callOlliTalkRpc('olli_academy_tasks_create_from_chat', {
              p_session_token: context.sessionToken,
              p_academy_id: context.academyId,
              p_source_message_id: Number(payload.message.id),
              p_items: taskInfo.items,
              p_assigned_to_member_id: String(taskInfo.assignee.member_id)
            });
          } catch(error) {
            console.warn('올리톡 할 일 등록 실패:', error);
            followupErrors.push('PC 학생관리 할 일 등록');
          }
        }
      }

      if (olliRequested) {
        const usingAi = olliAiMentionRequested || isOlliTalkAiEnabled();
        try {
          if(usingAi){
            const turn=await resolveOlliTalkAiTurn(commandText,context,Number(payload.message.id));
            olliTalkAssistantReplyPending=false;
            replaceOlliTalkAssistantTypingWithMessage(turn.assistantMessage,context.memberId);
            if (turn.recordAi) recordOlliTalkAiConversationTurn(commandText, turn.replyText);
          }else{
            const turn=await resolveOlliTalkBotTurn(commandText,context,Number(payload.message.id));
            appendOlliTalkPersistedMessage(turn.assistantMessage,context.memberId);
          }
        } catch(error) {
          console.warn(usingAi ? '올리톡 AI 응답 실패:' : '올리톡 올리봇 응답 실패:', error);
          followupErrors.push(usingAi ? 'AI 응답' : '올리봇 응답');
        } finally {
          if (olliTalkAssistantReplyPending) {
            olliTalkAssistantReplyPending = false;
            syncOlliTalkAssistantTypingIndicator();
          }
        }
      }

      await loadOlliTalkBetaMessages({ showLoading:false, localFirst:false, scrollMode:'bottom', render:false });

      if (followupErrors.length) {
        alert('메시지는 전송됐지만 ' + followupErrors.join(', ') + '에 실패했습니다.');
      }

      try {
        input.focus({ preventScroll:true });
      } catch(e) {
        input.focus();
      }
    } catch(error) {
      olliTalkAssistantReplyPending = false;
      syncOlliTalkAssistantTypingIndicator();
      console.warn('올리톡 메시지 전송 실패:', error);
      alert('메시지를 보내지 못했습니다.\n' + (error?.message || error));
    } finally {
      olliTalkSendInFlight = false;
      if (sendButton) sendButton.classList.remove('sending');
      updateOlliTalkBetaComposerState();
    }
  }

  function isObservationOlliTalkContext(){
    return olliTalkBetaReturnPageId === 'observationRosterScreen'
      || olliTalkBetaReturnPageId === 'studentMemoScreen';
  }

  function syncOlliTalkContextTab(){
    const tab = document.getElementById('olliTalkContextTab');
    if (!tab) return;
    const observation = isObservationOlliTalkContext();
    tab.textContent = observation ? '관찰노트' : '퀵노트';
    tab.setAttribute('aria-label', observation ? '관찰노트로 이동' : '퀵노트로 이동');
  }

  const OLLI_TALK_PAGE_SLIDE_IN_MS = 340;
  const OLLI_TALK_PAGE_SLIDE_OUT_MS = 280;

  function isOlliTalkTabbedPageId(pageId){
    return pageId === 'kinderChatFeedbackScreen'
      || pageId === 'observationRosterScreen'
      || pageId === 'studentMemoScreen';
  }

  function getOlliTalkPageSlideDuration(className){
    return className === 'vivizac-slide-in'
      ? OLLI_TALK_PAGE_SLIDE_IN_MS
      : OLLI_TALK_PAGE_SLIDE_OUT_MS;
  }

  function runOlliTalkPageSlide(screen, className){
    if (!screen) return Promise.resolve();
    screen.classList.add('vivizac-slide-page');
    screen.classList.remove('vivizac-slide-in', 'vivizac-slide-out', 'vivizac-slide-from-bottom');
    void screen.offsetWidth;
    screen.classList.add(className);

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      screen.classList.remove(className, 'vivizac-slide-page');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        screen.removeEventListener('animationend', onAnimationEnd);
        screen.classList.remove(className, 'vivizac-slide-page');
        resolve();
      };
      const onAnimationEnd = (animationEvent) => {
        if (animationEvent.target !== screen) return;
        finish();
      };
      screen.addEventListener('animationend', onAnimationEnd);
      window.setTimeout(finish, getOlliTalkPageSlideDuration(className) + 120);
    });
  }

  function getOlliTalkSourceFadeTargets(sourceScreen){
    const targets = [];
    if (sourceScreen) targets.push(sourceScreen);

    const sourceId = String(sourceScreen?.id || '');
    if (sourceId === 'kinderChatFeedbackScreen') {
      const feedbackTop = document.getElementById('kcfPersistentTopLayer');
      if (feedbackTop) targets.push(feedbackTop);
    }
    if (sourceId === 'observationRosterScreen' || sourceId === 'studentMemoScreen') {
      const observationNav = document.getElementById('observationPersistentNavLayer');
      if (observationNav) targets.push(observationNav);
    }
    return targets;
  }

  function beginOlliTalkSourceFade(sourceScreen){
    const targets = getOlliTalkSourceFadeTargets(sourceScreen);
    targets.forEach((target) => target.classList.remove('vivizac-slide-under-fade'));
    if (sourceScreen) void sourceScreen.offsetWidth;
    targets.forEach((target) => target.classList.add('vivizac-slide-under-fade'));
    return targets;
  }

  function clearOlliTalkSourceFade(targets){
    (targets || []).forEach((target) => target.classList.remove('vivizac-slide-under-fade'));
  }

  function showOlliTalkReturnScreen(pageId){
    const target = document.getElementById(pageId);
    if (!target) return null;
    target.style.display = 'flex';
    target.style.visibility = '';
    target.setAttribute('aria-hidden', 'false');
    return target;
  }

  function resetOlliTalkAfterPageTransition(){
    if (olliTalkChatGestureSettleTimer) clearTimeout(olliTalkChatGestureSettleTimer);
    olliTalkChatGestureSettleTimer = null;
    olliTalkChatGestureActive = false;
    commitOlliTalkKeyboardMessageMotion();
    releaseOlliTalkComposerViewportLock();
    olliTalkKeyboardTransitionActive = false;
  }

  async function slideOlliTalkOutTo(targetScreen){
    const screen = getScreen();
    if (!screen) return;

    if (targetScreen) {
      targetScreen.style.display = 'flex';
      targetScreen.style.visibility = '';
      targetScreen.setAttribute('aria-hidden', 'false');
    }

    screen.style.display = 'none';
    screen.setAttribute('aria-hidden', 'true');
    resetOlliTalkAfterPageTransition();
  }

  async function openOlliTalkBetaPage(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const sourceScreen = Array.from(document.querySelectorAll('.pageScreen')).find((candidate) => {
      if (!candidate || candidate.id === 'olliTalkBetaScreen') return false;
      try { return getComputedStyle(candidate).display !== 'none'; }
      catch (_) { return candidate.style.display !== 'none'; }
    });
    olliTalkBetaReturnPageId = String(sourceScreen?.id || 'recordRoomScreen');
    olliTalkBetaReturnToFeedback = olliTalkBetaReturnPageId === 'kinderChatFeedbackScreen';
    syncOlliTalkContextTab();

    const shouldSlide = isOlliTalkTabbedPageId(olliTalkBetaReturnPageId);
    if (!shouldSlide) {
      document.querySelectorAll('.pageScreen').forEach((screen) => {
        if (screen.id !== 'olliTalkBetaScreen') screen.style.display = 'none';
      });
    }

    if (!shouldSlide) {
      if (typeof window.setObservationPersistentNavVisible === 'function') {
        window.setObservationPersistentNavVisible(false);
      }
      if (typeof window.setKinderChatFeedbackPersistentTopVisible === 'function') {
        window.setKinderChatFeedbackPersistentTopVisible(false);
      } else {
        const feedbackTop = document.getElementById('kcfPersistentTopLayer');
        if (feedbackTop) feedbackTop.setAttribute('aria-hidden', 'true');
      }
    }

    const screen = getScreen();
    if (!screen) return;
    syncOlliTalkContrastTheme();
    closeOlliTalkSearch({ blur:false });
    olliTalkHistoryExhausted=false;
    olliTalkHistoryLoading=false;
    olliTalkCurrentPayload=null;
    olliTalkRenderedMessageLimit=OLLI_TALK_INITIAL_RENDER_LIMIT;

    // 단일 500개 캐시를 그대로 원본으로 두고, 최근 100개만 첫 화면에 그립니다.
    // 화면을 공개하기 전에는 서버/IDB/이미지 요청을 시작하지 않습니다.
    const openContext = getOlliTalkBetaContext();
    const openCachedPayload = readOlliTalkMessageCache(openContext);
    if(openCachedPayload){
      olliTalkCurrentPayload=openCachedPayload;
      renderOlliTalkCachedMemberCount(openCachedPayload);
      renderOlliTalkServerMessages(openCachedPayload,{
        scrollMode:'bottom',
        messageLimit:OLLI_TALK_INITIAL_RENDER_LIMIT,
        deferHydration:true
      });
    }else{
      applyOlliTalkMemberCount(null);
      setOlliTalkLoadingState();
    }

    screen.style.display = 'flex';
    screen.setAttribute('aria-hidden', 'false');
    screen?.style.setProperty('--olli-talk-composer-bottom', '0px');
    resetOlliTalkAfterPageTransition();

    if (shouldSlide) {
      document.querySelectorAll('.pageScreen').forEach((candidate) => {
        if (candidate.id !== 'olliTalkBetaScreen') candidate.style.display = 'none';
      });
      if (typeof window.setObservationPersistentNavVisible === 'function') {
        window.setObservationPersistentNavVisible(false);
      }
      if (typeof window.setKinderChatFeedbackPersistentTopVisible === 'function') {
        window.setKinderChatFeedbackPersistentTopVisible(false);
      } else {
        const feedbackTop = document.getElementById('kcfPersistentTopLayer');
        if (feedbackTop) feedbackTop.setAttribute('aria-hidden', 'true');
      }
    }

    bindViewport();
    bindOlliTalkChatComposerTracking();
    syncOlliTalkComposerViewport();
    syncViewport();
    resizeInput();
    scheduleOlliTalkChatToComposer();
    updateOlliTalkBetaComposerState();

    requestAnimationFrame(() => {
      // rAF 뒤의 macrotask에서 시작해 로컬 DOM의 첫 paint를 먼저 보장합니다.
      setTimeout(() => {
        if(!isOlliTalkBetaVisible())return;

        hydrateOlliTalkDeferredFirstPaintAssets();
        bindOlliTalkRealtime();
        loadOlliTalkMembers().then(() => renderOlliTalkMentionMenu()).catch(() => {});
        refreshOlliTalkMentionBadge().catch(() => {});
        if (typeof window.OlliRealtime?.ensureConnected === 'function') {
          window.OlliRealtime.ensureConnected({ force:false, reason:'olli_talk_open' }).catch(() => {});
        }
        loadOlliTalkBetaMessages({
          showLoading:!openCachedPayload,
          localFirst:false,
          cachedPayload:openCachedPayload,
          messageLimit:OLLI_TALK_INITIAL_RENDER_LIMIT,
          scrollMode:'bottom'
        });
      },0);
    });
  }

  async function closeOlliTalkBetaPage(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const input = document.getElementById('olliTalkBetaInput');
    if (input) input.blur();
    closeOlliTalkSearch();
    closeOlliTalkPhotoViewer(null,{restore:false});
    disconnectOlliTalkImageViewportObserver('chat');
    setTimeout(()=>{
      if(isOlliTalkBetaVisible())return;
      const hiddenScreen=getScreen();
      hiddenScreen?.querySelectorAll?.('.olliTalkBetaAttachmentImageFrame').forEach(frame=>{
        const image=frame.querySelector('.olliTalkBetaAttachmentImage');
        if(image)releaseOlliTalkAttachmentImageFrame(frame,image);
      });
    },420);

    if (olliTalkBetaReturnToFeedback) {
      const feedbackScreen = showOlliTalkReturnScreen('kinderChatFeedbackScreen');
      if (typeof window.setKinderChatFeedbackPersistentTopVisible === 'function') {
        window.setKinderChatFeedbackPersistentTopVisible(true);
      }
      await slideOlliTalkOutTo(feedbackScreen);
      if (typeof window.scheduleKinderChatFeedbackComposerViewportSync === 'function') {
        window.scheduleKinderChatFeedbackComposerViewportSync();
      }
      if (typeof window.updateKinderChatFeedbackKeyboardOffset === 'function') {
        window.updateKinderChatFeedbackKeyboardOffset();
      }
      return;
    }

    if (olliTalkBetaReturnPageId === 'studentMemoScreen') {
      const memoScreen = showOlliTalkReturnScreen('studentMemoScreen');
      if (memoScreen) memoScreen.classList.remove('observation-editor-keyboard-open');

      const restoreMemoEditor = window.setObservationMemoEditorMode
        || (typeof setObservationMemoEditorMode === 'function' ? setObservationMemoEditorMode : null);
      if (typeof restoreMemoEditor === 'function') {
        restoreMemoEditor();
      } else {
        if (typeof window.setObservationPersistentNavVisible === 'function') {
          window.setObservationPersistentNavVisible(true);
        }
        if (typeof window.mountObservationMemoEditorTools === 'function') {
          window.mountObservationMemoEditorTools();
        }
      }

      await slideOlliTalkOutTo(memoScreen);

      if (typeof window.mountObservationMemoEditorTools === 'function') {
        requestAnimationFrame(window.mountObservationMemoEditorTools);
      }
      return;
    }

    if (olliTalkBetaReturnPageId === 'observationRosterScreen') {
      const rosterScreen = showOlliTalkReturnScreen('observationRosterScreen');
      if (typeof window.setObservationPersistentNavVisible === 'function') {
        window.setObservationPersistentNavVisible(true);
      }
      await slideOlliTalkOutTo(rosterScreen);
      if (typeof window.showObservationMemoRoster === 'function') {
        try { window.showObservationMemoRoster(); } catch (_) {}
      }
      return;
    }

    const screen = getScreen();
    if (screen) {
      screen.style.display = 'none';
      screen.setAttribute('aria-hidden', 'true');
    }
    resetOlliTalkAfterPageTransition();

    if (typeof window.showRecordRoom === 'function') {
      await window.showRecordRoom();
    }
  }

  async function openOlliTalkContextPage(event){
    if (isObservationOlliTalkContext()) {
      await closeOlliTalkBetaPage(event);
      return;
    }
    await openQuickNoteFromOlliTalk(event);
  }

  async function openObservationFromOlliTalk(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const input = document.getElementById('olliTalkBetaInput');
    if (input) input.blur();
    closeOlliTalkSearch();

    const screen = getScreen();
    if (screen) {
      screen.style.display = 'none';
      screen.setAttribute('aria-hidden', 'true');
    }
    resetOlliTalkAfterPageTransition();

    if (typeof window.openOlliObservationFromRecordShortcut === 'function') {
      await window.openOlliObservationFromRecordShortcut(event);
    }
  }

  async function openQuickNoteFromOlliTalk(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const input = document.getElementById('olliTalkBetaInput');
    if (input) input.blur();
    closeOlliTalkSearch();

    const feedbackScreen = showOlliTalkReturnScreen('kinderChatFeedbackScreen');
    if (typeof window.setKinderChatFeedbackPersistentTopVisible === 'function') {
      window.setKinderChatFeedbackPersistentTopVisible(true);
    }
    await slideOlliTalkOutTo(feedbackScreen);

    if (typeof window.openKinderChatFeedbackPage === 'function') {
      window.openKinderChatFeedbackPage();
      return;
    }

    if (feedbackScreen) feedbackScreen.style.display = 'flex';
  }

  async function openRecordRoomFromOlliTalk(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const input = document.getElementById('olliTalkBetaInput');
    if (input) input.blur();
    closeOlliTalkSearch();

    olliTalkBetaReturnToFeedback = false;
    olliTalkBetaReturnPageId = 'recordRoomScreen';

    const recordScreen = document.getElementById('recordRoomScreen');
    const openAttendance = window.openRecordAttendanceDashboard
      || (typeof openRecordAttendanceDashboard === 'function' ? openRecordAttendanceDashboard : null);
    let attendanceReady = null;
    if (typeof openAttendance === 'function') {
      try { attendanceReady = openAttendance(); } catch (_) {}
    }

    await slideOlliTalkOutTo(recordScreen);
    if (attendanceReady && typeof attendanceReady.then === 'function') {
      try { await attendanceReady; } catch (_) {}
    }
  }

  let olliTalkRealtimeWatcher = null;

  function isOlliTalkBetaVisible(){
    const screen = getScreen();
    if (!screen || screen.hidden || screen.getAttribute('aria-hidden') === 'true') return false;

    try {
      const style = getComputedStyle(screen);
      return style.display !== 'none' && style.visibility !== 'hidden';
    } catch (_) {
      return screen.style.display !== 'none';
    }
  }

  function bindOlliTalkRealtime(){
    if (olliTalkRealtimeWatcher || typeof window.OlliRealtime?.watchDomain !== 'function') return;

    olliTalkRealtimeWatcher = window.OlliRealtime.watchDomain('chat', async (context) => {
      if (!context?.isCurrent?.()) return false;

      // 채팅 화면이 닫혀 있으면 다음 진입 때 서버 원본을 읽으므로
      // 백그라운드에서 불필요한 메시지 조회를 시작하지 않습니다.
      if (!isOlliTalkBetaVisible()) return true;

      // 내 메시지 저장 후 현재 요청이 끝나는 동안 들어온 신호는
      // 공통 watcher가 잠시 보류했다가 다시 적용합니다.
      if (olliTalkSendInFlight) return false;

      return loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
    });
  }

  function bindOlliTalkMentionBadgeRealtime(){
    if (olliTalkMentionBadgeWatcher || typeof window.OlliRealtime?.watchDomain !== 'function') return;
    olliTalkMentionBadgeWatcher = window.OlliRealtime.watchDomain('chat', async (context) => {
      if (!context?.isCurrent?.()) return false;
      const notifyMessageId = context?.trigger === 'change' ? Number(context?.revision || 0) : 0;
      if (notifyMessageId) {
        await new Promise(resolve => setTimeout(resolve, 140));
        if (!context?.isCurrent?.()) return false;
      }
      return refreshOlliTalkMentionBadge({ notifyMessageId });
    });
  }

  function init(){
    syncOlliTalkContrastTheme();
    window.addEventListener('olli-team-talk-ai-mode-changed', handleOlliTalkAiModeChanged);
    const input = getOlliTalkBetaInput();
    const sendButton = getOlliTalkBetaSendButton();
    const mentionTriggerButton = document.getElementById('olliTalkMentionTriggerBtn');
    const searchInput = document.getElementById('olliTalkSearchInput');
    const searchNextButton = document.getElementById('olliTalkSearchNextBtn');
    const searchCloseButton = document.getElementById('olliTalkSearchCloseBtn');
    const archiveButton = document.getElementById('olliTalkArchiveBtn');
    const archiveBackButton = document.getElementById('olliTalkArchiveBackBtn');
    const archiveMaterialCreateButton = document.getElementById('olliTalkArchiveMaterialCreateBtn');
    const archiveUploadButton = document.getElementById('olliTalkArchiveUploadBtn');
    const archiveFileInput = document.getElementById('olliTalkArchiveFileInput');
    const composerFileAddButton = document.getElementById('olliTalkFileAddBtn');
    const composerFileInput = document.getElementById('olliTalkComposerFileInput');
    const photoViewerBackButton = document.getElementById('olliTalkPhotoViewerBackBtn');
    const photoViewerArchiveButton = document.getElementById('olliTalkPhotoViewerArchiveBtn');
    const photoViewerSaveButton = document.getElementById('olliTalkPhotoViewerSaveBtn');
    const photoViewerDeleteButton = document.getElementById('olliTalkPhotoViewerDeleteBtn');
    const photoViewerLoadingCancelButton = document.getElementById('olliTalkPhotoViewerLoadingCancel');
    const archiveFileLoadingCancelButton = document.getElementById('olliTalkArchiveFileLoadingCancel');

    if (searchInput) {
      searchInput.addEventListener('input', () => refreshOlliTalkSearch({ resetIndex:true, scroll:true }));
      searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!olliTalkSearchMatches.length) refreshOlliTalkSearch({ resetIndex:true, scroll:true });
          else scrollToOlliTalkSearchMatch(olliTalkSearchIndex + 1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeOlliTalkSearch();
        }
      });
    }
    if (searchNextButton) {
      searchNextButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (!olliTalkSearchMatches.length) refreshOlliTalkSearch({ resetIndex:true, scroll:true });
        else scrollToOlliTalkSearchMatch(olliTalkSearchIndex + 1);
      });
    }
    if (searchCloseButton) {
      searchCloseButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        closeOlliTalkSearch();
      });
    }

    if(archiveButton)archiveButton.addEventListener('click',openOlliTalkArchivePage);
    if(archiveBackButton)archiveBackButton.addEventListener('click',closeOlliTalkArchivePage);
    if(archiveMaterialCreateButton)archiveMaterialCreateButton.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      window.OlliMobileTeamTalkMaterialOrders?.openCreate?.();
    });
    if(photoViewerBackButton)photoViewerBackButton.addEventListener('click',closeOlliTalkPhotoViewer);
    if(photoViewerArchiveButton)photoViewerArchiveButton.addEventListener('click',openOlliTalkPhotoReviewFromViewer);
    if(photoViewerSaveButton)photoViewerSaveButton.addEventListener('click',saveOlliTalkPhotoViewer);
    if(photoViewerDeleteButton)photoViewerDeleteButton.addEventListener('click',deleteOlliTalkPhotoViewer);
    if(photoViewerLoadingCancelButton)photoViewerLoadingCancelButton.addEventListener('click',closeOlliTalkPhotoViewer);
    if(archiveFileLoadingCancelButton)archiveFileLoadingCancelButton.addEventListener('click',cancelOlliTalkArchiveFileTransfer);
    document.querySelectorAll('[data-archive-tab]').forEach(button=>button.addEventListener('click',()=>setOlliTalkArchiveTab(String(button.dataset.archiveTab||'media'))));
    if(archiveUploadButton&&archiveFileInput){
      archiveUploadButton.addEventListener('click',()=>archiveFileInput.click());
      archiveFileInput.addEventListener('change',async event=>{
        const file=event.target?.files?.[0]||null;event.target.value='';if(file)await uploadOlliTalkArchiveFile(file);
      });
    }
    if(composerFileAddButton&&composerFileInput){
      composerFileAddButton.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        composerFileInput.click();
      });
      composerFileInput.addEventListener('change',async event=>{
        const files=Array.from(event.target?.files||[]);
        event.target.value='';
        if(files.length)await uploadOlliTalkComposerFiles(files);
      });
    }

    const beginOlliTalkChatGesture = () => {
      if (olliTalkChatGestureSettleTimer) {
        clearTimeout(olliTalkChatGestureSettleTimer);
        olliTalkChatGestureSettleTimer = null;
      }
      // Never let keyboard animation and a finger-driven chat scroll compete.
      commitOlliTalkKeyboardMessageMotion();
      olliTalkChatGestureActive = true;
    };
    const endOlliTalkChatGesture = () => {
      if (!olliTalkChatGestureActive && !olliTalkChatGestureSettleTimer) return;
      if (olliTalkChatGestureSettleTimer) clearTimeout(olliTalkChatGestureSettleTimer);
      olliTalkChatGestureSettleTimer = setTimeout(() => {
        olliTalkChatGestureSettleTimer = null;
        olliTalkChatGestureActive = false;
        syncOlliTalkComposerViewport({ force:true });
        syncViewport();
        scheduleOlliTalkChatToComposer();
      }, 120);
    };

    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (chatArea) {
      chatArea.addEventListener('pointerdown', beginOlliTalkChatGesture, { passive:true });
      chatArea.addEventListener('touchstart', beginOlliTalkChatGesture, { passive:true });
      window.addEventListener('pointerup', endOlliTalkChatGesture, { passive:true });
      window.addEventListener('pointercancel', endOlliTalkChatGesture, { passive:true });
      window.addEventListener('touchend', endOlliTalkChatGesture, { passive:true });
      window.addEventListener('touchcancel', endOlliTalkChatGesture, { passive:true });
      chatArea.addEventListener('scroll',()=>{
        if(chatArea.scrollTop>96||olliTalkHistoryLoading||olliTalkHistoryExhausted)return;
        if(olliTalkHistoryScrollRaf)return;
        olliTalkHistoryScrollRaf=requestAnimationFrame(()=>{
          olliTalkHistoryScrollRaf=0;
          loadOlderOlliTalkMessages().catch(error=>console.warn('올리톡 이전 대화 로드 실패:',error));
        });
      },{passive:true});
    }

    if (input) {
      let composerTouchStartX = null;
      let composerTouchStartY = null;
      const composer = input.closest('.olliTalkBetaComposer');

      input.addEventListener('pointerdown', event => {
        if (event.pointerType === 'touch') {
          if (document.activeElement !== input) {
            captureOlliTalkKeyboardBaseline(true);
            // Match the @ mention path: focus before iOS performs its native
            // scroll-into-view step, while leaving the tap/caret default intact.
            try { input.focus({ preventScroll:true }); }
            catch (_) { input.focus(); }
          }
          return;
        }
        captureOlliTalkKeyboardBaseline(true);
      }, true);

      if (composer) {
        composer.addEventListener('touchstart', event => {
          const touch = event.touches?.[0];
          composerTouchStartX = touch ? Number(touch.clientX) : null;
          composerTouchStartY = touch ? Number(touch.clientY) : null;
        }, { passive:true });

        composer.addEventListener('touchmove', event => {
          if (!getScreen()?.classList.contains('olliTalkKeyboardOpen')) return;
          const touch = event.touches?.[0];
          if (!touch || !Number.isFinite(composerTouchStartX) || !Number.isFinite(composerTouchStartY)) return;
          const deltaX = Math.abs(Number(touch.clientX) - composerTouchStartX);
          const deltaY = Math.abs(Number(touch.clientY) - composerTouchStartY);
          if (deltaY < 6 || deltaY <= deltaX) return;
          // Keep taps/cursor placement, but prevent a vertical drag that starts
          // inside composer from becoming an iOS page/WKScrollView pan.
          event.preventDefault();
        }, { passive:false });

        const clearComposerTouch = () => {
          composerTouchStartX = null;
          composerTouchStartY = null;
        };
        composer.addEventListener('touchend', clearComposerTouch, { passive:true });
        composer.addEventListener('touchcancel', clearComposerTouch, { passive:true });
      }

      input.addEventListener('input', () => {
        resizeInput();
        updateOlliTalkBetaComposerState();
        renderOlliTalkMentionMenu();
      });
      input.addEventListener('focus', () => {
        const screen = getScreen();
        beginOlliTalkKeyboardMessageMotion();
        releaseOlliTalkComposerViewportLock();
        olliTalkKeyboardTransitionActive = true;
        captureOlliTalkKeyboardBaseline(true);
        if (screen) screen.classList.add('olliTalkViewportMoving');
        scheduleOlliTalkViewportSettle();
        setTimeout(() => syncViewport({ source:'focus' }), 40);
        setTimeout(() => syncViewport({ source:'focus' }), 160);
        setTimeout(() => syncViewport({ source:'focus' }), 300);
      }, true);
      input.addEventListener('blur', () => {
        const screen = getScreen();
        beginOlliTalkKeyboardMessageMotion();
        releaseOlliTalkComposerViewportLock();
        olliTalkKeyboardTransitionActive = true;
        if (screen) screen.classList.add('olliTalkViewportMoving');
        scheduleOlliTalkViewportSettle();
        setTimeout(() => syncViewport({ source:'blur' }), 40);
        setTimeout(() => syncViewport({ source:'blur' }), 140);
        setTimeout(() => {
          syncViewport({ source:'blur' });
          if (document.activeElement !== input && !screen?.classList.contains('olliTalkKeyboardOpen')) {
            olliTalkKeyboardBaselineBottom = 0;
            olliTalkKeyboardTransitionActive = false;
          }
        }, 320);
      });
      input.addEventListener('click', renderOlliTalkMentionMenu);
      input.addEventListener('keyup', event => {
        if (event.key === 'Escape') hideOlliTalkMentionMenu();
      });
    }

    if (mentionTriggerButton) {
      mentionTriggerButton.addEventListener('click', openOlliTalkMentionPicker);
    }

    if (sendButton) {
      sendButton.addEventListener('pointerdown', event => {
        event.preventDefault();
        const composerInput = getOlliTalkBetaInput();
        if (!composerInput) return;
        try { composerInput.focus({ preventScroll:true }); }
        catch (_) { composerInput.focus(); }
      });
      sendButton.addEventListener('click', sendOlliTalkBetaMessage);
    }

    updateOlliTalkBetaComposerState();
    bindOlliTalkChatComposerTracking();
    bindOlliTalkRealtime();
    bindOlliTalkMentionBadgeRealtime();
    refreshOlliTalkMentionBadge().catch(() => {});
    syncViewport();
  }

  window.setOlliTalkBackgroundColor = (color) => {
    const screen = getScreen();
    if (!screen) return '';
    const value = String(color || '').trim();
    if (value) screen.style.setProperty('--olli-talk-bg', value);
    return syncOlliTalkContrastTheme();
  };
  window.openOlliTalkBetaPage = openOlliTalkBetaPage;
  window.closeOlliTalkBetaPage = closeOlliTalkBetaPage;
  window.openOlliTalkQuickOrder = openOlliTalkQuickOrder;
  window.openOlliTalkContextPage = openOlliTalkContextPage;
  window.openObservationFromOlliTalk = openObservationFromOlliTalk;
  window.openQuickNoteFromOlliTalk = openQuickNoteFromOlliTalk;
  window.openRecordRoomFromOlliTalk = openRecordRoomFromOlliTalk;
  window.loadOlliTalkBetaMessages = loadOlliTalkBetaMessages;
  window.refreshOlliTalkMentionBadge = refreshOlliTalkMentionBadge;
  window.openOlliTalkSearch = openOlliTalkSearch;
  window.closeOlliTalkSearch = closeOlliTalkSearch;
  window.openOlliTalkMentionPicker = openOlliTalkMentionPicker;
  window.openOlliTalkArchivePage = openOlliTalkArchivePage;
  window.closeOlliTalkArchivePage = closeOlliTalkArchivePage;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    init();
  }
})();
