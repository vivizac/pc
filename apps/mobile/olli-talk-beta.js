(() => {
  'use strict';

  window.__olliCommandsMovedToTalk = true;

  let olliTalkBetaReturnToFeedback = true;
  let olliTalkBetaReturnPageId = 'recordRoomScreen';
  let olliTalkBetaViewportBound = false;
  let olliTalkChatMeasureRaf = 0;
  let olliTalkKeyboardFollowLatest = false;
  let olliTalkKeyboardClosingReturnLatest = false;
  let olliTalkKeyboardUserNavigatedChat = false;
  let olliTalkChatGestureActive = false;
  let olliTalkChatGestureSettleTimer = null;
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
  // Temporary visual-only avatar check. These messages are never sent, cached, or written to Supabase.
  const OLLI_TALK_AVATAR_PREVIEW_ENABLED = true;
  const OLLI_TALK_AVATAR_PREVIEW_MEMBER_ID = '__olli_avatar_preview__';
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
  let olliTalkPendingTextInputMessageId = '';
  let olliTalkPendingReasonSubmitInFlight = false;
  let olliTalkPendingReasonInputField = null;
  let olliTalkPendingReasonAnchorPending = false;
  let olliTalkPendingReasonAnchorTimer = null;
  let olliTalkPendingReasonFocusRaf = 0;
  let olliTalkPendingMakeupDialogue = null;
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

  const OLLI_TALK_COMPOSER_IDLE_HEIGHT = 47;
  const OLLI_TALK_COMPOSER_ACTIVE_HEIGHT = 79;
  const OLLI_TALK_COMPOSER_MESSAGE_GAP = 10;
  const OLLI_TALK_KEYBOARD_MOTION_SETTLE_MS = 320;
  let olliTalkKeyboardMotionTimer = null;

  function beginOlliTalkKeyboardMotion(){
    const screen = getScreen();
    if (!screen) return;
    screen.classList.add('olliTalkKeyboardMotion');
    if (olliTalkKeyboardMotionTimer) clearTimeout(olliTalkKeyboardMotionTimer);
    olliTalkKeyboardMotionTimer = setTimeout(() => {
      olliTalkKeyboardMotionTimer = null;
      screen.classList.remove('olliTalkKeyboardMotion');
      // One final bottom reconciliation after iOS visualViewport finishes closing.
      if (olliTalkKeyboardClosingReturnLatest) {
        const closingFrame = captureOlliTalkKeyboardVisualFrame();
        restoreOlliTalkKeyboardCloseLatest();
        preserveOlliTalkKeyboardVisualFrame(closingFrame);
        olliTalkKeyboardClosingReturnLatest = false;
      }
    }, OLLI_TALK_KEYBOARD_MOTION_SETTLE_MS);
  }

  function continueOlliTalkKeyboardMotion(){
    const screen = getScreen();
    if (!screen?.classList.contains('olliTalkKeyboardMotion')) return;
    beginOlliTalkKeyboardMotion();
  }

  const OLLI_TALK_KEYBOARD_FOLLOW_TAU_MS = 32;
  // iOS keyboard opening: lag the same composer + message pair just slightly.
  // Closing keeps the original response speed.
  const OLLI_TALK_KEYBOARD_OPEN_FOLLOW_TAU_MS = 44;
  let olliTalkKeyboardVisualRaf = 0;
  let olliTalkKeyboardViewportRaf = 0;
  let olliTalkKeyboardVisualLastTs = 0;
  let olliTalkComposerVisualOffsetY = 0;
  let olliTalkMessagesVisualOffsetY = 0;
  let olliTalkViewportNeedsFullSync = false;
  let olliTalkViewportNeedsComposerSync = false;
  let olliTalkViewportNeedsLatestAnchor = false;
  let olliTalkViewportNeedsPendingReasonAnchor = false;

  function prefersReducedOlliTalkMotion(){
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
    catch (_) { return false; }
  }

  function captureOlliTalkKeyboardVisualFrame(){
    const screen = getScreen();
    const composerWrap = screen?.querySelector('.olliTalkBetaComposerWrap') || null;
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    const messageList = chatArea?.querySelector('.olliTalkBetaMessageList') || null;
    const messageAnchor = chatArea ? latestOlliTalkRenderedMessage(chatArea) : null;
    return {
      composerWrap,
      composerTop: composerWrap?.isConnected ? composerWrap.getBoundingClientRect().top : null,
      messageList,
      messageAnchor,
      messageTop: messageAnchor?.isConnected ? messageAnchor.getBoundingClientRect().top : null
    };
  }

  function applyOlliTalkKeyboardVisualOffsets(){
    const screen = getScreen();
    const composerWrap = screen?.querySelector('.olliTalkBetaComposerWrap') || null;
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    const messageList = chatArea?.querySelector('.olliTalkBetaMessageList') || null;

    if (composerWrap) {
      composerWrap.style.transform = Math.abs(olliTalkComposerVisualOffsetY) > 0.01
        ? `translate3d(0,${olliTalkComposerVisualOffsetY.toFixed(3)}px,0)`
        : '';
    }
    if (messageList) {
      messageList.style.transform = Math.abs(olliTalkMessagesVisualOffsetY) > 0.01
        ? `translate3d(0,${olliTalkMessagesVisualOffsetY.toFixed(3)}px,0)`
        : '';
    }
  }

  function stopOlliTalkKeyboardVisualController(options = {}){
    if (olliTalkKeyboardVisualRaf) cancelAnimationFrame(olliTalkKeyboardVisualRaf);
    if (olliTalkKeyboardViewportRaf) cancelAnimationFrame(olliTalkKeyboardViewportRaf);
    olliTalkKeyboardVisualRaf = 0;
    olliTalkKeyboardViewportRaf = 0;
    olliTalkKeyboardVisualLastTs = 0;
    olliTalkViewportNeedsFullSync = false;
    olliTalkViewportNeedsComposerSync = false;
    olliTalkViewportNeedsLatestAnchor = false;
    olliTalkViewportNeedsPendingReasonAnchor = false;
    if (options.reset !== false) {
      olliTalkComposerVisualOffsetY = 0;
      olliTalkMessagesVisualOffsetY = 0;
      applyOlliTalkKeyboardVisualOffsets();
    }
  }

  function stepOlliTalkKeyboardVisualController(timestamp){
    olliTalkKeyboardVisualRaf = 0;
    if (prefersReducedOlliTalkMotion()) {
      olliTalkComposerVisualOffsetY = 0;
      olliTalkMessagesVisualOffsetY = 0;
      applyOlliTalkKeyboardVisualOffsets();
      olliTalkKeyboardVisualLastTs = 0;
      return;
    }

    const previous = olliTalkKeyboardVisualLastTs || timestamp;
    const dt = Math.max(1,Math.min(34,timestamp - previous));
    olliTalkKeyboardVisualLastTs = timestamp;
    const followTau = getScreen()?.classList.contains('olliTalkKeyboardOpen')
      ? OLLI_TALK_KEYBOARD_OPEN_FOLLOW_TAU_MS
      : OLLI_TALK_KEYBOARD_FOLLOW_TAU_MS;
    const follow = 1 - Math.exp(-dt / followTau);

    olliTalkComposerVisualOffsetY += (0 - olliTalkComposerVisualOffsetY) * follow;
    olliTalkMessagesVisualOffsetY += (0 - olliTalkMessagesVisualOffsetY) * follow;

    if (Math.abs(olliTalkComposerVisualOffsetY) < 0.18) olliTalkComposerVisualOffsetY = 0;
    if (Math.abs(olliTalkMessagesVisualOffsetY) < 0.18) olliTalkMessagesVisualOffsetY = 0;
    applyOlliTalkKeyboardVisualOffsets();

    if (olliTalkComposerVisualOffsetY !== 0 || olliTalkMessagesVisualOffsetY !== 0) {
      olliTalkKeyboardVisualRaf = requestAnimationFrame(stepOlliTalkKeyboardVisualController);
    } else {
      olliTalkKeyboardVisualLastTs = 0;
    }
  }

  function ensureOlliTalkKeyboardVisualController(){
    if (prefersReducedOlliTalkMotion()) {
      olliTalkComposerVisualOffsetY = 0;
      olliTalkMessagesVisualOffsetY = 0;
      applyOlliTalkKeyboardVisualOffsets();
      return;
    }
    if (!olliTalkKeyboardVisualRaf) {
      olliTalkKeyboardVisualRaf = requestAnimationFrame(stepOlliTalkKeyboardVisualController);
    }
  }

  function preserveOlliTalkKeyboardVisualFrame(frame, options = {}){
    if (!frame || prefersReducedOlliTalkMotion()) return;
    const animateMessages = options.messages !== false;

    if (frame.composerWrap?.isConnected && Number.isFinite(frame.composerTop)) {
      const nextTop = frame.composerWrap.getBoundingClientRect().top;
      const deltaY = frame.composerTop - nextTop;
      if (Number.isFinite(deltaY) && Math.abs(deltaY) > 0.01) {
        olliTalkComposerVisualOffsetY += deltaY;
      }
    }

    if (
      animateMessages
      && frame.messageList?.isConnected
      && frame.messageAnchor?.isConnected
      && Number.isFinite(frame.messageTop)
    ) {
      const nextTop = frame.messageAnchor.getBoundingClientRect().top;
      const deltaY = frame.messageTop - nextTop;
      if (Number.isFinite(deltaY) && Math.abs(deltaY) > 0.01) {
        olliTalkMessagesVisualOffsetY += deltaY;
      }
    }

    applyOlliTalkKeyboardVisualOffsets();
    ensureOlliTalkKeyboardVisualController();
  }

  function flushOlliTalkKeyboardViewportUpdate(){
    olliTalkKeyboardViewportRaf = 0;
    const fullSync = olliTalkViewportNeedsFullSync;
    const composerSync = olliTalkViewportNeedsComposerSync;
    const anchorLatest = olliTalkViewportNeedsLatestAnchor;
    const anchorPendingReason = olliTalkViewportNeedsPendingReasonAnchor;
    olliTalkViewportNeedsFullSync = false;
    olliTalkViewportNeedsComposerSync = false;
    olliTalkViewportNeedsLatestAnchor = false;
    olliTalkViewportNeedsPendingReasonAnchor = false;

    const motionFrame = captureOlliTalkKeyboardVisualFrame();

    if (fullSync) syncViewport();
    else if (composerSync) syncOlliTalkComposerViewport();

    // Focus opening anchors messages above the composer; blur must reverse it.
    // Run after layout reserve updates, before the shared FLIP capture is painted.
    if (fullSync) restoreOlliTalkKeyboardCloseLatest();

    if (anchorPendingReason) scheduleOlliTalkPendingReasonAnchorAfterViewport();

    // The latest-message anchor alone owns scrollTop. Our FLIP controller
    // only paints the displacement, and never scrolls a second time.
    if (
      !isOlliTalkPendingReasonInputActive()
      && anchorLatest
      && !olliTalkChatGestureActive
      && olliTalkKeyboardFollowLatest
      && isOlliTalkComposerActive()
    ) {
      scheduleOlliTalkLatestMessageAnchor();
    }

    preserveOlliTalkKeyboardVisualFrame(motionFrame,{
      messages: !isOlliTalkPendingReasonInputActive() && !olliTalkChatGestureActive
    });
  }

  function scheduleOlliTalkKeyboardViewportUpdate(options = {}){
    if (options.fullSync === true) olliTalkViewportNeedsFullSync = true;
    if (options.composerSync === true) olliTalkViewportNeedsComposerSync = true;
    if (options.anchorLatest === true) olliTalkViewportNeedsLatestAnchor = true;
    if (options.pendingReason === true) olliTalkViewportNeedsPendingReasonAnchor = true;
    if (olliTalkKeyboardViewportRaf) return;
    olliTalkKeyboardViewportRaf = requestAnimationFrame(flushOlliTalkKeyboardViewportUpdate);
  }

  function isOlliTalkChatNearBottom(chatArea, threshold = 96){
    if (!chatArea) return true;
    const distance = Math.max(0, chatArea.scrollHeight - chatArea.clientHeight - chatArea.scrollTop);
    return distance <= Math.max(0, Number(threshold) || 0);
  }

  function restoreOlliTalkKeyboardCloseLatest(){
    // Never alter the reader's scroll position if they were viewing older chat.
    if (!olliTalkKeyboardClosingReturnLatest || isOlliTalkComposerActive() || olliTalkChatGestureActive) return false;
    if (!isOlliTalkBetaVisible()) return false;
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea?.isConnected) return false;
    chatArea.scrollTop = chatArea.scrollHeight;
    return true;
  }

  function isOlliTalkComposerActive(){
    const input = getOlliTalkBetaInput();
    return !!input && document.activeElement === input;
  }

  function getOlliTalkComposerLayoutGeometry(){
    const screen = getScreen();
    const viewport = screen?.querySelector('.olliTalkBetaViewport');
    const composerWrap = screen?.querySelector('.olliTalkBetaComposerWrap');
    if (!screen || !viewport || !composerWrap) return null;

    const viewportRect = viewport.getBoundingClientRect();
    const composerRect = composerWrap.getBoundingClientRect();
    if (
      !Number.isFinite(viewportRect.bottom)
      || !Number.isFinite(composerRect.bottom)
    ) return null;

    const active = screen.classList.contains('olliTalkKeyboardOpen');
    const renderedComposerHeight = composerWrap.querySelector('.olliTalkBetaComposer')?.getBoundingClientRect().height;
    const composerHeight = Number.isFinite(renderedComposerHeight) && renderedComposerHeight > 0
      ? renderedComposerHeight
      : (active ? OLLI_TALK_COMPOSER_ACTIVE_HEIGHT : OLLI_TALK_COMPOSER_IDLE_HEIGHT);
    // Exclude temporary animation translation from the layout measurement.
    const layoutComposerBottom = composerRect.bottom - olliTalkComposerVisualOffsetY;
    const bottomGap = Math.max(0, Math.ceil(viewportRect.bottom - layoutComposerBottom));
    const composerTop = viewportRect.bottom - bottomGap - composerHeight;
    return {
      composerTop,
      reserve: bottomGap + composerHeight + OLLI_TALK_COMPOSER_MESSAGE_GAP
    };
  }

  function syncOlliTalkChatToComposer(){
    olliTalkChatMeasureRaf = 0;
    const screen = getScreen();
    if (!screen) return;

    // 평상시에는 CSS 기본 reserve만 사용합니다.
    // 키보드가 열린 동안에만 visualViewport 기준의 동적 reserve를 인라인으로 둡니다.
    if (!isOlliTalkComposerActive()) {
      screen.style.removeProperty('--olli-talk-chat-reserve');
      return;
    }

    if (!isOlliTalkBetaVisible()) return;
    const geometry = getOlliTalkComposerLayoutGeometry();
    if (!geometry) return;
    const nextReserve = Math.max(0, Math.ceil(geometry.reserve)) + 'px';
    if (screen.style.getPropertyValue('--olli-talk-chat-reserve') !== nextReserve) {
      screen.style.setProperty('--olli-talk-chat-reserve', nextReserve);
    }
  }

  function scheduleOlliTalkChatToComposer(){
    if (olliTalkChatMeasureRaf) cancelAnimationFrame(olliTalkChatMeasureRaf);
    olliTalkChatMeasureRaf = requestAnimationFrame(syncOlliTalkChatToComposer);
  }

  function syncOlliTalkComposerViewport(options = {}){
    if (olliTalkChatGestureActive && options.force !== true) return;
    const layer = document.getElementById('olliTalkBetaComposerLayer');
    if (!layer) return;
    const viewport = window.visualViewport;
    const layoutWidth = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
    const layoutHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    const left = viewport ? Number(viewport.offsetLeft || 0) : 0;
    const top = viewport ? Number(viewport.offsetTop || 0) : 0;
    const width = viewport ? Number(viewport.width || layoutWidth) : layoutWidth;
    const height = viewport ? Number(viewport.height || layoutHeight) : layoutHeight;
    layer.style.setProperty('--olli-talk-composer-vv-left', Math.round(left) + 'px');
    layer.style.setProperty('--olli-talk-composer-vv-top', Math.round(top) + 'px');
    layer.style.setProperty('--olli-talk-composer-vv-width', Math.max(1, Math.round(width)) + 'px');
    layer.style.setProperty('--olli-talk-composer-vv-height', Math.max(1, Math.round(height)) + 'px');
  }

  function syncViewport(){
    const screen = getScreen();
    if (!screen) return;
    const inputFocused = isOlliTalkComposerActive();

    syncOlliTalkComposerViewport();
    screen.classList.toggle('olliTalkKeyboardOpen', inputFocused);
    if (!inputFocused) hideOlliTalkMentionMenu();
    syncOlliTalkChatToComposer();
    updateOlliTalkBetaComposerState();
    syncOlliTalkInputPlaceholder();
  }

  function bindViewport(){
    if (olliTalkBetaViewportBound) return;
    olliTalkBetaViewportBound = true;
    window.addEventListener('resize', () => {
      scheduleOlliTalkKeyboardViewportUpdate({
        fullSync:true,
        pendingReason:true
      });
    }, { passive:true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        continueOlliTalkKeyboardMotion();
        scheduleOlliTalkKeyboardViewportUpdate({
          fullSync:true,
          anchorLatest:true,
          pendingReason:true
        });
      }, { passive:true });
      window.visualViewport.addEventListener('scroll', () => {
        // iOS visualViewport pan은 composer 좌표만 갱신하고
        // 같은 RAF 컨트롤러가 현재 움직임을 끊지 않고 이어갑니다.
        scheduleOlliTalkKeyboardViewportUpdate({composerSync:true});
      }, { passive:true });
    }
  }

  const OLLI_TALK_INPUT_PLACEHOLDER = '메시지를 입력하세요';
  let olliTalkPlaceholderCanvas = null;

  function measureOlliTalkInputText(text, input){
    if (!input) return 0;
    if (!olliTalkPlaceholderCanvas) olliTalkPlaceholderCanvas = document.createElement('canvas');
    const context = olliTalkPlaceholderCanvas.getContext?.('2d');
    if (!context) return String(text || '').length * 8;
    const style = getComputedStyle(input);
    context.font = [
      style.fontStyle || 'normal',
      style.fontWeight || '400',
      style.fontSize || '14px',
      style.fontFamily || 'sans-serif'
    ].join(' ');
    return context.measureText(String(text || '')).width;
  }

  function syncOlliTalkInputPlaceholder(){
    const input = getOlliTalkBetaInput();
    const row = document.getElementById('olliTalkComposerTextRow');
    const prefix = getOlliTalkSelectedMentionPrefix();
    if (!input || !row) return;

    if (!olliTalkMentionModeActive || !prefix || prefix.hidden) {
      input.placeholder = OLLI_TALK_INPUT_PLACEHOLDER;
      return;
    }

    const rowStyle = getComputedStyle(row);
    const inputStyle = getComputedStyle(input);
    const mentionIndent = parseFloat(rowStyle.getPropertyValue('--olli-talk-mention-indent')) || 0;
    const paddingLeft = parseFloat(inputStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(inputStyle.paddingRight) || 0;
    const availableWidth = Math.max(0, input.clientWidth - mentionIndent - paddingLeft - paddingRight - 4);
    const full = OLLI_TALK_INPUT_PLACEHOLDER;

    if (measureOlliTalkInputText(full, input) <= availableWidth) {
      input.placeholder = full;
      return;
    }

    const ellipsis = '…';
    const ellipsisWidth = measureOlliTalkInputText(ellipsis, input);
    let low = 0;
    let high = full.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const width = measureOlliTalkInputText(full.slice(0, mid), input) + ellipsisWidth;
      if (width <= availableWidth) low = mid;
      else high = mid - 1;
    }
    input.placeholder = low > 0 ? full.slice(0, low) + ellipsis : ellipsis;
  }

  function resizeInput(){
    const input = document.getElementById('olliTalkBetaInput');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 112) + 'px';
    syncOlliTalkInputPlaceholder();
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

    const tokens = [];
    olliTalkMentionSelections.forEach(member => {
      const name = String(member?.display_name || '').trim();
      if (!name) return;
      const token = document.createElement('span');
      token.className = 'olliTalkSelectedMentionToken';
      if (member?.is_olli_ai === true || String(member?.member_id || '') === OLLI_TALK_AI_MENTION_ID) {
        token.classList.add('olli');
      }
      token.textContent = '@' + name;
      tokens.push(token);
    });

    prefix.replaceChildren(...tokens);
    prefix.hidden = tokens.length === 0;

    const textRow = document.getElementById('olliTalkComposerTextRow');
    if (!textRow) return;
    if (prefix.hidden) {
      textRow.style.setProperty('--olli-talk-mention-indent', '0px');
      syncOlliTalkInputPlaceholder();
      return;
    }

    const mentionWidth = Math.ceil(prefix.getBoundingClientRect().width);
    textRow.style.setProperty(
      '--olli-talk-mention-indent',
      Math.max(0, mentionWidth + 8) + 'px'
    );
    syncOlliTalkInputPlaceholder();
  }

  function isOlliTalkAiMentionConversationActive(){
    const selected = olliTalkMentionSelections.get(OLLI_TALK_AI_MENTION_ID);
    return olliTalkMentionModeActive && selected?.is_olli_ai === true;
  }

  function resetOlliTalkAiConversation(){
    olliTalkAiConversationMessages = [];
    olliTalkAiConversationAcademyId = '';
    olliTalkPendingMakeupDialogue = null;
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
  }

  function stripOlliTalkOlliPrefix(value){
    return String(value || '').replace(/^\s*@올리(?:\s+|$)/, '').trim();
  }

  function hasOlliTalkAiMentionSelection(){
    const selected = olliTalkMentionSelections.get(OLLI_TALK_AI_MENTION_ID);
    return selected?.is_olli_ai === true;
  }

  function activateOlliTalkAiMentionFromVoice(){
    const wasAiSelected = hasOlliTalkAiMentionSelection();
    olliTalkMentionModeActive = true;
    olliTalkMentionSelections.set(OLLI_TALK_AI_MENTION_ID, OLLI_TALK_AI_MENTION);
    if (!wasAiSelected) resetOlliTalkAiConversation();
    syncOlliTalkSelectedMentionPrefix();
    hideOlliTalkMentionMenu();
    resizeInput();
    updateOlliTalkBetaComposerState();
  }

  const OLLI_TALK_VOICE_WAKE_ROOTS = new Set([
    '올리',
    '오리',
    '울리',
    '얼리',
    '올릴',
    '오릴'
  ]);

  function matchOlliTalkVoiceWakePrefix(transcript){
    const source=String(transcript || '');

    // 정확한 "올리"는 STT가 호격 어미를 생략해도 호출어로 인정합니다.
    const exact=source.match(/^\s*@?\s*올리(?:\s*(?:야(?:아+)?|이야|일야|일이야|아))?(?=\s|[,，.。!?！？:]|$)\s*[,，.。!?！？:]?\s*/i);
    if(exact) return exact;

    // 오인식 후보는 문장 맨 앞 + 호격 어미가 있을 때만 허용합니다.
    // 그래서 본문 중간의 일반 명사 "오리" 등은 바꾸지 않습니다.
    const spoken=source.match(/^\s*@?\s*([가-힣]{2,3}?)(?:\s*(?:야(?:아+)?|이야|일야|일이야|아))(?=\s|[,，.。!?！？:]|$)\s*[,，.。!?！？:]?\s*/i);
    if(spoken && OLLI_TALK_VOICE_WAKE_ROOTS.has(String(spoken[1] || '').normalize('NFC'))){
      return spoken;
    }

    // 사용자가 직접 @를 말하거나 입력한 경우에는 호격 어미가 없어도 가까운 호출어를 인정합니다.
    const explicit=source.match(/^\s*@\s*([가-힣]{2,3})(?=\s|[,，.。!?！？:]|$)\s*[,，.。!?！？:]?\s*/i);
    if(explicit && OLLI_TALK_VOICE_WAKE_ROOTS.has(String(explicit[1] || '').normalize('NFC'))){
      return explicit;
    }

    return null;
  }

  function parseOlliTalkVoiceTranscript(value){
    const transcript=String(value || '').trim();
    if(!transcript) return {mentionOlli:false,text:''};

    const wake=matchOlliTalkVoiceWakePrefix(transcript);
    if(!wake) return {mentionOlli:false,text:transcript};
    return {
      mentionOlli:true,
      text:transcript.slice(wake[0].length).trimStart()
    };
  }

  function finalizeOlliTalkVoiceTranscript(transcript,meta={}){
    const parsed=parseOlliTalkVoiceTranscript(transcript);
    if(!parsed.mentionOlli) return parsed.text;

    activateOlliTalkAiMentionFromVoice();

    if(parsed.text) return parsed.text;

    const target=meta?.target || getOlliTalkBetaInput();
    if(target){
      target.value=String(meta?.baseText || '');
      target.dispatchEvent(new Event('input',{bubbles:true}));
    }
    return '';
  }

  async function toggleOlliTalkVoiceInput(event){
    if(event){
      event.preventDefault();
      event.stopPropagation();
    }
    const input=getOlliTalkBetaInput();
    const button=document.getElementById('olliTalkBetaVoiceBtn');
    const composer=input?.closest?.('.olliTalkBetaComposer') || null;
    const voice=window.KcfVoiceTranscription;
    if(!input || !button || !composer) return false;

    if(!voice || typeof voice.toggleForTarget!=='function'){
      if(typeof window.showPushToast==='function') window.showPushToast('음성 입력을 아직 준비하지 못했어요.');
      else alert('음성 입력을 아직 준비하지 못했어요.');
      return false;
    }

    await voice.toggleForTarget(input,button,{
      showPanel:true,
      panelHost:composer,
      deferTranscriptUntilFinalized:false,
      finalizeTranscript:finalizeOlliTalkVoiceTranscript
    },event);
    return true;
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

  async function resolveOlliTalkFeedbackAnalysis(commandText,rawCommandText,context,sourceMessageId){
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'feedback_analysis',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(commandText || '').trim(),
        sourceMessageText:String(rawCommandText || commandText || '').trim(),
        sourceMessageId:Number(sourceMessageId || 0)
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true){
      throw new Error(data?.error || data?.message || '피드백 분석 응답을 받지 못했습니다.');
    }
    const message=String(data?.output || '').trim();
    if(!message) throw new Error('피드백 분석 응답이 비어 있습니다.');
    return {message};
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

  async function saveOlliTalkPendingTextInputReply(context,message,replyToMessageId,pendingOverride=null){
    const text=String(message || '').trim() || '내용을 입력해 주세요.';
    const pending=pendingOverride && typeof pendingOverride==='object'
      ? pendingOverride
      : olliTalkPendingActionReason;
    if(!pending || typeof pending!=='object'){
      throw new Error('사유 선택 작업 정보를 확인하지 못했습니다.');
    }
    const payload=await callOlliTalkRpc('olli_team_chat_send_reason_choice',{
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_body:text,
      p_pending:pending,
      p_client_message_id:createOlliTalkClientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!payload?.ok || !payload?.message?.action || String(payload.message.action.action_type || '').trim()!=='choose_reason'){
      throw new Error(payload?.message || '사유 선택 카드를 저장하지 못했습니다.');
    }
    olliTalkPendingTextInputMessageId='';
    return {
      assistantMessage:payload.message,
      replyText:text,
      recordAi:false
    };
  }

  async function continueOlliTalkBatchReasonChoice(reason,pending,context,reasonMessageId){
    const pendingBatch=pending?.__batchAgent;
    if(!pendingBatch) throw new Error('복합명령 사유 선택 상태를 확인하지 못했습니다.');

    const commands=Array.isArray(pendingBatch.commands)
      ? pendingBatch.commands.map(item=>Object.assign({},item,{
          structuredCommand:item?.structuredCommand && typeof item.structuredCommand==='object'
            ? Object.assign({},item.structuredCommand)
            : item?.structuredCommand
        }))
      : [];
    const reasonIndex=commands.findIndex(item=>olliTalkBatchCommandNeedsReason(item) && !String(item.reason || '').trim());
    if(reasonIndex<0) throw new Error('사유를 적용할 복합명령을 찾지 못했습니다.');

    commands[reasonIndex].reason=reason;
    commands[reasonIndex].reasonMessageId=Number(reasonMessageId || 0);
    commands[reasonIndex].reasonMessageText=reason;
    if(commands[reasonIndex].structuredCommand && typeof commands[reasonIndex].structuredCommand==='object'){
      commands[reasonIndex].structuredCommand.reason=reason;
    }

    const nextPending={
      sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
      sourceMessageText:String(pendingBatch.sourceMessageText || '').trim(),
      commands
    };
    const nextReasonIndex=commands.findIndex(item=>olliTalkBatchCommandNeedsReason(item) && !String(item.reason || '').trim());
    if(nextReasonIndex>=0){
      olliTalkPendingActionReason={intent:'batch_write',__batchAgent:nextPending};
      const prompt=olliTalkBatchReasonPrompt(commands[nextReasonIndex]);
      return saveOlliTalkPendingTextInputReply(
        context,
        prompt,
        reasonMessageId,
        olliTalkPendingActionReason
      );
    }

    const clarificationIndex=commands.findIndex(olliTalkBatchCommandNeedsClarification);
    if(clarificationIndex>=0){
      olliTalkPendingActionReason={intent:'batch_write',__batchAgent:nextPending};
      const assistantMessage=await startOlliTalkBatchStructuredChoice(context,nextPending,clarificationIndex);
      return {
        assistantMessage,
        replyText:String(assistantMessage?.body || '').trim() || '필요한 정보를 선택해 주세요.',
        recordAi:false
      };
    }

    olliTalkPendingActionReason=null;
    return resolveOlliTalkBatchAgentTurn({
      sourceText:nextPending.sourceMessageText,
      sourceMessageId:nextPending.sourceMessageId,
      commands,
      context
    });
  }

  async function resolveOlliTalkPendingReasonDirectTurn(reasonText,context,replyToMessageId,pendingOverride=null){
    const reason=String(reasonText || '').trim();
    const pending=pendingOverride && typeof pendingOverride==='object'
      ? pendingOverride
      : olliTalkPendingActionReason;
    if(!reason || !pending) throw new Error('진행 중인 사유 입력 작업을 찾지 못했습니다.');

    if(isOlliTalkPendingReasonCancel(reason)){
      olliTalkPendingActionReason=null;
      const message='작업 준비를 취소했어요.';
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
        replyText:message,
        recordAi:false
      };
    }

    const intent=String(pending.intent || '').trim();
    const structuredMakeup=pending.__structuredMakeupCancel || null;
    if(intent==='cancel_makeup' && structuredMakeup){
      olliTalkPendingActionReason=null;
      return resolveOlliTalkStructuredMakeupCancelTurn({
        structuredCommand:structuredMakeup.structuredCommand,
        sourceText:String(structuredMakeup.sourceMessageText || '').trim(),
        sourceMessageId:Number(structuredMakeup.sourceMessageId || 0),
        reasonText:reason,
        reasonMessageText:reason,
        reasonMessageId:Number(replyToMessageId || 0),
        context,
      });
    }

    const structuredTrial=pending.__structuredTrialCancel || null;
    if(intent==='cancel_trial' && structuredTrial){
      olliTalkPendingActionReason=null;
      return resolveOlliTalkStructuredTrialCancelTurn({
        structuredCommand:structuredTrial.structuredCommand,
        sourceText:String(structuredTrial.sourceMessageText || '').trim(),
        sourceMessageId:Number(structuredTrial.sourceMessageId || 0),
        reasonText:reason,
        reasonMessageText:reason,
        reasonMessageId:Number(replyToMessageId || 0),
        context,
      });
    }

    const trialCancelAgent=pending.__trialCancelAgent || null;
    if(intent==='cancel_trial' && trialCancelAgent){
      olliTalkPendingActionReason=null;
      return resolveOlliTalkTrialCancelAgentTurn({
        sourceText:String(trialCancelAgent.sourceMessageText || '').trim(),
        sourceMessageId:Number(trialCancelAgent.sourceMessageId || 0),
        reasonText:reason,
        reasonMessageText:reason,
        reasonMessageId:Number(replyToMessageId || 0),
        context,
      });
    }

    const makeupCancelAgent=pending.__makeupCancelAgent || null;
    if(intent==='cancel_makeup' && makeupCancelAgent){
      olliTalkPendingActionReason=null;
      return resolveOlliTalkMakeupCancelAgentTurn({
        sourceText:String(makeupCancelAgent.sourceMessageText || '').trim(),
        sourceMessageId:Number(makeupCancelAgent.sourceMessageId || 0),
        reasonText:reason,
        reasonMessageText:reason,
        reasonMessageId:Number(replyToMessageId || 0),
        context,
      });
    }

    const absenceAgent=pending.__absenceAgent || null;
    if(intent==='mark_absent' && absenceAgent){
      olliTalkPendingActionReason=null;
      return resolveOlliTalkAbsenceAgentTurn({
        sourceText:String(absenceAgent.sourceMessageText || '').trim(),
        sourceMessageId:Number(absenceAgent.sourceMessageId || 0),
        reasonText:reason,
        reasonMessageText:reason,
        reasonMessageId:Number(replyToMessageId || 0),
        context,
      });
    }

    if(intent==='batch_write' && pending.__batchAgent){
      return continueOlliTalkBatchReasonChoice(
        reason,
        pending,
        context,
        Number(replyToMessageId || 0)
      );
    }

    const schedule=window.OlliCommandSchedule;
    const command=Object.assign({},pending,{reason});
    olliTalkPendingActionReason=null;
    const confirmation=String(schedule?.writeConfirmationMessage?.(command) || '').trim() || '이 작업을 진행할까요?';
    return {
      assistantMessage:await saveOlliTalkActionReply(context,confirmation,command,replyToMessageId),
      replyText:confirmation,
      recordAi:false
    };
  }

  function getOlliTalkFastCancelReasonCommand(pending,reason=''){
    if(!pending || typeof pending!=='object') return null;
    const intent=String(pending.intent || '').trim();
    if(!['cancel_makeup','cancel_trial'].includes(intent)) return null;
    if(intent==='batch_write' || pending.__batchAgent) return null;

    const nested=intent==='cancel_makeup'
      ? pending?.__structuredMakeupCancel?.structuredCommand
      : pending?.__structuredTrialCancel?.structuredCommand;
    const source=nested && typeof nested==='object' ? nested : pending;
    const command=Object.assign({},source);
    const commandIntent=String(command.intent || command.action || '').trim();
    if(commandIntent!==intent) return null;
    if(!String(command.oneTimeSessionId || command.one_time_session_id || '').trim()) return null;
    if(!String(command.sessionDate || command.session_date || '').trim()) return null;
    if(Number(command.timeSlot || command.time_slot || 0)<=0) return null;

    delete command.__structuredMakeupCancel;
    delete command.__structuredTrialCancel;
    delete command.__makeupCancelAgent;
    delete command.__trialCancelAgent;
    command.intent=intent;
    command.reason=String(reason || '').trim();
    return command;
  }

  function getOlliTalkFastCancelConfirmation(pending,reason){
    const command=getOlliTalkFastCancelReasonCommand(pending,reason);
    if(!command) return '';
    const schedule=window.OlliCommandSchedule;
    const confirmation=String(schedule?.writeConfirmationMessage?.(command) || '').trim();
    if(confirmation) return confirmation;

    const name=String(command.studentName || command.guestName || '학생').trim() || '학생';
    const kind=command.intent==='cancel_trial' ? '체험수업' : '보강';
    return name+' 학생의 '+kind+'을 '+String(reason || '').trim()+' 사유로 취소할까요?';
  }

  function replaceOlliTalkReasonChoiceWithSelection(wrap,reasonAction){
    const card=wrap?.closest?.('.olliTalkBetaActionCard');
    if(!card || !reasonAction) return false;
    const selectedAction=Object.assign({},reasonAction,{
      display_label:String(reasonAction.display_label || reasonAction.selected_reason || '').trim()
    });
    const replacement=createOlliTalkActionCard(selectedAction);
    if(!replacement) return false;
    card.replaceWith(replacement);
    return true;
  }

  async function submitOlliTalkPendingReasonText(reasonText,wrap,action){
    const reason=String(reasonText || '').trim();
    const actionId=String(action?.id || '').trim();
    if(!reason || !actionId || olliTalkPendingReasonSubmitInFlight) return false;

    const context=getOlliTalkBetaContext();
    if(!context.sessionToken || !context.academyId){
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return false;
    }

    olliTalkPendingReasonSubmitInFlight=true;
    wrap?.classList?.add('busy');
    wrap?.querySelectorAll?.('button,input').forEach(control=>{control.disabled=true});

    try{
      const fastPending=olliTalkPendingActionReason;
      const fastCommand=getOlliTalkFastCancelReasonCommand(fastPending,reason);
      if(fastCommand){
        const confirmationBody=getOlliTalkFastCancelConfirmation(fastPending,reason);
        const payload=await callOlliTalkRpc('olli_team_chat_action_select_reason_prepare_cancel',{
          p_session_token:context.sessionToken,
          p_academy_id:context.academyId,
          p_action_id:actionId,
          p_reason:reason,
          p_confirmation_body:confirmationBody
        });
        if(!payload?.ok || !payload?.reason_action || !payload?.confirmation_message?.action){
          throw new Error(payload?.message || '취소 확인 작업을 준비하지 못했습니다.');
        }

        const active=document.activeElement;
        if(active && wrap?.contains?.(active) && typeof active.blur==='function') active.blur();

        closeOlliTalkPendingReasonInputMode({blur:true});
        olliTalkPendingActionReason=null;
        olliTalkPendingTextInputMessageId='';
        replaceOlliTalkReasonChoiceWithSelection(wrap,payload.reason_action);
        appendOlliTalkPersistedMessage(payload.confirmation_message,context.memberId);
        return true;
      }

      const payload=await callOlliTalkRpc('olli_team_chat_action_select_reason',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId,
        p_reason:reason
      });
      const pending=payload?.pending;
      const reasonMessageId=Number(payload?.action?.message_id || 0);
      if(!payload?.ok || !payload?.action || !pending || !Number.isSafeInteger(reasonMessageId) || reasonMessageId<=0){
        throw new Error(payload?.message || '취소 사유를 선택하지 못했습니다.');
      }

      olliTalkPendingActionReason=pending;
      await resolveOlliTalkPendingReasonDirectTurn(
        reason,
        context,
        reasonMessageId,
        pending
      );
      closeOlliTalkPendingReasonInputMode({blur:true});
      olliTalkPendingTextInputMessageId='';

      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
      return true;
    }catch(error){
      console.warn('올리톡 전용 사유 선택 처리 실패:',error);
      alert(error?.message || '취소 사유를 처리하지 못했습니다.');
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      }).catch(()=>{});
      return false;
    }finally{
      olliTalkPendingReasonSubmitInFlight=false;
      wrap?.classList?.remove('busy');
      if(isOlliTalkPendingReasonInputActive()){
        wrap?.querySelectorAll?.('button,input').forEach(control=>{control.disabled=false});
      }
    }
  }

  function isOlliTalkPendingReasonInputActive(){
    return !!(
      olliTalkPendingReasonInputField?.isConnected
      && getScreen()?.classList?.contains('olliTalkReasonInputActive')
    );
  }

  function clearOlliTalkPendingReasonTimers(){
    if(olliTalkPendingReasonAnchorTimer){
      clearTimeout(olliTalkPendingReasonAnchorTimer);
      olliTalkPendingReasonAnchorTimer=null;
    }
    if(olliTalkPendingReasonFocusRaf){
      cancelAnimationFrame(olliTalkPendingReasonFocusRaf);
      olliTalkPendingReasonFocusRaf=0;
    }
  }

  function closeOlliTalkPendingReasonInputMode(options={}){
    const field=olliTalkPendingReasonInputField;
    clearOlliTalkPendingReasonTimers();
    olliTalkPendingReasonAnchorPending=false;
    olliTalkPendingReasonInputField=null;
    getScreen()?.classList?.remove('olliTalkReasonInputActive');

    if(options.blur!==false && field && document.activeElement===field){
      field.blur();
    }
    scheduleOlliTalkChatToComposer();
  }

  function anchorOlliTalkPendingReasonInput(field){
    const chatArea=document.getElementById('olliTalkBetaChatArea');
    if(!chatArea?.isConnected || !field?.isConnected) return false;

    const viewport=window.visualViewport;
    const chatRect=chatArea.getBoundingClientRect();
    const viewportBottom=viewport
      ? Number(viewport.offsetTop || 0)+Number(viewport.height || 0)
      : Number(window.innerHeight || chatRect.bottom);
    const visibleBottom=Math.min(chatRect.bottom,viewportBottom)-OLLI_TALK_COMPOSER_MESSAGE_GAP;
    const fieldRect=field.getBoundingClientRect();
    const overflow=fieldRect.bottom-visibleBottom;
    if(overflow<=0.5) return true;

    const maxScroll=Math.max(0,chatArea.scrollHeight-chatArea.clientHeight);
    chatArea.scrollTop=Math.max(0,Math.min(maxScroll,chatArea.scrollTop+overflow));
    return true;
  }

  function scheduleOlliTalkPendingReasonAnchorAfterViewport(){
    if(
      !olliTalkPendingReasonAnchorPending
      || !isOlliTalkPendingReasonInputActive()
      || olliTalkChatGestureActive
    ) return false;

    if(olliTalkPendingReasonAnchorTimer) clearTimeout(olliTalkPendingReasonAnchorTimer);
    olliTalkPendingReasonAnchorTimer=setTimeout(()=>{
      olliTalkPendingReasonAnchorTimer=null;
      const field=olliTalkPendingReasonInputField;
      if(
        !olliTalkPendingReasonAnchorPending
        || !field?.isConnected
        || document.activeElement!==field
      ) return;

      // 키보드 resize가 안정된 뒤 딱 한 번만 chatArea 내부를 이동합니다.
      olliTalkPendingReasonAnchorPending=false;
      anchorOlliTalkPendingReasonInput(field);
    },72);
    return true;
  }

  function focusOlliTalkPendingReasonInputAfterLayout(field){
    clearOlliTalkPendingReasonTimers();
    olliTalkPendingReasonAnchorPending=true;

    // 입력칸 DOM/레이아웃을 먼저 한 frame 보여준 다음 키보드를 엽니다.
    olliTalkPendingReasonFocusRaf=requestAnimationFrame(()=>{
      olliTalkPendingReasonFocusRaf=requestAnimationFrame(()=>{
        olliTalkPendingReasonFocusRaf=0;
        if(!isOlliTalkPendingReasonInputActive() || !field?.isConnected) return;
        try{field.focus({preventScroll:true})}catch(_){field.focus()}
        // visualViewport가 없는 환경의 fallback. 실제 scroll write는 역시 한 번만 일어납니다.
        if(!window.visualViewport) scheduleOlliTalkPendingReasonAnchorAfterViewport();
      });
    });
  }

  function openOlliTalkPendingReasonInput(event){
    if(event){
      event.preventDefault();
      event.stopPropagation();
    }
    const wrap=event?.currentTarget?.closest?.('.olliTalkBetaPendingInput');
    const form=wrap?.querySelector?.('.olliTalkBetaPendingReasonForm');
    const field=form?.querySelector?.('.olliTalkBetaPendingReasonField');
    if(!form || !field) return false;

    const standardInput=getOlliTalkBetaInput();
    if(standardInput && document.activeElement===standardInput) standardInput.blur();

    form.hidden=false;
    event.currentTarget.setAttribute('aria-expanded','true');
    olliTalkPendingReasonInputField=field;
    getScreen()?.classList?.add('olliTalkReasonInputActive');
    olliTalkKeyboardFollowLatest=false;
    hideOlliTalkMentionMenu();
    scheduleOlliTalkChatToComposer();

    focusOlliTalkPendingReasonInputAfterLayout(field);
    return true;
  }

  function createOlliTalkPendingTextInputButton(action){
    const wrap=document.createElement('div');
    wrap.className='olliTalkBetaPendingInput';

    const noReason=document.createElement('button');
    noReason.type='button';
    noReason.className='olliTalkBetaPendingInputButton';
    noReason.textContent='사유 없음';
    noReason.setAttribute('aria-label','사유 없이 진행');
    noReason.addEventListener('click',()=>{
      submitOlliTalkPendingReasonText('사유 없음',wrap,action)
        .catch(error=>console.warn('올리톡 사유 없음 처리 실패:',error));
    });

    const inputButton=document.createElement('button');
    inputButton.type='button';
    inputButton.className='olliTalkBetaPendingInputButton';
    inputButton.textContent='사유 입력';
    inputButton.setAttribute('aria-label','사유를 직접 입력');
    inputButton.setAttribute('aria-expanded','false');
    inputButton.addEventListener('click',openOlliTalkPendingReasonInput);

    const form=document.createElement('form');
    form.className='olliTalkBetaPendingReasonForm';
    form.hidden=true;

    const field=document.createElement('input');
    field.type='text';
    field.className='olliTalkBetaPendingReasonField';
    field.maxLength=200;
    field.placeholder='취소 사유를 입력하세요';
    field.setAttribute('aria-label','취소 사유 입력');
    field.addEventListener('pointerdown',event=>{
      if(document.activeElement===field) return;
      event.preventDefault();
      if(!isOlliTalkPendingReasonInputActive()){
        olliTalkPendingReasonInputField=field;
        getScreen()?.classList?.add('olliTalkReasonInputActive');
      }
      try{field.focus({preventScroll:true})}catch(_){field.focus()}
      olliTalkPendingReasonAnchorPending=true;
      scheduleOlliTalkPendingReasonAnchorAfterViewport();
    });

    const submit=document.createElement('button');
    submit.type='submit';
    submit.className='olliTalkBetaPendingReasonSubmit';
    submit.textContent='확인';
    submit.setAttribute('aria-label','취소 사유 선택');

    form.addEventListener('submit',event=>{
      event.preventDefault();
      const reason=String(field.value || '').trim();
      if(!reason){
        try{field.focus({preventScroll:true})}catch(_){field.focus()}
        return;
      }
      submitOlliTalkPendingReasonText(reason,wrap,action).catch(error=>{
        console.warn('올리톡 전용 사유 입력 선택 실패:',error);
      });
    });

    form.append(field,submit);
    wrap.append(noReason,inputButton,form);
    return wrap;
  }

  function shouldShowOlliTalkPendingTextInput(item){
    return !!olliTalkPendingActionReason
      && !item?.action
      && String(item?.message_type || '').trim()==='ai'
      && String(item?.id || '').trim()===String(olliTalkPendingTextInputMessageId || '').trim();
  }

  async function saveOlliTalkStructuredTargetChoice(context,body,payload,replyToMessageId){
    const result=await callOlliTalkRpc('olli_team_chat_send_structured_target_choice',{
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_body:normalizeOlliTalkActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:createOlliTalkClientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveOlliTalkStructuredStudentChoice(context,body,payload,replyToMessageId){
    const result=await callOlliTalkRpc('olli_team_chat_send_structured_student_choice',{
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_body:normalizeOlliTalkActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:createOlliTalkClientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '학생 선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveOlliTalkStructuredDivisionChoice(context,body,payload,replyToMessageId){
    const result=await callOlliTalkRpc('olli_team_chat_send_structured_division_choice',{
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_body:normalizeOlliTalkActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:createOlliTalkClientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '수업 구분 선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveOlliTalkStructuredTimeChoice(context,body,payload,replyToMessageId){
    const result=await callOlliTalkRpc('olli_team_chat_send_structured_time_choice',{
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_body:normalizeOlliTalkActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:createOlliTalkClientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '시간 선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveOlliTalkStructuredDateChoice(context,body,payload,replyToMessageId){
    const result=await callOlliTalkRpc('olli_team_chat_send_structured_date_choice',{
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_body:normalizeOlliTalkActionPrompt(body),
      p_action_payload:payload,
      p_client_message_id:createOlliTalkClientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    });
    if(!result?.ok || !result?.message?.action){
      throw new Error(result?.message || '날짜 선택 카드를 저장하지 못했습니다.');
    }
    return result.message;
  }

  async function saveOlliTalkActionReply(context,body,command,replyToMessageId){
    const actionType=String(command?.intent || '').trim();
    if(!actionType) throw new Error('작업 종류를 확인하지 못했습니다.');

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
      p_session_token:context.sessionToken,
      p_academy_id:context.academyId,
      p_body:normalizeOlliTalkActionPrompt(body),
      p_action_payload:command,
      p_client_message_id:createOlliTalkClientMessageId(),
      p_reply_to_message_id:Number(replyToMessageId || 0) || null
    };
    if(rpcName==='olli_team_chat_send_action')rpcPayload.p_action_type=actionType;
    const payload=await callOlliTalkRpc(rpcName,rpcPayload);
    if(!payload?.ok || !payload?.message?.action){
      throw new Error(payload?.message || '작업 카드를 저장하지 못했습니다.');
    }
    return payload.message;
  }

  function parseOlliTalkTimetableAdminRuleCandidate(commandText,router=window.OlliCommandRouter){
    if(!router) return null;
    try{
      const parsers=[
        'parseClassLayoutMutationIntent',
        'parseTeacherAssignmentMutationIntent',
        'parseSessionOrderMutationIntent',
        'parseNormalClassDayMutationIntent'
      ];
      for(const name of parsers){
        if(typeof router[name]!=='function') continue;
        const parsed=router[name](commandText);
        if(parsed) return parsed;
      }
      return null;
    }catch(error){
      console.warn('올리톡 시간표 관리 Agent 후보 판별 실패:',error);
      return null;
    }
  }

  function parseOlliTalkBatchAgentCandidate(commandText,router=window.OlliCommandRouter){
    if(!router || typeof router.parseMultiWriteIntent!=='function') return null;
    try{
      const parsed=router.parseMultiWriteIntent(commandText);
      return String(parsed?.intent || '').trim()==='batch_write' && Array.isArray(parsed?.commands)
        ? parsed
        : null;
    }catch(error){
      console.warn('올리톡 복합쓰기 Agent 후보 판별 실패:',error);
      return null;
    }
  }

  function olliTalkBatchCommandNeedsReason(command){
    return ['mark_absent','cancel_makeup','cancel_trial'].includes(String(command?.intent || '').trim());
  }

  function olliTalkBatchReasonPrompt(command){
    const intent=String(command?.intent || '').trim();
    if(intent==='mark_absent') return String(command?.studentName || '').trim()+' 학생의 결석 사유를 알려주세요.';
    if(intent==='cancel_makeup') return String(command?.studentName || '').trim()+' 학생의 보강 취소 사유를 알려주세요.';
    if(intent==='cancel_trial') return String(command?.guestName || command?.studentName || '').trim()+' 학생의 체험 취소 사유를 알려주세요.';
    return '사유를 알려주세요.';
  }

  function olliTalkBatchCommandNeedsClarification(command){
    return command?.needsClarification===true;
  }

  function olliTalkBatchClarificationPrompt(command){
    if(String(command?.intent || '').trim()==='add_makeup'){
      return String(command?.studentName || '').trim()+' 학생의 보강 날짜와 시간을 함께 알려주세요.';
    }
    return '작업에 필요한 날짜와 시간을 함께 알려주세요.';
  }

  function applyOlliTalkBatchClarification(command,replyText,replyMessageId,router){
    const item=Object.assign({},command);
    const reply=String(replyText || '').trim();
    if(String(item.intent || '').trim()==='add_makeup' && router && typeof router.parseMakeupMutationIntent==='function'){
      const contextText=String(item.text+' '+reply).trim();
      const parsed=router.parseMakeupMutationIntent(contextText);
      if(!parsed || String(parsed.intent || '').trim()!=='add_makeup') return null;
      item.needsClarification=false;
      item.contextText=contextText;
      item.clarificationMessageId=Number(replyMessageId || 0);
      item.clarificationMessageText=reply;
      return item;
    }
    return null;
  }

  function buildOlliTalkBatchAgentCommands(batch,sourceMessageId,sourceMessageText,interpretedBatchCommands=[]){
    const parsed=Array.isArray(batch?.commands)?batch.commands:[];
    const structured=Array.isArray(interpretedBatchCommands)?interpretedBatchCommands:[];
    const router=window.OlliCommandRouter;
    return parsed.map((command,index)=>{
      const intent=String(command?.intent || '').trim();
      const provided=structured[index]&&typeof structured[index]==='object'?structured[index]:null;
      const derived=router && typeof router.interpretedIntentToStructuredCommand==='function'
        ? router.interpretedIntentToStructuredCommand(intent,String(command?.originalText || '').trim())
        : null;
      const system=provided && String(provided.action || '').trim()===intent ? provided : (derived || {});
      if(String(system?.action || '').trim()!==intent) return null;
      const reason=String(system?.reason || '').trim() || String(command?.reason || '').trim();
      const item={
        intent,
        text:String(command?.originalText || '').trim(),
        studentName:String(system?.studentName || '').trim() || String(command?.studentName || command?.guestName || '').trim(),
        division:String(system?.division || '').trim() || String(command?.division || '').trim(),
        dateExpression:String(system?.dateExpression || '').trim() || String(command?.dateLabel || command?.dateSpec?.label || '').trim(),
        timeSlot:Number(system?.timeSlot || command?.timeSlot || 0),
        classGroup:(String(system?.classGroup || '').trim() || String(command?.classGroup || '').trim()).toUpperCase(),
        reason,
        reasonMessageId:olliTalkBatchCommandNeedsReason(command) && reason ? Number(sourceMessageId || 0) : 0,
        reasonMessageText:olliTalkBatchCommandNeedsReason(command) && reason ? String(sourceMessageText || '').trim() : '',
        memoNote:String(system?.memoNote || '').trim() || String(command?.memoNote || '').trim(),
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

  function olliTalkBatchStructuredCommand(command,index){
    const intent=String(command?.intent || '').trim();
    const base=command?.structuredCommand&&typeof command.structuredCommand==='object'
      ? Object.assign({},command.structuredCommand)
      : {};
    return Object.assign(base,{
      action:intent,
      studentName:String(base.studentName || command?.studentName || '').trim(),
      division:String(base.division || command?.division || '').trim(),
      dateExpression:String(base.dateExpression || command?.dateExpression || '').trim(),
      timeSlot:Number(base.timeSlot || command?.timeSlot || 0),
      classGroup:String(base.classGroup || command?.classGroup || '').trim().toUpperCase(),
      batchStructured:true,
      batchCommandIndex:Number(index)
    });
  }


  function activeOlliTalkBatchStructuredCommand(draft){
    const pending=olliTalkPendingActionReason?.__batchAgent;
    const index=Number(draft?.batchCommandIndex);
    if(
      String(olliTalkPendingActionReason?.intent || '').trim()!=='batch_write'
      || !pending
      || draft?.batchStructured!==true
      || !Number.isInteger(index)
      || index<0
    ) return null;
    const commands=Array.isArray(pending.commands)
      ? pending.commands.map(item=>Object.assign({},item))
      : [];
    if(!['add_makeup','add_trial','add_waitlist','add_pickup'].includes(String(commands[index]?.intent || '').trim())) return null;
    return {pending,index,commands};
  }

  async function finishOlliTalkBatchStructuredCommand(draft,prepared,context){
    const active=activeOlliTalkBatchStructuredCommand(draft);
    if(!active || prepared?.kind!=='action_pending' || !prepared?.payload) return null;
    const intent=String(active.commands[active.index]?.intent || '').trim();
    let selection=null;
    if(intent==='add_makeup'){
      selection={
        sessionDate:String(prepared.payload.sessionDate || '').trim(),
        timeSlot:Number(prepared.payload.timeSlot || 0),
        classGroup:String(prepared.payload.classGroup || '').trim().toUpperCase()
      };
      if(!/^\d{4}-\d{2}-\d{2}$/.test(selection.sessionDate)||selection.timeSlot<=0||!['A','B'].includes(selection.classGroup)){
        throw new Error('복합쓰기 보강 선택 결과를 확인하지 못했습니다.');
      }
    }else if(intent==='add_trial'){
      selection={
        sessionDate:String(prepared.payload.sessionDate || '').trim(),
        timeSlot:Number(prepared.payload.timeSlot || 0),
        classGroup:String(prepared.payload.classGroup || '').trim().toUpperCase(),
        division:String(prepared.payload.division || '').trim()
      };
    }else if(intent==='add_waitlist'){
      selection={
        sessionDate:String(prepared.payload.sessionDate || prepared.payload.effectiveDate || '').trim(),
        timeSlot:Number(prepared.payload.targetTimeSlot || 0),
        classGroup:String(prepared.payload.targetClassGroup || '').trim().toUpperCase(),
        division:String(prepared.payload.division || '').trim()
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

    const nextIndex=active.commands.findIndex(olliTalkBatchCommandNeedsClarification);
    const nextPending={
      sourceMessageId:Number(active.pending.sourceMessageId || 0),
      sourceMessageText:String(active.pending.sourceMessageText || '').trim(),
      commands:active.commands
    };
    if(nextIndex>=0){
      olliTalkPendingActionReason={intent:'batch_write',__batchAgent:nextPending};
      return startOlliTalkBatchStructuredChoice(context,nextPending,nextIndex);
    }

    olliTalkPendingActionReason=null;
    const turn=await resolveOlliTalkBatchAgentTurn({
      sourceText:nextPending.sourceMessageText,
      sourceMessageId:nextPending.sourceMessageId,
      commands:active.commands,
      context
    });
    return turn?.assistantMessage || null;
  }


  async function startOlliTalkBatchStructuredChoice(context,pendingBatch,index){
    const router=window.OlliCommandRouter;
    const command=Array.isArray(pendingBatch?.commands)?pendingBatch.commands[index]:null;
    if(
      !router
      || typeof router.prepareStructuredAction!=='function'
      || !['add_makeup','add_trial','add_waitlist','add_pickup'].includes(String(command?.intent || '').trim())
    ){
      throw new Error('복합쓰기 선택 기능을 준비하지 못했습니다.');
    }

    const prepared=await router.prepareStructuredAction(
      olliTalkBatchStructuredCommand(command,index),
      {source:'olli_talk_batch_structured_choice',selectedStudent:null,autoSubmitContext:null}
    );
    if(prepared?.handled!==true) throw new Error('복합쓰기 선택을 준비하지 못했습니다.');

    const replyToMessageId=Number(pendingBatch?.sourceMessageId || 0) || null;
    if(prepared.kind==='action_needs_field' && prepared.payload){
      const field=String(prepared.payload.field || '').trim();
      if(field==='student_choice') return saveOlliTalkStructuredStudentChoice(context,prepared.message || '학생을 선택해 주세요.',prepared.payload,replyToMessageId);
      if(field==='target_choice') return saveOlliTalkStructuredTargetChoice(context,prepared.message || '보강할 반을 선택해 주세요.',prepared.payload,replyToMessageId);
      if(field==='division') return saveOlliTalkStructuredDivisionChoice(context,prepared.message || '유치부인지 초등부인지 선택해 주세요.',prepared.payload,replyToMessageId);
      if(field==='date') return saveOlliTalkStructuredDateChoice(context,prepared.message || '보강 날짜를 선택해 주세요.',prepared.payload,replyToMessageId);
      if(field==='time') return saveOlliTalkStructuredTimeChoice(context,prepared.message || '보강 시간을 선택해 주세요.',prepared.payload,replyToMessageId);
    }
    if(prepared.kind==='action_pending' && prepared.payload){
      return finishOlliTalkBatchStructuredCommand(olliTalkBatchStructuredCommand(command,index),prepared,context);
    }
    if(prepared.kind==='action_rejected'){
      return saveOlliTalkOlliReply(context,String(prepared.message || '').trim() || '보강 등록을 준비하지 못했어요.',replyToMessageId);
    }
    throw new Error('복합쓰기 선택 상태를 확인하지 못했습니다.');
  }

  function parseOlliTalkTrialCancelAgentCandidate(commandText,router=window.OlliCommandRouter){
    if(!router || typeof router.parseTrialCancelMutationIntent!=='function') return null;
    try{
      const parsed=router.parseTrialCancelMutationIntent(commandText);
      return String(parsed?.intent || '').trim()==='cancel_trial' ? parsed : null;
    }catch(error){
      console.warn('올리톡 체험 취소 Agent 후보 판별 실패:',error);
      return null;
    }
  }

  function parseOlliTalkMakeupAddDraftCandidate(commandText,router=window.OlliCommandRouter){
    if(!router || typeof router.parseBatchDraftWriteIntent!=='function') return null;
    try{
      const parsed=router.parseBatchDraftWriteIntent(commandText);
      if(String(parsed?.intent || '').trim()!=='add_makeup' || parsed?.batchDraft!==true) return null;
      const missing=Array.isArray(parsed.missingBatchFields)
        ? parsed.missingBatchFields.map(item=>String(item || '').trim()).filter(Boolean)
        : [];
      return missing.length ? Object.assign({},parsed,{missingBatchFields:missing}) : null;
    }catch(error){
      console.warn('올리톡 보강 등록 추가정보 후보 판별 실패:',error);
      return null;
    }
  }

  function olliTalkMakeupAddDraftPrompt(candidate){
    const missing=Array.isArray(candidate?.missingBatchFields) ? candidate.missingBatchFields : [];
    const needsDate=missing.includes('date');
    const needsTime=missing.includes('time');
    if(needsDate && needsTime){
      return '보강 날짜와 시간이 빠져 있어요. 날짜와 시간을 포함해서 다시 요청해 주세요. 예: 권보미 10월 5일 5시 보강 등록해줘';
    }
    if(needsDate){
      return '보강 날짜가 빠져 있어요. 날짜를 포함해서 다시 요청해 주세요. 예: 권보미 10월 5일 5시 보강 등록해줘';
    }
    if(needsTime){
      return '보강 시간이 빠져 있어요. 시간을 포함해서 다시 요청해 주세요. 예: 권보미 10월 5일 5시 보강 등록해줘';
    }
    return '보강 등록에 필요한 날짜와 시간을 함께 알려 주세요.';
  }

  function parseOlliTalkMakeupCancelAgentCandidate(commandText,router=window.OlliCommandRouter){
    if(!router || typeof router.parseMakeupCancelMutationIntent!=='function') return null;
    try{
      const parsed=router.parseMakeupCancelMutationIntent(commandText);
      return String(parsed?.intent || '').trim()==='cancel_makeup' ? parsed : null;
    }catch(error){
      console.warn('올리톡 보강 취소 Agent 후보 판별 실패:',error);
      return null;
    }
  }

  function parseOlliTalkAbsenceAgentCandidate(commandText,router=window.OlliCommandRouter){
    if(!router || typeof router.parseAbsenceMutationIntent!=='function') return null;
    try{
      const parsed=router.parseAbsenceMutationIntent(commandText);
      return String(parsed?.intent || '').trim()==='mark_absent' && String(parsed?.studentName || '').trim() ? parsed : null;
    }catch(error){
      console.warn('올리톡 결석 Agent 후보 판별 실패:',error);
      return null;
    }
  }

  function isOlliTalkClassOnceAgentCandidate(commandText,router=window.OlliCommandRouter){
    if(!router || typeof router.parseClassMutationIntent!=='function') return false;
    try{
      return String(router.parseClassMutationIntent(commandText)?.intent || '').trim()==='add_class_once';
    }catch(error){
      console.warn('올리톡 1회 수업 Agent 후보 판별 실패:',error);
      return false;
    }
  }

  async function resolveOlliTalkAttendanceStatusAgentTurn(commandText,parsed,context,replyToMessageId){
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
      throw new Error('출석부 상태 변경 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'attendance_status_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(commandText || '').trim(),
        sourceMessageId
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true || !data?.message?.action){
      throw new Error(data?.error || data?.message || '출석부 상태 변경 Agent 응답을 받지 못했습니다.');
    }
    if(String(data.message.action.action_type || '').trim()!=='set_attendance_status'){
      throw new Error('출석부 상태 변경 Agent 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  async function resolveOlliTalkTimetableAdminRuleTurn(commandText,parsed,context,replyToMessageId){
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
      throw new Error('시간표 관리 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    const expectedType=String(parsed?.intent || '').trim();
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'timetable_admin_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(commandText || '').trim(),
        sourceMessageId
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true){
      throw new Error(data?.error || data?.message || '시간표 관리 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=String(data.choiceRequired.message || '').trim() || '수업 순서를 변경할 수업을 선택해 주세요.';
      return {
        assistantMessage:await saveOlliTalkStructuredTargetChoice(
          context,
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
    if(String(data.message.action.action_type || '').trim()!==expectedType){
      throw new Error('시간표 관리 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }


  async function resolveOlliTalkStructuredTimetableAdminTurn(structuredCommand,context,sourceMessageText,sourceMessageId){
    const sourceId=Number(sourceMessageId || 0);
    const sourceText=String(sourceMessageText || '').trim();
    if(!Number.isSafeInteger(sourceId)||sourceId<=0||!sourceText){
      throw new Error('수업 순서 변경 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_timetable_admin_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:sourceText,
        sourceMessageId:sourceId,
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true||!data?.message?.action){
      throw new Error(data?.error || data?.message || '시간표 관리 규칙 시스템 응답을 받지 못했습니다.');
    }
    const expectedType=String(structuredCommand?.action || '').trim();
    if(!['set_session_order','set_class_teacher','set_teacher_override'].includes(expectedType)
      ||String(data.message.action.action_type || '').trim()!==expectedType){
      throw new Error('시간표 관리 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  async function resolveOlliTalkSourceBoundReadAgentTurn({
    mode,
    commandText,
    readIntent=null,
    context,
    replyToMessageId,
  }){
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
      throw new Error('시간표 조회 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    const body={
      mode,
      academyId:context?.academyId || '',
      sessionToken:context?.sessionToken || '',
      message:String(commandText || '').trim(),
      sourceMessageId
    };
    if(readIntent) body.readIntent=readIntent;

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    const data=await response.json().catch(()=>({}));
    const replyText=String(data?.output || '').trim();
    if(!response.ok || data?.ok!==true || !replyText){
      throw new Error(data?.error || data?.message || '시간표 읽기 Agent 응답을 받지 못했습니다.');
    }
    return {
      assistantMessage:await saveOlliTalkOlliReply(context,replyText,sourceMessageId),
      replyText,
      recordAi:false
    };
  }

  async function resolveOlliTalkBatchAgentTurn({
    sourceText,
    sourceMessageId,
    commands,
    context,
  }){
    const sourceId=Number(sourceMessageId || 0);
    if(!Number.isSafeInteger(sourceId) || sourceId<=0){
      throw new Error('복합쓰기 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'batch_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(sourceText || '').trim(),
        sourceMessageId:sourceId,
        commands
      })
    });
    const data=await response.json().catch(()=>({}));
    const messages=Array.isArray(data?.messages)?data.messages:[];
    if(!response.ok || data?.ok!==true || messages.length<2){
      throw new Error(data?.error || data?.message || '복합쓰기 Agent 응답을 받지 못했습니다.');
    }
    return {
      assistantMessage:messages[0],
      assistantMessages:messages,
      replyText:messages.map(message=>String(message?.body || '').trim()).filter(Boolean).join('\n'),
      recordAi:false
    };
  }

  async function resolveOlliTalkStructuredTimetableMemoTurn(structuredCommand,context,sourceMessageText,sourceMessageId){
    const sourceId=Number(sourceMessageId || 0);
    const sourceText=String(sourceMessageText || '').trim();
    const memoNote=String(structuredCommand?.memoNote || structuredCommand?.memo_note || '').trim();
    if(!Number.isSafeInteger(sourceId)||sourceId<=0||!sourceText){
      throw new Error('시간표 메모 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_memo_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
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
      const choiceMessage=String(data.choiceRequired.message || '').trim() || '삭제할 메모를 선택해 주세요.';
      return {
        assistantMessage:await saveOlliTalkStructuredTargetChoice(
          context,
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
    const expectedType=String(structuredCommand?.action || '').trim();
    if(String(data.message.action.action_type || '').trim()!==expectedType){
      throw new Error('시간표 메모 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  function mergeOlliTalkStructuredTrialCancelCommand(previous,current){
    const before=previous && typeof previous==='object' ? previous : {};
    const next=current && typeof current==='object' ? current : {};
    const nextTime=Number(next.timeSlot || 0);
    const nextMinute=Number(next.classMinute || 0);
    return {
      action:'cancel_trial',
      studentName:String(next.studentName || '').trim() || String(before.studentName || '').trim(),
      oneTimeSessionId:String(next.oneTimeSessionId || next.one_time_session_id || '').trim() || String(before.oneTimeSessionId || before.one_time_session_id || '').trim(),
      division:String(next.division || '').trim() || String(before.division || '').trim(),
      dateExpression:String(next.dateExpression || '').trim() || String(before.dateExpression || '').trim(),
      timeSlot:nextTime>0 ? nextTime : Number(before.timeSlot || 0),
      classMinute:(nextTime>0 || nextMinute>0) ? nextMinute : Number(before.classMinute || 0),
      classGroup:String(next.classGroup || '').trim().toUpperCase() || String(before.classGroup || '').trim().toUpperCase(),
      reason:String(next.reason || '').trim() || String(before.reason || '').trim(),
    };
  }

  async function resolveOlliTalkStructuredTrialCancelTurn({
    structuredCommand,
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    context,
  }){
    const sourceId=Number(sourceMessageId || 0);
    const reasonId=Number(reasonMessageId || 0);
    if(!Number.isSafeInteger(sourceId)||sourceId<=0){
      throw new Error('체험 취소 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if(!Number.isSafeInteger(reasonId)||reasonId<=0||!String(reasonText || '').trim()){
      throw new Error('체험 취소 사유 메시지를 확인하지 못했습니다.');
    }

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_trial_cancel_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(sourceText || '').trim(),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:String(reasonMessageText || '').trim(),
        reason:String(reasonText || '').trim(),
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true){
      throw new Error(data?.error || data?.message || '체험 취소 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=String(data.choiceRequired.message || '').trim() || '취소할 체험수업을 선택해 주세요.';
      return {
        assistantMessage:await saveOlliTalkStructuredTargetChoice(context,choiceMessage,data.choiceRequired.payload,sourceId),
        replyText:choiceMessage,
        recordAi:false
      };
    }
    if(!data?.message?.action){
      throw new Error(data?.error || data?.message || '체험 취소 확인 카드를 받지 못했습니다.');
    }
    if(String(data.message.action.action_type || '').trim()!=='cancel_trial'){
      throw new Error('체험 취소 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  async function resolveOlliTalkTrialCancelAgentTurn({
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    context,
  }){
    const sourceId=Number(sourceMessageId || 0);
    const reasonId=Number(reasonMessageId || 0);
    if(!Number.isSafeInteger(sourceId) || sourceId<=0){
      throw new Error('체험 취소 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if(!Number.isSafeInteger(reasonId) || reasonId<=0 || !String(reasonText || '').trim()){
      throw new Error('체험 취소 사유 메시지를 확인하지 못했습니다.');
    }

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'trial_cancel_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(sourceText || '').trim(),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:String(reasonMessageText || '').trim(),
        reason:String(reasonText || '').trim()
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true || !data?.message?.action){
      throw new Error(data?.error || data?.message || '체험 취소 Agent 응답을 받지 못했습니다.');
    }
    if(String(data.message.action.action_type || '').trim()!=='cancel_trial'){
      throw new Error('체험 취소 Agent 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  async function resolveOlliTalkStructuredWaitlistUpdateTurn(structuredCommand,context,sourceText,replyToMessageId){
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
      throw new Error('대기 변경 요청의 원문 메시지를 확인하지 못했습니다.');
    }

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_waitlist_update_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(sourceText || '').trim(),
        sourceMessageId,
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true){
      throw new Error(data?.error || data?.message || '대기 변경 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=String(data.choiceRequired.message || '').trim() || '변경할 대기를 선택해 주세요.';
      return {
        assistantMessage:await saveOlliTalkStructuredTargetChoice(context,choiceMessage,data.choiceRequired.payload,sourceMessageId),
        replyText:choiceMessage,
        recordAi:false
      };
    }
    if(!data?.message?.action){
      throw new Error(data?.error || data?.message || '대기 변경 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(String(data.message.action.action_type || '').trim()!=='update_waitlist'){
      throw new Error('대기 변경 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  function isOlliTalkSafeMakeupClarification(response,data){
    const code=String(data?.code || '').trim();
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
      && !!String(data?.error || '').trim();
  }

  async function resolveOlliTalkMakeupAgentResponse({
    response,
    data,
    context,
    replyToMessageId,
  }){
    if(!response.ok){
      if(isOlliTalkSafeMakeupClarification(response,data)){
        const message=String(data.error || '').trim();
        olliTalkPendingMakeupDialogue=null;
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      throw new Error(data?.error || data?.message || '보강 등록 Agent 응답을 받지 못했습니다.');
    }

    const interactionStatus=String(data?.interactionStatus || '').trim();
    const aiReply=String(data?.output || '').trim();
    if(data?.ok===true && ['needs_clarification','blocked'].includes(interactionStatus) && aiReply){
      olliTalkPendingMakeupDialogue={ active:true, status:interactionStatus, prompt:aiReply };
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,aiReply,replyToMessageId),
        replyText:aiReply,
        recordAi:false
      };
    }

    if(data?.ok!==true || !data?.message?.action){
      throw new Error(data?.error || data?.message || '보강 등록 Agent 응답을 받지 못했습니다.');
    }
    if(String(data.message.action.action_type || '').trim()!=='add_makeup'){
      throw new Error('보강 등록 Agent 작업 종류가 올바르지 않습니다.');
    }
    olliTalkPendingMakeupDialogue=null;
    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  function mergeOlliTalkStructuredMakeupCancelCommand(previous,current){
    const before=previous && typeof previous==='object' ? previous : {};
    const next=current && typeof current==='object' ? current : {};
    const nextTime=Number(next.timeSlot || 0);
    const nextMinute=Number(next.classMinute || 0);
    return {
      action:'cancel_makeup',
      studentName:String(next.studentName || '').trim() || String(before.studentName || '').trim(),
      oneTimeSessionId:String(next.oneTimeSessionId || next.one_time_session_id || '').trim() || String(before.oneTimeSessionId || before.one_time_session_id || '').trim(),
      dateExpression:String(next.dateExpression || '').trim() || String(before.dateExpression || '').trim(),
      timeSlot:nextTime>0 ? nextTime : Number(before.timeSlot || 0),
      classMinute:(nextTime>0 || nextMinute>0) ? nextMinute : Number(before.classMinute || 0),
      classGroup:String(next.classGroup || '').trim().toUpperCase() || String(before.classGroup || '').trim().toUpperCase(),
      reason:String(next.reason || '').trim() || String(before.reason || '').trim(),
    };
  }

  async function resolveOlliTalkStructuredMakeupCancelTurn({
    structuredCommand,
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    context,
  }){
    const sourceId=Number(sourceMessageId || 0);
    const reasonId=Number(reasonMessageId || 0);
    if(!Number.isSafeInteger(sourceId) || sourceId<=0){
      throw new Error('보강 취소 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if(!Number.isSafeInteger(reasonId) || reasonId<=0 || !String(reasonText || '').trim()){
      throw new Error('보강 취소 사유 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_makeup_cancel_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(sourceText || '').trim(),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:String(reasonMessageText || '').trim(),
        reason:String(reasonText || '').trim(),
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true){
      throw new Error(data?.error || data?.message || '보강 취소 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=String(data.choiceRequired.message || '').trim() || '취소할 보강을 선택해 주세요.';
      return {
        assistantMessage:await saveOlliTalkStructuredTargetChoice(
          context,
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
    if(String(data.message.action.action_type || '').trim()!=='cancel_makeup'){
      throw new Error('보강 취소 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  async function resolveOlliTalkMakeupCancelAgentTurn({
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    context,
  }){
    const sourceId=Number(sourceMessageId || 0);
    const reasonId=Number(reasonMessageId || 0);
    if(!Number.isSafeInteger(sourceId) || sourceId<=0){
      throw new Error('보강 취소 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if(!Number.isSafeInteger(reasonId) || reasonId<=0 || !String(reasonText || '').trim()){
      throw new Error('보강 취소 사유 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'makeup_cancel_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(sourceText || '').trim(),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:String(reasonMessageText || '').trim(),
        reason:String(reasonText || '').trim()
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true || !data?.message?.action){
      throw new Error(data?.error || data?.message || '보강 취소 Agent 응답을 받지 못했습니다.');
    }
    if(String(data.message.action.action_type || '').trim()!=='cancel_makeup'){
      throw new Error('보강 취소 Agent 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  async function resolveOlliTalkAbsenceAgentTurn({
    sourceText,
    sourceMessageId,
    reasonText,
    reasonMessageText,
    reasonMessageId,
    context,
  }){
    const sourceId=Number(sourceMessageId || 0);
    const reasonId=Number(reasonMessageId || 0);
    if(!Number.isSafeInteger(sourceId) || sourceId<=0){
      throw new Error('결석 요청의 원문 메시지를 확인하지 못했습니다.');
    }
    if(!Number.isSafeInteger(reasonId) || reasonId<=0 || !String(reasonText || '').trim()){
      throw new Error('결석 사유 메시지를 확인하지 못했습니다.');
    }

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'absence_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(sourceText || '').trim(),
        sourceMessageId:sourceId,
        reasonMessageId:reasonId,
        reasonMessageText:String(reasonMessageText || '').trim(),
        reason:String(reasonText || '').trim()
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true || !data?.message?.action){
      throw new Error(data?.error || data?.message || '결석 Agent 응답을 받지 못했습니다.');
    }
    if(String(data.message.action.action_type || '').trim()!=='mark_absent'){
      throw new Error('결석 Agent 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  async function resolveOlliTalkClassOnceAgentTurn(commandText,context,replyToMessageId){
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
      throw new Error('1회 수업 등록 요청의 원문 메시지를 확인하지 못했습니다.');
    }

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'class_once_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(commandText || '').trim(),
        sourceMessageId
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true || !data?.message?.action){
      throw new Error(data?.error || data?.message || '1회 수업 Agent 응답을 받지 못했습니다.');
    }
    if(String(data.message.action.action_type || '').trim()!=='add_class_once'){
      throw new Error('1회 수업 Agent 작업 종류가 올바르지 않습니다.');
    }

    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  async function resolveOlliTalkStructuredMoveCancelTurn(structuredCommand,context,sourceMessageText,sourceMessageId){
    const sourceId=Number(sourceMessageId || 0);
    if(!Number.isSafeInteger(sourceId)||sourceId<=0||!String(sourceMessageText || '').trim()){
      throw new Error('수업 이동 취소 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'structured_move_cancel_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(sourceMessageText || '').trim(),
        sourceMessageId:sourceId,
        structuredCommand
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true){
      throw new Error(data?.error || data?.message || '수업 이동 취소 규칙 시스템 응답을 받지 못했습니다.');
    }
    if(data?.choiceRequired?.payload){
      const choiceMessage=String(data.choiceRequired.message || '').trim() || '취소할 수업 이동 예약을 선택해 주세요.';
      return {
        assistantMessage:await saveOlliTalkStructuredTargetChoice(
          context,
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
    if(String(data.message.action.action_type || '').trim()!=='cancel_move'){
      throw new Error('수업 이동 취소 규칙 시스템 작업 종류가 올바르지 않습니다.');
    }
    return {
      assistantMessage:data.message,
      replyText:String(data.message.body || '').trim(),
      recordAi:false
    };
  }

  function isOlliTalkPendingReasonCancel(text){
    return /^(취소|취소해|취소해줘|그만|중단|하지마|아니|아니야)$/i.test(String(text || '').trim());
  }


  async function resolveOlliTalkBatchRuleTurn(parsed,commandText,context,replyToMessageId,batchCommands=[]){
    const sourceId=Number(replyToMessageId || 0);
    const commands=buildOlliTalkBatchAgentCommands(parsed,sourceId,commandText,batchCommands);
    if(commands.length!==(Array.isArray(parsed?.commands)?parsed.commands.length:0)){
      throw new Error('복합명령 구조화 결과와 규칙 시스템 작업 수가 일치하지 않습니다.');
    }
    const missingIndex=commands.findIndex(item=>olliTalkBatchCommandNeedsReason(item) && !String(item.reason || '').trim());
    if(missingIndex>=0){
      olliTalkPendingActionReason={intent:'batch_write',__batchAgent:{
        sourceMessageId:sourceId,sourceMessageText:String(commandText || '').trim(),commands
      }};
      const prompt=olliTalkBatchReasonPrompt(commands[missingIndex]);
      return saveOlliTalkPendingTextInputReply(context,prompt,replyToMessageId,olliTalkPendingActionReason);
    }
    const clarificationIndex=commands.findIndex(olliTalkBatchCommandNeedsClarification);
    if(clarificationIndex>=0){
      const pendingBatch={sourceMessageId:sourceId,sourceMessageText:String(commandText || '').trim(),commands};
      olliTalkPendingActionReason={intent:'batch_write',__batchAgent:pendingBatch};
      const assistantMessage=await startOlliTalkBatchStructuredChoice(context,pendingBatch,clarificationIndex);
      return {assistantMessage,replyText:String(assistantMessage?.body || '').trim() || '보강 날짜를 선택해 주세요.',recordAi:false};
    }
    return resolveOlliTalkBatchAgentTurn({
      sourceText:String(commandText || '').trim(),sourceMessageId:sourceId,commands,context
    });
  }

  async function resolveOlliTalkSharedAgentRouteTurn(route,commandText,context,replyToMessageId,batchCommands=[]){
    if(!route || !route.key) return null;
    const parsed=route.parsed || null;

    switch(route.key){
      case 'attendance_status':
        return resolveOlliTalkAttendanceStatusAgentTurn(commandText,parsed,context,replyToMessageId);
      case 'class_once': return resolveOlliTalkClassOnceAgentTurn(commandText,context,replyToMessageId);
      case 'attendance_read':
        return resolveOlliTalkSourceBoundReadAgentTurn({mode:'attendance_read',commandText,context,replyToMessageId});
      case 'pickup_read':
        return resolveOlliTalkSourceBoundReadAgentTurn({mode:'pickup_read',commandText,context,replyToMessageId});
      default: return null;
    }
  }

  async function resolveOlliTalkContextualMakeupTurn(commandText,context,replyToMessageId){
    if(!olliTalkPendingMakeupDialogue) return null;
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0) return null;

    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'context_makeup_prepare',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(commandText || '').trim(),
        sourceMessageId,
        conversation:olliTalkAiConversationMessages.map((item)=>({
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
      const pendingStatus=String(olliTalkPendingMakeupDialogue?.status || '').trim();
      const retryMessage=pendingStatus==='blocked'
        ? '보강 등록을 이어서 진행 중이에요. 변경할 날짜·시간·반을 알려 주세요. 그만하려면 "취소"라고 말해 주세요.'
        : (String(olliTalkPendingMakeupDialogue?.prompt || '').trim() || '보강 등록을 이어서 진행 중이에요. 필요한 내용을 다시 알려 주세요. 그만하려면 "취소"라고 말해 주세요.');
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,retryMessage,sourceMessageId),
        replyText:retryMessage,
        recordAi:false
      };
    }
    return resolveOlliTalkMakeupAgentResponse({
      response,
      data,
      context,
      replyToMessageId:sourceMessageId,
    });
  }



  async function interpretOlliTalkSystemLanguage(commandText,context,replyToMessageId){
    const sourceMessageId=Number(replyToMessageId || 0);
    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
      throw new Error('올리 해석에 필요한 원문 메시지를 확인하지 못했습니다.');
    }
    const response=await fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'interpret',
        academyId:context?.academyId || '',
        sessionToken:context?.sessionToken || '',
        message:String(commandText || '').trim(),
        sourceMessageId,
        conversation:(Array.isArray(olliTalkAiConversationMessages) ? olliTalkAiConversationMessages : []).map((item)=>({
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
    const lane=String(language.lane || '').trim() || 'routine';
    const route=String(language.route || '').trim();
    const intent=String(language.intent || '').trim();
    const standaloneCommand=String(language.standaloneCommand || '').trim();
    const structuredRaw=language.structuredCommand && typeof language.structuredCommand==='object'
      ? language.structuredCommand
      : {};
    const structuredCommand={
      action:String(structuredRaw.action || '').trim(),
      studentName:String(structuredRaw.studentName || '').trim(),
      division:String(structuredRaw.division || '').trim(),
      dateExpression:String(structuredRaw.dateExpression || '').trim(),
      timeSlot:Number(structuredRaw.timeSlot || 0),
      classGroup:String(structuredRaw.classGroup || '').trim().toUpperCase(),
      weekday:Number(structuredRaw.weekday || 0),
      classTime:Number(structuredRaw.classTime || 0),
      classMinute:Number(structuredRaw.classMinute || 0),
      pickupKind:String(structuredRaw.pickupKind || '').trim(),
      pickupLabel:String(structuredRaw.pickupLabel || '').trim(),
      pickupTime:String(structuredRaw.pickupTime || '').trim(),
      sourceDateExpression:String(structuredRaw.sourceDateExpression || '').trim(),
      sourceWeekday:Number(structuredRaw.sourceWeekday || 0),
      sourceTimeSlot:Number(structuredRaw.sourceTimeSlot || 0),
      sourceMinute:Number(structuredRaw.sourceMinute || 0),
      sourceClassGroup:String(structuredRaw.sourceClassGroup || '').trim().toUpperCase(),
      targetDateExpression:String(structuredRaw.targetDateExpression || '').trim(),
      targetWeekday:Number(structuredRaw.targetWeekday || 0),
      targetTimeSlot:Number(structuredRaw.targetTimeSlot || 0),
      targetMinute:Number(structuredRaw.targetMinute || 0),
      targetClassGroup:String(structuredRaw.targetClassGroup || '').trim().toUpperCase(),
      reason:String(structuredRaw.reason || '').trim(),
      memoNote:String(structuredRaw.memoNote || '').trim(),
      availabilityPurpose:String(structuredRaw.availabilityPurpose || '').trim(),
      rosterKind:String(structuredRaw.rosterKind || '').trim()
    };
    const readCommands=(Array.isArray(language.readCommands)?language.readCommands:[]).slice(0,3).map((command)=>({
      action:String(command?.action || '').trim(),
      studentName:String(command?.studentName || '').trim(),
      division:String(command?.division || '').trim(),
      dateExpression:String(command?.dateExpression || '').trim(),
      timeSlot:Number(command?.timeSlot || 0),
      classGroup:String(command?.classGroup || '').trim().toUpperCase(),
      weekday:Number(command?.weekday || 0),
      classTime:Number(command?.classTime || 0),
      pickupKind:String(command?.pickupKind || '').trim(),
      availabilityPurpose:String(command?.availabilityPurpose || '').trim(),
      rosterKind:String(command?.rosterKind || '').trim()
    }));
    const batchCommands=(Array.isArray(language.batchCommands)?language.batchCommands:[]).slice(0,3).map((command)=>({
      action:String(command?.action || '').trim(),
      studentName:String(command?.studentName || '').trim(),
      division:String(command?.division || '').trim(),
      dateExpression:String(command?.dateExpression || '').trim(),
      timeSlot:Number(command?.timeSlot || 0),
      classGroup:String(command?.classGroup || '').trim().toUpperCase(),
      weekday:Number(command?.weekday || 0),
      classTime:Number(command?.classTime || 0),
      classMinute:Number(command?.classMinute || 0),
      pickupKind:String(command?.pickupKind || '').trim(),
      pickupLabel:String(command?.pickupLabel || '').trim(),
      pickupTime:String(command?.pickupTime || '').trim(),
      sourceDateExpression:String(command?.sourceDateExpression || '').trim(),
      sourceWeekday:Number(command?.sourceWeekday || 0),
      sourceTimeSlot:Number(command?.sourceTimeSlot || 0),
      sourceMinute:Number(command?.sourceMinute || 0),
      sourceClassGroup:String(command?.sourceClassGroup || '').trim().toUpperCase(),
      targetDateExpression:String(command?.targetDateExpression || '').trim(),
      targetWeekday:Number(command?.targetWeekday || 0),
      targetTimeSlot:Number(command?.targetTimeSlot || 0),
      targetMinute:Number(command?.targetMinute || 0),
      targetClassGroup:String(command?.targetClassGroup || '').trim().toUpperCase(),
      reason:String(command?.reason || '').trim(),
      memoNote:String(command?.memoNote || '').trim()
    }));
    const reply=String(language.reply || '').trim();
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



  function olliTalkRuleCommandMatchesInterpretation(router,intent,commandText){
    const expected=String(intent || '').trim();
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
      return String(classified?.intent || '').trim()===expected;
    }catch(_){
      return false;
    }
  }


  function reportOlliTalkAiLegacyRouteOutcome(context,outcome,routeKey,sharedRoute,classifierAvailable){
    if(!context?.academyId || !context?.sessionToken) return;
    void fetch('/api/olli-agent',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode:'route_outcome',
        academyId:context.academyId,
        sessionToken:context.sessionToken,
        surface:'mobile',
        outcome:String(outcome || '').trim(),
        routeKey:String(routeKey || '').trim(),
        sharedRouteKey:String(sharedRoute?.key || '').trim(),
        classifierAvailable:classifierAvailable===true
      })
    }).catch(()=>{});
  }

 async function resolveOlliTalkAiTurn(commandText,context,replyToMessageId,options={}){
    const router=window.OlliCommandRouter;
    const schedule=window.OlliCommandSchedule;
    const rawCommandText=String(commandText || '').trim();

    const pendingStructuredMakeupCancel=olliTalkPendingActionReason?.__structuredMakeupCancel || null;
    if(
      String(olliTalkPendingActionReason?.intent || '').trim()==='cancel_makeup'
      && pendingStructuredMakeupCancel
    ){
      if(isOlliTalkPendingReasonCancel(rawCommandText)){
        olliTalkPendingActionReason=null;
        const message='작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      olliTalkPendingActionReason=null;
      return resolveOlliTalkStructuredMakeupCancelTurn({
        structuredCommand:pendingStructuredMakeupCancel.structuredCommand,
        sourceText:String(pendingStructuredMakeupCancel.sourceMessageText || '').trim(),
        sourceMessageId:Number(pendingStructuredMakeupCancel.sourceMessageId || 0),
        reasonText:rawCommandText,
        reasonMessageText:rawCommandText,
        reasonMessageId:Number(replyToMessageId || 0),
        context,
      });
    }

    let localRuleClassification=null;
    let localRuleIntent='';
    if(router && typeof router.classifyRequest==='function'){
      try{
        localRuleClassification=router.classifyRequest(rawCommandText);
        localRuleIntent=String(localRuleClassification?.intent || '').trim();
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
      && String(localRuleClassification?.type || (localRuleIntent==='open_student_info' ? 'ui_query' : '')).trim()!=='other';
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
      : await interpretOlliTalkSystemLanguage(
          rawCommandText,
          context,
          replyToMessageId
        );
    const interpreterLane=String(interpretation.lane || '').trim() || 'routine';
    const interpreterRoute=String(interpretation.route || '').trim();
    const interpreterIntent=String(interpretation.intent || '').trim();
    let structuredCommand=interpretation.structuredCommand || null;
    const batchCommands=Array.isArray(interpretation.batchCommands)?interpretation.batchCommands:[];
    const readCommands=Array.isArray(interpretation.readCommands)?interpretation.readCommands:[];
    commandText=String(interpretation.standaloneCommand || rawCommandText).trim();
    if(
      interpreterLane==='routine'
      && (!structuredCommand || !String(structuredCommand.action || '').trim() || String(structuredCommand.action || '').trim()==='none')
      && router
      && typeof router.interpretedIntentToStructuredCommand==='function'
    ){
      structuredCommand=router.interpretedIntentToStructuredCommand(interpreterIntent,commandText) || structuredCommand;
    }

    if(options.allowSuggestedQuery && router && typeof router.runSuggestedQuery==='function'){
      const suggested=await router.runSuggestedQuery(commandText,{
        source:'olli_talk_reply_button',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(suggested?.handled===true){
        reportOlliTalkAiLegacyRouteOutcome(
          context,
          'suggested',
          String(suggested.intent || suggested.payload?.intent || '').trim(),
          null,
          false
        );
        const suggestedMessage=String(suggested.message || '').trim() || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,suggestedMessage,replyToMessageId),
          replyText:suggestedMessage,
          recordAi:false
        };
      }
    }

    if(interpreterLane==='chat'){
      const resolved=await resolveOlliTalkAiReply(rawCommandText,context);
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,resolved.message,replyToMessageId),
        replyText:resolved.message,
        recordAi:true
      };
    }

    if(interpreterLane==='feedback'){
      const resolved=await resolveOlliTalkFeedbackAnalysis(
        commandText,
        rawCommandText,
        context,
        replyToMessageId
      );
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,resolved.message,replyToMessageId),
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
        const message=String(queried.message || '').trim() || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && String(structuredCommand?.action || '').trim()==='find_pickups'
      && router
      && typeof router.runStructuredQuery==='function'
    ){
      const queried=await router.runStructuredQuery(structuredCommand,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(queried?.handled===true){
        const message=String(queried.message || '').trim() || '픽업 일정을 확인했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && String(structuredCommand?.action || '').trim()==='find_roster_entries'
      && router
      && typeof router.runStructuredQuery==='function'
    ){
      const queried=await router.runStructuredQuery(structuredCommand,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(queried?.handled===true){
        const message=String(queried.message || '').trim() || '학생 명단을 확인했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && String(structuredCommand?.action || '').trim()==='find_available_slots'
      && router
      && typeof router.runStructuredQuery==='function'
    ){
      const queried=await router.runStructuredQuery(structuredCommand,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(queried?.handled===true){
        const message=String(queried.message || '').trim() || '빈자리 조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && String(structuredCommand?.action || '').trim()==='get_student_schedule'
      && router
      && typeof router.runStructuredQuery==='function'
    ){
      const queried=await router.runStructuredQuery(structuredCommand,{
        source:'olli_talk_ai_structured',
        selectedStudent:null,
        autoSubmitContext:null
      });
      if(queried?.handled===true){
        const message=String(queried.message || '').trim() || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
    }

    if(
      interpreterLane==='routine'
      && String(structuredCommand?.action || '').trim()==='cancel_makeup'
    ){
      const pending=olliTalkPendingActionReason?.__structuredMakeupCancel || null;
      if(pending && isOlliTalkPendingReasonCancel(rawCommandText)){
        olliTalkPendingActionReason=null;
        const message='작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }

      let merged=mergeOlliTalkStructuredMakeupCancelCommand(
        pending?.structuredCommand,
        structuredCommand
      );

      let preflight=null;
      if(!pending && router && typeof router.prepareStructuredAction==='function'){
        preflight=await router.prepareStructuredAction(merged,{
          source:'olli_talk_ai_structured_preflight',
          selectedStudent:null,
          autoSubmitContext:null
        });
        if(preflight?.handled===true && preflight.kind==='action_rejected'){
          const rejectedMessage=String(preflight.message || '').trim() || '보강 취소 작업을 준비하지 못했어요.';
          return {
            assistantMessage:await saveOlliTalkOlliReply(context,rejectedMessage,replyToMessageId),
            replyText:rejectedMessage,
            recordAi:false
          };
        }
        if(preflight?.handled===true && preflight.payload){
          merged=mergeOlliTalkStructuredMakeupCancelCommand(merged,preflight.payload);
        }
      }

      const reason=String(merged.reason || '').trim();
      if(!reason){
        const sourceMessageId=Number(replyToMessageId || 0);
        olliTalkPendingActionReason={
          intent:'cancel_makeup',
          __structuredMakeupCancel:{
            sourceMessageId,
            sourceMessageText:String(rawCommandText || '').trim(),
            structuredCommand:merged
          }
        };
        const reasonMessage=String(preflight?.message || '').trim()
          || (String(merged.studentName || '').trim() || '학생')+' 학생의 보강 취소 사유를 알려주세요.';
        return saveOlliTalkPendingTextInputReply(context,reasonMessage,replyToMessageId);
      }

      const sourceMessageId=pending
        ? Number(pending.sourceMessageId || 0)
        : Number(replyToMessageId || 0);
      const sourceText=pending
        ? String(pending.sourceMessageText || '').trim()
        : String(rawCommandText || '').trim();
      const reasonMessageId=Number(replyToMessageId || 0);
      const reasonMessageText=String(rawCommandText || '').trim();
      olliTalkPendingActionReason=null;
      return resolveOlliTalkStructuredMakeupCancelTurn({
        structuredCommand:merged,
        sourceText,
        sourceMessageId,
        reasonText:pending ? reasonMessageText : reason,
        reasonMessageText,
        reasonMessageId,
        context,
      });
    }

    if(
      interpreterLane==='routine'
      && String(structuredCommand?.action || '').trim()==='cancel_move'
    ){
      return resolveOlliTalkStructuredMoveCancelTurn(
        structuredCommand,
        context,
        rawCommandText,
        replyToMessageId
      );
    }

    if(
      interpreterLane==='routine'
      && ['add_timetable_memo','delete_timetable_memo'].includes(String(structuredCommand?.action || '').trim())
    ){
      return resolveOlliTalkStructuredTimetableMemoTurn(
        structuredCommand,
        context,
        rawCommandText,
        replyToMessageId
      );
    }

    if(
      interpreterLane==='routine'
      && String(structuredCommand?.action || '').trim()==='update_waitlist'
    ){
      return resolveOlliTalkStructuredWaitlistUpdateTurn(
        structuredCommand,
        context,
        rawCommandText,
        replyToMessageId
      );
    }

    if(
      interpreterLane==='routine'
      && String(structuredCommand?.action || '').trim()==='cancel_trial'
    ){
      const pending=olliTalkPendingActionReason?.__structuredTrialCancel || null;
      if(pending && isOlliTalkPendingReasonCancel(rawCommandText)){
        olliTalkPendingActionReason=null;
        const message='작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }

      let merged=mergeOlliTalkStructuredTrialCancelCommand(
        pending?.structuredCommand,
        structuredCommand
      );

      let preflight=null;
      if(!pending && router && typeof router.prepareStructuredAction==='function'){
        preflight=await router.prepareStructuredAction(merged,{
          source:'olli_talk_ai_structured_preflight',
          selectedStudent:null,
          autoSubmitContext:null
        });
        if(preflight?.handled===true && preflight.kind==='action_rejected'){
          const rejectedMessage=String(preflight.message || '').trim() || '체험 취소 작업을 준비하지 못했어요.';
          return {
            assistantMessage:await saveOlliTalkOlliReply(context,rejectedMessage,replyToMessageId),
            replyText:rejectedMessage,
            recordAi:false
          };
        }
        if(preflight?.handled===true && preflight.payload){
          merged=mergeOlliTalkStructuredTrialCancelCommand(merged,preflight.payload);
        }
      }

      const reason=String(merged.reason || '').trim();
      if(!reason){
        const sourceMessageId=Number(replyToMessageId || 0);
        olliTalkPendingActionReason={
          intent:'cancel_trial',
          __structuredTrialCancel:{
            sourceMessageId,
            sourceMessageText:String(rawCommandText || '').trim(),
            structuredCommand:merged
          }
        };
        const reasonMessage=String(preflight?.message || '').trim()
          || (String(merged.studentName || '').trim() || '체험 학생')+' 체험 취소 사유를 알려주세요.';
        return saveOlliTalkPendingTextInputReply(context,reasonMessage,replyToMessageId,olliTalkPendingActionReason);
      }

      const sourceMessageId=pending
        ? Number(pending.sourceMessageId || 0)
        : Number(replyToMessageId || 0);
      const sourceText=pending
        ? String(pending.sourceMessageText || '').trim()
        : String(rawCommandText || '').trim();
      const reasonMessageId=Number(replyToMessageId || 0);
      const reasonMessageText=String(rawCommandText || '').trim();
      olliTalkPendingActionReason=null;
      return resolveOlliTalkStructuredTrialCancelTurn({
        structuredCommand:merged,
        sourceText,
        sourceMessageId,
        reasonText:pending ? reasonMessageText : reason,
        reasonMessageText,
        reasonMessageId,
        context,
      });
    }


    if(
      interpreterLane==='routine'
      && ['add_makeup','update_makeup','add_trial','update_trial','add_waitlist','cancel_waitlist','add_pickup','update_pickup','cancel_pickup','move_class','mark_absent'].includes(String(structuredCommand?.action || '').trim())
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
          if(String(prepared.payload.field || '').trim()==='student_choice'){
            return {
              assistantMessage:await saveOlliTalkStructuredStudentChoice(
                context,
                prepared.message || '학생을 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:String(prepared.message || ''),
              recordAi:false
            };
          }
          if(String(prepared.payload.field || '').trim()==='target_choice'){
            return {
              assistantMessage:await saveOlliTalkStructuredTargetChoice(
                context,
                prepared.message || '대상을 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:String(prepared.message || ''),
              recordAi:false
            };
          }
          if(String(prepared.payload.field || '').trim()==='division'){
            return {
              assistantMessage:await saveOlliTalkStructuredDivisionChoice(
                context,
                prepared.message || '유치부인지 초등부인지 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:String(prepared.message || ''),
              recordAi:false
            };
          }
          if(['date','target_date'].includes(String(prepared.payload.field || '').trim())){
            return {
              assistantMessage:await saveOlliTalkStructuredDateChoice(
                context,
                prepared.message || '날짜를 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:String(prepared.message || ''),
              recordAi:false
            };
          }
          if(['time','target_time'].includes(String(prepared.payload.field || '').trim())){
            return {
              assistantMessage:await saveOlliTalkStructuredTimeChoice(
                context,
                prepared.message || '시간을 선택해 주세요.',
                prepared.payload,
                replyToMessageId
              ),
              replyText:String(prepared.message || ''),
              recordAi:false
            };
          }
          const fieldMessage=String(prepared.message || '').trim() || '필요한 정보를 선택해 주세요.';
          return {
            assistantMessage:await saveOlliTalkOlliReply(context,fieldMessage,replyToMessageId),
            replyText:fieldMessage,
            recordAi:false
          };
        }
        if(['action_pending','action_choice'].includes(prepared.kind) && prepared.payload){
          return {
            assistantMessage:await saveOlliTalkActionReply(
              context,
              prepared.message || (prepared.kind==='action_choice' ? '반을 선택해 주세요.' : '이 작업을 진행할까요?'),
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
          return saveOlliTalkPendingTextInputReply(context,reasonMessage,replyToMessageId);
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

    if(interpreterRoute==='rule'){
      if(interpreterIntent==='cancel_pending'){
        olliTalkPendingMakeupDialogue=null;
        olliTalkPendingActionReason=null;
        const message='진행 중인 작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      if(!olliTalkRuleCommandMatchesInterpretation(router,interpreterIntent,commandText)){
        const message='올리가 이해한 업무와 규칙 시스템 명령이 일치하지 않아 실행하지 않았어요. 요청을 조금 더 구체적으로 알려 주세요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      olliTalkPendingMakeupDialogue=null;
      olliTalkPendingActionReason=null;
    }

    if(interpreterRoute!=='rule' && olliTalkPendingActionReason){
      if(isOlliTalkPendingReasonCancel(commandText)){
        olliTalkPendingActionReason=null;
        const message='작업 준비를 취소했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }

      const pendingBatch=olliTalkPendingActionReason.__batchAgent;
      if(String(olliTalkPendingActionReason.intent || '').trim()==='batch_write' && pendingBatch){
        const commands=Array.isArray(pendingBatch.commands)
          ? pendingBatch.commands.map(item=>Object.assign({},item))
          : [];
        const reasonIndex=commands.findIndex(item=>olliTalkBatchCommandNeedsReason(item) && !String(item.reason || '').trim());
        if(reasonIndex>=0){
          commands[reasonIndex].reason=String(commandText || '').trim();
          commands[reasonIndex].reasonMessageId=Number(replyToMessageId || 0);
          commands[reasonIndex].reasonMessageText=String(commandText || '').trim();
          const nextReasonIndex=commands.findIndex(item=>olliTalkBatchCommandNeedsReason(item) && !String(item.reason || '').trim());
          if(nextReasonIndex>=0){
            olliTalkPendingActionReason={
              intent:'batch_write',
              __batchAgent:{
                sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
                sourceMessageText:String(pendingBatch.sourceMessageText || '').trim(),
                commands
              }
            };
            const prompt=olliTalkBatchReasonPrompt(commands[nextReasonIndex]);
            return {
              assistantMessage:await saveOlliTalkOlliReply(context,prompt,replyToMessageId),
              replyText:prompt,
              recordAi:false
            };
          }

          const clarificationIndex=commands.findIndex(olliTalkBatchCommandNeedsClarification);
          if(clarificationIndex>=0){
            const nextPending={
              sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
              sourceMessageText:String(pendingBatch.sourceMessageText || '').trim(),
              commands
            };
            olliTalkPendingActionReason={intent:'batch_write',__batchAgent:nextPending};
            const assistantMessage=await startOlliTalkBatchStructuredChoice(context,nextPending,clarificationIndex);
            return {
              assistantMessage,
              replyText:String(assistantMessage?.body || '').trim() || '보강 날짜를 선택해 주세요.',
              recordAi:false
            };
          }
        }else{
          const clarificationIndex=commands.findIndex(olliTalkBatchCommandNeedsClarification);
          if(clarificationIndex>=0){
            const clarified=applyOlliTalkBatchClarification(
              commands[clarificationIndex],
              commandText,
              replyToMessageId,
              router
            );
            if(!clarified){
              const prompt=olliTalkBatchClarificationPrompt(commands[clarificationIndex]);
              olliTalkPendingActionReason={
                intent:'batch_write',
                __batchAgent:{
                  sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
                  sourceMessageText:String(pendingBatch.sourceMessageText || '').trim(),
                  commands
                }
              };
              return {
                assistantMessage:await saveOlliTalkOlliReply(context,prompt,replyToMessageId),
                replyText:prompt,
                recordAi:false
              };
            }
            commands[clarificationIndex]=clarified;
            const nextClarificationIndex=commands.findIndex(olliTalkBatchCommandNeedsClarification);
            if(nextClarificationIndex>=0){
              olliTalkPendingActionReason={
                intent:'batch_write',
                __batchAgent:{
                  sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
                  sourceMessageText:String(pendingBatch.sourceMessageText || '').trim(),
                  commands
                }
              };
              const prompt=olliTalkBatchClarificationPrompt(commands[nextClarificationIndex]);
              return {
                assistantMessage:await saveOlliTalkOlliReply(context,prompt,replyToMessageId),
                replyText:prompt,
                recordAi:false
              };
            }
          }
        }

        olliTalkPendingActionReason=null;
        return resolveOlliTalkBatchAgentTurn({
          sourceText:String(pendingBatch.sourceMessageText || '').trim(),
          sourceMessageId:Number(pendingBatch.sourceMessageId || 0),
          commands,
          context,
        });
      }

      const pendingTrialCancel=olliTalkPendingActionReason.__trialCancelAgent;
      if(String(olliTalkPendingActionReason.intent || '').trim()==='cancel_trial' && pendingTrialCancel){
        olliTalkPendingActionReason=null;
        return resolveOlliTalkTrialCancelAgentTurn({
          sourceText:String(pendingTrialCancel.sourceMessageText || '').trim(),
          sourceMessageId:Number(pendingTrialCancel.sourceMessageId || 0),
          reasonText:String(commandText || '').trim(),
          reasonMessageText:String(commandText || '').trim(),
          reasonMessageId:Number(replyToMessageId || 0),
          context,
        });
      }

      const pendingMakeupCancel=olliTalkPendingActionReason.__makeupCancelAgent;
      if(String(olliTalkPendingActionReason.intent || '').trim()==='cancel_makeup' && pendingMakeupCancel){
        olliTalkPendingActionReason=null;
        return resolveOlliTalkMakeupCancelAgentTurn({
          sourceText:String(pendingMakeupCancel.sourceMessageText || '').trim(),
          sourceMessageId:Number(pendingMakeupCancel.sourceMessageId || 0),
          reasonText:String(commandText || '').trim(),
          reasonMessageText:String(commandText || '').trim(),
          reasonMessageId:Number(replyToMessageId || 0),
          context,
        });
      }

      const pendingAbsence=olliTalkPendingActionReason.__absenceAgent;
      if(String(olliTalkPendingActionReason.intent || '').trim()==='mark_absent' && pendingAbsence){
        olliTalkPendingActionReason=null;
        return resolveOlliTalkAbsenceAgentTurn({
          sourceText:String(pendingAbsence.sourceMessageText || '').trim(),
          sourceMessageId:Number(pendingAbsence.sourceMessageId || 0),
          reasonText:String(commandText || '').trim(),
          reasonMessageText:String(commandText || '').trim(),
          reasonMessageId:Number(replyToMessageId || 0),
          context,
        });
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

    if(
      interpreterRoute==='rule'
      && ['set_class_layout','set_class_teacher','set_teacher_override','set_session_order','set_normal_class_day'].includes(interpreterIntent)
    ){
      const parsed=parseOlliTalkTimetableAdminRuleCandidate(commandText,router);
      if(!parsed || String(parsed.intent || '').trim()!==interpreterIntent){
        const message='시간표 관리 요청을 규칙 시스템에서 확인하지 못했어요. 날짜·시간·대상을 조금 더 구체적으로 알려 주세요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      return resolveOlliTalkTimetableAdminRuleTurn(commandText,parsed,context,replyToMessageId);
    }

    if(interpreterRoute==='rule' && interpreterIntent==='batch_write'){
      const parsed=parseOlliTalkBatchAgentCandidate(commandText,router);
      if(!parsed){
        const message='복합명령 구조가 원문과 일치하지 않아 실행하지 않았어요. 요청을 조금 더 구체적으로 알려 주세요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
          replyText:message,
          recordAi:false
        };
      }
      return resolveOlliTalkBatchRuleTurn(parsed,commandText,context,replyToMessageId,batchCommands);
    }

    const routeClassifier=window.OlliTeamTalkAgentRouteClassifier;
    const classifierAvailable=!!(routeClassifier && typeof routeClassifier.classify==='function');
    const sharedRoute=interpreterRoute==='agent' && classifierAvailable
      ? routeClassifier.classify(commandText,{router})
      : null;
    if(interpreterRoute==='agent'){
      if(sharedRoute){
        const routedTurn=await resolveOlliTalkSharedAgentRouteTurn(sharedRoute,commandText,context,replyToMessageId,batchCommands);
        if(routedTurn) return routedTurn;
      }
      const resolved=await resolveOlliTalkAiReply(rawCommandText,context);
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,resolved.message,replyToMessageId),
        replyText:resolved.message,
        recordAi:true
      };
    }

    const makeupAddDraftCandidate=parseOlliTalkMakeupAddDraftCandidate(commandText,router);
    if(makeupAddDraftCandidate){
      const message=olliTalkMakeupAddDraftPrompt(makeupAddDraftCandidate);
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
        replyText:message,
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
        if(['action_pending','action_needs_reason','action_rejected'].includes(String(prepared.kind || '').trim())){
          reportOlliTalkAiLegacyRouteOutcome(
            context,
            'legacy_write',
            String(prepared.intent || prepared.payload?.intent || '').trim(),
            sharedRoute,
            classifierAvailable
          );
        }
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
          const pendingPayload=Object.assign({},prepared.payload);
          if(String(pendingPayload.intent || '').trim()==='cancel_trial'){
            const parsedTrialCancel=parseOlliTalkTrialCancelAgentCandidate(commandText,router);
            const sourceMessageId=Number(replyToMessageId || 0);
            if(parsedTrialCancel && Number.isSafeInteger(sourceMessageId) && sourceMessageId>0){
              pendingPayload.__trialCancelAgent={
                sourceMessageId,
                sourceMessageText:String(commandText || '').trim()
              };
            }
          }
          if(String(pendingPayload.intent || '').trim()==='cancel_makeup'){
            const parsedMakeupCancel=parseOlliTalkMakeupCancelAgentCandidate(commandText,router);
            const sourceMessageId=Number(replyToMessageId || 0);
            if(parsedMakeupCancel && Number.isSafeInteger(sourceMessageId) && sourceMessageId>0){
              pendingPayload.__makeupCancelAgent={
                sourceMessageId,
                sourceMessageText:String(commandText || '').trim()
              };
            }
          }
          if(String(pendingPayload.intent || '').trim()==='mark_absent'){
            const parsedAbsence=parseOlliTalkAbsenceAgentCandidate(commandText,router);
            const sourceMessageId=Number(replyToMessageId || 0);
            if(parsedAbsence && Number.isSafeInteger(sourceMessageId) && sourceMessageId>0){
              pendingPayload.__absenceAgent={
                sourceMessageId,
                sourceMessageText:String(commandText || '').trim()
              };
            }
          }
          olliTalkPendingActionReason=pendingPayload;
          const reasonMessage=String(prepared.message || '').trim() || '사유를 알려주세요.';
          return saveOlliTalkPendingTextInputReply(context,reasonMessage,replyToMessageId);
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
        reportOlliTalkAiLegacyRouteOutcome(
          context,
          'legacy_read',
          String(queried.intent || queried.payload?.intent || '').trim(),
          sharedRoute,
          classifierAvailable
        );
        const queryMessage=String(queried.message || '').trim() || '조회 결과를 확인했어요.';
        return {
          assistantMessage:await saveOlliTalkOlliReply(context,queryMessage,replyToMessageId),
          replyText:queryMessage,
          recordAi:false
        };
      }
    }

    if(interpreterRoute==='rule'){
      const message='요청을 시스템 명령으로 해석했지만 규칙 시스템에 연결하지 못했어요. 필요한 정보를 조금 더 구체적으로 알려 주세요.';
      return {
        assistantMessage:await saveOlliTalkOlliReply(context,message,replyToMessageId),
        replyText:message,
        recordAi:false
      };
    }

    const resolved=await resolveOlliTalkAiReply(rawCommandText,context);
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
    const screen = getScreen();
    if (screen) screen.classList.toggle('olliTalkCanSend', canSend);
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

  function getOlliTalkRenderableMessageSnapshot(item){
    if(!item||typeof item!=='object')return item;
    const { unread_count, ...renderable }=item;
    return renderable;
  }

  function areOlliTalkMessagePayloadsRenderEquivalent(left,right){
    if(!left||!right)return false;
    if(String(left.current_member_id||'')!==String(right.current_member_id||''))return false;
    const leftMessages=Array.isArray(left.messages)?left.messages:[];
    const rightMessages=Array.isArray(right.messages)?right.messages:[];
    if(leftMessages.length!==rightMessages.length)return false;
    try{
      return leftMessages.every((item,index)=>
        JSON.stringify(getOlliTalkRenderableMessageSnapshot(item))
          ===JSON.stringify(getOlliTalkRenderableMessageSnapshot(rightMessages[index]))
      );
    }catch(_){return false}
  }

  function syncOlliTalkRenderedUnreadCounts(payload){
    const chatArea=document.getElementById('olliTalkBetaChatArea');
    if(!chatArea)return false;
    const messages=Array.isArray(payload?.messages)?payload.messages:[];
    const byId=new Map(messages.map(item=>[String(item?.id||''),item]).filter(([id])=>!!id));

    chatArea.querySelectorAll('.olliTalkBetaMessage[data-message-id]').forEach(row=>{
      const item=byId.get(String(row.dataset.messageId||''));
      if(!item)return;
      const type=String(item?.message_type||'text');
      if(type==='ai'||type==='system')return;

      const count=Math.max(0,Number(item?.unread_count||0));
      const meta=row.querySelector('.olliTalkBetaBubbleMeta');
      if(!meta)return;
      let badge=meta.querySelector('.olliTalkBetaUnreadCount');

      if(count>0){
        if(!badge){
          badge=createMessageText('span','olliTalkBetaUnreadCount',String(count));
          meta.insertBefore(badge,meta.firstChild);
        }else{
          badge.textContent=String(count);
        }
        badge.style.visibility='';
        badge.removeAttribute('aria-hidden');
        return;
      }

      // 읽음 완료 시 기존 badge의 폭은 그대로 둬서 말풍선 줄바꿈/높이가 흔들리지 않게 합니다.
      if(badge){
        badge.style.visibility='hidden';
        badge.setAttribute('aria-hidden','true');
      }
    });
    return true;
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
    if(!card)return 'none';
    const source=String(src||'').trim();
    const existing=card.querySelector('.olliTalkBetaLinkPreviewImage');

    if(!source){
      if(existing)existing.remove();
      card.classList.remove('hasImage');
      return 'none';
    }
    if(existing?.dataset?.previewSrc===source){
      if(existing.complete&&existing.naturalWidth>0){
        existing.hidden=false;
        card.classList.add('hasImage');
        return 'ready';
      }
      return 'pending';
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

    const followFinalLayout=()=>{
      const chatArea=document.getElementById('olliTalkBetaChatArea');
      const keepBottom=options.followBottom===true&&!!chatArea&&isOlliTalkChatNearBottom(chatArea,120);
      if(keepBottom&&chatArea?.isConnected) scheduleOlliTalkLatestMessageAnchor();
    };

    image.addEventListener('load',()=>{
      if(!image.isConnected)return;
      image.hidden=false;
      card.classList.add('hasImage');
      followFinalLayout();
    },{once:true});
    image.addEventListener('error',()=>{
      if(image.isConnected)image.remove();
      card.classList.remove('hasImage');
      followFinalLayout();
    },{once:true});
    image.src=source;
    card.insertBefore(image,card.firstChild);
    return 'pending';
  }

  function applyOlliTalkLinkPreview(card,url,preview){
    if(!preview||!card?.isConnected)return false;

    const chatArea=document.getElementById('olliTalkBetaChatArea');
    const suppressAutoAnchor=String(card.dataset.olliSuppressAutoAnchor||'')==='1';
    const keepBottom=!suppressAutoAnchor&&!!chatArea&&isOlliTalkChatNearBottom(chatArea,120);
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
    const imageState=setOlliTalkLinkPreviewImage(card,imageSource,{local:localImage,followBottom:keepBottom});
    if(keepBottom&&chatArea?.isConnected&&imageState!=='pending'){
      scheduleOlliTalkLatestMessageAnchor();
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
      // IntersectionObserver already decides when the preview is close enough to load.
      // Once hydration starts, force the <img> request to start even while the element is hidden.
      // iOS can otherwise defer a hidden loading="lazy" image indefinitely.
      image.loading='eager';
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
      if(imageWidth&&imageHeight){
        frame.style.aspectRatio=`${imageWidth} / ${imageHeight}`;
      }else{
        // 오래된 첨부처럼 크기 메타데이터가 없어도 첫 paint부터 프레임 크기를 고정합니다.
        // 실제 이미지가 로드되거나 viewport 밖에서 src가 해제되어도 이 비율은 바꾸지 않습니다.
        frame.classList.add('fallbackRatio');
        frame.style.aspectRatio='4 / 3';
      }
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
    syncViewport();
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

  function formatOlliTalkMobileBubbleText(item,inputText){
    let text=String(inputText || '');

    // 모바일 시스템 완료 말풍선은 색상 자체로 완료 상태가 구분되므로
    // 서버 메시지에 포함된 앞쪽 체크 기호는 화면에서만 제거합니다.
    if(String(item?.message_type || '').trim()==='system'){
      text=text.replace(/^\s*[✓✔]\s*/,'');
    }

    // 규칙 시스템의 반별 잔여 자리 안내는 설명 문장 다음 줄에서 시작합니다.
    // 예: "5시는 반이 나뉘어 있어요.\nA반 2자리 · B반 2자리"
    text=text.replace(/([.!?。])\s+(?=A반\s*\d+\s*자리)/g,'$1\n');
    return text;
  }

  function createOlliTalkMessageBubble(input, options = {}){
    const item=input&&typeof input==='object'?input:null;
    if(item?.attachment)return createOlliTalkAttachmentMessageBubble(item, options);
    const bubble=document.createElement('div');
    bubble.className='olliTalkBetaBubble';
    const text=formatOlliTalkMobileBubbleText(item,String(item?item.body:(input||'')));

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
      if(!url)return;
      card.dataset.olliSuppressAutoAnchor='1';
      Promise.resolve(hydrateOlliTalkLinkPreview(card,url)).finally(()=>{
        if(card?.isConnected)delete card.dataset.olliSuppressAutoAnchor;
      });
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

  function getOlliTalkDisplayName(senderName){
    const rawName=String(senderName || '').trim();
    const normalized=rawName.replace(/\s+/g,'');
    if(normalized==='하주영'||normalized==='루루')return '루루';
    if(normalized==='영앙'||normalized==='영양'||normalized==='조영아')return '조영아';
    if(normalized==='최민기'||normalized==='원장')return '원장';
    return rawName||'선생님';
  }

  function getOlliTalkMemberAvatarKey(senderMemberId,senderName){
    const memberId=String(senderMemberId || '').trim();
    const member=olliTalkMembers.find(item=>String(item?.member_id || '').trim()===memberId);
    const catalog=window.OlliTeamTalkAvatars;
    return catalog?.normalizeKey?.(member?.avatar_key)
      ||catalog?.fallbackKey?.(memberId || String(senderName || '').trim())
      ||'';
  }

  function getOlliTalkProfile(senderName,senderMemberId){
    const displayName=getOlliTalkDisplayName(senderName);
    const catalog=window.OlliTeamTalkAvatars;
    const avatarKey=getOlliTalkMemberAvatarKey(senderMemberId,senderName);
    return {
      displayName,
      avatarKey,
      avatar:avatarKey&&catalog?.src ? catalog.src(avatarKey,senderMemberId||senderName) : '',
      initials:displayName.slice(0,1)
    };
  }

  function syncOlliTalkMemberAvatarElement(avatar,senderName,senderMemberId){
    if(!avatar)return;
    const profile=getOlliTalkProfile(senderName,senderMemberId);
    avatar.dataset.memberId=String(senderMemberId || '').trim();
    avatar.dataset.senderName=String(senderName || '').trim();
    avatar.replaceChildren();
    avatar.classList.remove('textAvatar');
    if(profile.avatar){
      const img=document.createElement('img');
      img.alt='';
      img.setAttribute('aria-hidden','true');
      img.src=profile.avatar;
      avatar.appendChild(img);
    }else{
      avatar.classList.add('textAvatar');
      avatar.textContent=profile.initials;
    }
  }

  function hydrateOlliTalkMemberAvatars(){
    const screen=getScreen();
    if(!screen)return;
    screen.querySelectorAll('.olliTalkBetaMemberAvatar[data-member-id]').forEach(avatar=>{
      syncOlliTalkMemberAvatarElement(
        avatar,
        avatar.dataset.senderName || '',
        avatar.dataset.memberId || ''
      );
    });
  }

  function createOlliTalkSenderProfile(senderName,senderMemberId){
    const profile=getOlliTalkProfile(senderName,senderMemberId);
    const sender=document.createElement('div');
    sender.className='olliTalkBetaSender';

    const avatar=document.createElement('span');
    avatar.className='olliTalkBetaMemberAvatar';
    syncOlliTalkMemberAvatarElement(avatar,senderName,senderMemberId);

    sender.appendChild(avatar);
    sender.appendChild(createMessageText('span','olliTalkBetaSenderName',profile.displayName));
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

  function isOlliTalkChoiceActionType(actionType){
    return [
      'choose_makeup_group','choose_trial_group','choose_waitlist_group','choose_move_group',
      'choose_structured_student','choose_structured_target','choose_structured_division',
      'choose_structured_date','choose_structured_time','choose_reason'
    ].includes(String(actionType || '').trim());
  }

  function getOlliTalkSelectedChoiceButtonLabel(action){
    const displayLabel=String(action?.display_label || '').trim();
    if(!displayLabel) return '선택 완료';
    const selected=displayLabel.replace(/\s*선택\s*$/,'').trim();
    return selected || displayLabel;
  }

  function getOlliTalkActionStatusLabel(action){
    const status=String(action?.status || '').trim();
    const displayLabel=String(action?.display_label || '').trim();
    if(displayLabel) return displayLabel;
    if(status==='completed') return '완료';
    if(status==='cancelled') return '취소됨';
    if(status==='failed') return '처리 실패';
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

  async function handleOlliTalkSessionGroupChoice(action,group){
    const actionId=String(action?.id || '').trim();
    const classGroup=String(group || '').trim().toUpperCase();
    if(!actionId || !['A','B'].includes(classGroup) || olliTalkActionBusy.has(actionId)) return;

    const context=getOlliTalkBetaContext();
    if(!context.sessionToken || !context.academyId){
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    olliTalkActionBusy.add(actionId);
    setOlliTalkActionCardBusy(actionId,true);
    try{
      const actionType=String(action?.action_type || '').trim();
      const rpcName=actionType==='choose_trial_group'
        ? 'olli_team_chat_action_select_trial_group'
        : actionType==='choose_waitlist_group'
          ? 'olli_team_chat_action_select_waitlist_group'
          : actionType==='choose_move_group'
            ? 'olli_team_chat_action_select_move_group'
            : 'olli_team_chat_action_select_makeup_group';
      const payload=await callOlliTalkRpc(rpcName,{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId,
        p_class_group:classGroup
      });
      if(!payload?.ok || !payload?.action){
        throw new Error(payload?.message || '반을 선택하지 못했습니다.');
      }
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
    }catch(error){
      console.warn('올리톡 보강 반 선택 실패:',error);
      alert(error?.message || '반을 선택하지 못했습니다.');
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


  function olliTalkStructuredDateExpressionFromDate(date){
    if(!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return (date.getMonth()+1)+'월 '+date.getDate()+'일';
  }

  function olliTalkStructuredDateInputValue(date){
    if(!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      String(date.getMonth()+1).padStart(2,'0'),
      String(date.getDate()).padStart(2,'0')
    ].join('-');
  }

  async function continueOlliTalkStructuredWriteDraft(draft,context){
    const router=window.OlliCommandRouter;
    if(!router || typeof router.prepareStructuredAction!=='function') return null;
    const prepared=await router.prepareStructuredAction(draft,{
      source:'olli_talk_structured_field_choice',
      selectedStudent:null,
      autoSubmitContext:null
    });
    if(prepared?.handled!==true) return null;

    if(prepared.kind==='action_needs_field'){
      if(String(prepared.payload?.field || '').trim()==='student_choice' && prepared.payload){
        return saveOlliTalkStructuredStudentChoice(context,prepared.message || '학생을 선택해 주세요.',prepared.payload,null);
      }
      if(String(prepared.payload?.field || '').trim()==='target_choice' && prepared.payload){
        return saveOlliTalkStructuredTargetChoice(context,prepared.message || '대상을 선택해 주세요.',prepared.payload,null);
      }
      if(String(prepared.payload?.field || '').trim()==='division' && prepared.payload){
        return saveOlliTalkStructuredDivisionChoice(context,prepared.message || '유치부인지 초등부인지 선택해 주세요.',prepared.payload,null);
      }
      if(['date','target_date'].includes(String(prepared.payload?.field || '').trim()) && prepared.payload){
        return saveOlliTalkStructuredDateChoice(context,prepared.message || '날짜를 선택해 주세요.',prepared.payload,null);
      }
      if(['time','target_time'].includes(String(prepared.payload?.field || '').trim()) && prepared.payload){
        return saveOlliTalkStructuredTimeChoice(context,prepared.message || '시간을 선택해 주세요.',prepared.payload,null);
      }
      return saveOlliTalkOlliReply(context,String(prepared.message || '').trim() || '필요한 정보를 선택해 주세요.',null);
    }
    if(prepared.kind==='action_pending' && prepared.payload && draft?.batchStructured===true){
      return finishOlliTalkBatchStructuredCommand(draft,prepared,context);
    }
    if(['action_pending','action_choice'].includes(prepared.kind) && prepared.payload){
      return saveOlliTalkActionReply(
        context,
        prepared.message || (prepared.kind==='action_choice' ? '반을 선택해 주세요.' : '이 작업을 진행할까요?'),
        prepared.payload,
        null
      );
    }
    if(prepared.kind==='action_rejected'){
      return saveOlliTalkOlliReply(context,String(prepared.message || '').trim() || '작업을 준비하지 못했어요.',null);
    }
    return null;
  }

  async function handleOlliTalkStructuredDateChoice(action,dateExpression){
    const actionId=String(action?.id || '').trim();
    const selected=String(dateExpression || '').trim();
    if(!actionId || !selected || olliTalkActionBusy.has(actionId)) return;

    const context=getOlliTalkBetaContext();
    if(!context.sessionToken || !context.academyId){
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    olliTalkActionBusy.add(actionId);
    setOlliTalkActionCardBusy(actionId,true);
    try{
      const payload=await callOlliTalkRpc('olli_team_chat_action_select_structured_date',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId,
        p_date_expression:selected
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '날짜를 선택하지 못했습니다.');
      }
      if(String(payload?.draft?.action || '').trim()==='update_waitlist'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=String(payload?.source_message_text || '').trim();
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('대기 변경 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveOlliTalkStructuredWaitlistUpdateTurn(
          payload.draft,
          context,
          sourceMessageText,
          sourceMessageId
        );
      }else{
        await continueOlliTalkStructuredWriteDraft(payload.draft,context);
      }
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
    }catch(error){
      console.warn('올리톡 구조화 날짜 선택 실패:',error);
      alert(error?.message || '날짜를 선택하지 못했습니다.');
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

  function appendOlliTalkStructuredDateChoiceButtons(card,action){
    card.classList.add('structuredDate');
    const interactive=String(action?.status || '').trim()==='pending';

    const now=new Date();
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12,0,0,0);
    const tomorrow=new Date(today.getTime());
    tomorrow.setDate(tomorrow.getDate()+1);

    const addQuick=(label,date)=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='olliTalkBetaActionButton primary';
      button.textContent=label;
      button.disabled=!interactive;
      if(interactive) button.addEventListener('click',()=>handleOlliTalkStructuredDateChoice(action,olliTalkStructuredDateExpressionFromDate(date)));
      card.appendChild(button);
    };
    addQuick('오늘',today);
    addQuick('내일',tomorrow);

    const dateInput=document.createElement('input');
    dateInput.type='date';
    dateInput.className='olliTalkBetaDateInput';
    dateInput.disabled=!interactive;
    dateInput.min=olliTalkStructuredDateInputValue(today);
    const maxDate=new Date(today.getTime());
    maxDate.setDate(maxDate.getDate()+364);
    dateInput.max=olliTalkStructuredDateInputValue(maxDate);
    if(interactive) dateInput.addEventListener('change',()=>{
      const match=String(dateInput.value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(!match) return;
      handleOlliTalkStructuredDateChoice(action,Number(match[2])+'월 '+Number(match[3])+'일');
    });

    const pick=document.createElement('button');
    pick.type='button';
    pick.className='olliTalkBetaActionButton secondary dateWide';
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

  async function handleOlliTalkStructuredTargetChoice(action,choiceId){
    const actionId=String(action?.id || '').trim();
    const selectedId=String(choiceId || '').trim();
    if(!actionId || !selectedId || olliTalkActionBusy.has(actionId)) return;

    const context=getOlliTalkBetaContext();
    if(!context.sessionToken || !context.academyId){
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    olliTalkActionBusy.add(actionId);
    setOlliTalkActionCardBusy(actionId,true);
    try{
      const payload=await callOlliTalkRpc('olli_team_chat_action_select_structured_target',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId,
        p_choice_id:selectedId
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '대상을 선택하지 못했습니다.');
      }
      if(['set_session_order','set_class_teacher','set_teacher_override'].includes(String(payload?.draft?.action || '').trim())){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=String(payload?.source_message_text || '').trim();
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('수업 순서 변경 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveOlliTalkStructuredTimetableAdminTurn(
          payload.draft,
          context,
          sourceMessageText,
          sourceMessageId
        );
      }else if(['add_timetable_memo','delete_timetable_memo'].includes(String(payload?.draft?.action || '').trim())){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=String(payload?.source_message_text || '').trim();
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('시간표 메모 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveOlliTalkStructuredTimetableMemoTurn(
          payload.draft,
          context,
          sourceMessageText,
          sourceMessageId
        );
      }else if(String(payload?.draft?.action || '').trim()==='cancel_move'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=String(payload?.source_message_text || '').trim();
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('수업 이동 취소 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveOlliTalkStructuredMoveCancelTurn(
          payload.draft,
          context,
          sourceMessageText,
          sourceMessageId
        );
      }else if(String(payload?.draft?.action || '').trim()==='cancel_trial'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=String(payload?.source_message_text || '').trim();
        const reasonMessageId=Number(payload?.reason_message_id || 0);
        const reasonMessageText=String(payload?.reason_message_text || '').trim();
        const reason=String(payload?.draft?.reason || '').trim();
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText
          ||!Number.isSafeInteger(reasonMessageId)||reasonMessageId<=0||!reasonMessageText||!reason){
          throw new Error('체험 취소 원문 또는 사유 메시지를 확인하지 못했습니다.');
        }
        await resolveOlliTalkStructuredTrialCancelTurn({
          structuredCommand:payload.draft,sourceText:sourceMessageText,sourceMessageId,
          reasonText:reason,reasonMessageText,reasonMessageId,context
        });
      }else if(String(payload?.draft?.action || '').trim()==='cancel_makeup'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=String(payload?.source_message_text || '').trim();
        const reasonMessageId=Number(payload?.reason_message_id || 0);
        const reasonMessageText=String(payload?.reason_message_text || '').trim();
        const reason=String(payload?.draft?.reason || '').trim();
        if(
          !Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText
          || !Number.isSafeInteger(reasonMessageId)||reasonMessageId<=0||!reasonMessageText||!reason
        ){
          throw new Error('보강 취소 원문 또는 사유 메시지를 확인하지 못했습니다.');
        }
        await resolveOlliTalkStructuredMakeupCancelTurn({
          structuredCommand:payload.draft,
          sourceText:sourceMessageText,
          sourceMessageId,
          reasonText:reason,
          reasonMessageText,
          reasonMessageId,
          context,
        });
      }else if(String(payload?.draft?.action || '').trim()==='update_waitlist'){
        const sourceMessageId=Number(payload?.source_message_id || 0);
        const sourceMessageText=String(payload?.source_message_text || '').trim();
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||!sourceMessageText){
          throw new Error('대기 변경 원문 메시지를 확인하지 못했습니다.');
        }
        await resolveOlliTalkStructuredWaitlistUpdateTurn(
          payload.draft,
          context,
          sourceMessageText,
          sourceMessageId
        );
      }else{
        await continueOlliTalkStructuredWriteDraft(payload.draft,context);
      }
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
    }catch(error){
      console.warn('올리톡 구조화 대상 선택 실패:',error);
      alert(error?.message || '대상을 선택하지 못했습니다.');
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

  async function populateOlliTalkStructuredTargetChoiceCard(card,action){
    const actionId=String(action?.id || '').trim();
    const interactive=String(action?.status || '').trim()==='pending';
    const context=getOlliTalkBetaContext();
    if(!actionId || !context.sessionToken || !context.academyId) return;

    try{
      const payload=await callOlliTalkRpc('olli_team_chat_get_structured_target_choice',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId
      });
      if(!payload?.ok || !Array.isArray(payload?.choices)){
        throw new Error(payload?.message || '선택할 일정을 확인하지 못했습니다.');
      }
      if(!card.isConnected || String(card.dataset.olliTalkActionId || '').trim()!==actionId) return;
      card.replaceChildren();
      if(!payload.choices.length){
        card.appendChild(createMessageText('span','olliTalkBetaActionStatus','선택할 일정이 없어요.'));
        return;
      }
      payload.choices.forEach(choice=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='olliTalkBetaActionButton primary targetChoice';
        button.textContent=String(choice?.label || '일정').trim();
        button.disabled=!interactive;
        if(interactive) button.addEventListener('click',()=>handleOlliTalkStructuredTargetChoice(action,String(choice?.id || '').trim()));
        card.appendChild(button);
      });
    }catch(error){
      if(!card.isConnected) return;
      card.replaceChildren(createMessageText('span','olliTalkBetaActionStatus failed',String(error?.message || '').trim() || '일정 목록을 불러오지 못했어요.'));
    }
  }

  function appendOlliTalkStructuredTargetChoiceButtons(card,action){
    card.classList.add('structuredTarget');
    card.appendChild(createMessageText('span','olliTalkBetaActionStatus','일정 확인 중'));
    void populateOlliTalkStructuredTargetChoiceCard(card,action);
  }

  async function handleOlliTalkStructuredStudentChoice(action,studentName){
    const actionId=String(action?.id || '').trim();
    const selectedName=String(studentName || '').trim();
    if(!actionId || !selectedName || olliTalkActionBusy.has(actionId)) return;

    const context=getOlliTalkBetaContext();
    if(!context.sessionToken || !context.academyId){
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    olliTalkActionBusy.add(actionId);
    setOlliTalkActionCardBusy(actionId,true);
    try{
      const payload=await callOlliTalkRpc('olli_team_chat_action_select_structured_student',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId,
        p_student_name:selectedName
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '학생을 선택하지 못했습니다.');
      }
      await continueOlliTalkStructuredWriteDraft(payload.draft,context);
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
    }catch(error){
      console.warn('올리톡 구조화 학생 선택 실패:',error);
      alert(error?.message || '학생을 선택하지 못했습니다.');
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

  async function populateOlliTalkStructuredStudentChoiceCard(card,action){
    const actionId=String(action?.id || '').trim();
    const interactive=String(action?.status || '').trim()==='pending';
    const context=getOlliTalkBetaContext();
    if(!actionId || !context.sessionToken || !context.academyId) return;

    try{
      const payload=await callOlliTalkRpc('olli_team_chat_get_structured_student_choice',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId
      });
      if(!payload?.ok || !Array.isArray(payload?.choices)){
        throw new Error(payload?.message || '선택할 학생을 확인하지 못했습니다.');
      }
      if(!card.isConnected || String(card.dataset.olliTalkActionId || '').trim()!==actionId) return;
      card.replaceChildren();
      if(!payload.choices.length){
        card.appendChild(createMessageText('span','olliTalkBetaActionStatus','선택할 학생이 없어요.'));
        return;
      }
      payload.choices.forEach(choice=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='olliTalkBetaActionButton primary studentChoice';
        button.textContent=String(choice?.label || choice?.studentName || '학생').trim();
        button.disabled=!interactive;
        if(interactive) button.addEventListener('click',()=>handleOlliTalkStructuredStudentChoice(action,String(choice?.studentName || '').trim()));
        card.appendChild(button);
      });
    }catch(error){
      if(!card.isConnected) return;
      card.replaceChildren(createMessageText('span','olliTalkBetaActionStatus failed',String(error?.message || '').trim() || '학생 목록을 불러오지 못했어요.'));
    }
  }

  function appendOlliTalkStructuredStudentChoiceButtons(card,action){
    card.classList.add('structuredStudent');
    card.appendChild(createMessageText('span','olliTalkBetaActionStatus','학생 확인 중'));
    void populateOlliTalkStructuredStudentChoiceCard(card,action);
  }

  async function handleOlliTalkStructuredDivisionChoice(action,division){
    const actionId=String(action?.id || '').trim();
    const selected=String(division || '').trim().toLowerCase();
    if(!actionId || !['kinder','elementary'].includes(selected) || olliTalkActionBusy.has(actionId)) return;

    const context=getOlliTalkBetaContext();
    if(!context.sessionToken || !context.academyId){
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    olliTalkActionBusy.add(actionId);
    setOlliTalkActionCardBusy(actionId,true);
    try{
      const payload=await callOlliTalkRpc('olli_team_chat_action_select_structured_division',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId,
        p_division:selected
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '수업 구분을 선택하지 못했습니다.');
      }
      await continueOlliTalkStructuredWriteDraft(payload.draft,context);
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
    }catch(error){
      console.warn('올리톡 구조화 수업 구분 선택 실패:',error);
      alert(error?.message || '수업 구분을 선택하지 못했습니다.');
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

  function appendOlliTalkStructuredDivisionChoiceButtons(card,action){
    card.classList.add('structuredDivision');
    const interactive=String(action?.status || '').trim()==='pending';
    [
      {value:'kinder',label:'유치부'},
      {value:'elementary',label:'초등부'}
    ].forEach(choice=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='olliTalkBetaActionButton primary divisionChoice';
      button.textContent=choice.label;
      button.disabled=!interactive;
      if(interactive) button.addEventListener('click',()=>handleOlliTalkStructuredDivisionChoice(action,choice.value));
      card.appendChild(button);
    });
  }

  async function handleOlliTalkStructuredTimeChoice(action,timeSlot){
    const actionId=String(action?.id || '').trim();
    const selectedTime=Number(timeSlot || 0);
    if(!actionId || !selectedTime || olliTalkActionBusy.has(actionId)) return;

    const context=getOlliTalkBetaContext();
    if(!context.sessionToken || !context.academyId){
      alert('올리톡을 사용하려면 계정 로그인이 필요합니다.');
      return;
    }

    olliTalkActionBusy.add(actionId);
    setOlliTalkActionCardBusy(actionId,true);
    try{
      const payload=await callOlliTalkRpc('olli_team_chat_action_select_structured_time',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId,
        p_time_slot:selectedTime
      });
      if(!payload?.ok || !payload?.action || !payload?.draft){
        throw new Error(payload?.message || '시간을 선택하지 못했습니다.');
      }
      await continueOlliTalkStructuredWriteDraft(payload.draft,context);
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'follow-if-near-bottom'
      });
    }catch(error){
      console.warn('올리톡 구조화 시간 선택 실패:',error);
      alert(error?.message || '시간을 선택하지 못했습니다.');
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

  async function populateOlliTalkStructuredTimeChoiceCard(card,action){
    const actionId=String(action?.id || '').trim();
    const interactive=String(action?.status || '').trim()==='pending';
    const context=getOlliTalkBetaContext();
    if(!actionId || !context.sessionToken || !context.academyId) return;

    try{
      const payload=await callOlliTalkRpc('olli_team_chat_get_structured_time_choice',{
        p_session_token:context.sessionToken,
        p_academy_id:context.academyId,
        p_action_id:actionId
      });
      if(!payload?.ok || !Array.isArray(payload?.choices)){
        throw new Error(payload?.message || '선택 가능한 시간을 확인하지 못했습니다.');
      }
      if(!card.isConnected || String(card.dataset.olliTalkActionId || '').trim()!==actionId) return;
      card.replaceChildren();
      if(!payload.choices.length){
        card.appendChild(createMessageText('span','olliTalkBetaActionStatus','선택 가능한 수업 시간이 없어요.'));
        return;
      }
      payload.choices.forEach(choice=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='olliTalkBetaActionButton primary timeChoice';
        const label=String(choice?.label || '').trim() || Number(choice?.timeSlot || 0)+'시';
        const status=String(choice?.status || '').trim();
        const selectable=choice?.selectable===true;
        const waitlistFull=status==='full'
          && String(payload?.targetIntent || '').trim()==='add_waitlist';
        if(status==='full' && !waitlistFull){
          button.classList.add('withStatusLabel');
          button.append(
            createMessageText('span','timeChoiceLabel',label),
            createMessageText('span','timeChoiceStatus','마감')
          );
        }else{
          button.textContent=waitlistFull ? label+'\n대기 가능' : label;
        }
        button.disabled=!selectable || !interactive;
        if(!selectable) button.classList.add('closed');
        if(selectable && interactive) button.addEventListener('click',()=>handleOlliTalkStructuredTimeChoice(action,Number(choice?.timeSlot || 0)));
        card.appendChild(button);
      });
    }catch(error){
      if(!card.isConnected) return;
      card.replaceChildren(createMessageText('span','olliTalkBetaActionStatus failed',String(error?.message || '').trim() || '시간을 불러오지 못했어요.'));
    }
  }

  function appendOlliTalkStructuredTimeChoiceButtons(card,action){
    card.classList.add('structuredTime');
    card.appendChild(createMessageText('span','olliTalkBetaActionStatus','시간 확인 중'));
    void populateOlliTalkStructuredTimeChoiceCard(card,action);
  }

  function createOlliTalkActionCard(action){
    const card=document.createElement('div');
    const status=String(action?.status || 'pending').trim() || 'pending';
    card.className='olliTalkBetaActionCard';
    if(String(action?.action_type || '').trim()==='choose_reason') card.classList.add('reasonChoice');
    card.dataset.olliTalkActionId=String(action?.id || '').trim();
    card.dataset.actionStatus=status;

    if(status!=='pending'){
      if(status==='completed' && isOlliTalkChoiceActionType(action?.action_type)){
        const selectedRow=document.createElement('div');
        selectedRow.className='olliTalkBetaBubbleRow olliTalkBetaSelectedChoiceRow';
        selectedRow.dataset.olliTalkActionId=String(action?.id || '').trim();
        selectedRow.dataset.actionStatus=status;

        const selectedBubble=createMessageText(
          'div',
          'olliTalkBetaBubble olliTalkBetaSelectedChoiceBubble',
          getOlliTalkSelectedChoiceButtonLabel(action)
        );
        selectedRow.appendChild(selectedBubble);
        return selectedRow;
      }
      if(status==='failed'){
        const label=createMessageText('span','olliTalkBetaActionStatus',getOlliTalkActionStatusLabel(action));
        label.classList.add('failed');
        card.appendChild(label);
        return card;
      }
      // 최종 등록/취소/변경 결과는 바로 아래 시스템 말풍선이 담당합니다.
      return null;
    }

    if(String(action?.action_type || '').trim()==='choose_reason'){
      card.appendChild(createOlliTalkPendingTextInputButton(action));
      return card;
    }

    const isSessionGroupChoice=['choose_makeup_group','choose_trial_group','choose_waitlist_group','choose_move_group'].includes(String(action?.action_type || '').trim());
    if(isSessionGroupChoice){
      ['A','B'].forEach(group=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='olliTalkBetaActionButton primary';
        button.textContent=group+'반';
        button.addEventListener('click',()=>handleOlliTalkSessionGroupChoice(action,group));
        card.appendChild(button);
      });
      return card;
    }

    if(String(action?.action_type || '').trim()==='choose_structured_student'){
      appendOlliTalkStructuredStudentChoiceButtons(card,action);
      return card;
    }

    if(String(action?.action_type || '').trim()==='choose_structured_target'){
      appendOlliTalkStructuredTargetChoiceButtons(card,action);
      return card;
    }

    if(String(action?.action_type || '').trim()==='choose_structured_division'){
      appendOlliTalkStructuredDivisionChoiceButtons(card,action);
      return card;
    }

    if(String(action?.action_type || '').trim()==='choose_structured_date'){
      appendOlliTalkStructuredDateChoiceButtons(card,action);
      return card;
    }

    if(String(action?.action_type || '').trim()==='choose_structured_time'){
      appendOlliTalkStructuredTimeChoiceButtons(card,action);
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

    olliTalkOlliReplyBusy.add(messageId);
    button.disabled=true;
    button.textContent='응답 중';

    try{
      olliTalkAssistantReplyPending=true;
      syncOlliTalkAssistantTypingIndicator();
      const turn=await resolveOlliTalkAiTurn(commandText,context,Number(messageId),{allowSuggestedQuery:true});
      olliTalkAssistantReplyPending=false;
      const assistantMessages=Array.isArray(turn.assistantMessages) && turn.assistantMessages.length
        ? turn.assistantMessages
        : [turn.assistantMessage].filter(Boolean);
      if(assistantMessages.length){
        replaceOlliTalkAssistantTypingWithMessage(assistantMessages[0],context.memberId);
        assistantMessages.slice(1).forEach(message=>appendOlliTalkPersistedMessage(message,context.memberId));
      }else{
        syncOlliTalkAssistantTypingIndicator();
      }

      removeOlliTalkReplySuggestion(messageId);
      await loadOlliTalkBetaMessages({
        showLoading:false,
        localFirst:false,
        scrollMode:'bottom',
        render:false
      });
    }catch(error){
      console.warn('올리 응답 버튼 처리 실패:',error);
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
    const senderName = String(item?.sender_name || '').trim();
    const currentId = String(currentMemberId || '').trim();
    if (senderMemberId && senderMemberId === currentId) return 'outgoing:' + senderMemberId;
    return 'incoming:' + (senderName || senderMemberId || 'unknown');
  }

  function getOlliTalkMessageMinuteKey(value){
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0')
    ].join(':');
  }

  function isOlliTalkConnectedMessage(previousItem, item, currentMemberId){
    if (!previousItem || !item) return false;
    const previousKey = getOlliTalkMessageGroupKey(previousItem, currentMemberId);
    const currentKey = getOlliTalkMessageGroupKey(item, currentMemberId);
    if (!previousKey || previousKey !== currentKey) return false;

    const previousMinute = getOlliTalkMessageMinuteKey(previousItem?.created_at);
    const currentMinute = getOlliTalkMessageMinuteKey(item?.created_at);
    return !!previousMinute && previousMinute === currentMinute;
  }

  function isOlliTalkRenderedMessageGroupMatch(group,item,currentMemberId){
    if(!group?.classList?.contains('olliTalkBetaMessageGroup') || !item) return false;
    const currentKey=getOlliTalkMessageGroupKey(item,currentMemberId);
    const currentMinute=getOlliTalkMessageMinuteKey(item?.created_at);
    return !!currentKey
      && String(group.dataset.groupKey || '')===currentKey
      && !!currentMinute
      && String(group.dataset.minuteKey || '')===currentMinute;
  }

  function hideOlliTalkRenderedMessageTime(message){
    if(!message?.classList?.contains('olliTalkBetaMessage')) return;
    const time=message.querySelector?.('.olliTalkBetaMessageTime');
    if(time){
      time.style.visibility='hidden';
      time.setAttribute('aria-hidden','true');
    }
  }

  function syncOlliTalkRenderedGroupTime(group){
    if(!group?.classList?.contains('olliTalkBetaMessageGroup')) return false;
    const messages=Array.from(
      group.querySelectorAll('.olliTalkBetaMessage[data-message-id]')
    );
    if(!messages.length) return false;

    messages.forEach((message,index)=>{
      const time=message.querySelector?.('.olliTalkBetaMessageTime');
      if(!time) return;
      const isLast=index===messages.length-1;
      time.style.visibility=isLast ? '' : 'hidden';
      if(isLast){
        time.removeAttribute('aria-hidden');
      }else{
        time.setAttribute('aria-hidden','true');
      }
    });
    return true;
  }

  function createOlliTalkMessageGroupElement(item,currentMemberId){
    const type=String(item?.message_type || 'text');
    const isAi=type==='ai' || type==='system';
    const own=!isAi && String(item?.sender_member_id || '')===String(currentMemberId || '');
    const mode=isAi ? 'ai' : (own ? 'outgoing' : 'incoming');

    const group=document.createElement('div');
    group.className='olliTalkBetaMessageGroup '+mode;
    group.dataset.groupKey=getOlliTalkMessageGroupKey(item,currentMemberId);
    group.dataset.minuteKey=getOlliTalkMessageMinuteKey(item?.created_at);
    group.dataset.dateKey=getOlliTalkDateKey(item?.created_at);

    const stack=document.createElement('div');
    stack.className='olliTalkBetaMessageStack';

    if(isAi || !own){
      const incomingLayout=document.createElement('div');
      incomingLayout.className='olliTalkBetaIncomingLayout'+(isAi ? ' olliTalkBetaAiIncomingLayout' : '');

      if(isAi){
        const sender=document.createElement('div');
        sender.className='olliTalkBetaSender';
        const avatar=document.createElement('span');
        avatar.className='olliTalkBetaMemberAvatar olliTalkBetaAiAvatar';
        avatar.textContent='Olli';
        avatar.setAttribute('aria-hidden','true');
        sender.appendChild(avatar);
        sender.appendChild(createMessageText('span','olliTalkBetaSenderName','올리'));
        incomingLayout.appendChild(sender);
      }else{
        const senderName=String(item?.sender_name || '선생님').trim() || '선생님';
        incomingLayout.appendChild(createOlliTalkSenderProfile(senderName,item?.sender_member_id));
      }

      incomingLayout.appendChild(stack);
      group.appendChild(incomingLayout);
    }else{
      group.appendChild(stack);
    }

    return group;
  }

  function appendOlliTalkMessageToGroup(group,item,currentMemberId,options={}){
    if(!group || !item) return null;
    const stack=group.querySelector('.olliTalkBetaMessageStack');
    if(!stack) return null;
    const groupStart=!stack.querySelector('.olliTalkBetaMessage[data-message-id]');
    const message=createOlliTalkMessageElement(item,currentMemberId,{
      ...options,
      groupStart
    });
    stack.appendChild(message);
    syncOlliTalkRenderedGroupTime(group);
    return message;
  }

  function clearOlliTalkAvatarPreviewMessages(){
    const chatArea=document.getElementById('olliTalkBetaChatArea');
    if(!chatArea)return;
    chatArea.querySelectorAll('[data-olli-avatar-preview="1"]').forEach(node=>node.remove());
  }

  function renderOlliTalkAvatarPreviewMessages(){
    if(!OLLI_TALK_AVATAR_PREVIEW_ENABLED || !isOlliTalkBetaVisible())return false;
    const chatArea=document.getElementById('olliTalkBetaChatArea');
    if(!chatArea)return false;

    clearOlliTalkAvatarPreviewMessages();

    const members=Array.from(new Map(
      (Array.isArray(olliTalkMembers)?olliTalkMembers:[])
        .filter(member=>member && member.is_olli_ai!==true && String(member.member_id||'').trim())
        .map(member=>[String(member.member_id).trim(),member])
    ).values());
    if(!members.length)return false;

    let list=chatArea.querySelector('.olliTalkBetaMessageList');
    if(!list){
      list=document.createElement('div');
      list.className='olliTalkBetaMessageList';
      chatArea.replaceChildren(list);
    }

    const createdAt=new Date().toISOString();
    members.forEach((member,index)=>{
      const memberId=String(member.member_id||'').trim();
      const senderName=String(
        member.display_name
        ||member.member_name
        ||member.name
        ||'선생님'
      ).trim()||'선생님';
      const item={
        id:'avatar-preview-'+memberId,
        client_message_id:'avatar-preview-'+memberId,
        sender_member_id:memberId,
        sender_name:senderName,
        message_type:'text',
        body:'아이콘 확인용 메시지입니다.',
        unread_count:0,
        created_at:createdAt
      };
      const group=createOlliTalkMessageGroupElement(item,OLLI_TALK_AVATAR_PREVIEW_MEMBER_ID);
      group.dataset.olliAvatarPreview='1';
      group.dataset.olliAvatarPreviewIndex=String(index);
      appendOlliTalkMessageToGroup(group,item,OLLI_TALK_AVATAR_PREVIEW_MEMBER_ID);
      list.appendChild(group);
    });

    chatArea.dataset.previewReady='';
    scheduleOlliTalkChatToComposer();
    scheduleOlliTalkLatestMessageAnchor();
    return true;
  }

  function getOlliTalkMessageFlow(messageElement){
    return messageElement?.querySelector?.(':scope > .olliTalkBetaMessageFlow') || null;
  }

  function moveOlliTalkMessageMetaToRow(messageElement,row,createdAt){
    if(!messageElement || !row) return false;
    const meta=messageElement.querySelector?.('.olliTalkBetaBubbleMeta');
    if(!meta) return false;
    const time=meta.querySelector?.('.olliTalkBetaMessageTime');
    if(time && createdAt){
      time.textContent=formatOlliTalkBetaMessageTime(createdAt);
      time.style.visibility='';
      time.removeAttribute('aria-hidden');
    }
    row.appendChild(meta);
    return true;
  }

  function appendOlliTalkInlineSystemResult(messageElement,item){
    if(!messageElement?.classList?.contains('olliTalkBetaMessage')) return false;
    const flow=getOlliTalkMessageFlow(messageElement);
    if(!flow) return false;

    const row=document.createElement('div');
    row.className='olliTalkBetaBubbleRow olliTalkBetaInlineSystemResultRow';

    const bubble=createOlliTalkMessageBubble(item);
    bubble.classList.add('olliTalkBetaSystemBubble','olliTalkBetaInlineSystemResult');
    if(/작업\s*요청.*취소/.test(String(item?.body || ''))){
      bubble.classList.add('olliTalkBetaCancelSystemBubble');
    }
    bubble.dataset.messageId=String(item?.id || '');
    row.appendChild(bubble);
    flow.appendChild(row);
    moveOlliTalkMessageMetaToRow(messageElement,row,item?.created_at);
    return true;
  }

  function createOlliTalkMessageElement(item,currentMemberId,options={}){
    const type=String(item?.message_type || 'text');
    const isAi=type==='ai' || type==='system';
    const own=!isAi && String(item?.sender_member_id || '')===String(currentMemberId || '');
    const message=document.createElement('div');

    message.className='olliTalkBetaMessage '+(isAi ? 'ai' : (own ? 'outgoing' : 'incoming'));
    if(options.groupStart===true) message.classList.add('olliTalkBetaMessageGroupStart');
    message.dataset.messageId=String(item?.id || '');
    message.dataset.dateKey=getOlliTalkDateKey(item?.created_at);
    message.dataset.groupKey=getOlliTalkMessageGroupKey(item,currentMemberId);
    message.dataset.minuteKey=getOlliTalkMessageMinuteKey(item?.created_at);

    const flow=document.createElement('div');
    flow.className='olliTalkBetaMessageFlow';

    const bubbleRow=document.createElement('div');
    bubbleRow.className='olliTalkBetaBubbleRow';
    const bubble=createOlliTalkMessageBubble(item,options);
    if(type==='system'){
      bubble.classList.add('olliTalkBetaSystemBubble');
      if(/작업\s*요청.*취소/.test(String(item?.body || ''))){
        bubble.classList.add('olliTalkBetaCancelSystemBubble');
      }
    }
    bubbleRow.appendChild(bubble);

    const bubbleMeta=document.createElement('div');
    bubbleMeta.className='olliTalkBetaBubbleMeta';
    const unreadCount=isAi ? 0 : Math.max(0,Number(item?.unread_count || 0));
    if(unreadCount>0){
      bubbleMeta.appendChild(createMessageText('span','olliTalkBetaUnreadCount',String(unreadCount)));
    }
    const messageTime=createMessageText('div','olliTalkBetaMessageTime',formatOlliTalkBetaMessageTime(item?.created_at));
    if(options.hideTime===true){
      messageTime.style.visibility='hidden';
      messageTime.setAttribute('aria-hidden','true');
    }
    bubbleMeta.appendChild(messageTime);
    bubbleRow.appendChild(bubbleMeta);
    flow.appendChild(bubbleRow);

    let selectedChoiceRow=null;
    if(item?.action){
      const actionCard=createOlliTalkActionCard(item.action);
      if(actionCard){
        flow.appendChild(actionCard);
        if(actionCard.classList?.contains('olliTalkBetaSelectedChoiceRow')){
          selectedChoiceRow=actionCard;
        }
      }
    }
    if(shouldShowOlliTalkPendingTextInput(item)) flow.appendChild(createOlliTalkPendingTextInputButton());
    message.appendChild(flow);

    if(selectedChoiceRow){
      moveOlliTalkMessageMetaToRow(
        message,
        selectedChoiceRow,
        item?.action?.resolved_at || item?.action?.updated_at || item?.created_at
      );
    }

    if(item?.material_request_id && item?.material_event_id){
      message.appendChild(createOlliTalkMaterialConfirmCard(item));
    }
    if(window.OlliTeacherPayroll?.createTeamChatPayrollButton){
      const payrollButton=window.OlliTeacherPayroll.createTeamChatPayrollButton(item,'mobile');
      if(payrollButton) message.appendChild(payrollButton);
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

  function scrollOlliTalkMessageAboveComposer(message){
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea?.isConnected || !message?.isConnected) return false;

    const chatRect = chatArea.getBoundingClientRect();
    const messageRect = message.getBoundingClientRect();
    const geometry = getOlliTalkComposerLayoutGeometry();
    const visibleBottom = geometry
      ? Math.min(chatRect.bottom, geometry.composerTop - OLLI_TALK_COMPOSER_MESSAGE_GAP)
      : chatRect.bottom - OLLI_TALK_COMPOSER_MESSAGE_GAP;
    // Compare layout positions, not last frame's message transform.
    const layoutMessageBottom = messageRect.bottom - olliTalkMessagesVisualOffsetY;
    const overflow = layoutMessageBottom - visibleBottom;
    if (overflow <= 0.5) return true;

    const maxScroll = Math.max(0, chatArea.scrollHeight - chatArea.clientHeight);
    chatArea.scrollTop = Math.max(0, Math.min(maxScroll, chatArea.scrollTop + overflow));
    return true;
  }

  function scheduleOlliTalkMessageAboveComposer(message){
    syncOlliTalkChatToComposer();
    return scrollOlliTalkMessageAboveComposer(message);
  }

  function scheduleOlliTalkLatestMessageAnchor(){
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea?.isConnected) return false;
    const latest = latestOlliTalkRenderedMessage(chatArea);
    if (latest) return scheduleOlliTalkMessageAboveComposer(latest);
    chatArea.scrollTop = chatArea.scrollHeight;
    return true;
  }

  function latestOlliTalkRenderedMessage(chatArea){
    const rows = chatArea
      ? Array.from(chatArea.querySelectorAll('.olliTalkBetaMessage, .olliTalkBetaSystemMessage'))
      : [];
    return rows[rows.length - 1] || null;
  }

  function syncOlliTalkAssistantTypingIndicator(options = {}){
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
    const typing = createOlliTalkAssistantTypingElement();
    list.appendChild(typing);
    if(options.anchor!==false) scheduleOlliTalkMessageAboveComposer(typing);
  }

  function replaceOlliTalkAssistantTypingWithMessage(item, currentMemberId){
    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (!chatArea || !item) return false;
    const typing = chatArea.querySelector('[data-olli-assistant-typing]');
    if(String(item?.message_type || '').trim()==='ai' && Number(item?.reply_to_message_id || 0)>0){
      removeOlliTalkReplySuggestion(String(Number(item.reply_to_message_id)));
    }

    if(!typing){
      return appendOlliTalkPersistedMessage(item,currentMemberId);
    }

    const typingBottom=typing.getBoundingClientRect().bottom;
    const group=createOlliTalkMessageGroupElement(item,currentMemberId);
    const next=appendOlliTalkMessageToGroup(group,item,currentMemberId);
    if(!next) return false;
    typing.replaceWith(group);
    chatArea.dataset.previewReady = '';

    // ...가 이미 입력창 위에 고정된 위치를 그대로 유지하고,
    // 실제 답변이 더 커진 만큼만 위로 보정합니다. 별도의 두 번째 bottom-anchor는 호출하지 않습니다.
    const nextBottom=group.getBoundingClientRect().bottom;
    const growth=nextBottom-typingBottom;
    if(growth>0.5){
      const maxScroll=Math.max(0,chatArea.scrollHeight-chatArea.clientHeight);
      chatArea.scrollTop=Math.max(0,Math.min(maxScroll,chatArea.scrollTop+growth));
    }
    return true;
  }

  function appendOlliTalkPersistedMessage(item,currentMemberId){
    const chatArea=document.getElementById('olliTalkBetaChatArea');
    if(!chatArea || !item) return false;
    const messageId=String(item?.id || '').trim();
    if(messageId){
      const duplicate=Array.from(chatArea.querySelectorAll('[data-message-id]'))
        .some(node=>String(node.dataset.messageId || '')===messageId);
      if(duplicate) return true;
    }

    let list=chatArea.querySelector('.olliTalkBetaMessageList');
    if(!list){
      list=document.createElement('div');
      list.className='olliTalkBetaMessageList';
      chatArea.replaceChildren(list);
    }

    const renderedMessages=Array.from(list.querySelectorAll('.olliTalkBetaMessage[data-message-id]'));
    const lastRendered=renderedMessages[renderedMessages.length-1] || null;
    const lastGroup=lastRendered?.closest?.('.olliTalkBetaMessageGroup') || null;
    const itemDateKey=getOlliTalkDateKey(item?.created_at);
    const lastDateKey=String(lastRendered?.dataset?.dateKey || '');
    const dateChanged=!!(itemDateKey && itemDateKey!==lastDateKey);

    if(dateChanged){
      const divider=document.createElement('div');
      divider.className='olliTalkBetaDateDivider';
      divider.appendChild(createMessageText('span','',formatOlliTalkDateLabel(item?.created_at)));
      list.appendChild(divider);
    }

    const sameGroup=!dateChanged && isOlliTalkRenderedMessageGroupMatch(lastGroup,item,currentMemberId);
    let group=lastGroup;
    if(sameGroup && lastRendered){
      hideOlliTalkRenderedMessageTime(lastRendered);
    }else{
      group=createOlliTalkMessageGroupElement(item,currentMemberId);
      list.appendChild(group);
    }

    const next=appendOlliTalkMessageToGroup(group,item,currentMemberId);
    if(!next) return false;

    if(String(item?.message_type || '').trim()==='ai' && Number(item?.reply_to_message_id || 0)>0){
      removeOlliTalkReplySuggestion(String(Number(item.reply_to_message_id)));
    }
    chatArea.dataset.previewReady='';
    if(!isOlliTalkPendingReasonInputActive()){
      scheduleOlliTalkMessageAboveComposer(next);
    }
    return true;
  }

  function renderOlliTalkServerMessages(payload,options={}){
    const chatArea=document.getElementById('olliTalkBetaChatArea');
    if(!chatArea) return;
    disconnectOlliTalkImageViewportObserver('chat');

    const scrollMode=String(options.scrollMode || 'bottom');
    const previousScrollTop=Math.max(0,Number(chatArea.scrollTop || 0));
    const previousScrollHeight=Math.max(0,Number(chatArea.scrollHeight || 0));
    const wasNearBottom=isOlliTalkChatNearBottom(chatArea);

    olliTalkCurrentPayload=payload || null;
    const allMessages=Array.isArray(payload?.messages) ? payload.messages : [];
    const requestedMessageLimit=Math.max(0,Math.floor(Number(options.messageLimit) || 0));
    const messages=requestedMessageLimit>0 && allMessages.length>requestedMessageLimit
      ? allMessages.slice(-requestedMessageLimit)
      : allMessages;
    olliTalkRenderedMessageLimit=messages.length;
    const currentMemberId=String(payload?.current_member_id || getOlliTalkBetaContext().memberId || '').trim();
    const olliReplyTargetIds=getOlliTalkReplyTargetIds(allMessages);

    if(!messages.length){
      chatArea.replaceChildren(createOlliTalkEmptyState('아직 대화가 없어요','첫 메시지를 보내 올리톡을 시작해 보세요.'));
      chatArea.dataset.previewReady='';
      return;
    }

    const list=document.createElement('div');
    list.className='olliTalkBetaMessageList';

    let lastDateKey='';
    let activeGroup=null;
    let lastRenderedMessage=null;

    messages.forEach((item,index)=>{
      const previousItem=index>0 ? messages[index-1] : null;
      const previousActionStatus=String(previousItem?.action?.status || '').trim();
      const isInlineSystemResult=String(item?.message_type || 'text')==='system'
        && String(previousItem?.message_type || '')==='ai'
        && ['completed','cancelled'].includes(previousActionStatus);

      if(isInlineSystemResult && lastRenderedMessage && appendOlliTalkInlineSystemResult(lastRenderedMessage,item)){
        activeGroup=null;
        return;
      }

      const dateKey=getOlliTalkDateKey(item?.created_at);
      const dateChanged=!!(dateKey && dateKey!==lastDateKey);
      if(dateChanged){
        const divider=document.createElement('div');
        divider.className='olliTalkBetaDateDivider';
        divider.appendChild(createMessageText('span','',formatOlliTalkDateLabel(item?.created_at)));
        list.appendChild(divider);
        lastDateKey=dateKey;
        activeGroup=null;
      }

      const sameGroup=!dateChanged
        && !!activeGroup
        && isOlliTalkConnectedMessage(previousItem,item,currentMemberId)
        && isOlliTalkRenderedMessageGroupMatch(activeGroup,item,currentMemberId);
      if(!sameGroup){
        activeGroup=createOlliTalkMessageGroupElement(item,currentMemberId);
        list.appendChild(activeGroup);
      }

      const nextItem=index+1<messages.length ? messages[index+1] : null;
      const continuesGroup=isOlliTalkConnectedMessage(item,nextItem,currentMemberId);
      lastRenderedMessage=appendOlliTalkMessageToGroup(activeGroup,item,currentMemberId,{
        hideTime:continuesGroup,
        olliReplyTargetIds,
        deferHydration:options.deferHydration===true
      });
    });

    chatArea.replaceChildren(list);
    chatArea.dataset.previewReady = '';
    if (olliTalkAssistantReplyPending) syncOlliTalkAssistantTypingIndicator({anchor:false});
    scheduleOlliTalkChatToComposer();

    // 첫 진입은 같은 task 안에서 최신 메시지 위치를 확정합니다.
    // 다음 frame으로 하단 보정을 미루지 않아 첫 paint 뒤에 채팅이 내려가는 현상을 막습니다.
    if(scrollMode==='initial-latest'){
      syncOlliTalkChatToComposer();
      if (isOlliTalkBetaVisible()) scheduleOlliTalkLatestMessageAnchor();
      return;
    }

    const searchBar = document.getElementById('olliTalkSearchBar');
    const searchInput = document.getElementById('olliTalkSearchInput');
    const hasActiveSearch = !!searchBar && !searchBar.hidden && !!String(searchInput?.value || '').trim();
    if (hasActiveSearch) {
      refreshOlliTalkSearch({ resetIndex:true, scroll:true });
    } else {
      const shouldFollowBottom = scrollMode === 'bottom'
        || (scrollMode === 'follow-if-near-bottom' && wasNearBottom);

      if (shouldFollowBottom) {
        scheduleOlliTalkLatestMessageAnchor();
      } else {
        // Restore the reading position in the same render transaction,
        // before an asynchronous iOS keyboard viewport change can intervene.
        if(scrollMode==='preserve-prepend'){
          const addedHeight=Math.max(0,chatArea.scrollHeight-previousScrollHeight);
          chatArea.scrollTop=previousScrollTop+addedHeight;
        } else {
          chatArea.scrollTop=previousScrollTop;
        }
      }
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

  function applyOlliTalkBadgeValue(badges,count){
    const value=Math.max(0,Number(count||0));
    Array.from(badges||[]).forEach((badge)=>{
      if(!value){
        badge.hidden=true;
        badge.textContent='';
        return;
      }
      badge.hidden=false;
      badge.textContent=value>99?'99+':String(value);
    });
    return value;
  }

  function setOlliTalkMentionBadge(count,materialCount=0){
    const workBadges=document.querySelectorAll('[data-olli-work-badge], #kcfOlliTalkBadge');
    const workHubBadges=document.querySelectorAll('[data-olli-work-hub-badge]');
    const value=applyOlliTalkBadgeValue(workBadges,count);
    applyOlliTalkBadgeValue(workHubBadges,materialCount);
    try { window.OlliTalkPush?.setAppBadge?.(value); } catch (_) {}
  }

  async function refreshOlliTalkMentionBadge(options = {}){
    const context = getOlliTalkBetaContext();
    if (!context.sessionToken || !context.academyId) {
      setOlliTalkMentionBadge(0,0);
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

      setOlliTalkMentionBadge(unreadCount,materialUnreadCount);
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
      hydrateOlliTalkMemberAvatars();
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
    window.OlliMobileKeyboardActivation?.focus(input);
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

    const activeQuery = currentMentionQuery();
    if (activeQuery) {
      input.setRangeText('', activeQuery.start, activeQuery.end, 'end');
    }
    const value = String(input.value || '')
      .replace(/(^|\s)@[^\s@]*$/g, '$1')
      .replace(/(^|\s)@(?=\s|$)/g, '$1')
      .replace(/\s+/g, ' ')
      .trimStart();
    input.value = value;
    olliTalkMentionSelections.clear();
    resetOlliTalkAiConversation();
    syncOlliTalkSelectedMentionPrefix();
  }

  function activateOlliTalkComposerInput(event){
    const keyboard = window.OlliMobileKeyboardActivation;
    if (!keyboard) return null;
    return keyboard.activate(event, {
      input:getOlliTalkBetaInput,
      afterFocus:() => {
        resizeInput();
        updateOlliTalkBetaComposerState();
        syncViewport();
      }
    });
  }

  async function runOlliTalkComposerControl(event, options = {}){
    const useMention = options.mention === true;
    const input = getOlliTalkBetaInput();
    if (!input) return false;

    // Capture the frame before shared keyboard focus expands the composer.
    const activationMotionFrame = captureOlliTalkKeyboardVisualFrame();

    if (useMention && olliTalkMentionModeActive) {
      window.OlliMobileKeyboardActivation?.stopEvent(event);
      clearOlliTalkMentionDraft();
      olliTalkMentionModeActive = false;
      hideOlliTalkMentionMenu();
      resizeInput();
      updateOlliTalkBetaComposerState();
      input.blur();
      syncViewport();
      preserveOlliTalkKeyboardVisualFrame(activationMotionFrame);
      return false;
    }

    if (useMention) {
      olliTalkMentionModeActive = true;

      const caret = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
      const activeQuery = currentMentionQuery();
      if (!activeQuery) {
        const before = input.value.slice(0, caret);
        const insertion = before && !/\s$/.test(before) ? ' @' : '@';
        input.setRangeText(insertion, caret, caret, 'end');
      }
    }

    const activated = activateOlliTalkComposerInput(event);
    if (!activated) return false;

    renderOlliTalkMentionMenu();
    syncViewport();
    // Paint the first motion before the pending viewport RAF. It must see
    // both the original one-row position and the new focused position.
    preserveOlliTalkKeyboardVisualFrame(activationMotionFrame);
    if (!olliTalkMembers.length) {
      await loadOlliTalkMembers();
      renderOlliTalkMentionMenu();
      syncViewport();
    }
    return true;
  }

  function runOlliTalkComposerActivation(event, mode){
    return runOlliTalkComposerControl(event, { mention:mode === 'mention' });
  }

  function bindOlliTalkComposerActivationControl(target, mode){
    if (!target || target.dataset.olliComposerActivationBound === '1') return;
    target.dataset.olliComposerActivationBound = '1';
    target.addEventListener('click', event => {
      try {
        const result = runOlliTalkComposerActivation(event, mode);
        if (result && typeof result.catch === 'function') {
          result.catch(error => console.warn(
            mode === 'mention' ? '올리톡 멘션 전환 실패:' : '올리톡 입력창 활성화 실패:',
            error
          ));
        }
      } catch(error) {
        console.warn(
          mode === 'mention' ? '올리톡 멘션 전환 실패:' : '올리톡 입력창 활성화 실패:',
          error
        );
      }
    });
  }

  async function openOlliTalkMentionPicker(event){
    return runOlliTalkComposerControl(event, { mention:true });
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
      const renderChanged=!basePayload||!areOlliTalkMessagePayloadsRenderEquivalent(basePayload,mergedPayload);
      olliTalkHistoryExhausted=pageMessages.length<100;
      writeOlliTalkMessageCache(context,mergedPayload);
      if(options.render!==false&&renderChanged){
        const activeRenderLimit=Math.max(0,Math.floor(Math.max(Number(options.messageLimit)||0,Number(olliTalkRenderedMessageLimit)||0)));
        renderOlliTalkServerMessages(mergedPayload,{
          scrollMode:options.scrollMode||'bottom',
          ...(activeRenderLimit>0?{messageLimit:activeRenderLimit}:{})
        });
      }else{
        olliTalkCurrentPayload=mergedPayload;
        if(options.render!==false&&changed)syncOlliTalkRenderedUnreadCounts(mergedPayload);
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

    const isOlliWorkflowFollowup = olliRequested && (
      hasOlliTalkPendingCommand()
      || !!olliTalkPendingActionReason
      || !!olliTalkPendingMakeupDialogue
    );
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
      let olliTalkFirstReplyStartedAt=0;
      if (olliRequested && !isOlliWorkflowFollowup) {
        olliTalkAssistantReplyPending = true;
        olliTalkFirstReplyStartedAt=Date.now();
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
        try {
          const turn=await resolveOlliTalkAiTurn(commandText,context,Number(payload.message.id));
            if(olliTalkFirstReplyStartedAt){
              const remaining=1000-(Date.now()-olliTalkFirstReplyStartedAt);
              if(remaining>0) await new Promise(resolve=>setTimeout(resolve,remaining));
            }
            olliTalkAssistantReplyPending=false;
            const assistantMessages=Array.isArray(turn.assistantMessages) && turn.assistantMessages.length
              ? turn.assistantMessages
              : [turn.assistantMessage].filter(Boolean);
            if(assistantMessages.length){
              replaceOlliTalkAssistantTypingWithMessage(assistantMessages[0],context.memberId);
              assistantMessages.slice(1).forEach(message=>appendOlliTalkPersistedMessage(message,context.memberId));
            }else{
              syncOlliTalkAssistantTypingIndicator();
            }
          recordOlliTalkAiConversationTurn(commandText, turn.replyText);
        } catch(error) {
          console.warn('올리톡 응답 실패:', error);
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

      window.OlliMobileKeyboardActivation?.focus(input);
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
    if (olliTalkChatGestureSettleTimer) clearTimeout(olliTalkChatGestureSettleTimer);
    olliTalkChatGestureSettleTimer = null;
    olliTalkChatGestureActive = false;
    screen.style.removeProperty('--olli-talk-chat-reserve');
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
        scrollMode:'initial-latest',
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
    resizeInput();
    syncViewport();
    updateOlliTalkBetaComposerState();

    if(openCachedPayload){
      syncOlliTalkChatToComposer();
      scheduleOlliTalkLatestMessageAnchor();
    }

    requestAnimationFrame(() => {
      // rAF 뒤의 macrotask에서 시작해 로컬 DOM의 첫 paint를 먼저 보장합니다.
      setTimeout(() => {
        if(!isOlliTalkBetaVisible())return;

        hydrateOlliTalkDeferredFirstPaintAssets();
        bindOlliTalkRealtime();
        const memberLoadPromise=loadOlliTalkMembers()
          .then(members=>{
            renderOlliTalkMentionMenu();
            return members;
          })
          .catch(()=>[]);
        refreshOlliTalkMentionBadge().catch(() => {});
        if (typeof window.OlliRealtime?.ensureConnected === 'function') {
          window.OlliRealtime.ensureConnected({ force:false, reason:'olli_talk_open' }).catch(() => {});
        }
        const messageLoadPromise=loadOlliTalkBetaMessages({
          showLoading:!openCachedPayload,
          localFirst:false,
          cachedPayload:openCachedPayload,
          messageLimit:OLLI_TALK_INITIAL_RENDER_LIMIT,
          scrollMode:openCachedPayload ? 'follow-if-near-bottom' : 'initial-latest'
        });
        Promise.allSettled([memberLoadPromise,messageLoadPromise]).then(()=>{
          if(!isOlliTalkBetaVisible())return;
          renderOlliTalkAvatarPreviewMessages();
        });
      },0);
    });
  }

  async function closeOlliTalkBetaPage(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const talkScreen = getScreen();
    if (olliTalkChatGestureSettleTimer) clearTimeout(olliTalkChatGestureSettleTimer);
    olliTalkChatGestureSettleTimer = null;
    olliTalkChatGestureActive = false;
    talkScreen?.style.removeProperty('--olli-talk-chat-reserve');
    closeOlliTalkPendingReasonInputMode({blur:true});

    const input = document.getElementById('olliTalkBetaInput');
    if (input) input.blur();
    olliTalkKeyboardClosingReturnLatest = false;
    olliTalkKeyboardUserNavigatedChat = false;
    if (olliTalkKeyboardMotionTimer) clearTimeout(olliTalkKeyboardMotionTimer);
    olliTalkKeyboardMotionTimer = null;
    stopOlliTalkKeyboardVisualController();
    talkScreen?.classList.remove('olliTalkKeyboardMotion');
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
    const input = getOlliTalkBetaInput();
    const sendButton = getOlliTalkBetaSendButton();
    const mentionTriggerButton = document.getElementById('olliTalkMentionTriggerBtn');
    const composerActivateButton = document.getElementById('olliTalkComposerActivateBtn');
    const voiceButton = document.getElementById('olliTalkBetaVoiceBtn');
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

    if(voiceButton){
      voiceButton.addEventListener('pointerdown',event=>{
        if(event.isPrimary===false)return;
        if(event.pointerType==='mouse' && event.button!==0)return;
        toggleOlliTalkVoiceInput(event).catch(error=>console.warn('올리톡 음성 입력 시작 실패:',error));
      });
      voiceButton.addEventListener('click',event=>{
        // Pointer input is handled on pointerdown so the active two-row composer
        // cannot collapse between press and click. Keep keyboard activation.
        if(event.detail!==0){
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        toggleOlliTalkVoiceInput(event).catch(error=>console.warn('올리톡 음성 입력 시작 실패:',error));
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

    const chatArea = document.getElementById('olliTalkBetaChatArea');
    if (chatArea) {
      const settleOlliTalkChatGesture = (delay = 180) => {
        if (olliTalkChatGestureSettleTimer) clearTimeout(olliTalkChatGestureSettleTimer);
        olliTalkChatGestureSettleTimer = setTimeout(() => {
          olliTalkChatGestureSettleTimer = null;
          olliTalkChatGestureActive = false;
          syncOlliTalkComposerViewport({ force:true });
          syncOlliTalkChatToComposer();
        }, Math.max(0, Number(delay) || 0));
      };
      const beginOlliTalkChatGesture = () => {
        if (isOlliTalkComposerActive()) olliTalkKeyboardUserNavigatedChat = true;
        if (olliTalkChatGestureSettleTimer) clearTimeout(olliTalkChatGestureSettleTimer);
        olliTalkChatGestureSettleTimer = null;
        olliTalkChatGestureActive = true;
      };
      const endOlliTalkChatGesture = () => {
        // window의 pointerup/touchend는 입력창·버튼 터치에도 발생합니다.
        // 실제 chatArea 제스처가 시작된 경우에만 종료 보정을 실행해
        // 키보드가 올라오는 중 composer를 다시 강제 보정하지 않습니다.
        if (!olliTalkChatGestureActive) return;
        settleOlliTalkChatGesture(180);
      };

      chatArea.addEventListener('pointerdown', beginOlliTalkChatGesture, { passive:true });
      chatArea.addEventListener('touchstart', beginOlliTalkChatGesture, { passive:true });
      window.addEventListener('pointerup', endOlliTalkChatGesture, { passive:true });
      window.addEventListener('pointercancel', endOlliTalkChatGesture, { passive:true });
      window.addEventListener('touchend', endOlliTalkChatGesture, { passive:true });
      window.addEventListener('touchcancel', endOlliTalkChatGesture, { passive:true });

      chatArea.addEventListener('scroll',()=>{
        if(olliTalkChatGestureActive) settleOlliTalkChatGesture(180);
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

          // 입력창/버튼 영역에서 시작한 세로 드래그가 iOS page/WKScrollView pan으로
          // 번지지 않게 막습니다. chatArea 자체의 스크롤은 건드리지 않습니다.
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
        const chatArea = document.getElementById('olliTalkBetaChatArea');
        olliTalkKeyboardClosingReturnLatest = false;
        olliTalkKeyboardUserNavigatedChat = false;
        olliTalkKeyboardFollowLatest = !chatArea || isOlliTalkChatNearBottom(chatArea,120);
        beginOlliTalkKeyboardMotion();
        // focus/resize/scroll 모두 같은 RAF 업데이트 경로를 사용합니다.
        scheduleOlliTalkKeyboardViewportUpdate({fullSync:true});
      }, true);
      input.addEventListener('blur', () => {
        olliTalkKeyboardClosingReturnLatest = olliTalkKeyboardFollowLatest
          && !olliTalkKeyboardUserNavigatedChat && !olliTalkChatGestureActive;
        olliTalkKeyboardFollowLatest = false;
        beginOlliTalkKeyboardMotion();
        scheduleOlliTalkKeyboardViewportUpdate({fullSync:true});
      });
      input.addEventListener('click', renderOlliTalkMentionMenu);
      input.addEventListener('keyup', event => {
        if (event.key === 'Escape') hideOlliTalkMentionMenu();
      });
    }

    bindOlliTalkComposerActivationControl(composerActivateButton, 'input');
    bindOlliTalkComposerActivationControl(mentionTriggerButton, 'mention');

    if (sendButton) {
      sendButton.addEventListener('pointerdown', event => {
        if (event.isPrimary === false) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        sendOlliTalkBetaMessage(event).catch(error => console.warn('올리톡 메시지 전송 시작 실패:', error));
      });
      sendButton.addEventListener('click', event => {
        // Pointer input is handled on pointerdown so the active two-row composer
        // cannot collapse and hide the send button before the click is delivered.
        if (event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        sendOlliTalkBetaMessage(event).catch(error => console.warn('올리톡 메시지 전송 시작 실패:', error));
      });
    }

    updateOlliTalkBetaComposerState();
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
