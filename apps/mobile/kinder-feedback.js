/* ── 유치부 대화형 1분 피드백 페이지 v1 ── */
const KCF_DRAFT_KEY = 'olli_kinder_chat_feedback_draft_v1';
const KCF_GUIDE_VISIBILITY_KEY = 'olli_kinder_chat_feedback_guide_visibility_v1';
const KCF_PROMPT_CACHE_TOUCH_KEY_PREFIX = 'olli_kcf_prompt_cache_touch_v1';
const KCF_PROMPT_CACHE_WARM_COOLDOWN_MS = 5 * 60 * 1000;
let kcfPromptCacheWarmupPromise = null;

function getKinderChatFeedbackPromptCacheTouchKey(){
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${KCF_PROMPT_CACHE_TOUCH_KEY_PREFIX}_${academyId}`;
}
function getKinderChatFeedbackPromptCacheTouchedAt(){
  try {
    return Number(localStorage.getItem(getKinderChatFeedbackPromptCacheTouchKey()) || 0) || 0;
  } catch(e) {
    return 0;
  }
}
function markKinderChatFeedbackPromptCacheTouched(){
  try {
    localStorage.setItem(getKinderChatFeedbackPromptCacheTouchKey(), String(Date.now()));
  } catch(e) {}
}
function warmKinderChatFeedbackPromptCache(){
  if (kcfPromptCacheWarmupPromise) return kcfPromptCacheWarmupPromise;

  const touchedAt = getKinderChatFeedbackPromptCacheTouchedAt();
  if (touchedAt && Date.now() - touchedAt < KCF_PROMPT_CACHE_WARM_COOLDOWN_MS) {
    return Promise.resolve({ ok:true, skipped:'recent' });
  }

  const startedAt = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();

  kcfPromptCacheWarmupPromise = fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      promptType: 'class',
      messages: [],
      warmup: true,
      stream: false
    })
  })
    .then(async response => {
      let data = {};
      try { data = await response.json(); } catch(e) {}
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `캐시 준비 요청 실패 (${response.status})`);
      }
      markKinderChatFeedbackPromptCacheTouched();
      const endedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      console.info('[OLLI AI] feedback prompt cache warmup ready', {
        elapsedMs: Math.round(endedAt - startedAt),
        model: data.model || '',
        inputTokens: Number(data.inputTokens || 0) || 0,
        cachedTokens: Number(data.cachedTokens || 0) || 0,
        cacheWriteTokens: Number(data.cacheWriteTokens || 0) || 0,
      });
      return data;
    })
    .catch(error => {
      console.warn('[OLLI AI] feedback prompt cache warmup skipped:', error?.message || error);
      return null;
    })
    .finally(() => {
      kcfPromptCacheWarmupPromise = null;
    });

  return kcfPromptCacheWarmupPromise;
}
function reportKinderChatFeedbackTtft(ttftMs, promptType, academyId){
  const elapsed = Math.round(Number(ttftMs));
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60000) return;
  if (String(promptType || 'class') !== 'class') return;

  try {
    fetch('/api/feedback-ttft-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        academyId: String(academyId || ''),
        promptType: 'class',
        ttftMs: elapsed
      })
    }).catch(() => {});
  } catch(e) {}
}
function getKinderChatFeedbackDraftKey(){
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${KCF_DRAFT_KEY}_${academyId}`;
}
function getKinderChatFeedbackGuideVisibilityKey(){
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  let memberKey = '';
  try {
    const context = window.OlliStorageCore?.AcademyContext?.getCurrent?.() || null;
    memberKey = String(context?.memberId || context?.member_id || context?.userId || context?.user_id || context?.memberName || '').trim();
  } catch(e) {}
  if (!memberKey) {
    try {
      memberKey = String(localStorage.getItem('olli_current_member_id') || localStorage.getItem('olli_current_member_name') || '').trim();
    } catch(e) {}
  }
  return `${KCF_GUIDE_VISIBILITY_KEY}_${academyId}_${memberKey || 'member'}`;
}
function isKinderChatFeedbackGuideVisible(){
  try {
    return localStorage.getItem(getKinderChatFeedbackGuideVisibilityKey()) !== 'hidden';
  } catch(e) {
    return true;
  }
}
function applyKinderChatFeedbackGuideVisibility(){
  const screen = document.getElementById('kinderChatFeedbackScreen');
  if (!screen) return;
  screen.classList.toggle('kcfGuideHidden', !isKinderChatFeedbackGuideVisible());

}
function setKinderChatFeedbackGuideVisibility(visible){
  try {
    localStorage.setItem(getKinderChatFeedbackGuideVisibilityKey(), visible ? 'visible' : 'hidden');
  } catch(e) {}
  applyKinderChatFeedbackGuideVisibility();
}
const KCF_VIVICOT_INBOX_BUBBLE_KEY_PREFIX = 'olli_kcf_vivicot_inbox_bubble_active_v1';
const KCF_TOP_MODE_KEY_PREFIX = 'olli_kcf_top_mode_v1';
let kcfTopMode = 'live';
function getKinderChatFeedbackTopModeStorageKey(){
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${KCF_TOP_MODE_KEY_PREFIX}_${academyId}`;
}
function getKinderChatFeedbackTopMode(){
  return kcfTopMode === 'inbox' ? 'inbox' : 'live';
}
function applyKinderChatFeedbackTopMode(){
  const mode = getKinderChatFeedbackTopMode();
  const inboxMode = mode === 'inbox';
  const layer = document.getElementById('kcfPersistentTopLayer');
  const liveBtn = document.getElementById('kcfOlliBtn');
  const inboxBtn = document.getElementById('kcfInboxModeBtn');
  if (layer) layer.classList.toggle('kcfTopModeInbox', inboxMode);
  if (liveBtn) {
    liveBtn.setAttribute('aria-hidden', inboxMode ? 'true' : 'false');
    liveBtn.tabIndex = inboxMode ? -1 : 0;
  }
  if (inboxBtn) {
    inboxBtn.setAttribute('aria-hidden', inboxMode ? 'false' : 'true');
    inboxBtn.tabIndex = inboxMode ? 0 : -1;
  }
  try { updateKinderChatFeedbackBadge(); } catch(e) {}
}
function setKinderChatFeedbackTopMode(mode, persist = true){
  kcfTopMode = 'live';
  if (persist) {
    try { localStorage.setItem(getKinderChatFeedbackTopModeStorageKey(), 'live'); } catch(e) {}
  }
  applyKinderChatFeedbackTopMode();
  restoreKinderChatFeedbackLiveSession();
}
function restoreKinderChatFeedbackTopMode(){
  setKinderChatFeedbackTopMode('live', false);
}
function toggleKinderChatFeedbackTopMode(event){
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  setKinderChatFeedbackTopMode(getKinderChatFeedbackTopMode() === 'live' ? 'inbox' : 'live');
}
let kcfVivicotInboxMidnightTimer = null;
let kcfActiveKeyword = '';
let kcfKeepInputFocusUntil = 0;
let kcfKeyboardBaselineBottom = 0;
let kcfContentBaselineHeight = 0;
let kcfViewportBound = false;
let kcfViewportSettleTimer = null;
let kcfLastViewportSignature = '';
let kcfChatGestureActive = false;
let kcfChatGestureSettleTimer = null;
let kcfComposerViewportLock = null;
let kcfComposerViewportLockTimer = null;
let kcfKeyboardTransitionActive = false;
let kcfPendingPhoto = null;
let kcfManualSelectedStudentId = '';
let kcfManualSelectedStudentName = '';
let kcfManualSelectedStudentDivision = '';
function normalizeKinderChatFeedbackStudentDivision(student){
  const raw = String(student?.type || student?.division || student || '').trim().toLowerCase();
  return raw === 'kinder' || raw === '유치부' ? 'kinder' : 'elementary';
}
function getKinderChatFeedbackManualSelection(){
  const studentId = String(kcfManualSelectedStudentId || '').trim();
  const studentName = normalizeTodayFeedbackStudentName(kcfManualSelectedStudentName || '');
  const studentDivision = String(kcfManualSelectedStudentDivision || '').trim();
  return studentId && studentName ? {
    studentId,
    studentName,
    studentDivision: studentDivision === 'kinder' ? 'kinder' : 'elementary'
  } : null;
}
function syncKinderChatFeedbackManualSelectionUi(){
  const input = document.getElementById('kcfInput');
  if (!input) return;
  const selected = getKinderChatFeedbackManualSelection();
  const teacherMode = getKinderChatFeedbackTeacherMode();
  const autoSelection = teacherMode && typeof teacherMode.getSelection === 'function'
    ? teacherMode.getSelection()
    : null;
  if (autoSelection?.studentId) return;
  input.placeholder = selected ? `${selected.studentName} 수업기록을 적어주세요` : '수업기록을 적어주세요';
}
function setKinderChatFeedbackManualSelection(student){
  kcfManualSelectedStudentId = String(student?.id || '').trim();
  kcfManualSelectedStudentName = normalizeTodayFeedbackStudentName(student?.name || '');
  kcfManualSelectedStudentDivision = normalizeKinderChatFeedbackStudentDivision(student);
  syncKinderChatFeedbackManualSelectionUi();
}
function clearKinderChatFeedbackManualSelection(){
  kcfManualSelectedStudentId = '';
  kcfManualSelectedStudentName = '';
  kcfManualSelectedStudentDivision = '';
  syncKinderChatFeedbackManualSelectionUi();
}
const kcfKeywordQuestions = {
  transition: { title:'망설임→전환', questions:['아이가 처음 망설인 장면은 무엇이었나요?', '어떤 도움을 받고 다시 시도했나요?', '다시 시도한 뒤 모습은 어땠나요?'] },
  thought: { title:'생각 표현', questions:['아이가 직접 말한 생각은 무엇이었나요?', '그 생각이 그림에서 어떻게 표현되었나요?', '특별히 인상 깊었던 말은 무엇인가요?'] },
  confidence: { title:'자신감', questions:['아이가 스스로 해보려 한 장면은 무엇이었나요?', '완성 후 표정이나 말은 어땠나요?', '이전보다 자신감이 보인 부분은 무엇인가요?'] },
  help: { title:'도움 요청', questions:['아이가 어떤 순간에 도움을 요청했나요?', '도움을 받은 뒤 다시 시도했나요?', '그 과정에서 성장으로 보인 부분은 무엇인가요?'] },
  material: { title:'재료 탐색', questions:['아이가 어떤 재료에 관심을 보였나요?', '재료를 어떻게 사용해 보았나요?', '새로운 표현으로 이어진 부분이 있었나요?'] },
  joy: { title:'즐겁게 참여', questions:['아이가 즐거워한 장면은 언제였나요?', '웃거나 말로 표현한 반응이 있었나요?', '활동에 몰입한 모습은 어땠나요?'] },
  friend: { title:'친구와 협력', questions:['친구와 어떤 상호작용이 있었나요?', '양보하거나 도와준 장면이 있었나요?', '협력 후 아이의 반응은 어땠나요?'] },
  focus: { title:'집중', questions:['아이가 집중한 장면은 무엇이었나요?', '얼마나 오래 이어가려 했나요?', '집중이 표현으로 이어진 부분은 무엇인가요?'] }
};
function getKinderChatFeedbackScreen() {
  return document.getElementById('kinderChatFeedbackScreen');
}
function getKinderChatFeedbackInput() {
  return document.getElementById('kcfInput');
}
const kcfViewportDebugEnabled = (() => {
  try { return new URLSearchParams(window.location.search).get('kcfDebug') === '1'; }
  catch (_) { return false; }
})();
let kcfViewportDebugBaseline = null;
let kcfViewportDebugOverlay = null;
let kcfViewportDebugBound = false;
function readKinderChatFeedbackViewportDebugSample(label) {
  const vv = window.visualViewport;
  const screen = getKinderChatFeedbackScreen();
  const inner = screen?.querySelector('.kcfInner');
  const chat = document.getElementById('kcfChatArea');
  const composer = document.getElementById('kcfComposerLayer');
  const rectTop = el => {
    try { return Math.round(el?.getBoundingClientRect?.().top || 0); }
    catch (_) { return 0; }
  };
  return {
    label:String(label || ''),
    t:Math.round(performance.now()),
    scrollY:Math.round(Number(window.scrollY || window.pageYOffset || 0)),
    vvTop:Math.round(Number(vv?.offsetTop || 0)),
    vvHeight:Math.round(Number(vv?.height || window.innerHeight || 0)),
    innerHeight:Math.round(Number(window.innerHeight || 0)),
    chatScroll:Math.round(Number(chat?.scrollTop || 0)),
    screenTop:rectTop(screen),
    innerTop:rectTop(inner),
    chatTop:rectTop(chat),
    composerTop:rectTop(composer)
  };
}
function classifyKinderChatFeedbackViewportDebug(sample) {
  if (!kcfViewportDebugBaseline || !sample) return 'baseline';
  const b = kcfViewportDebugBaseline;
  const vvMoved = Math.abs(sample.vvTop - b.vvTop) > 2;
  const windowMoved = Math.abs(sample.scrollY - b.scrollY) > 2;
  const chatMoved = Math.abs(sample.chatScroll - b.chatScroll) > 2;
  if ((vvMoved || windowMoved) && chatMoved) return 'viewport + chat';
  if (vvMoved || windowMoved) return 'viewport 이동';
  if (chatMoved) return 'chat scroll 이동';
  return '이동 없음';
}
function ensureKinderChatFeedbackViewportDebugOverlay() {
  if (!kcfViewportDebugEnabled) return null;
  if (kcfViewportDebugOverlay?.isConnected) return kcfViewportDebugOverlay;
  const el = document.createElement('pre');
  el.id = 'kcfViewportDebugOverlay';
  el.style.cssText = [
    'position:fixed','left:6px','right:6px','bottom:110px','z-index:999999',
    'margin:0','padding:8px 10px','border-radius:10px','background:rgba(0,0,0,.78)',
    'color:#fff','font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
    'white-space:pre-wrap','pointer-events:none','max-height:34vh','overflow:hidden'
  ].join(';');
  document.body.appendChild(el);
  kcfViewportDebugOverlay = el;
  return el;
}
function captureKinderChatFeedbackViewportDebug(label, setBaseline = false) {
  if (!kcfViewportDebugEnabled) return;
  const sample = readKinderChatFeedbackViewportDebugSample(label);
  if (setBaseline || !kcfViewportDebugBaseline) kcfViewportDebugBaseline = sample;
  const b = kcfViewportDebugBaseline;
  const result = classifyKinderChatFeedbackViewportDebug(sample);
  const overlay = ensureKinderChatFeedbackViewportDebugOverlay();
  if (!overlay) return;
  overlay.textContent = [
    'KCF VIEWPORT DEBUG · ' + result,
    sample.label + '  +' + Math.max(0, sample.t - b.t) + 'ms',
    'window.scrollY  ' + b.scrollY + ' → ' + sample.scrollY,
    'vv.offsetTop    ' + b.vvTop + ' → ' + sample.vvTop,
    'vv.height       ' + b.vvHeight + ' → ' + sample.vvHeight,
    'innerHeight     ' + b.innerHeight + ' → ' + sample.innerHeight,
    'chat.scrollTop  ' + b.chatScroll + ' → ' + sample.chatScroll,
    'tops screen/inner/chat/composer',
    [b.screenTop,b.innerTop,b.chatTop,b.composerTop].join('/') + ' → ' +
      [sample.screenTop,sample.innerTop,sample.chatTop,sample.composerTop].join('/')
  ].join('\n');
}
function bindKinderChatFeedbackViewportDiagnostics() {
  if (!kcfViewportDebugEnabled || kcfViewportDebugBound) return;
  kcfViewportDebugBound = true;
  const input = getKinderChatFeedbackInput();
  const chat = document.getElementById('kcfChatArea');
  if (input) {
    input.addEventListener('focus', () => {
      captureKinderChatFeedbackViewportDebug('focus');
      [50,150,300,600].forEach(delay => setTimeout(() => {
        captureKinderChatFeedbackViewportDebug('focus+' + delay);
      }, delay));
    }, true);
    input.addEventListener('blur', () => captureKinderChatFeedbackViewportDebug('blur'), true);
  }
  if (chat) chat.addEventListener('scroll', () => captureKinderChatFeedbackViewportDebug('chat-scroll'), { passive:true });
  window.addEventListener('resize', () => captureKinderChatFeedbackViewportDebug('window-resize'), { passive:true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => captureKinderChatFeedbackViewportDebug('vv-resize'), { passive:true });
    window.visualViewport.addEventListener('scroll', () => captureKinderChatFeedbackViewportDebug('vv-scroll'), { passive:true });
  }
}
function getKinderChatFeedbackMessageList() {
  const area = document.getElementById('kcfChatArea');
  if (!area) return null;
  let list = document.getElementById('kcfMessageList');
  if (!list) {
    list = document.createElement('div');
    list.id = 'kcfMessageList';
    list.className = 'kcfMessageList';
    area.appendChild(list);
  }
  return list;
}
function isKinderChatFeedbackVisible() {
  const screen = getKinderChatFeedbackScreen();
  if (!screen) return false;
  return getComputedStyle(screen).display !== 'none';
}
function readKinderChatFeedbackComposerViewportGeometry() {
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
function applyKinderChatFeedbackComposerViewportGeometry(layer, geometry) {
  if (!layer || !geometry) return;
  layer.style.setProperty('--kcf-composer-vv-left', Math.round(Number(geometry.left) || 0) + 'px');
  layer.style.setProperty('--kcf-composer-vv-top', Math.round(Number(geometry.top) || 0) + 'px');
  layer.style.setProperty('--kcf-composer-vv-width', Math.max(1, Math.round(Number(geometry.width) || 1)) + 'px');
  layer.style.setProperty('--kcf-composer-vv-height', Math.max(1, Math.round(Number(geometry.height) || 1)) + 'px');
}
function releaseKinderChatFeedbackComposerViewportLock() {
  if (kcfComposerViewportLockTimer) clearTimeout(kcfComposerViewportLockTimer);
  kcfComposerViewportLockTimer = null;
  kcfComposerViewportLock = null;
  getKinderChatFeedbackScreen()?.classList.remove('kcfComposerViewportLocked');
}
function lockKinderChatFeedbackComposerViewport() {
  const screen = getKinderChatFeedbackScreen();
  const input = getKinderChatFeedbackInput();
  if (!screen || !input || document.activeElement !== input) return false;
  if (getKinderChatFeedbackKeyboardOffset() <= 24) return false;
  kcfComposerViewportLock = readKinderChatFeedbackComposerViewportGeometry();
  const layer = document.getElementById('kcfComposerLayer');
  applyKinderChatFeedbackComposerViewportGeometry(layer, kcfComposerViewportLock);
  screen.classList.add('kcfComposerViewportLocked');
  kcfKeyboardTransitionActive = false;
  return true;
}
function scheduleKinderChatFeedbackComposerViewportLock() {
  if (kcfComposerViewportLockTimer) clearTimeout(kcfComposerViewportLockTimer);
  kcfComposerViewportLockTimer = setTimeout(() => {
    kcfComposerViewportLockTimer = null;
    lockKinderChatFeedbackComposerViewport();
  }, 120);
}
function syncKinderChatFeedbackComposerViewport(options = {}) {
  if (kcfChatGestureActive && options.force !== true) return;
  const layer = document.getElementById('kcfComposerLayer');
  if (!layer) return;
  if (kcfComposerViewportLock && options.followKeyboard !== true) {
    applyKinderChatFeedbackComposerViewportGeometry(layer, kcfComposerViewportLock);
    return;
  }
  applyKinderChatFeedbackComposerViewportGeometry(layer, readKinderChatFeedbackComposerViewportGeometry());
}
function getKinderChatFeedbackViewportBottom() {
  const viewport = window.visualViewport;
  if (!viewport) return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  return Number(viewport.offsetTop || 0) + Number(viewport.height || 0);
}
function captureKinderChatFeedbackKeyboardBaseline(force = false) {
  const currentBottom = getKinderChatFeedbackViewportBottom();
  if (!currentBottom) return;
  const layoutBottom = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  const candidate = Math.max(currentBottom, layoutBottom);
  if (force || !kcfKeyboardBaselineBottom) kcfKeyboardBaselineBottom = candidate;
}
function getKinderChatFeedbackKeyboardOffset() {
  const currentBottom = getKinderChatFeedbackViewportBottom();
  if (!kcfKeyboardBaselineBottom) captureKinderChatFeedbackKeyboardBaseline(true);
  return Math.max(0, Math.round(kcfKeyboardBaselineBottom - currentBottom));
}
function captureKinderChatFeedbackContentBaseline(force = false) {
  const screen = getKinderChatFeedbackScreen();
  const inner = screen?.querySelector('.kcfInner');
  if (!screen || !inner) return;
  const rect = inner.getBoundingClientRect();
  const candidate = Math.max(
    1,
    Math.round(Number(rect.height || 0)),
    Math.round(Number(window.innerHeight || 0)),
    Math.round(Number(window.visualViewport?.height || 0))
  );
  if (force || !kcfContentBaselineHeight) kcfContentBaselineHeight = candidate;
}
function syncKinderChatFeedbackContentViewportCompensation(options = {}) {
  const screen = getKinderChatFeedbackScreen();
  if (!screen) return;
  const input = getKinderChatFeedbackInput();
  const keyboardTracking = (!!input && document.activeElement === input)
    || screen.classList.contains('kcfKeyboardOpen')
    || kcfKeyboardTransitionActive;

  if (options.reset === true || !keyboardTracking) {
    screen.style.setProperty('--kcf-content-vv-offset-top', '0px');
    screen.style.setProperty('--kcf-content-layout-height', '100%');
    if (options.reset === true) kcfContentBaselineHeight = 0;
    return;
  }

  if (!kcfContentBaselineHeight) captureKinderChatFeedbackContentBaseline(true);
  const visualOffsetTop = Math.max(0, Math.round(Number(window.visualViewport?.offsetTop || 0)));
  screen.style.setProperty('--kcf-content-vv-offset-top', visualOffsetTop + 'px');
  screen.style.setProperty('--kcf-content-layout-height', Math.max(1, kcfContentBaselineHeight) + 'px');
}
function finishKinderChatFeedbackViewportTransition() {
  const screen = getKinderChatFeedbackScreen();
  if (!screen) return;
  screen.classList.remove('kcfViewportMoving');
  kcfViewportSettleTimer = null;
}
function scheduleKinderChatFeedbackViewportSettle() {
  if (kcfViewportSettleTimer) clearTimeout(kcfViewportSettleTimer);
  kcfViewportSettleTimer = setTimeout(finishKinderChatFeedbackViewportTransition, 130);
}
function syncKinderChatFeedbackViewport(options = {}) {
  const screen = getKinderChatFeedbackScreen();
  if (!screen) return;
  const vv = window.visualViewport;
  const top = vv ? Number(vv.offsetTop || 0) : 0;
  const left = vv ? Number(vv.offsetLeft || 0) : 0;
  const width = vv ? Number(vv.width || window.innerWidth) : window.innerWidth;
  const height = vv ? Number(vv.height || window.innerHeight) : window.innerHeight;
  const input = getKinderChatFeedbackInput();
  const inputFocused = !!input && document.activeElement === input;

  if (inputFocused && !kcfKeyboardBaselineBottom) captureKinderChatFeedbackKeyboardBaseline(true);

  const keyboardTracking = inputFocused
    || screen.classList.contains('kcfKeyboardOpen')
    || kcfKeyboardTransitionActive;
  const keyboardOffset = keyboardTracking ? getKinderChatFeedbackKeyboardOffset() : 0;
  const keyboardOpen = keyboardTracking && keyboardOffset > 24;
  const signature = [Math.round(top), Math.round(left), Math.round(width), Math.round(height)].join(':');
  const viewportChanged = signature !== kcfLastViewportSignature;

  syncKinderChatFeedbackContentViewportCompensation();

  if (kcfChatGestureActive) {
    kcfLastViewportSignature = signature;
    return;
  }

  const keyboardInteraction = inputFocused
    || screen.classList.contains('kcfKeyboardOpen')
    || screen.classList.contains('kcfViewportMoving');

  if (keyboardInteraction && viewportChanged) {
    screen.classList.add('kcfViewportMoving');
    scheduleKinderChatFeedbackViewportSettle();
  }
  kcfLastViewportSignature = signature;

  if (keyboardOpen) {
    if (!inputFocused) {
      syncKinderChatFeedbackComposerViewport({ followKeyboard:true });
    } else if (kcfKeyboardTransitionActive || !kcfComposerViewportLock) {
      syncKinderChatFeedbackComposerViewport({ followKeyboard:true });
      scheduleKinderChatFeedbackComposerViewportLock();
    } else {
      syncKinderChatFeedbackComposerViewport();
    }
  } else {
    syncKinderChatFeedbackComposerViewport({ followKeyboard:true });
  }

  screen.classList.toggle('kcfKeyboardOpen', keyboardOpen);
  if (!keyboardOpen && !inputFocused) {
    releaseKinderChatFeedbackComposerViewportLock();
    kcfKeyboardTransitionActive = false;
    kcfKeyboardBaselineBottom = 0;
  }
  if (input) autoResizeKinderChatFeedbackInput(input);
}
function bindKinderChatFeedbackViewport() {
  if (kcfViewportBound) return;
  kcfViewportBound = true;
  window.addEventListener('resize', () => syncKinderChatFeedbackViewport({ source:'window-resize' }), { passive:true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => syncKinderChatFeedbackViewport({ source:'visual-resize' }), { passive:true });
    window.visualViewport.addEventListener('scroll', () => {
      if (kcfComposerViewportLock) {
        syncKinderChatFeedbackComposerViewport();
        return;
      }
      syncKinderChatFeedbackViewport({ source:'visual-scroll' });
    }, { passive:true });
  }
}
function bindKinderChatFeedbackViewportInteractions() {
  if (window.__kcfViewportInteractionsBound) return;
  window.__kcfViewportInteractionsBound = true;

  const chatArea = document.getElementById('kcfChatArea');
  const input = getKinderChatFeedbackInput();
  const questionGuide = document.getElementById('kcfQuestionGuide');
  const keywordScroller = document.getElementById('kcfKeywordScroller');

  const beginKinderChatFeedbackChatGesture = () => {
    if (kcfChatGestureSettleTimer) {
      clearTimeout(kcfChatGestureSettleTimer);
      kcfChatGestureSettleTimer = null;
    }
    kcfChatGestureActive = true;
  };
  const endKinderChatFeedbackChatGesture = () => {
    if (!kcfChatGestureActive && !kcfChatGestureSettleTimer) return;
    if (kcfChatGestureSettleTimer) clearTimeout(kcfChatGestureSettleTimer);
    kcfChatGestureSettleTimer = setTimeout(() => {
      kcfChatGestureSettleTimer = null;
      kcfChatGestureActive = false;
      syncKinderChatFeedbackComposerViewport({ force:true });
      syncKinderChatFeedbackViewport();
    }, 120);
  };

  if (chatArea) {
    chatArea.addEventListener('pointerdown', beginKinderChatFeedbackChatGesture, { passive:true });
    chatArea.addEventListener('touchstart', beginKinderChatFeedbackChatGesture, { passive:true });
    window.addEventListener('pointerup', endKinderChatFeedbackChatGesture, { passive:true });
    window.addEventListener('pointercancel', endKinderChatFeedbackChatGesture, { passive:true });
    window.addEventListener('touchend', endKinderChatFeedbackChatGesture, { passive:true });
    window.addEventListener('touchcancel', endKinderChatFeedbackChatGesture, { passive:true });
  }

  if (questionGuide) {
    questionGuide.addEventListener('touchmove', event => {
      if (!questionGuide.classList.contains('show')) return;
      event.preventDefault();
      event.stopPropagation();
    }, { passive:false });
  }

  if (keywordScroller) {
    let keywordTouchStartX = null;
    let keywordTouchStartY = null;
    keywordScroller.addEventListener('touchstart', event => {
      const touch = event.touches?.[0];
      keywordTouchStartX = touch ? Number(touch.clientX) : null;
      keywordTouchStartY = touch ? Number(touch.clientY) : null;
    }, { passive:true });
    keywordScroller.addEventListener('touchmove', event => {
      const touch = event.touches?.[0];
      if (!touch || !Number.isFinite(keywordTouchStartX) || !Number.isFinite(keywordTouchStartY)) return;
      const deltaX = Math.abs(Number(touch.clientX) - keywordTouchStartX);
      const deltaY = Math.abs(Number(touch.clientY) - keywordTouchStartY);
      if (deltaY < 6 || deltaY <= deltaX) return;
      event.preventDefault();
      event.stopPropagation();
    }, { passive:false });
    const clearKeywordTouch = () => {
      keywordTouchStartX = null;
      keywordTouchStartY = null;
    };
    keywordScroller.addEventListener('touchend', clearKeywordTouch, { passive:true });
    keywordScroller.addEventListener('touchcancel', clearKeywordTouch, { passive:true });
  }

  if (input) {
    const composer = input.closest('.kcfComposer');
    let composerTouchStartX = null;
    let composerTouchStartY = null;

    input.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') {
        captureKinderChatFeedbackViewportDebug('pointerdown-before-focus', true);
        captureKinderChatFeedbackContentBaseline(true);
        const teacherMode = getKinderChatFeedbackTeacherMode();
        const teacherEnabled = !!(
          teacherMode
          && typeof teacherMode.isEnabled === 'function'
          && teacherMode.isEnabled()
        );
        if (!teacherEnabled) {
          kcfKeepInputFocusUntil = Date.now() + 900;
        }
        if (document.activeElement !== input) {
          captureKinderChatFeedbackKeyboardBaseline(true);
          try { input.focus({ preventScroll:true }); }
          catch (_) { input.focus(); }
        }
        return;
      }
      captureKinderChatFeedbackKeyboardBaseline(true);
    }, true);

    if (composer) {
      composer.addEventListener('touchstart', event => {
        const touch = event.touches?.[0];
        composerTouchStartX = touch ? Number(touch.clientX) : null;
        composerTouchStartY = touch ? Number(touch.clientY) : null;
      }, { passive:true });

      composer.addEventListener('touchmove', event => {
        if (!getKinderChatFeedbackScreen()?.classList.contains('kcfKeyboardOpen')) return;
        const touch = event.touches?.[0];
        if (!touch || !Number.isFinite(composerTouchStartX) || !Number.isFinite(composerTouchStartY)) return;
        const deltaX = Math.abs(Number(touch.clientX) - composerTouchStartX);
        const deltaY = Math.abs(Number(touch.clientY) - composerTouchStartY);
        if (deltaY < 6 || deltaY <= deltaX) return;
        event.preventDefault();
        event.stopPropagation();
      }, { passive:false });

      const clearComposerTouch = () => {
        composerTouchStartX = null;
        composerTouchStartY = null;
      };
      composer.addEventListener('touchend', clearComposerTouch, { passive:true });
      composer.addEventListener('touchcancel', clearComposerTouch, { passive:true });
    }

    input.addEventListener('focus', () => {
      const screen = getKinderChatFeedbackScreen();
      releaseKinderChatFeedbackComposerViewportLock();
      kcfKeyboardTransitionActive = true;
      captureKinderChatFeedbackKeyboardBaseline(true);
      if (!kcfContentBaselineHeight) captureKinderChatFeedbackContentBaseline(true);
      if (screen) screen.classList.add('kcfViewportMoving');
      scheduleKinderChatFeedbackViewportSettle();
      setTimeout(() => syncKinderChatFeedbackViewport({ source:'focus' }), 40);
      setTimeout(() => syncKinderChatFeedbackViewport({ source:'focus' }), 160);
      setTimeout(() => syncKinderChatFeedbackViewport({ source:'focus' }), 300);
    }, true);

    input.addEventListener('blur', () => {
      if (Date.now() < kcfKeepInputFocusUntil) {
        setTimeout(() => {
          const currentInput = getKinderChatFeedbackInput();
          if (currentInput) {
            try { currentInput.focus({ preventScroll:true }); }
            catch (_) { currentInput.focus(); }
          }
        }, 0);
        return;
      }
      const screen = getKinderChatFeedbackScreen();
      releaseKinderChatFeedbackComposerViewportLock();
      kcfKeyboardTransitionActive = true;
      if (screen) screen.classList.add('kcfViewportMoving');
      scheduleKinderChatFeedbackViewportSettle();
      setTimeout(() => syncKinderChatFeedbackViewport({ source:'blur' }), 40);
      setTimeout(() => syncKinderChatFeedbackViewport({ source:'blur' }), 140);
      setTimeout(() => {
        syncKinderChatFeedbackViewport({ source:'blur' });
        if (document.activeElement !== input && !screen?.classList.contains('kcfKeyboardOpen')) {
          kcfKeyboardBaselineBottom = 0;
          kcfKeyboardTransitionActive = false;
        }
      }, 320);
    });
  }

  bindKinderChatFeedbackViewport();
  bindKinderChatFeedbackViewportDiagnostics();
  syncKinderChatFeedbackViewport();
}
function setKinderChatFeedbackPersistentTopVisible(visible) {
  const layer = document.getElementById('kcfPersistentTopLayer');
  if (!layer) return;
  const active = !!visible;
  layer.classList.toggle('show', active);
  layer.setAttribute('aria-hidden', active ? 'false' : 'true');
}
function toggleKinderChatFeedbackModeMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('kcfModeMenu');
  if (menu) menu.classList.toggle('show');
}
function closeKinderChatFeedbackModeMenu() {
  const menu = document.getElementById('kcfModeMenu');
  if (menu) menu.classList.remove('show');
}
function switchKinderChatFeedbackMode(mode, event) {
  if (event) event.stopPropagation();
  closeKinderChatFeedbackModeMenu();
  if (mode === 'growth') {
    saveKinderChatFeedbackDraft();
    openKinderChatFeedbackGrowthSheet();
    return;
  }
  if (mode === 'elementaryMemo') {
    saveKinderChatFeedbackDraft();
    const division = getKinderChatFeedbackEntryDivision();
    const page = document.getElementById('kinderChatFeedbackScreen');
    if (page) page.style.display = 'none';
    setKinderChatFeedbackPersistentTopVisible(false);
    const openFn = window.openObservationNoteFromRecord || (typeof openObservationNoteFromRecord === 'function' ? openObservationNoteFromRecord : null);
    if (openFn) {
      openFn({ division });
      return;
    }
    const students = (typeof getStudentsByType === 'function') ? getStudentsByType(division) : [];
    const targetStudent = students && students.length ? students[0] : null;
    if (targetStudent && typeof openStudentMemoPageById === 'function') {
      openStudentMemoPageById(targetStudent.id);
      return;
    }
    alert(`${division === 'kinder' ? '유치부' : '초등부'} 관찰노트를 열 수 없습니다.`);
  }
}
function getKinderChatFeedbackEntryDivision(options = {}) {
  const explicit = String(options?.division || '').trim();
  if (explicit === 'kinder' || explicit === 'elementary') return explicit;
  try {
    const saved = String(window.getOlliLastRecordDivisionView?.() || '');
    if (saved === 'kinder' || saved === 'elementary') return saved;
  } catch (_) {}
  applyKinderChatFeedbackStudentManageSortPrefs(false);
  return kcfStudentManageDivision === 'kinder' ? 'kinder' : 'elementary';
}
function applyKinderChatFeedbackEntryDivision(options = {}) {
  const nextDivision = getKinderChatFeedbackEntryDivision(options);
  applyKinderChatFeedbackStudentManageSortPrefs(false);
  kcfStudentManageDivision = nextDivision;
  kcfStudentManageSortDay = '';
  const selected = getKinderChatFeedbackManualSelection();
  if (selected && selected.studentDivision !== nextDivision) clearKinderChatFeedbackManualSelection();
  saveKinderChatFeedbackStudentManageSortPrefs();
  return nextDivision;
}
function openKinderChatFeedbackPage(options = {}) {
  const navigationManaged = options?.navigationManaged === true;
  applyKinderChatFeedbackEntryDivision(options);
  if (typeof window.setObservationPersistentNavVisible === 'function') {
    window.setObservationPersistentNavVisible(false);
  }
  if (!navigationManaged) {
    const screens = document.querySelectorAll('.pageScreen');
    screens.forEach(screen => { if (screen.id !== 'kinderChatFeedbackScreen') screen.style.display = 'none'; });
  }
  const page = document.getElementById('kinderChatFeedbackScreen');
  if (page) page.style.display = 'flex';
  restoreKinderChatFeedbackLiveSession();
  setKinderChatFeedbackPersistentTopVisible(true);
  bindKinderChatFeedbackViewportInteractions();
  loadKinderChatFeedbackDraft();
  applyKinderChatFeedbackGuideVisibility();
  syncKinderChatFeedbackManualSelectionUi();
  updateKinderChatFeedbackBadge();
  scheduleKinderChatFeedbackVivicotBubbleMidnightReset();
  syncKinderChatFeedbackViewport();

  const teacherMode = getKinderChatFeedbackTeacherMode();
  if (teacherMode && typeof teacherMode.onPageOpened === 'function') {
    setTimeout(() => teacherMode.onPageOpened(), 0);
  }
  setTimeout(() => {
    const input = document.getElementById('kcfInput');
    if (input) autoResizeKinderChatFeedbackInput(input);
  }, 0);
}
async function closeKinderChatFeedbackPage() {
  saveKinderChatFeedbackDraft();
  persistKinderChatFeedbackLiveSessionNow();
  if (window.KcfTeacherSheet && typeof window.KcfTeacherSheet.close === 'function') {
    window.KcfTeacherSheet.close({ sync:true });
  }
  releaseKinderChatFeedbackComposerViewportLock();
  syncKinderChatFeedbackContentViewportCompensation({ reset:true });
  kcfKeyboardBaselineBottom = 0;
  kcfKeyboardTransitionActive = false;
  kcfLastViewportSignature = '';
  kcfChatGestureActive = false;
  const page = document.getElementById('kinderChatFeedbackScreen');
  if (page) page.classList.remove('kcfKeyboardOpen','kcfViewportMoving','kcfComposerViewportLocked');
  if (page) page.style.display = 'none';
  setKinderChatFeedbackPersistentTopVisible(false);
  if (typeof window.openOlliAttendancePage === 'function') {
    await window.openOlliAttendancePage();
    return;
  }
  const openAttendance = window.openRecordAttendanceDashboard
    || (typeof openRecordAttendanceDashboard === 'function' ? openRecordAttendanceDashboard : null);
  if (typeof openAttendance === 'function') {
    try { await openAttendance(); } catch (_) {}
  }
  if (typeof showRecordRoom === 'function') await showRecordRoom();
}
function isKinderChatFeedbackQueueItem(item) {
  return !!item && (
    item.sourcePage === 'kinderChatFeedback' ||
    item.label === '유치부 1분 피드백' ||
    item.label === '유치부 성장 피드백' ||
    item.label === '유치부 실패-성장 피드백'
  );
}

function getKinderChatFeedbackItemDateKey(item) {
  const explicit = String(item?.dateKey || '').trim();
  if (explicit) return explicit;
  const raw = item?.createdAt || item?.updatedAt || '';
  if (!raw) return '';
  try { return getTodayFeedbackDateKey(raw); } catch(e) { return ''; }
}
function pruneExpiredKinderChatFeedbackItems() {
  const today = getTodayFeedbackDateKey();
  const list = getTodayFeedbackItemsRaw();
  let changed = false;
  const next = list.filter(item => {
    if (!isKinderChatFeedbackQueueItem(item)) return true;
    const itemDateKey = getKinderChatFeedbackItemDateKey(item);
    const keep = !itemDateKey || itemDateKey === today;
    if (!keep) changed = true;
    return keep;
  });
  if (changed) {
    try { setTodayFeedbackItemsRaw(next); } catch(e) {}
    try { renderTodayFeedbackPage(); } catch(e) {}
  }
  return changed;
}

function getKinderChatFeedbackItems() {
  try {
    pruneExpiredKinderChatFeedbackItems();
    return getTodayFeedbackItemsRaw()
      .filter(item => isKinderChatFeedbackQueueItem(item))
      .sort((a, b) => {
        const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
        const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
        return bt - at;
      });
  } catch(e) {
    return [];
  }
}
function getKinderChatFeedbackTodayItems() {
  const today = getTodayFeedbackDateKey();
  return getKinderChatFeedbackItems().filter(item => item && getKinderChatFeedbackItemDateKey(item) === today);
}
function getKinderChatFeedbackCounts() {
  const items = getKinderChatFeedbackTodayItems();
  return {
    generating: items.filter(item => item.status === 'generating').length,
    ready: items.filter(item => (item.status === 'done' || item.status === 'review') && !item.reviewed && !item.saved).length,
    error: items.filter(item => item.status === 'error').length,
    saved: items.filter(item => item.saved || item.reviewed).length
  };
}
function getKinderChatFeedbackVivicotBubbleStorageKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${KCF_VIVICOT_INBOX_BUBBLE_KEY_PREFIX}_${academyId}`;
}
function isKinderChatFeedbackVivicotBubbleActive() {
  const today = getTodayFeedbackDateKey();
  const completedToday = getKinderChatFeedbackTodayItems().some(item => item && (
    item.status === 'done' || item.status === 'review' || item.saved || item.reviewed
  ));
  try {
    const key = getKinderChatFeedbackVivicotBubbleStorageKey();
    let activeDate = String(localStorage.getItem(key) || '').trim();
    if (completedToday && activeDate !== today) {
      localStorage.setItem(key, today);
      activeDate = today;
    } else if (activeDate && activeDate !== today) {
      localStorage.removeItem(key);
      activeDate = '';
    }
    return activeDate === today;
  } catch(e) {
    return completedToday;
  }
}
function syncKinderChatFeedbackBadgeElement(badge, readyCount, visible) {
  if (!badge) return;
  if (visible && readyCount > 0) {
    badge.textContent = readyCount > 99 ? '99+' : String(readyCount);
    badge.classList.add('show');
  } else {
    badge.textContent = '';
    badge.classList.remove('show');
  }
}
function updateKinderChatFeedbackBadge() {
  const bubble = document.getElementById('kcfVivicotInboxBubble');
  const bubbleBadge = document.getElementById('kcfVivicotInboxBadge');
  const counts = getKinderChatFeedbackCounts();
  const bubbleActive = isKinderChatFeedbackVivicotBubbleActive();

  if (bubble) {
    const bubbleText = bubble.querySelector('.kcfVivicotInboxBubbleText');
    if (bubbleText) bubbleText.textContent = '임시 보관함';
    bubble.setAttribute('aria-label', '임시 보관함 열기');
    const showBubble = bubbleActive && getKinderChatFeedbackTopMode() === 'inbox';
    bubble.classList.toggle('show', showBubble);
    bubble.tabIndex = showBubble ? 0 : -1;
  }
  syncKinderChatFeedbackBadgeElement(bubbleBadge, counts.ready, bubbleActive);
}

function scheduleKinderChatFeedbackVivicotBubbleMidnightReset() {
  if (kcfVivicotInboxMidnightTimer) clearTimeout(kcfVivicotInboxMidnightTimer);
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());
  kcfVivicotInboxMidnightTimer = window.setTimeout(() => {
    kcfVivicotInboxMidnightTimer = null;
    updateKinderChatFeedbackBadge();
    scheduleKinderChatFeedbackVivicotBubbleMidnightReset();
  }, delay);
}

function autoResizeKinderChatFeedbackInput(input) {
  if (!input) return;
  const minHeight = 34;
  const maxHeight = 110;
  const screen = document.getElementById('kinderChatFeedbackScreen');
  const canGrow = document.activeElement === input || !!screen?.classList.contains('kcfKeyboardOpen');

  if (!canGrow) {
    input.style.height = `${minHeight}px`;
    input.style.minHeight = `${minHeight}px`;
    input.style.maxHeight = `${minHeight}px`;
    input.style.overflowY = 'hidden';

    return;
  }

  input.style.minHeight = `${minHeight}px`;
  input.style.maxHeight = `${maxHeight}px`;
  input.style.height = 'auto';
  const nextHeight = Math.max(minHeight, Math.min(maxHeight, input.scrollHeight || minHeight));
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = (input.scrollHeight || 0) > maxHeight ? 'auto' : 'hidden';

}
window.autoResizeKinderChatFeedbackInput = autoResizeKinderChatFeedbackInput;
function focusKinderChatFeedbackInput() {
  const input = document.getElementById('kcfInput');
  if (!input) return;
  try { input.focus({ preventScroll:true }); }
  catch (_) { input.focus(); }
}
function openKinderChatFeedbackPhotoPicker(event) {
  if (event) event.stopPropagation();
  const input = document.getElementById('kcfPhotoInput');
  if (!input) return;
  input.value = '';
  input.click();
}
function loadKinderChatFeedbackImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('사진을 불러오지 못했습니다.'));
    };
    img.src = url;
  });
}
function canvasToKinderChatFeedbackBlob(canvas, type, quality) {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), type || 'image/jpeg', quality || 0.78);
  });
}
async function resizeKinderChatFeedbackPhoto(file, maxSide, quality, namePrefix) {
  const img = await loadKinderChatFeedbackImageFromFile(file);
  const originalWidth = img.naturalWidth || img.width || 0;
  const originalHeight = img.naturalHeight || img.height || 0;
  const sourceMax = Math.max(originalWidth, originalHeight) || maxSide;
  const scale = Math.min(1, maxSide / sourceMax);
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('사진 처리 환경을 사용할 수 없습니다.');
  ctx.drawImage(img, 0, 0, width, height);
  const type = 'image/jpeg';
  const blob = await canvasToKinderChatFeedbackBlob(canvas, type, quality);
  if (!blob) throw new Error('사진 압축에 실패했습니다.');
  const baseName = String(file.name || namePrefix || 'photo').replace(/\.[^.]+$/, '').replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9_-]+/g, '_').slice(0, 40) || namePrefix || 'photo';
  const resizedFile = new File([blob], `${baseName}_${namePrefix || 'photo'}.jpg`, { type, lastModified: Date.now() });
  const dataUrl = canvas.toDataURL(type, quality || 0.78);
  return { file: resizedFile, dataUrl, width, height, fileSize: resizedFile.size, mimeType: type };
}

const KCF_PHOTO_BUCKET = 'student_feedback_photos';
const KCF_PHOTO_COMMON_FEATURE = 'feedback_photo';
function writeFeedbackPhotoCommonLocal(payload, syncStatus, phase) {
  try {
    if (typeof window.writeOlliLocal !== 'function') return null;
    const academyId = String(payload?.academy_id || getCurrentOlliAcademyId() || '').trim();
    const photoId = String(payload?.id || payload?.photo_id || '').trim();
    if (!academyId || !photoId) return null;
    let previousData = null;
    if (typeof window.readOlliLocal === 'function') {
      try {
        const previous = window.readOlliLocal(KCF_PHOTO_COMMON_FEATURE, { academyId, fileId: photoId }, { fallback: null });
        if (previous && typeof previous === 'object' && !Array.isArray(previous)) previousData = previous;
      } catch (_) {}
    }
    const mergedPayload = Object.assign({}, previousData || {}, payload, {
      storage_phase: phase || payload.storage_phase || (previousData && previousData.storage_phase) || 'metadata',
      local_recorded_at: new Date().toISOString()
    });
    return window.writeOlliLocal(KCF_PHOTO_COMMON_FEATURE, {
      academyId,
      fileId: photoId
    }, mergedPayload, {
      syncStatus: syncStatus || 'pending'
    });
  } catch (err) {
    console.warn('feedback photo common local write failed:', err);
    return null;
  }
}
function enqueueFeedbackPhotoCommonSync(payload, operation, err) {
  try {
    const core = window.OlliStorageCore;
    if (!core || !core.SyncQueue || typeof core.SyncQueue.enqueue !== 'function') return null;
    const academyId = String(payload?.academy_id || getCurrentOlliAcademyId() || '').trim();
    const photoId = String(payload?.id || payload?.photo_id || '').trim();
    if (!academyId || !photoId) return null;
    return core.SyncQueue.enqueue({
      feature: KCF_PHOTO_COMMON_FEATURE,
      operation: operation || 'upload',
      academy_id: academyId,
      student_id: payload?.student_id || null,
      file_id: photoId,
      payload: Object.assign({}, payload, {
        imageFile: undefined,
        thumbnailFile: undefined,
        localPreviewUrl: undefined
      }),
      status: operation === 'upload' ? 'blocked' : 'pending',
      error_code: err && err.code ? err.code : (operation === 'upload' ? 'FILE_UPLOAD_FAILED' : 'SERVER_WRITE_FAILED'),
      error_message: String(err && (err.message || err) || '')
    }, { coalesce: operation !== 'upload' });
  } catch (queueErr) {
    console.warn('feedback photo sync queue failed:', queueErr);
    return null;
  }
}
async function uploadOlliStorageFile(bucket, objectPath, file) {
  const storage = window.OlliFeedbackPhotoStorage;
  if (!storage || typeof storage.uploadSignedFile !== 'function') {
    const error = new Error('수업사진 보안 업로드 모듈이 준비되지 않았습니다.');
    error.code = 'PHOTO_SECURE_STORAGE_NOT_READY';
    throw error;
  }
  const academyId = requireOlliAcademyId('수업사진 업로드');
  return storage.uploadSignedFile({ academyId, bucket, objectPath, file });
}

async function saveFeedbackPhotoMetadataViaCommonStorage(payload, label = '수업사진 메타데이터 저장') {
  if (typeof saveOlliData !== 'function') {
    const error = new Error('수업사진 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: KCF_PHOTO_COMMON_FEATURE, resource: 'feedback_photos', operation: 'save', message: error.message, student_id: payload?.student_id || '' });
    throw error;
  }
  const academyId = String(payload?.academy_id || '').trim();
  const photoId = String(payload?.id || payload?.photo_id || '').trim();
  if (!academyId || !photoId) {
    const error = new Error(`${label} 식별값이 없습니다.`);
    recordOlliStorageIssue({ feature: KCF_PHOTO_COMMON_FEATURE, resource: 'feedback_photos', operation: 'save', message: error.message, student_id: payload?.student_id || '' });
    throw error;
  }
  const result = await saveOlliData(KCF_PHOTO_COMMON_FEATURE, {
    academyId,
    fileId: photoId,
    forceCommon: true,
    data: payload
  });
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`${label} 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({ feature: KCF_PHOTO_COMMON_FEATURE, resource: 'feedback_photos', operation: 'save', message: String(error && (error.message || error) || ''), student_id: payload?.student_id || '' });
    throw error;
  }
  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  if (!row || typeof row !== 'object') {
    const error = new Error(`${label} 서버 저장 행을 확인하지 못했습니다.`);
    recordOlliStorageIssue({ feature: KCF_PHOTO_COMMON_FEATURE, resource: 'feedback_photos', operation: 'verify', message: error.message, student_id: payload?.student_id || '' });
    throw error;
  }
  writeFeedbackPhotoCommonLocal(Object.assign({}, payload, row), 'synced', 'metadata_saved');
  return row;
}

async function linkFeedbackPhotoToStudentViaCommonStorage(linkPayload, label = '수업사진 학생 연결') {
  if (typeof saveOlliData !== 'function') {
    const error = new Error('수업사진 학생 연결 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'feedback_photo_student_link', resource: 'feedback_photos', operation: 'link', message: error.message, student_id: linkPayload?.student_id || '' });
    throw error;
  }
  const academyId = String(linkPayload?.academy_id || '').trim();
  const photoId = String(linkPayload?.id || linkPayload?.photo_id || '').trim();
  const studentId = String(linkPayload?.student_id || '').trim();
  if (!academyId || !photoId || !studentId) {
    const error = new Error(`${label} 식별값이 없습니다.`);
    recordOlliStorageIssue({ feature: 'feedback_photo_student_link', resource: 'feedback_photos', operation: 'link', message: error.message, student_id: studentId });
    throw error;
  }
  const result = await saveOlliData('feedback_photo_student_link', {
    academyId,
    fileId: photoId,
    forceCommon: true,
    data: {
      student_id: studentId,
      updated_at: linkPayload.updated_at || new Date().toISOString()
    },
    serverOptions: { operation: 'patch' }
  });
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`${label} 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({ feature: 'feedback_photo_student_link', resource: 'feedback_photos', operation: 'link', message: String(error && (error.message || error) || ''), student_id: studentId });
    throw error;
  }
  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  writeFeedbackPhotoCommonLocal(Object.assign({}, linkPayload, row || {}), 'synced', 'student_linked');
  return row;
}
async function uploadKinderChatFeedbackPhotoToSupabase(photo, feedbackJobId, studentName) {
  if (!photo?.imageFile || !photo?.thumbnailFile) return null;
  const academyId = requireOlliAcademyId('수업사진 저장');
  const photoId = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const monthKey = String(photo.monthKey || getTodayFeedbackDateKey().slice(0, 7));
  const safeMonth = monthKey.replace(/[^0-9-]/g, '') || getTodayFeedbackDateKey().slice(0, 7);
  const basePath = `${academyId}/${safeMonth}/${photoId}`;
  const pendingPayload = {
    id: photoId,
    academy_id: academyId,
    student_id: null,
    student_name: String(studentName || ''),
    feedback_job_id: feedbackJobId,
    image_path: `${basePath}/image.jpg`,
    thumbnail_path: `${basePath}/thumb.jpg`,
    image_width: Number(photo.imageWidth || 0),
    image_height: Number(photo.imageHeight || 0),
    file_size: Number(photo.fileSize || 0),
    mime_type: photo.mimeType || 'image/jpeg',
    month_key: safeMonth,
    image_order: Number(photo.imageOrder || 1),
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  writeFeedbackPhotoCommonLocal(pendingPayload, 'pending', 'uploading');
  try {
    await Promise.all([
      uploadOlliStorageFile(KCF_PHOTO_BUCKET, `${basePath}/image.jpg`, photo.imageFile),
      uploadOlliStorageFile(KCF_PHOTO_BUCKET, `${basePath}/thumb.jpg`, photo.thumbnailFile)
    ]);
    const payload = Object.assign({}, pendingPayload, {
      image_url: null,
      thumbnail_url: null,
      updated_at: new Date().toISOString()
    });
    const row = await saveFeedbackPhotoMetadataViaCommonStorage(payload, '수업사진 메타데이터 저장');
    writeFeedbackPhotoCommonLocal(Object.assign({}, payload, row || {}), 'synced', 'metadata_saved');

    let signedUrls = null;
    try {
      signedUrls = await window.OlliFeedbackPhotoStorage.getSignedPhotoUrls({
        academyId,
        photoId,
        force: true
      });
    } catch (signError) {
      recordOlliStorageIssue({
        feature: KCF_PHOTO_COMMON_FEATURE,
        resource: 'feedback_photos',
        operation: 'sign_read',
        message: signError?.message || signError,
        student_id: payload?.student_id || ''
      });
    }

    return {
      photo_id: photoId,
      originalName: photo.originalName || '작품사진',
      previewUrl: signedUrls?.imageUrl || photo.previewUrl || '',
      thumbnailUrl: signedUrls?.thumbnailUrl || photo.thumbnailUrl || '',
      imagePath: payload.image_path,
      thumbnailPath: payload.thumbnail_path,
      signedUrlExpiresAt: signedUrls?.expiresAt || '',
      imageWidth: payload.image_width,
      imageHeight: payload.image_height,
      fileSize: payload.file_size,
      mimeType: payload.mime_type,
      imageOrder: payload.image_order,
      feedbackType: photo.feedbackType || 'class',
      lessonTitle: photo.lessonTitle || '',
      monthKey: safeMonth,
      uploadStatus: 'uploaded',
      isDeleted: false
    };
  } catch (err) {
    writeFeedbackPhotoCommonLocal(pendingPayload, 'pending', 'upload_failed');
    enqueueFeedbackPhotoCommonSync(pendingPayload, 'upload', err);
    recordOlliStorageIssue({ feature: '수업사진', resource: `${KCF_PHOTO_BUCKET}/feedback_photos`, operation: 'upload', message: err.message || err });
    throw new Error(`수업사진을 Supabase에 저장하지 못했습니다. ${err.message || ''}`.trim());
  }
}
async function linkFeedbackPhotosToStudent(item, studentId) {
  const academyId = requireOlliAcademyId('수업사진 학생 연결');
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  for (const attachment of attachments) {
    const photoId = String(attachment?.photo_id || '').trim();
    if (!photoId) continue;
    const linkPayload = {
      id: photoId,
      academy_id: academyId,
      student_id: studentId,
      updated_at: new Date().toISOString()
    };
    writeFeedbackPhotoCommonLocal(linkPayload, 'pending', 'linking_student');
    try {
      const row = await linkFeedbackPhotoToStudentViaCommonStorage(linkPayload, '수업사진 학생 연결');
      writeFeedbackPhotoCommonLocal(Object.assign({}, linkPayload, row || {}), 'synced', 'student_linked');
    } catch (err) {
      enqueueFeedbackPhotoCommonSync(linkPayload, 'update', err);
      writeFeedbackPhotoCommonLocal(linkPayload, 'pending', 'student_link_failed');
      throw err;
    }
  }
}
async function handleKinderChatFeedbackPhotoChange(event) {
  const input = event && event.target ? event.target : document.getElementById('kcfPhotoInput');
  const file = input && input.files && input.files[0] ? input.files[0] : null;
  if (!file) return;
  if (file.type && !String(file.type).startsWith('image/')) {
    setKinderChatFeedbackWarning('사진 파일만 추가할 수 있어요.');
    if (input) input.value = '';
    return;
  }
  try {
    setKinderChatFeedbackWarning('');
    const image = await resizeKinderChatFeedbackPhoto(file, 1200, 0.78, 'feedback');
    const thumb = await resizeKinderChatFeedbackPhoto(file, 320, 0.72, 'thumb');
    kcfPendingPhoto = {
      originalName: file.name || '작품사진',
      imageFile: image.file,
      thumbnailFile: thumb.file,
      previewUrl: image.dataUrl,
      thumbnailUrl: thumb.dataUrl,
      imageWidth: image.width,
      imageHeight: image.height,
      fileSize: image.fileSize,
      mimeType: image.mimeType,
      imageOrder: 1,
      feedbackType: 'class',
      lessonTitle: '',
      monthKey: getTodayFeedbackDateKey().slice(0, 7),
      uploadStatus: 'pending',
      isDeleted: false
    };
    renderKinderChatFeedbackPhotoPreview();
    const textInput = document.getElementById('kcfInput');
    if (textInput) {
      try { textInput.focus({ preventScroll:true }); }
      catch (_) { textInput.focus(); }
    }
  } catch(err) {
    console.error('1분 피드백 사진 처리 오류:', err);
    setKinderChatFeedbackWarning(err.message || '사진을 추가하지 못했습니다.');
    clearKinderChatFeedbackPhoto();
  }
}
function clearKinderChatFeedbackPhoto() {
  kcfPendingPhoto = null;
  const input = document.getElementById('kcfPhotoInput');
  if (input) input.value = '';
  renderKinderChatFeedbackPhotoPreview();
}
function renderKinderChatFeedbackPhotoPreview() {
  const box = document.getElementById('kcfPhotoPreview');
  if (!box) return;
  if (!kcfPendingPhoto || !kcfPendingPhoto.thumbnailUrl) {
    box.classList.remove('show');
    box.innerHTML = '';
    return;
  }
  const name = kcfPendingPhoto.originalName || '작품사진';
  box.innerHTML = `<div class="kcfPhotoThumbWrap"><img src="${escapeHtml(kcfPendingPhoto.thumbnailUrl)}" alt="첨부 사진 미리보기"><button type="button" class="kcfPhotoRemoveBtn" onclick="clearKinderChatFeedbackPhoto()" aria-label="첨부 사진 삭제">×</button></div><div class="kcfPhotoMetaText">${escapeHtml(name)}</div>`;
  box.classList.add('show');
}
function getKinderChatFeedbackPhotoSnapshot() {
  if (!kcfPendingPhoto) return null;
  return {
    originalName: kcfPendingPhoto.originalName || '작품사진',
    thumbnailUrl: kcfPendingPhoto.thumbnailUrl || '',
    previewUrl: kcfPendingPhoto.previewUrl || '',
    imageWidth: kcfPendingPhoto.imageWidth || 0,
    imageHeight: kcfPendingPhoto.imageHeight || 0,
    fileSize: kcfPendingPhoto.fileSize || 0,
    mimeType: kcfPendingPhoto.mimeType || 'image/jpeg',
    imageOrder: kcfPendingPhoto.imageOrder || 1,
    feedbackType: kcfPendingPhoto.feedbackType || 'class',
    lessonTitle: kcfPendingPhoto.lessonTitle || '',
    monthKey: kcfPendingPhoto.monthKey || getTodayFeedbackDateKey().slice(0, 7),
    uploadStatus: kcfPendingPhoto.uploadStatus || 'pending',
    isDeleted: false
  };
}
function saveKinderChatFeedbackDraft() {
  const input = document.getElementById('kcfInput');
  if (!input) return;
  try {
    const value = String(input.value || '');
    if (value.trim()) localStorage.setItem(getKinderChatFeedbackDraftKey(), value);
    else localStorage.removeItem(getKinderChatFeedbackDraftKey());
  } catch(e) {}
}
function loadKinderChatFeedbackDraft() {
  const input = document.getElementById('kcfInput');
  if (!input) return;
  try {
    const saved = localStorage.getItem(getKinderChatFeedbackDraftKey()) || '';
    if (String(saved || '').trim()) input.value = saved;
    else {
      localStorage.removeItem(getKinderChatFeedbackDraftKey());
      if (!String(input.value || '').trim()) input.value = '';
    }
  } catch(e) {}
  autoResizeKinderChatFeedbackInput(input);
}
function clearKinderChatFeedbackDraft() {
  try { localStorage.removeItem(getKinderChatFeedbackDraftKey()); } catch(e) {}
}
function setKinderChatFeedbackWarning(message) {
  const el = document.getElementById('kcfInputWarning');
  if (!el) return;
  const text = String(message || '').trim();
  el.textContent = text;
  el.classList.toggle('show', !!text);
}
function typeKinderChatFeedbackBotMessage(bubble, messageText, area) {
  if (!bubble) return;
  const fullText = String(messageText || '');
  bubble.textContent = '';
  if (!fullText) return;
  let index = 0;
  const speed = fullText.length > 90 ? 14 : 20;
  const step = fullText.length > 90 ? 2 : 1;
  function drawNext() {
    index = Math.min(fullText.length, index + step);
    bubble.textContent = fullText.slice(0, index);
    if (area) area.scrollTop = area.scrollHeight;
    if (index < fullText.length) {
      setTimeout(drawNext, speed);
    }
  }
  drawNext();
}
function addKinderChatMessage(role, text) {
  const area = document.getElementById('kcfChatArea');
  const messageList = getKinderChatFeedbackMessageList();
  if (!area || !messageList) return;
  const intro = document.getElementById('kcfCenterIntro');
  if (intro) intro.classList.add('hidden');
  const row = document.createElement('div');
  row.className = `kcfMsgRow ${role === 'user' ? 'user' : 'bot'}`;
  const bubble = document.createElement('div');
  bubble.className = 'kcfBubble';
  const messageText = role === 'user' ? String(text || '') : String(text || '').replace(/^\s*(?:올리로그|올리)\s*\n?/, '').trim();
  if (role === 'user') {
    bubble.textContent = messageText;
  }
  row.appendChild(bubble);
  messageList.appendChild(row);
  if (role === 'user') {
    requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
  } else {
    requestAnimationFrame(() => {
      area.scrollTop = area.scrollHeight;
      typeKinderChatFeedbackBotMessage(bubble, messageText, area);
    });
  }
}
const kcfLiveFeedbackItems = new Map();
const KCF_LIVE_SESSION_KEY_PREFIX = 'olli_kcf_live_session_v1';
const KCF_LIVE_SESSION_VERSION = 1;
const KCF_LIVE_SESSION_MAX_ITEMS = 50;
const KCF_LIVE_SESSION_PERSIST_DELAY_MS = 350;
const KCF_LIVE_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
let kcfLiveSessionPersistTimer = null;
let kcfLiveSessionRenderedScope = '';
function getKinderChatFeedbackLiveAcademyId(){
  let academyId = '';
  try {
    if (typeof getOlliCurrentAcademyId === 'function') academyId = String(getOlliCurrentAcademyId() || '').trim();
  } catch(e) {}
  if (!academyId) {
    try {
      const current = window.OlliStorageCore?.AcademyContext?.getCurrent?.() || null;
      academyId = String(current?.academyId || current?.academy_id || '').trim();
    } catch(e) {}
  }
  if (!academyId) {
    try { academyId = String(localStorage.getItem('olli_current_academy_id') || '').trim(); } catch(e) {}
  }
  return academyId || 'unscoped';
}
function getKinderChatFeedbackLiveDateKey(){
  try {
    if (typeof getTodayFeedbackDateKey === 'function') return String(getTodayFeedbackDateKey() || '');
  } catch(e) {}
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function getKinderChatFeedbackLiveSessionStorageKey(){
  return `${KCF_LIVE_SESSION_KEY_PREFIX}_${getKinderChatFeedbackLiveAcademyId()}`;
}
function getKinderChatFeedbackLiveSessionExpiryAt(){
  return Date.now() + KCF_LIVE_SESSION_RETENTION_MS;
}
function sanitizeKinderChatFeedbackLiveAttachments(attachments){
  if (!Array.isArray(attachments)) return [];
  return attachments.map(attachment => {
    const source = attachment && typeof attachment === 'object' ? attachment : {};
    const safeUrl = value => {
      const text = String(value || '').trim();
      return text && !/^data:/i.test(text) && !/^blob:/i.test(text) ? text : '';
    };
    return {
      photo_id:String(source.photo_id || '').trim(),
      originalName:String(source.originalName || '').trim(),
      thumbnailUrl:'',
      imageWidth:Number(source.imageWidth || 0) || 0,
      imageHeight:Number(source.imageHeight || 0) || 0
    };
  }).filter(attachment => attachment.photo_id || attachment.originalName || attachment.thumbnailUrl);
}
function serializeKinderChatFeedbackLiveItem(item){
  if (!item || !item.id) return null;
  const savedRow = item.savedRow && typeof item.savedRow === 'object'
    ? {
        id:item.savedRow.id || '',
        client_record_id:item.savedRow.client_record_id || '',
        content:item.savedRow.content || item.resultText || ''
      }
    : null;
  return {
    id:String(item.id || ''),
    academyId:String(item.academyId || getKinderChatFeedbackLiveAcademyId()),
    dateKey:String(item.dateKey || getKinderChatFeedbackLiveDateKey()),
    status:String(item.status || 'done'),
    studentName:String(item.studentName || ''),
    studentDivision:item.studentDivision === 'kinder' ? 'kinder' : 'elementary',
    studentId:String(item.studentId || ''),
    feedbackType:String(item.feedbackType || 'class'),
    label:String(item.label || '피드백'),
    sourcePage:String(item.sourcePage || 'kinderChatFeedback'),
    sourceText:String(item.sourceText || ''),
    attachments:sanitizeKinderChatFeedbackLiveAttachments(item.attachments),
    resultText:String(item.resultText || ''),
    errorMessage:String(item.errorMessage || ''),
    suspiciousSegments:Array.isArray(item.suspiciousSegments) ? item.suspiciousSegments.slice(0, 20) : [],
    saved:!!item.saved,
    reviewed:!!item.reviewed,
    createdAt:String(item.createdAt || ''),
    updatedAt:String(item.updatedAt || ''),
    feedbackMonth:String(item.feedbackMonth || ''),
    feedbackMonthNumber:Number(item.feedbackMonthNumber || 0) || 0,
    savedStudentId:String(item.savedStudentId || ''),
    savedSourceTable:String(item.savedSourceTable || ''),
    savedAcademyId:String(item.savedAcademyId || ''),
    savedRowId:String(item.savedRowId || ''),
    savedAt:String(item.savedAt || ''),
    savedRow
  };
}
function readKinderChatFeedbackLiveSession(){
  const academyId = getKinderChatFeedbackLiveAcademyId();
  if (!academyId || academyId === 'unscoped') return null;
  const key = `${KCF_LIVE_SESSION_KEY_PREFIX}_${academyId}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const session = JSON.parse(raw);
    const updatedAtMs = Date.parse(String(session?.updatedAt || session?.createdAt || ''));
    const storedExpiryAt = Number(session?.expiresAt || 0);
    const rollingExpiryAt = Number.isFinite(updatedAtMs) ? updatedAtMs + KCF_LIVE_SESSION_RETENTION_MS : 0;
    const effectiveExpiryAt = rollingExpiryAt || storedExpiryAt;
    const expired = effectiveExpiryAt > 0 && effectiveExpiryAt <= Date.now();
    if (!session || Number(session.version || 0) !== KCF_LIVE_SESSION_VERSION || expired) {
      localStorage.removeItem(key);
      return null;
    }
    const items = Array.isArray(session.items) ? session.items : [];
    return { ...session, items:items.slice(-KCF_LIVE_SESSION_MAX_ITEMS) };
  } catch(e) {
    try { localStorage.removeItem(key); } catch(ignore) {}
    return null;
  }
}
function persistKinderChatFeedbackLiveSessionNow(){
  if (kcfLiveSessionPersistTimer) {
    clearTimeout(kcfLiveSessionPersistTimer);
    kcfLiveSessionPersistTimer = null;
  }
  const academyId = getKinderChatFeedbackLiveAcademyId();
  if (!academyId || academyId === 'unscoped') return;
  const dateKey = getKinderChatFeedbackLiveDateKey();
  const key = `${KCF_LIVE_SESSION_KEY_PREFIX}_${academyId}`;
  kcfLiveFeedbackItems.forEach(item => {
    if (item && (!item.academyId || item.academyId === 'unscoped')) item.academyId = academyId;
  });
  const items = Array.from(kcfLiveFeedbackItems.values())
    .filter(item => item && item.status !== 'discarded')
    .filter(item => String(item.academyId || academyId) === academyId)
    .map(serializeKinderChatFeedbackLiveItem)
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .slice(-KCF_LIVE_SESSION_MAX_ITEMS);
  try {
    if (!items.length) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({
      version:KCF_LIVE_SESSION_VERSION,
      academyId,
      dateKey,
      createdAt:items[0]?.createdAt || new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      expiresAt:getKinderChatFeedbackLiveSessionExpiryAt(),
      items
    }));
  } catch(e) {
    console.warn('LIVE 대화 임시저장 실패:', e?.message || e);
  }
}
function scheduleKinderChatFeedbackLiveSessionPersist(){
  if (kcfLiveSessionPersistTimer) return;
  kcfLiveSessionPersistTimer = setTimeout(() => {
    kcfLiveSessionPersistTimer = null;
    persistKinderChatFeedbackLiveSessionNow();
  }, KCF_LIVE_SESSION_PERSIST_DELAY_MS);
}
function decorateKinderChatFeedbackLiveUserRow(row, item){
  if (!row || !item) return row;
  const bubble = row.querySelector('.kcfBubble');
  if (!bubble) return row;

  const studentName = normalizeTodayFeedbackStudentName(item.studentName || '') || '학생';
  const sourceText = String(item.sourceText || '').trim();
  let nameEl = bubble.querySelector('.kcfLiveUserStudentName');
  let messageEl = bubble.querySelector('.kcfLiveUserMessageText');

  if (!nameEl || !messageEl) {
    const currentText = sourceText || String(bubble.textContent || '').trim();
    bubble.textContent = '';
    nameEl = document.createElement('span');
    nameEl.className = 'kcfLiveUserStudentName';
    messageEl = document.createElement('span');
    messageEl.className = 'kcfLiveUserMessageText';
    bubble.append(nameEl, messageEl);
    messageEl.textContent = currentText;
  } else if (sourceText) {
    messageEl.textContent = sourceText;
  }

  nameEl.textContent = studentName;
  return row;
}
function tagKinderChatFeedbackLiveUserRow(item){
  const area = document.getElementById('kcfChatArea');
  if (!area || !item?.id) return null;
  const existing = area.querySelector(`[data-kcf-live-user-for="${CSS.escape(String(item.id))}"]`);
  if (existing) return decorateKinderChatFeedbackLiveUserRow(existing, item);
  const rows = Array.from(area.querySelectorAll('.kcfMsgRow.user'));
  const row = rows.reverse().find(candidate => !candidate.dataset.kcfLiveUserFor) || null;
  if (row) {
    row.dataset.kcfLiveUserFor = String(item.id);
    decorateKinderChatFeedbackLiveUserRow(row, item);
  }
  return row;
}
function renderKinderChatFeedbackRestoredUserMessage(item){
  const sourceText = String(item?.sourceText || '').trim();
  if (!sourceText || !item?.id) return;
  const area = document.getElementById('kcfChatArea');
  if (!area) return;
  if (area.querySelector(`[data-kcf-live-user-for="${CSS.escape(String(item.id))}"]`)) return;
  addKinderChatMessage('user', sourceText);
  tagKinderChatFeedbackLiveUserRow(item);
}
function restoreKinderChatFeedbackLiveSession(){
  const area = document.getElementById('kcfChatArea');
  if (!area) return;
  const academyId = getKinderChatFeedbackLiveAcademyId();
  if (!academyId || academyId === 'unscoped') return false;
  const dateKey = getKinderChatFeedbackLiveDateKey();
  const scope = academyId;
  const hasRenderedLiveRows = !!area.querySelector('.kcfLiveResponseRow');
  if (kcfLiveSessionRenderedScope === scope && hasRenderedLiveRows) return;

  if (kcfLiveSessionRenderedScope && kcfLiveSessionRenderedScope !== scope) {
    area.querySelectorAll('.kcfLiveResponseRow, .kcfMsgRow[data-kcf-live-user-for]').forEach(row => row.remove());
    kcfLiveFeedbackItems.clear();
  }
  kcfLiveSessionRenderedScope = scope;

  const session = readKinderChatFeedbackLiveSession();
  if (!session?.items?.length) return false;
  let changed = false;
  for (const stored of session.items) {
    if (!stored?.id) continue;
    const item = {
      ...stored,
      academyId:String(stored.academyId || academyId),
      dateKey:String(stored.dateKey || dateKey),
      attachments:sanitizeKinderChatFeedbackLiveAttachments(stored.attachments),
      suspiciousSegments:Array.isArray(stored.suspiciousSegments) ? stored.suspiciousSegments : []
    };
    const restoredStoredText = restoreKinderChatFeedbackLiveStudentAliases(item.resultText, item.studentName);
    if (restoredStoredText !== item.resultText) {
      item.resultText = restoredStoredText;
      changed = true;
    }
    if (item.status === 'streaming') {
      item.status = 'interrupted';
      item.errorMessage = item.errorMessage || '이전 LIVE 응답이 중간에 종료되었습니다.';
      item.updatedAt = new Date().toISOString();
      changed = true;
    }
    kcfLiveFeedbackItems.set(item.id, item);
    renderKinderChatFeedbackRestoredUserMessage(item);

    let row = getKinderChatFeedbackLiveRow(item.id);
    let liveUi = null;
    if (!row) {
      liveUi = createKinderChatFeedbackLiveMessage(item);
      row = liveUi.row;
    }
    const bubble = row?.querySelector?.('.kcfLiveBubble') || liveUi?.bubble || null;
    if (bubble) {
      if (item.resultText) {
        item.suspiciousSegments = renderKinderChatFeedbackLiveResultText(bubble, item.resultText);
      } else if (item.errorMessage) {
        bubble.textContent = `피드백을 불러오지 못했어요.\n${item.errorMessage}`;
      } else {
        bubble.textContent = '이전 LIVE 응답이 중간에 종료되었습니다.';
      }
      bubble.setAttribute('aria-busy', 'false');
    }
    if (item.status === 'error' || item.status === 'interrupted') {
      if (row) row.classList.add('kcfLiveResponseError');
    }
    if (item.resultText) showKinderChatFeedbackLiveActions(item);
  }
  const intro = document.getElementById('kcfCenterIntro');
  if (intro) intro.classList.add('hidden');
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
  if (changed) persistKinderChatFeedbackLiveSessionNow();
  return true;
}

function stripKinderChatFeedbackLivePrefix(text) {
  return String(text || '').replace(/^\s*(?:올리로그|올리)\s*\n?/, '');
}
function restoreKinderChatFeedbackLiveStudentAliases(text, studentName) {
  const source = String(text || '');
  if (!source || typeof restoreFeedbackStudentAliases !== 'function') return source;
  try {
    return restoreFeedbackStudentAliases(source, studentName);
  } catch (err) {
    console.warn('LIVE 피드백 학생 이름 복원 실패:', err?.message || err);
    return source;
  }
}
function isKinderChatFeedbackLiveRequestDiscarded(id) {
  try {
    const teacherMode = getKinderChatFeedbackTeacherMode();
    return !!(teacherMode &&
      typeof teacherMode.shouldDiscardFeedbackJob === 'function' &&
      teacherMode.shouldDiscardFeedbackJob(String(id || '')));
  } catch(e) {
    return false;
  }
}
function getKinderChatFeedbackLiveItem(id) {
  return kcfLiveFeedbackItems.get(String(id || '')) || null;
}
function getKinderChatFeedbackLiveRow(id) {
  const key = String(id || '');
  if (!key) return null;
  return document.querySelector(`[data-kcf-live-feedback-id="${CSS.escape(key)}"]`);
}
function renderKinderChatFeedbackLiveResultText(bubble, text) {
  const source = String(text || '');
  const segments = typeof getSuspiciousFeedbackSegments === 'function'
    ? getSuspiciousFeedbackSegments(source)
    : [];
  if (!bubble) return segments;
  if (segments.length && typeof renderSuspiciousFeedbackText === 'function') {
    bubble.innerHTML = renderSuspiciousFeedbackText(source);
  } else {
    bubble.textContent = source;
  }
  return segments;
}
const KCF_LIVE_ACTION_ICON_SVG = {
  copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2.2"></rect><path d="M15 9V7.2A2.2 2.2 0 0 0 12.8 5H7.2A2.2 2.2 0 0 0 5 7.2v5.6A2.2 2.2 0 0 0 7.2 15H9"></path></svg>',
  edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 18.8l3.6-.8L18.4 8.4a2 2 0 0 0-2.8-2.8L6 15.2l-.8 3.6z"></path><path d="M13.9 7.3l2.8 2.8"></path></svg>',
  save:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v10"></path><path d="M8.5 11l3.5 3.5 3.5-3.5"></path><path d="M5 18v.7A1.3 1.3 0 0 0 6.3 20h11.4a1.3 1.3 0 0 0 1.3-1.3V18"></path></svg>'
};
function setKinderChatFeedbackLiveActionLabel(btn, label) {
  if (!btn) return;
  const text = String(label || '').trim();
  btn.setAttribute('aria-label', text);
  btn.title = text;
  if (!btn.classList.contains('kcfLiveIconActionBtn')) btn.textContent = text;
}
function createKinderChatFeedbackLiveActionButton(label, className = '', iconName = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `kcfLiveActionBtn ${className}`.trim();
  if (iconName && KCF_LIVE_ACTION_ICON_SVG[iconName]) {
    btn.classList.add('kcfLiveIconActionBtn');
    btn.dataset.kcfLiveActionIcon = iconName;
    btn.innerHTML = KCF_LIVE_ACTION_ICON_SVG[iconName];
  } else {
    btn.textContent = label;
  }
  setKinderChatFeedbackLiveActionLabel(btn, label);
  return btn;
}
function createKinderChatFeedbackLiveMessage(options = {}) {
  const area = document.getElementById('kcfChatArea');
  const messageList = getKinderChatFeedbackMessageList();
  if (!area || !messageList) return { row:null, bubble:null, area:null };
  const intro = document.getElementById('kcfCenterIntro');
  if (intro) intro.classList.add('hidden');

  const row = document.createElement('div');
  row.className = 'kcfMsgRow bot kcfLiveResponseRow';
  row.dataset.kcfLiveFeedbackId = String(options.id || '');

  const studentTitle = document.createElement('div');
  studentTitle.className = 'kcfLiveStudentTitle';
  studentTitle.textContent = normalizeTodayFeedbackStudentName(options.studentName || '') || '학생';

  const bubble = document.createElement('div');
  bubble.className = 'kcfBubble kcfLiveBubble';
  bubble.setAttribute('aria-live', 'polite');
  bubble.setAttribute('aria-busy', 'true');
  bubble.textContent = '…';

  const editArea = document.createElement('textarea');
  editArea.className = 'kcfLiveEditArea';
  editArea.setAttribute('aria-label', 'LIVE 피드백 수정');

  const actions = document.createElement('div');
  actions.className = 'kcfLiveActions';

  const copyBtn = createKinderChatFeedbackLiveActionButton('복사', 'kcfLiveNormalAction kcfLiveCopyBtn', 'copy');
  const editBtn = createKinderChatFeedbackLiveActionButton('수정', 'kcfLiveNormalAction kcfLiveEditBtn', 'edit');
  const saveBtn = createKinderChatFeedbackLiveActionButton('저장', 'kcfLiveNormalAction kcfLiveSaveBtn', 'save');
  const cancelBtn = createKinderChatFeedbackLiveActionButton('취소', 'kcfLiveEditAction kcfLiveCancelBtn');
  const doneBtn = createKinderChatFeedbackLiveActionButton('완료', 'kcfLiveEditAction kcfLiveDoneBtn');

  copyBtn.addEventListener('click', () => copyKinderChatFeedbackLive(options.id, copyBtn));
  editBtn.addEventListener('click', () => editKinderChatFeedbackLive(options.id));
  saveBtn.addEventListener('click', () => saveKinderChatFeedbackLive(options.id, saveBtn));
  cancelBtn.addEventListener('click', () => cancelKinderChatFeedbackLiveEdit(options.id));
  doneBtn.addEventListener('click', () => confirmKinderChatFeedbackLiveEdit(options.id, doneBtn));

  actions.append(copyBtn, editBtn, saveBtn, cancelBtn, doneBtn);
  row.append(studentTitle, bubble, editArea, actions);
  messageList.appendChild(row);
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
  return { row, studentTitle, bubble, editArea, actions, area };
}
async function getKinderChatFeedbackLiveErrorMessage(response) {
  const fallback = `피드백 요청에 실패했습니다. (${response?.status || 'network'})`;
  if (!response) return fallback;
  let raw = '';
  try { raw = await response.text(); } catch(e) {}
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw);
    return String(data?.error || data?.message || data?.detail?.error?.message || fallback);
  } catch(e) {
    return String(raw || fallback).trim() || fallback;
  }
}
function refreshKinderChatFeedbackLiveActions(item) {
  if (!item) return;
  const row = getKinderChatFeedbackLiveRow(item.id);
  if (!row) return;
  const segments = typeof getSuspiciousFeedbackSegments === 'function'
    ? getSuspiciousFeedbackSegments(item.resultText || '')
    : [];
  const copyBtn = row.querySelector('.kcfLiveCopyBtn');
  const saveBtn = row.querySelector('.kcfLiveSaveBtn');
  const editBtn = row.querySelector('.kcfLiveEditBtn');
  if (copyBtn) copyBtn.disabled = !item.resultText || !!segments.length;
  if (editBtn) editBtn.disabled = !item.resultText || item.status === 'streaming';
  if (saveBtn) {
    setKinderChatFeedbackLiveActionLabel(saveBtn, item.saved || item.reviewed ? '저장 완료' : '저장');
    saveBtn.disabled = !item.resultText || ['streaming','interrupted','error'].includes(item.status) || !!segments.length || !!(item.saved || item.reviewed);
  }
  row.classList.toggle('saved', !!(item.saved || item.reviewed));
}
function showKinderChatFeedbackLiveActions(item) {
  const row = getKinderChatFeedbackLiveRow(item?.id);
  if (!row) return;
  row.classList.add('kcfLiveResponseDone');
  refreshKinderChatFeedbackLiveActions(item);
}
async function copyKinderChatFeedbackLive(id, btn) {
  const item = getKinderChatFeedbackLiveItem(id);
  if (!item || !String(item.resultText || '').trim()) return false;
  const segments = typeof getSuspiciousFeedbackSegments === 'function'
    ? getSuspiciousFeedbackSegments(item.resultText)
    : [];
  if (segments.length) {
    try { showPushToast('확인이 필요한 문자가 있어요. 수정 후 복사해 주세요.'); } catch(e) {}
    return false;
  }
  await copyKinderChatSourceCardText(btn, item.resultText);
  return true;
}
function editKinderChatFeedbackLive(id) {
  const item = getKinderChatFeedbackLiveItem(id);
  const row = getKinderChatFeedbackLiveRow(id);
  if (!item || !row || !item.resultText) return;
  const editArea = row.querySelector('.kcfLiveEditArea');
  if (!editArea) return;
  editArea.value = item.resultText;
  row.classList.add('editing');
  requestAnimationFrame(() => {
    editArea.style.height = 'auto';
    editArea.style.height = `${Math.max(120, editArea.scrollHeight)}px`;
    try { editArea.focus(); } catch(e) {}
  });
}
function cancelKinderChatFeedbackLiveEdit(id) {
  const item = getKinderChatFeedbackLiveItem(id);
  const row = getKinderChatFeedbackLiveRow(id);
  if (!row) return;
  const editArea = row.querySelector('.kcfLiveEditArea');
  if (editArea && item) editArea.value = item.resultText || '';
  row.classList.remove('editing');
}
async function confirmKinderChatFeedbackLiveEdit(id, btn) {
  const item = getKinderChatFeedbackLiveItem(id);
  const row = getKinderChatFeedbackLiveRow(id);
  const editArea = row?.querySelector?.('.kcfLiveEditArea');
  if (!item || !row || !editArea) return false;
  const nextText = String(editArea.value || '').trim();
  if (!nextText) {
    try { showPushToast('수정할 피드백 내용이 비어 있어요.'); } catch(e) {}
    return false;
  }

  const wasSaved = !!(item.saved || item.reviewed);
  let patchedSavedRow = null;
  if (wasSaved) {
    if (typeof getTodayFeedbackSavedRowId !== 'function' || typeof patchSavedTodayFeedbackItem !== 'function') {
      try { showPushToast('저장된 피드백 수정 기능을 불러오지 못했습니다.'); } catch(e) {}
      return false;
    }
    const savedRecordId = getTodayFeedbackSavedRowId(item);
    if (!savedRecordId) {
      try { showPushToast('저장된 피드백의 서버 ID를 찾지 못했습니다.'); } catch(e) {}
      return false;
    }
    const oldLabel = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '저장 중...';
    }
    try {
      patchedSavedRow = await patchSavedTodayFeedbackItem(item, nextText);
    } catch (err) {
      console.error('LIVE 저장 피드백 수정 오류:', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldLabel || '완료';
      }
      try { showPushToast(`수정 저장 중 오류가 발생했어요. ${err.message || ''}`.trim()); } catch(e) {}
      return false;
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldLabel || '완료';
    }
  }

  const segments = typeof getSuspiciousFeedbackSegments === 'function'
    ? getSuspiciousFeedbackSegments(nextText)
    : [];
  item.resultText = nextText;
  item.suspiciousSegments = segments;
  item.status = segments.length ? 'review' : 'done';
  item.updatedAt = new Date().toISOString();
  if (wasSaved) {
    item.saved = true;
    item.reviewed = true;
    item.savedRow = { ...(item.savedRow || {}), ...(patchedSavedRow || {}), content: nextText };
  }
  const bubble = row.querySelector('.kcfLiveBubble');
  if (bubble) renderKinderChatFeedbackLiveResultText(bubble, nextText);
  row.classList.remove('editing');
  refreshKinderChatFeedbackLiveActions(item);
  persistKinderChatFeedbackLiveSessionNow();
  if (wasSaved) {
    try { showPushToast('수정 내용을 저장했어요.'); } catch(e) {}
  }
  return true;
}
async function saveKinderChatFeedbackLive(id, btn = null, selectedStudentId = '') {
  const item = getKinderChatFeedbackLiveItem(id);
  if (!item || !String(item.resultText || '').trim() || item.status === 'streaming') return false;
  if (item.saved || item.reviewed) {
    try { showPushToast('이미 기록실에 저장된 피드백입니다.'); } catch(e) {}
    refreshKinderChatFeedbackLiveActions(item);
    return true;
  }

  const segments = typeof getSuspiciousFeedbackSegments === 'function'
    ? getSuspiciousFeedbackSegments(item.resultText)
    : [];
  if (segments.length) {
    try { showPushToast('확인이 필요한 문자가 있어요. 수정 후 저장해 주세요.'); } catch(e) {}
    return false;
  }

  let finalStudentId = String(selectedStudentId || item.studentId || item.savedStudentId || '').trim();
  if (!finalStudentId) {
    const candidates = typeof getKinderChatFeedbackSaveStudentCandidates === 'function'
      ? getKinderChatFeedbackSaveStudentCandidates(item.studentName, item.studentDivision)
      : [];
    if (!candidates.length) {
      try { showPushToast(`${item.studentName || '입력한 이름'}로 등록된 학생 이름이 없습니다.`); } catch(e) {}
      return false;
    }
    if (candidates.length > 1) {
      openKinderChatFeedbackSaveStudentPicker(item.id, candidates, 'live');
      return null;
    }
    finalStudentId = String(candidates[0]?.id || '').trim();
  }
  if (!finalStudentId) return false;
  if (typeof autoSaveGeneratedFeedback !== 'function') {
    try { showPushToast('피드백 저장 기능을 불러오지 못했습니다.'); } catch(e) {}
    return false;
  }

  const oldLabel = btn ? (btn.getAttribute('aria-label') || btn.textContent || '저장') : '저장';
  if (btn) {
    btn.disabled = true;
    setKinderChatFeedbackLiveActionLabel(btn, '저장 중');
  }

  let savedOk = false;
  try {
    savedOk = await autoSaveGeneratedFeedback(item.resultText, {
      feedbackType: item.feedbackType || 'class',
      studentDivision: item.studentDivision || 'elementary',
      studentName: item.studentName || '',
      studentId: finalStudentId
    }, null);
  } catch (err) {
    console.error('LIVE 피드백 저장 오류:', err);
    savedOk = false;
  }

  if (savedOk === false) {
    if (btn) {
      btn.disabled = false;
      setKinderChatFeedbackLiveActionLabel(btn, oldLabel || '저장');
    }
    try { showPushToast('피드백 저장을 확인해 주세요.'); } catch(e) {}
    return false;
  }

  try {
    if (typeof linkFeedbackPhotosToStudent === 'function') await linkFeedbackPhotosToStudent(item, finalStudentId);
  } catch (err) {
    console.warn('LIVE 피드백 사진 연결 확인 필요:', err);
    try { showPushToast('피드백은 저장됐지만 사진 연결을 다시 확인해야 해요.'); } catch(e) {}
  }

  const savedRow = savedOk && typeof savedOk === 'object' ? savedOk : null;
  const sourceTable = typeof getFeedbackTableNameByType === 'function'
    ? getFeedbackTableNameByType(item.feedbackType || 'class')
    : '';
  item.saved = true;
  item.reviewed = true;
  item.studentId = finalStudentId;
  item.savedStudentId = finalStudentId;
  item.savedSourceTable = sourceTable;
  item.savedAcademyId = typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '';
  item.savedRowId = String(savedRow?.id || savedRow?.client_record_id || '').trim();
  item.savedRow = savedRow || item.savedRow || null;
  item.savedAt = new Date().toISOString();
  item.updatedAt = item.savedAt;
  persistKinderChatFeedbackLiveSessionNow();

  if (btn) {
    setKinderChatFeedbackLiveActionLabel(btn, '저장 완료');
    btn.disabled = true;
  }
  refreshKinderChatFeedbackLiveActions(item);
  try { showPushToast('피드백을 저장했어요.'); } catch(e) {}
  return true;
}
function startKinderChatFeedbackLiveRequest(options = {}) {
  const now = new Date().toISOString();
  const item = {
    id: String(options.id || `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    status: 'streaming',
    studentName: normalizeTodayFeedbackStudentName(options.studentName || '') || '학생',
    studentDivision: options.studentDivision === 'kinder' ? 'kinder' : 'elementary',
    studentId: String(options.studentId || ''),
    feedbackType: options.feedbackType || 'class',
    label: options.label || '피드백',
    sourcePage: 'kinderChatFeedback',
    sourceText: String(options.userText || ''),
    attachments: Array.isArray(options.attachments) ? options.attachments : [],
    resultText: '',
    errorMessage: '',
    suspiciousSegments: [],
    saved: false,
    reviewed: false,
    createdAt: now,
    updatedAt: now,
    feedbackMonth: String(options.feedbackMonth || ''),
    feedbackMonthNumber: Number(options.feedbackMonthNumber || 0),
    academyId:getKinderChatFeedbackLiveAcademyId(),
    dateKey:getKinderChatFeedbackLiveDateKey()
  };
  kcfLiveFeedbackItems.set(item.id, item);
  tagKinderChatFeedbackLiveUserRow(item);
  persistKinderChatFeedbackLiveSessionNow();
  const liveUi = createKinderChatFeedbackLiveMessage(item);

  (async () => {
    try {
      const requestStartedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      let firstChunkLogged = false;
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptType: options.promptType || 'class',
          jobId: item.id,
          studentId: item.studentId,
          studentName: item.studentName,
          studentDivision: item.studentDivision,
          feedbackMonth: item.feedbackMonth,
          feedbackMonthNumber: item.feedbackMonthNumber,
          messages: [{
            role: 'user',
            content: String(options.requestContent || options.userText || '').trim()
          }],
          stream: true
        })
      });

      if (!response.ok) throw new Error(await getKinderChatFeedbackLiveErrorMessage(response));
      if (!response.body || typeof response.body.getReader !== 'function') {
        throw new Error('이 기기에서 스트리밍 응답을 읽을 수 없습니다.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!firstChunkLogged && value && value.length) {
          firstChunkLogged = true;
          const firstChunkAt = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
          const firstChunkElapsedMs = Math.round(firstChunkAt - requestStartedAt);
          console.info('[OLLI AI] feedback first stream chunk', {
            elapsedMs: firstChunkElapsedMs,
          });
          reportKinderChatFeedbackTtft(
            firstChunkElapsedMs,
            options.promptType || 'class',
            item.academyId
          );
        }
        if (isKinderChatFeedbackLiveRequestDiscarded(item.id)) {
          item.status = 'discarded';
          kcfLiveFeedbackItems.delete(item.id);
          persistKinderChatFeedbackLiveSessionNow();
          try { await reader.cancel(); } catch(e) {}
          if (liveUi.row) liveUi.row.remove();
          return;
        }
        fullText += decoder.decode(value, { stream:true });
        const visibleText = restoreKinderChatFeedbackLiveStudentAliases(
          stripKinderChatFeedbackLivePrefix(fullText),
          item.studentName
        );
        item.resultText = visibleText;
        item.updatedAt = new Date().toISOString();
        scheduleKinderChatFeedbackLiveSessionPersist();
        if (liveUi.bubble) {
          liveUi.bubble.textContent = visibleText || '…';
          if (liveUi.area) liveUi.area.scrollTop = liveUi.area.scrollHeight;
        }
      }

      fullText += decoder.decode();
      if (isKinderChatFeedbackLiveRequestDiscarded(item.id)) {
        item.status = 'discarded';
        kcfLiveFeedbackItems.delete(item.id);
        persistKinderChatFeedbackLiveSessionNow();
        if (liveUi.row) liveUi.row.remove();
        return;
      }
      const finalText = restoreKinderChatFeedbackLiveStudentAliases(
        stripKinderChatFeedbackLivePrefix(fullText),
        item.studentName
      ).trim();
      if (!finalText) throw new Error('응답 본문이 비어 있습니다.');

      item.status = 'done';
      item.resultText = finalText;
      markKinderChatFeedbackPromptCacheTouched();
      item.suspiciousSegments = typeof getSuspiciousFeedbackSegments === 'function'
        ? getSuspiciousFeedbackSegments(finalText)
        : [];
      item.updatedAt = new Date().toISOString();
      persistKinderChatFeedbackLiveSessionNow();
      const successTeacherMode = getKinderChatFeedbackTeacherMode();
      if (successTeacherMode && typeof successTeacherMode.onFeedbackRequestResult === 'function') {
        successTeacherMode.onFeedbackRequestResult({
          id:item.id,
          studentId:item.studentId,
          studentName:item.studentName,
          studentDivision:item.studentDivision,
          status:item.suspiciousSegments.length ? 'review' : 'done'
        });
      }
      if (isKinderChatFeedbackLiveRequestDiscarded(item.id)) {
        kcfLiveFeedbackItems.delete(item.id);
        persistKinderChatFeedbackLiveSessionNow();
        if (liveUi.row) liveUi.row.remove();
        return;
      }
      if (liveUi.bubble) {
        renderKinderChatFeedbackLiveResultText(liveUi.bubble, finalText);
        liveUi.bubble.setAttribute('aria-busy', 'false');
      }
      showKinderChatFeedbackLiveActions(item);
      if (liveUi.area) liveUi.area.scrollTop = liveUi.area.scrollHeight;
    } catch(err) {
      if (isKinderChatFeedbackLiveRequestDiscarded(item.id)) {
        item.status = 'discarded';
        kcfLiveFeedbackItems.delete(item.id);
        persistKinderChatFeedbackLiveSessionNow();
        if (liveUi.row) liveUi.row.remove();
        return;
      }
      item.status = 'error';
      item.errorMessage = String(err?.message || err || '알 수 없는 오류입니다.');
      item.updatedAt = new Date().toISOString();
      persistKinderChatFeedbackLiveSessionNow();
      const failureTeacherMode = getKinderChatFeedbackTeacherMode();
      if (failureTeacherMode && typeof failureTeacherMode.onFeedbackRequestResult === 'function') {
        failureTeacherMode.onFeedbackRequestResult({
          id:item.id,
          studentId:item.studentId,
          studentName:item.studentName,
          studentDivision:item.studentDivision,
          status:'error',
          errorMessage:item.errorMessage
        });
      }
      if (liveUi.bubble) {
        liveUi.bubble.textContent = `피드백을 불러오지 못했어요.\n${item.errorMessage}`;
        liveUi.bubble.setAttribute('aria-busy', 'false');
      }
      if (liveUi.row) liveUi.row.classList.add('kcfLiveResponseError');
      try { showPushToast(`${item.studentName} 피드백을 확인해 주세요.`); } catch(e) {}
    }
  })();

  return item;
}

async function copyKinderChatSourceCardText(btn, text) {
  const copyText = String(text || '').trim();
  if (!copyText) {
    showPushToast('복사할 내용이 없어요.');
    return;
  }

  const oldHtml = btn ? btn.innerHTML : '';
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(copyText);
      copied = true;
    }
  } catch(e) {
    copied = false;
  }

  if (!copied) {
    try {
      const temp = document.createElement('textarea');
      temp.value = copyText;
      temp.setAttribute('readonly', '');
      temp.style.position = 'fixed';
      temp.style.left = '-9999px';
      temp.style.top = '0';
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      copied = true;
    } catch(e) {
      copied = false;
    }
  }

  if (copied) {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: oldHtml || '복사하기', restoreDisabled: false });
  } else {
    showPushToast('복사에 실패했어요.');
  }
}

function addKinderChatDocumentMessage(title, subtitle, bodyText = '', variant = '', photoMeta = null) {
  const area = document.getElementById('kcfChatArea');
  const messageList = getKinderChatFeedbackMessageList();
  if (!area || !messageList) return;
  const intro = document.getElementById('kcfCenterIntro');
  if (intro) intro.classList.add('hidden');

  const row = document.createElement('div');
  row.className = 'kcfMsgRow user';

  const card = document.createElement('div');
  card.className = `kcfDocumentCard ${variant === 'growth' ? 'growth' : ''}`.trim();

  const cleanTitle = String(title || '아이 이름').trim();
  const cleanSubtitle = String(subtitle || '1분 피드백').trim();

  const photoThumbUrl = photoMeta && photoMeta.thumbnailUrl ? String(photoMeta.thumbnailUrl) : '';
  const iconHtml = photoThumbUrl
    ? `<span class="kcfDocumentIcon hasPhoto" aria-hidden="true"><img class="kcfDocumentPhotoThumb" src="${escapeHtml(photoThumbUrl)}" alt=""></span>`
    : `<span class="kcfDocumentIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3.8h7.2L18 7.6V20a1.2 1.2 0 0 1-1.2 1.2H7.2A1.2 1.2 0 0 1 6 20V5a1.2 1.2 0 0 1 1-1.2z"></path><path d="M14 4v4h4"></path><path d="M9 12h6"></path><path d="M9 15h6"></path></svg></span>`;

  card.innerHTML = `${iconHtml}<span class="kcfDocumentText"><span class="kcfDocumentTitle">${escapeHtml(cleanTitle)}</span><span class="kcfDocumentSub">${escapeHtml(cleanSubtitle)}</span></span>`;

  row.appendChild(card);
  messageList.appendChild(row);
  const teacherMode = getKinderChatFeedbackTeacherMode();
  if (variant === 'minute' && teacherMode && typeof teacherMode.onDocumentMessageAdded === 'function') {
    teacherMode.onDocumentMessageAdded(row, { studentName:cleanTitle, body:String(bodyText || '').trim(), subtitle:cleanSubtitle, photoMeta:photoMeta || null });
  }
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}
function renderKinderChatFeedbackGuide(key) {
  const guide = document.getElementById('kcfQuestionGuide');
  if (!guide) return;
  const data = kcfKeywordQuestions[key];
  if (!data) {
    guide.innerHTML = '';
    guide.classList.remove('show');

    return;
  }
  const icon = '<svg class="kcfQuestionIcon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="M15 15l4 4"></path></svg>';
  guide.innerHTML = `<ul class="kcfQuestionList">${data.questions.map(q => `<li>${icon}<span class="kcfQuestionText">${escapeHtml(q)}</span></li>`).join('')}</ul>`;
  guide.classList.add('show');

}
function toggleKinderChatFeedbackKeyword(key, button) {
  const buttons = document.querySelectorAll('.kcfKeywordBtn');
  if (kcfActiveKeyword === key) {
    kcfActiveKeyword = '';
    buttons.forEach(btn => btn.classList.remove('active'));
    renderKinderChatFeedbackGuide('');
    return;
  }
  kcfActiveKeyword = key;
  buttons.forEach(btn => btn.classList.toggle('active', btn === button));
  renderKinderChatFeedbackGuide(key);
}
function clearKinderChatFeedbackKeyword() {
  kcfActiveKeyword = '';
  document.querySelectorAll('.kcfKeywordBtn').forEach(btn => btn.classList.remove('active'));
  renderKinderChatFeedbackGuide('');
}
function getKinderChatFeedbackStatusLabel(status) {
  if (status === 'generating') return '정리 중';
  if (status === 'error') return '오류';
  if (status === 'review') return '확인 필요';
  return '도착';
}
function getKinderChatFeedbackAvatarSeed(item, fallbackName = '') {
  if (item && typeof item === 'object') {
    return String(item.id || item.createdAt || item.updatedAt || item.studentId || item.studentName || fallbackName || 'olli');
  }
  return String(item || fallbackName || 'olli');
}
function getKinderChatFeedbackAvatarHash(seed) {
  const text = String(seed || 'olli');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i) * (i + 7)) % 1000003;
  }
  return Math.abs(hash);
}
function getKinderChatFeedbackAvatarIcon(item) {
  const seed = getKinderChatFeedbackAvatarSeed(item);
  const hash = getKinderChatFeedbackAvatarHash(seed);

  // 미술용품 전용 아이콘만 사용합니다.
  // 순서: 붓, 팔레트, 물감튜브, 크레파스, 연필, 지우개
  const icons = [
    // 붓
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarBrush">
      <path d="M14.7 4.6l4.7 4.7"></path>
      <path d="M5.4 18.8c1.9.3 3.7-.2 5-1.5l8.1-8.1-3.7-3.7-8.1 8.1c-1.3 1.3-1.8 3.1-1.3 5.2z"></path>
      <path d="M5.1 19l4.1-1.2"></path>
    </svg>`,

    // 팔레트
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarPalette">
      <path d="M12.1 4.7c-4.4 0-7.8 2.9-7.8 6.6 0 3.5 2.9 6 6.8 6.4.7.1 1.1.5 1.1 1.2 0 .8.7 1.3 1.6 1.1 3.6-.8 6-3.5 6-7.1 0-4.5-3.3-8.2-7.7-8.2z"></path>
      <circle cx="8.1" cy="10.4" r="1"></circle>
      <circle cx="11.3" cy="8.6" r="1"></circle>
      <circle cx="14.8" cy="10.2" r="1"></circle>
      <path d="M15.2 15.1h2.1"></path>
    </svg>`,

    // 물감 튜브
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarPaintTube">
      <path d="M8.4 5.2h7.2"></path>
      <path d="M9.1 5.2v2.4h5.8V5.2"></path>
      <path d="M8.7 7.6h6.6l2.4 9.1c.3 1.2-.6 2.3-1.8 2.3H8.1c-1.2 0-2.1-1.1-1.8-2.3l2.4-9.1z"></path>
      <path d="M8.2 14.2h7.6"></path>
      <path d="M10.2 16.6h3.6"></path>
    </svg>`,

    // 크레파스
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarCrayon">
      <path d="M6.1 8.7l2.6-2.6c.6-.6 1.6-.6 2.2 0l7 7c.6.6.6 1.6 0 2.2l-2.6 2.6c-.6.6-1.6.6-2.2 0l-7-7c-.6-.6-.6-1.6 0-2.2z"></path>
      <path d="M8.5 6.3l-1.9-1 1 1.9"></path>
      <path d="M10.2 9.6l4.2 4.2"></path>
      <path d="M12.4 7.4l4.2 4.2"></path>
    </svg>`,

    // 연필
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarPencil">
      <path d="M5.5 18.5l1.1-4.4 8.6-8.6 3.3 3.3-8.6 8.6-4.4 1.1z"></path>
      <path d="M14.1 6.6l3.3 3.3"></path>
      <path d="M6.6 14.1l3.3 3.3"></path>
      <path d="M5.5 18.5l2.6-.7-1.9-1.9-.7 2.6z"></path>
    </svg>`,

    // 지우개
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarEraser">
      <path d="M6.2 13.2l5.7-5.7c.8-.8 2-.8 2.8 0l3 3c.8.8.8 2 0 2.8L12 19H6.2v-5.8z"></path>
      <path d="M10.8 8.6l6.1 6.1"></path>
      <path d="M12 19h6.2"></path>
    </svg>`
  ];

  return icons[hash % icons.length];
}
function getKinderChatFeedbackAvatarColor(item) {
  const palette = ['#9BE7E8', '#FFD3B8', '#FFC5DB', '#9DDEF2', '#BFD9FF', '#E8B8FF', '#D7F3C8', '#FFE4A8'];
  const seed = getKinderChatFeedbackAvatarSeed(item);
  const hash = getKinderChatFeedbackAvatarHash(seed);
  return palette[hash % palette.length];
}
function getKinderChatFeedbackAvatarIconColor(item) {
  const colors = ['#1D6F73', '#9A5B24', '#A2446A', '#1B7790', '#2D6EA8', '#9D31C9', '#4C8440', '#9A6A12'];
  const seed = getKinderChatFeedbackAvatarSeed(item);
  const hash = getKinderChatFeedbackAvatarHash(seed);
  return colors[hash % colors.length];
}
function buildKinderChatFeedbackInboxCard(item) {
  const status = item.status || 'done';
  const text = status === 'generating'
    ? '올리가 피드백을 정리하고 있어요.'
    : (status === 'error' ? (item.errorMessage || '피드백 생성 중 오류가 발생했습니다.') : (item.resultText || ''));
  const canEdit = status === 'done' || status === 'review';
  const canDelete = true;
  const isLoadFail = isTodayFeedbackLoadFailItem(item);
  const canSave = status === 'done' && !isLoadFail && !getSuspiciousFeedbackSegments(item.resultText || '').length;
  const canCopy = canSave;
  const name = item.studentName || '학생';
  const avatarIcon = getKinderChatFeedbackAvatarIcon(item);
  const avatarColor = getKinderChatFeedbackAvatarColor(item);
  const avatarIconColor = getKinderChatFeedbackAvatarIconColor(item);
  const dateText = formatNotificationDate(item.updatedAt || item.createdAt);
  const labelText = String(item.label || '유치부 1분 피드백').replace(/^유치부\s*/, '') || '1분 피드백';
  const openMetaText = dateText ? `${labelText} · ${dateText}` : labelText;
  const renderedText = status === 'done' || status === 'review' ? renderSuspiciousFeedbackText(text) : escapeHtml(text);
  return `<div class="kcfInboxCard" data-kcf-feedback-id="${escapeHtml(item.id)}" onclick="toggleKinderChatFeedbackInboxItem('${escapeHtml(item.id)}')">
    <div class="kcfInboxTop">
      <div class="kcfInboxAvatar" style="background:${escapeHtml(avatarColor)}; color:${escapeHtml(avatarIconColor)};">${avatarIcon}</div>
      <div class="kcfInboxMain">
        <div class="kcfInboxMetaRow">
          <div class="kcfInboxName">${escapeHtml(name)}</div>
          <div class="kcfInboxStatus ${escapeHtml(status)}">${escapeHtml(getKinderChatFeedbackStatusLabel(status))}</div>
        </div>
        <div class="kcfInboxText" data-kcf-open-meta="${escapeHtml(openMetaText)}">${escapeHtml(openMetaText || getKinderChatFeedbackStatusLabel(status))}</div>
      </div>
    </div>
    <div class="kcfInboxFullText">${renderedText}</div>
    <textarea class="kcfInboxEditArea" onclick="event.stopPropagation()">${escapeHtml(item.resultText || '')}</textarea>
    ${buildTodayFeedbackIssueHtml(status === 'done' || status === 'review' ? getSuspiciousFeedbackSegments(item.resultText || '') : [])}
    <div class="kcfInboxActions" onclick="event.stopPropagation()">
      <div class="kcfInboxActionsLeft">
        <button type="button" class="todayFeedbackActionBtn kcfInboxActionBtn kcfInboxDeleteBtn" onclick="deleteKinderChatFeedbackInboxItem('${escapeHtml(item.id)}')"${canDelete ? '' : ' disabled'}>삭제</button>
      </div>
      <div class="kcfInboxActionsRight">
        <button type="button" class="todayFeedbackActionBtn kcfInboxActionBtn kcfInboxEditBtn" onclick="editKinderChatFeedbackInboxItem('${escapeHtml(item.id)}')"${canEdit ? '' : ' disabled'}>수정</button>
        <button type="button" class="todayFeedbackActionBtn kcfInboxActionBtn kcfInboxCopyBtn" onclick="copyAndSaveKinderChatFeedback('${escapeHtml(item.id)}', this)"${canCopy ? '' : ' disabled'}>복사 + 저장</button>
        <button type="button" class="todayFeedbackActionBtn kcfInboxActionBtn kcfInboxEditCancelBtn" onclick="cancelKinderChatFeedbackInboxEdit('${escapeHtml(item.id)}')" style="display:none;">취소</button>
        <button type="button" class="todayFeedbackActionBtn primary kcfInboxActionBtn kcfInboxEditDoneBtn" onclick="confirmKinderChatFeedbackInboxEdit('${escapeHtml(item.id)}')" style="display:none;">수정 완료</button>
      </div>
    </div>
  </div>`;
}
function toggleKinderChatFeedbackInboxItem(id) {
  const card = document.querySelector(`[data-kcf-feedback-id="${CSS.escape(id)}"]`);
  if (!card || card.classList.contains('editing')) return;
  const nextOpen = !card.classList.contains('open');
  card.classList.toggle('open', nextOpen);
}
function renderKinderChatFeedbackInbox() {
  const body = document.getElementById('kcfInboxBody');
  if (!body) return;
  const items = getKinderChatFeedbackItems();
  if (!items.length) {
    body.innerHTML = '<div class="kcfInboxEmpty">아직 받은 피드백이 없습니다.<br>관찰 내용을 보내면 이곳에 정리해둘게요.</div>';
    updateKinderChatFeedbackBadge();
    return;
  }
  const generating = items.filter(item => item.status === 'generating');
  const ready = items.filter(item => (item.status === 'done' || item.status === 'review') && !item.reviewed && !item.saved);
  const error = items.filter(item => item.status === 'error');
  const saved = items.filter(item => item.saved || item.reviewed);
  let html = '';
  if (generating.length) html += `<div class="kcfInboxSectionTitle">생성 중 ${generating.length}</div>` + generating.map(buildKinderChatFeedbackInboxCard).join('');
  if (ready.length) html += ready.map(buildKinderChatFeedbackInboxCard).join('');
  if (error.length) html += `<div class="kcfInboxSectionTitle">오류 ${error.length}</div>` + error.map(buildKinderChatFeedbackInboxCard).join('');
  if (saved.length) html += `<div class="kcfInboxSectionTitle">저장완료 ${saved.length}</div>` + saved.map(buildKinderChatFeedbackInboxCard).join('');
  body.innerHTML = html;
  updateKinderChatFeedbackBadge();
}
function openKinderChatFeedbackInbox() {
  renderKinderChatFeedbackInbox();
  const overlay = document.getElementById('kcfInboxOverlay');
  if (overlay) overlay.classList.add('show');
  saveKinderChatFeedbackDraft();
}
function closeKinderChatFeedbackInbox(event) {
  if (event && event.target && event.target.id !== 'kcfInboxOverlay') return;
  const overlay = document.getElementById('kcfInboxOverlay');
  if (overlay) overlay.classList.remove('show');
}
function editKinderChatFeedbackInboxItem(id) {
  const card = document.querySelector(`[data-kcf-feedback-id="${CSS.escape(id)}"]`);
  if (!card) return;
  card.classList.add('editing', 'open');
  const editBtn = card.querySelector('.kcfInboxEditBtn');
  const doneBtn = card.querySelector('.kcfInboxEditDoneBtn');
  const cancelBtn = card.querySelector('.kcfInboxEditCancelBtn');
  const deleteBtn = card.querySelector('.kcfInboxDeleteBtn');
  const copyBtn = card.querySelector('.kcfInboxCopyBtn');
  const saveBtn = card.querySelector('.kcfInboxSaveBtn');
  if (editBtn) editBtn.style.display = 'none';
  if (deleteBtn) deleteBtn.style.display = 'none';
  if (doneBtn) doneBtn.style.display = 'inline-flex';
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  if (copyBtn) copyBtn.style.display = 'none';
  if (saveBtn) saveBtn.style.display = 'none';
  const textarea = card.querySelector('.kcfInboxEditArea');
  if (textarea) {
    const fitEditArea = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    requestAnimationFrame(fitEditArea);
    textarea.oninput = fitEditArea;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
}
function cancelKinderChatFeedbackInboxEdit(id) {
  renderKinderChatFeedbackInbox();
}
function deleteKinderChatFeedbackInboxItem(id) {
  const item = getTodayFeedbackItemById(id);
  const name = String(item?.studentName || '이 피드백').trim();
  const ok = window.confirm(`${name} 피드백을 정말 삭제할까요?\n삭제하면 임시 보관함에서 사라집니다.`);
  if (!ok) return;

  const list = getTodayFeedbackItemsRaw().filter(item => !(item && item.id === id));
  setTodayFeedbackItemsRaw(list);
  renderKinderChatFeedbackInbox();
  updateKinderChatFeedbackBadge();
  try { showPushToast('피드백을 삭제했어요.'); } catch(e) {}
}
async function writeKinderChatFeedbackClipboard(text) {
  const content = String(text || '').trim();
  if (!content) return false;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch(e) {}

  try {
    const temp = document.createElement('textarea');
    temp.value = content;
    temp.setAttribute('readonly', '');
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    temp.style.top = '0';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(temp);
    return !!ok;
  } catch(e) {
    return false;
  }
}

async function copyAndSaveKinderChatFeedback(id, btn, selectedStudentId = '') {
  const item = getTodayFeedbackItemById(id);
  if (!item || !item.resultText) return false;

  const reason = getTodayFeedbackExportBlockReason(item);
  if (reason) {
    showPushToast(reason);
    return false;
  }

  const oldText = btn ? (btn.textContent || '복사 + 저장') : '복사 + 저장';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '복사 중...';
  }

  const copied = await writeKinderChatFeedbackClipboard(item.resultText);
  if (!copied) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldText;
    }
    showPushToast('복사에 실패했어요.');
    return false;
  }

  if (item.saved || item.reviewed) {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: '저장완료', restoreDisabled: false });
    showPushToast('이미 기록실에 저장된 피드백입니다.');
    return true;
  }

  if (btn) btn.textContent = '저장 중...';
  const saved = await saveTodayFeedbackItem(id, btn || null, selectedStudentId);

  if (btn) {
    btn.disabled = false;
    btn.textContent = saved === true ? '저장완료' : oldText;
  }

  if (saved === true) {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: '저장완료', restoreDisabled: false });
    showPushToast('피드백을 저장했어요.');
  } else if (saved === null) {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: oldText, restoreDisabled: false });
    showPushToast('피드백을 복사했어요. 저장할 학생을 선택해 주세요.');
  } else {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: oldText, restoreDisabled: false });
    showPushToast('피드백은 복사했지만 기록실 저장은 확인이 필요해요.');
  }

  return saved;
}

async function confirmKinderChatFeedbackInboxEdit(id) {
  const card = document.querySelector(`[data-kcf-feedback-id="${CSS.escape(id)}"]`);
  const textarea = card?.querySelector?.('.kcfInboxEditArea');
  if (!textarea) return;
  const nextText = String(textarea.value || '').trim();
  if (!nextText) {
    setKinderChatFeedbackWarning('수정할 피드백 내용이 비어 있어요.');
    return;
  }
  const segments = getSuspiciousFeedbackSegments(nextText);
  const nextStatus = segments.length ? 'review' : 'done';
  const originalItem = getTodayFeedbackItemById(id);
  const wasServerSaved = !!(originalItem && (originalItem.saved || originalItem.reviewed));
  const savedRecordId = getTodayFeedbackSavedRowId(originalItem || {});
  let patchedSavedRow = null;
  if (wasServerSaved) {
    if (!savedRecordId) {
      setKinderChatFeedbackWarning('이미 저장된 피드백의 서버 ID를 찾지 못해 수정 저장을 할 수 없습니다.');
      return;
    }
    try {
      patchedSavedRow = await patchSavedTodayFeedbackItem(originalItem, nextText);
    } catch (err) {
      console.error('저장된 1분 피드백 수정 오류:', err);
      setKinderChatFeedbackWarning(`수정 저장 중 오류가 발생했어요. ${err.message || ''}`.trim());
      return;
    }
  }
  const list = getTodayFeedbackItemsRaw();
  let updatedItem = null;
  let changed = false;
  const now = new Date().toISOString();
  const nextList = list.map(item => {
    if (!item || item.id !== id) return item;
    changed = true;
    updatedItem = {
      ...item,
      resultText: nextText,
      suspiciousSegments: segments,
      status: nextStatus,
      reviewed: wasServerSaved ? true : false,
      saved: wasServerSaved ? true : false,
      savedRowId: wasServerSaved ? (savedRecordId || item.savedRowId || '') : (item.savedRowId || ''),
      savedSourceTable: wasServerSaved ? getTodayFeedbackSavedSourceTable(item) : (item.savedSourceTable || ''),
      savedStudentId: wasServerSaved ? (item.savedStudentId || item.studentId || '') : (item.savedStudentId || ''),
      savedAcademyId: wasServerSaved ? (item.savedAcademyId || (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '')) : (item.savedAcademyId || ''),
      savedRow: wasServerSaved ? { ...(item.savedRow || {}), ...(patchedSavedRow || {}), content: nextText } : item.savedRow,
      updatedAt: now
    };
    return updatedItem;
  });
  if (!changed) return;
  setTodayFeedbackItemsRaw(nextList);
  try { updateNotificationButtons(); } catch(e) {}
  try { renderTodayFeedbackPage(); } catch(e) {}
  try { updateKinderChatFeedbackBadge(); } catch(e) {}
  if (card) {
    card.classList.remove('editing');
    card.classList.add('open');
    const avatarEl = card.querySelector('.kcfInboxAvatar');
    const preview = card.querySelector('.kcfInboxText');
    const full = card.querySelector('.kcfInboxFullText');
    const statusEl = card.querySelector('.kcfInboxStatus');
    const issueBox = card.querySelector('.todayFeedbackIssueBox');
    const actions = card.querySelector('.kcfInboxActions');
    const editBtn = card.querySelector('.kcfInboxEditBtn');
    const doneBtn = card.querySelector('.kcfInboxEditDoneBtn');
    const cancelBtn = card.querySelector('.kcfInboxEditCancelBtn');
    const deleteBtn = card.querySelector('.kcfInboxDeleteBtn');
    const copyBtn = card.querySelector('.kcfInboxCopyBtn');
    const saveBtn = card.querySelector('.kcfInboxSaveBtn');
    const labelText = String(updatedItem?.label || '유치부 1분 피드백').replace(/^유치부\s*/, '') || '1분 피드백';
    const dateText = formatNotificationDate(updatedItem?.updatedAt || updatedItem?.createdAt);
    const openMetaText = dateText ? `${labelText} · ${dateText}` : labelText;
    if (avatarEl) avatarEl.style.display = 'none';
    if (preview) {
      preview.dataset.kcfPreviewText = nextText;
      preview.dataset.kcfOpenMeta = openMetaText;
      preview.textContent = openMetaText;
      preview.style.fontSize = 'calc(12px * var(--olli-text-scale))';
      preview.style.lineHeight = '1.35';
      preview.style.color = '#999';
    }
    if (full) full.innerHTML = renderSuspiciousFeedbackText(nextText);
    if (textarea) textarea.value = nextText;
    if (statusEl) {
      statusEl.className = `kcfInboxStatus ${nextStatus}`;
      statusEl.textContent = getKinderChatFeedbackStatusLabel(nextStatus);
    }
    if (issueBox) issueBox.remove();
    const issueHtml = buildTodayFeedbackIssueHtml(segments);
    if (issueHtml && actions) actions.insertAdjacentHTML('beforebegin', issueHtml);
    if (editBtn) editBtn.style.display = 'inline-flex';
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';
    if (doneBtn) doneBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (copyBtn) {
      copyBtn.style.display = 'inline-flex';
      copyBtn.disabled = !!segments.length;
    }
    if (saveBtn) {
      saveBtn.style.display = 'inline-flex';
      saveBtn.disabled = !!segments.length;
    }
  }
}

let kcfPendingSaveStudentPicker = { itemId:'', selectedStudentId:'', source:'inbox' };
function getKinderChatFeedbackSaveStudentCandidates(studentName, studentDivision = 'elementary') {
  const name = String(studentName || '').trim();
  const type = studentDivision === 'kinder' ? 'kinder' : 'elementary';
  if (!name || typeof getAllStudents !== 'function') return [];
  return getAllStudents().filter(student =>
    String(student.name || '').trim() === name &&
    (student.type || 'elementary') === type
  );
}
function getKinderChatFeedbackStudentMetaLine(student = {}) {
  const parts = [
    student.kindergarten || student.kindergartenName || student.school || student.kinder || '',
    student.age || student.studentAge || student.birthAge || '',
    student.teacher || student.homeroom_teacher || student.homeroomTeacher || student.teacherName || '',
    student.lesson_day || student.lessonDay || student.days || student.day || ''
  ].map(value => String(value || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' · ') : '학생정보 없음';
}
function openKinderChatFeedbackSaveStudentPicker(itemId, candidates = [], source = 'inbox') {
  const overlay = document.getElementById('kcfSaveStudentPickerOverlay');
  const list = document.getElementById('kcfSaveStudentPickerList');
  if (!overlay || !list || !candidates.length) return;
  kcfPendingSaveStudentPicker = {
    itemId:String(itemId || ''),
    selectedStudentId:String(candidates[0].id || ''),
    source:source === 'live' ? 'live' : 'inbox'
  };
  list.innerHTML = candidates.map((student, index) => {
    const id = String(student.id || '');
    const active = index === 0 ? ' active' : '';
    return `<button type="button" class="kcfSaveStudentOption${active}" data-student-id="${escapeHtml(id)}" onclick="selectKinderChatFeedbackSaveStudent('${escapeHtml(id)}')">
      <span class="kcfSaveStudentCheck" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg></span>
      <span><span class="kcfSaveStudentName">${escapeHtml(student.name || '')}</span><span class="kcfSaveStudentMeta">${escapeHtml(getKinderChatFeedbackStudentMetaLine(student))}</span></span>
    </button>`;
  }).join('');
  overlay.classList.add('show');
}
function selectKinderChatFeedbackSaveStudent(studentId) {
  kcfPendingSaveStudentPicker.selectedStudentId = String(studentId || '');
  document.querySelectorAll('#kcfSaveStudentPickerOverlay .kcfSaveStudentOption').forEach(btn => {
    btn.classList.toggle('active', String(btn.dataset.studentId || '') === String(studentId || ''));
  });
}
function closeKinderChatFeedbackSaveStudentPicker(event) {
  if (event && event.target && event.target.id !== 'kcfSaveStudentPickerOverlay') return;
  const overlay = document.getElementById('kcfSaveStudentPickerOverlay');
  if (overlay) overlay.classList.remove('show');
}
function confirmKinderChatFeedbackSaveStudentPicker() {
  const itemId = kcfPendingSaveStudentPicker.itemId;
  const selectedId = kcfPendingSaveStudentPicker.selectedStudentId;
  const source = kcfPendingSaveStudentPicker.source || 'inbox';
  closeKinderChatFeedbackSaveStudentPicker();
  if (!itemId || !selectedId) return;
  if (source === 'live') saveKinderChatFeedbackLive(itemId, null, selectedId);
  else saveTodayFeedbackItem(itemId, null, selectedId);
}

function submitKinderChatFeedbackGrowthSheet() {
  try {
    const userText = buildKinderChatFeedbackGrowthUserText();
    const hasMeaningful = userText.replace('[실패·성장 설문 정리]', '').replace(/추가메모:\s*없음/g, '').trim();
    if (!hasMeaningful) {
      setKinderChatFeedbackWarning('실패-성장 피드백 내용을 먼저 선택하거나 입력해 주세요.');
      return;
    }
    const name = document.getElementById('kcfgA1')?.value.trim() || '';
  if (!name) {
    alert('아이 이름을 입력해 주세요.');
    return;
  }
    closeKinderChatFeedbackGrowthSheet();
    addKinderChatDocumentMessage(name, '실패-성장 피드백', '실패-성장 피드백 설문', 'growth');
    if (getKinderChatFeedbackTopMode() !== 'live') {
      addKinderChatMessage('bot', '실패-성장 피드백 내용을 부모님께 잘 전달될 수 있도록 정리해둘게요.');
    }
    startTodayFeedbackRequest({
      promptType:'fail',
      userText,
      studentName: normalizeTodayFeedbackStudentName(name),
      studentId: String(window.__kcfSelectedStudentId || ''),
      studentDivision:'kinder',
      feedbackType:'fail',
      label:'유치부 실패-성장 피드백',
      sourcePage:'kinderChatFeedback',
      silent:true
    });
    resetKinderChatFeedbackGrowthSheet();
    updateKinderChatFeedbackBadge();
  } catch (error) {
    console.error('submitKinderChatFeedbackGrowthSheet failed', error);
    setKinderChatFeedbackWarning('실패-성장 피드백 생성 중 오류가 생겼어요. 다시 확인해 주세요.');
    try { showPushToast('실패-성장 피드백 생성 중 오류가 생겼어요.'); } catch(e) {}
  }
}
document.addEventListener('DOMContentLoaded', () => {
  bindKinderChatFeedbackViewportInteractions();
  const input = document.getElementById('kcfInput');
  if (input) {
    loadKinderChatFeedbackDraft();
    input.addEventListener('pointerdown', event => {
      const teacherMode = getKinderChatFeedbackTeacherMode();
      const teacherEnabled = !!(teacherMode && typeof teacherMode.isEnabled === 'function' && teacherMode.isEnabled());
      const teacherSheet = window.KcfTeacherSheet;
      if (!teacherEnabled || !teacherSheet || typeof teacherSheet.open !== 'function') return;
      if (typeof teacherSheet.isOpen === 'function' && teacherSheet.isOpen()) return;
      event.preventDefault();
      teacherSheet.open();
    });
    input.addEventListener('input', () => {
      autoResizeKinderChatFeedbackInput(input);
      saveKinderChatFeedbackDraft();
      setKinderChatFeedbackWarning('');
    });
    input.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        submitKinderChatFeedback();
      }
    });
  }
  document.querySelectorAll('.kcfKeywordBtn').forEach(btn => {
    btn.setAttribute('tabindex', '-1');
    const keepInputAlive = event => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const currentInput = document.getElementById('kcfInput');
      if (currentInput && document.activeElement === currentInput) {
        kcfKeepInputFocusUntil = Date.now() + 1400;
      }
    };
    const activateKeyword = event => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const currentInput = document.getElementById('kcfInput');
      if (currentInput && document.activeElement === currentInput) {
        kcfKeepInputFocusUntil = Date.now() + 1400;
      }
      toggleKinderChatFeedbackKeyword(btn.getAttribute('data-kcf-keyword'), btn);

    };
    btn.addEventListener('pointerdown', keepInputAlive);
    btn.addEventListener('click', activateKeyword);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest || !event.target.closest('.kcfHeaderCenter')) closeKinderChatFeedbackModeMenu();
  });
  updateKinderChatFeedbackBadge();
  scheduleKinderChatFeedbackVivicotBubbleMidnightReset();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  updateKinderChatFeedbackBadge();
  scheduleKinderChatFeedbackVivicotBubbleMidnightReset();
});
window.warmKinderChatFeedbackPromptCache = warmKinderChatFeedbackPromptCache;
window.addEventListener('pageshow', () => {
  updateKinderChatFeedbackBadge();
  scheduleKinderChatFeedbackVivicotBubbleMidnightReset();
});

let kcfStudentManageMode = false;
let kcfStudentManageSortDay = '';
let kcfStudentManageDivision = 'elementary';
let kcfStudentManageTeacherOnly = false;
const KCF_STUDENT_MANAGE_DAYS = ['월','화','수','목','금','토','일'];
const KCF_STUDENT_MANAGE_SORT_KEY_PREFIX = 'olli_kcf_student_manage_sort_v1';
const KCF_FEEDBACK_DOT_STORAGE_PREFIX = 'olli_kcf_feedback_student_dots_v1';
let kcfStudentManagePrefsAppliedKey = '';

function kcfNormalizeStudentType(student) {
  if (typeof normalizeKcfStudentType === 'function') return normalizeKcfStudentType(student);
  const raw = String(student?.type || student?.division || '').trim().toLowerCase();
  return raw === 'kinder' || raw === '유치부' ? 'kinder' : 'elementary';
}
function kcfNormalizeTeacher(value) {
  return String(value || '').replace(/선생님/g, '').replace(/담임/g, '').replace(/T$/i, '').trim();
}
function kcfCurrentTeacherNames() {
  const values = [];
  try { values.push(localStorage.getItem('olli_current_member_name') || ''); } catch(e) {}
  try { values.push(localStorage.getItem('olli_pending_teacher_name') || ''); } catch(e) {}
  return Array.from(new Set(values.map(kcfNormalizeTeacher).filter(Boolean)));
}
function kcfStudentTeacherNames(student) {
  return [student?.teacher, student?.homeroom_teacher, student?.teacher_name, student?.teacherName, student?.homeroomTeacher]
    .map(kcfNormalizeTeacher).filter(Boolean);
}
function kcfIsCurrentTeacherStudent(student) {
  const currentNames = kcfCurrentTeacherNames();
  if (!currentNames.length) return false;
  return kcfStudentTeacherNames(student).some(name => currentNames.includes(name));
}
function kcfGradeOrAgeSortValue(student) {
  const raw = kcfNormalizeStudentType(student) === 'kinder'
    ? (student?.age || student?.studentAge || student?.birthAge || '')
    : (student?.grade || student?.school_grade || student?.class_grade || '');
  const n = Number(String(raw).replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 999;
}
function getKcfAllActiveStudents() {
  if (typeof getAllStudents !== 'function') return [];
  return getAllStudents().filter(student => {
    if (!student) return false;
    try { if (typeof getStudentStatus === 'function') return getStudentStatus(student) === 'active'; } catch(e) {}
    const status = String(student.status || 'active').trim().toLowerCase();
    return !['inactive','withdrawn','paused','deleted','removed'].includes(status);
  });
}
function getKcfStudentManageScopeId() {
  try {
    if (typeof getOlliCurrentAcademyId === 'function') return String(getOlliCurrentAcademyId() || '').trim() || 'unscoped';
  } catch(e) {}
  return 'unscoped';
}
function getKcfStudentManageSortStorageKey() {
  return `${KCF_STUDENT_MANAGE_SORT_KEY_PREFIX}_${getKcfStudentManageScopeId()}`;
}
function readKinderChatFeedbackStudentManageSortPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(getKcfStudentManageSortStorageKey()) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch(e) { return null; }
}
function saveKinderChatFeedbackStudentManageSortPrefs() {
  try {
    localStorage.setItem(getKcfStudentManageSortStorageKey(), JSON.stringify({
      division: kcfStudentManageDivision === 'kinder' ? 'kinder' : 'elementary',
      teacherOnly: kcfStudentManageTeacherOnly === true,
      sortDay: KCF_STUDENT_MANAGE_DAYS.includes(kcfStudentManageSortDay) ? kcfStudentManageSortDay : '',
      savedAt: new Date().toISOString()
    }));
  } catch(err) { console.warn('1분 피드백 원생목록 정렬 저장 실패:', err); }
}
function applyKinderChatFeedbackStudentManageSortPrefs(force = false) {
  const key = getKcfStudentManageSortStorageKey();
  if (!force && kcfStudentManagePrefsAppliedKey === key) return;
  const prefs = readKinderChatFeedbackStudentManageSortPrefs();
  if (prefs) {
    kcfStudentManageDivision = prefs.division === 'kinder' ? 'kinder' : 'elementary';
    kcfStudentManageTeacherOnly = prefs.teacherOnly === true;
    kcfStudentManageSortDay = KCF_STUDENT_MANAGE_DAYS.includes(prefs.sortDay) ? prefs.sortDay : '';
  }
  kcfStudentManagePrefsAppliedKey = key;
}

function getKcfDotStorageKey() { return `${KCF_FEEDBACK_DOT_STORAGE_PREFIX}_${getKcfStudentManageScopeId()}`; }
function getKcfDotMonthKey(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, '0')}`;
}
function readKcfDotStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(getKcfDotStorageKey()) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch(e) { return {}; }
}
function writeKcfDotStore(store) {
  try { localStorage.setItem(getKcfDotStorageKey(), JSON.stringify(store && typeof store === 'object' ? store : {})); }
  catch(err) { console.warn('1분 피드백 완료 점 저장 실패:', err); }
}
function markKcfStudentFeedbackSent(studentId, dateValue) {
  const id = String(studentId || '').trim();
  if (!id) return;
  const monthKey = getKcfDotMonthKey(dateValue);
  const store = readKcfDotStore();
  const current = Array.isArray(store[monthKey]) ? store[monthKey].map(String) : [];
  if (!current.includes(id)) current.push(id);
  store[monthKey] = current;
  writeKcfDotStore(store);
  try { refreshKinderChatFeedbackStudentManagePopupIfOpen(); } catch(e) {}
}
function itemDateMatchesCurrentKcfMonth(item) {
  const explicitMonth = Number(item?.feedbackMonthNumber || item?.feedback_month_number || item?.monthNumber || 0);
  if (explicitMonth && explicitMonth === new Date().getMonth() + 1) return true;
  const dateKey = String(item?.dateKey || item?.createdAt || item?.updatedAt || item?.savedAt || '');
  if (!dateKey) return false;
  const d = new Date(dateKey);
  return Number.isNaN(d.getTime()) ? dateKey.slice(0, 7) === getKcfDotMonthKey() : getKcfDotMonthKey(d) === getKcfDotMonthKey();
}
function hasKcfStudentFeedbackSent(student) {
  const id = String(student?.id || '').trim();
  if (!id) return false;
  const store = readKcfDotStore();
  if ((Array.isArray(store[getKcfDotMonthKey()]) ? store[getKcfDotMonthKey()].map(String) : []).includes(id)) return true;
  try {
    const items = typeof getTodayFeedbackItemsRaw === 'function' ? getTodayFeedbackItemsRaw() : [];
    return (Array.isArray(items) ? items : []).some(item => {
      const status = String(item?.status || '').trim();
      const completed = status === 'done' || status === 'review' || item?.saved === true;
      return item?.sourcePage === 'kinderChatFeedback' &&
        String(item?.studentId || item?.savedStudentId || item?.student_id || '').trim() === id &&
        itemDateMatchesCurrentKcfMonth(item) &&
        completed;
    });
  } catch(e) { return false; }
}
function renderKcfRosterFeedbackDot(student) {
  return `<span class="memoStudentFeedbackDot kcfRosterFeedbackDot ${hasKcfStudentFeedbackSent(student) ? 'completed' : ''}" aria-hidden="true"></span>`;
}

function isKinderChatFeedbackStudentManageMode() {
  return kcfStudentManageMode === true;
}
function getKinderChatFeedbackStudentManageStudents() {
  applyKinderChatFeedbackStudentManageSortPrefs(false);
  let students = getKcfAllActiveStudents().filter(student => kcfNormalizeStudentType(student) === kcfStudentManageDivision);
  if (kcfStudentManageTeacherOnly) students = students.filter(kcfIsCurrentTeacherStudent);
  if (kcfStudentManageSortDay) students = students.filter(student => kinderChatFeedbackStudentMatchesDay(student, kcfStudentManageSortDay));
  return students.slice().sort((a, b) => {
    const gradeA = kcfGradeOrAgeSortValue(a);
    const gradeB = kcfGradeOrAgeSortValue(b);
    if (gradeA !== gradeB) return gradeA - gradeB;
    const teacherResult = (kcfStudentTeacherNames(a)[0] || '').localeCompare(kcfStudentTeacherNames(b)[0] || '', 'ko');
    if (teacherResult !== 0) return teacherResult;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');
  });
}
function kinderChatFeedbackStudentMatchesDay(student, day) {
  const dayText = [student?.lesson_day, student?.lessonDay, student?.days, student?.day]
    .map(value => String(value || '').trim()).filter(Boolean).join(' ');
  return !!day && dayText.includes(day);
}
function renderKinderChatFeedbackStudentManageHeader() {
  const manageMode = isKinderChatFeedbackStudentManageMode();
  const division = kcfStudentManageDivision;
  return `<div class="memoStudentSelectHeader">
    <div class="kcfStudentDivisionTabs" aria-label="원생 구분">
      <button type="button" class="kcfStudentDivisionBtn ${division === 'elementary' ? 'active' : ''}" onclick="setKinderChatFeedbackStudentManageDivision('elementary', event)">초등부</button>
      <button type="button" class="kcfStudentDivisionBtn ${division === 'kinder' ? 'active' : ''}" onclick="setKinderChatFeedbackStudentManageDivision('kinder', event)">유치부</button>
    </div>
    <button type="button" class="memoStudentSettingsIconBtn ${manageMode ? 'active' : ''}" onclick="toggleKinderChatFeedbackStudentManageMode(event)" aria-label="원생 설정" title="원생 설정">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 0 1 7.1 4l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 0 1 19.9 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"></path></svg>
    </button>
  </div>`;
}
function renderKinderChatFeedbackStudentManageControls() {
  if (isKinderChatFeedbackStudentManageMode()) {
    return `<div class="memoStudentSortPanel memoStudentManagePanel"><div class="memoStudentSortManageRow"><button type="button" class="memoStudentManageChip memoStudentAddChip" onclick="openKinderChatFeedbackStudentAddFromManage(event)" aria-label="원생 등록">+</button></div></div>`;
  }
  const teacherButton = `<button type="button" class="memoStudentSortChip kcfRosterTeacherChip ${kcfStudentManageTeacherOnly ? 'active' : ''}" onclick="toggleKinderChatFeedbackStudentManageTeacherOnly(event)">담임</button>`;
  const dayButtons = KCF_STUDENT_MANAGE_DAYS.map(day => `<button type="button" class="memoStudentSortChip memoStudentDaySortChip ${kcfStudentManageSortDay === day ? 'active' : ''}" onclick="toggleKinderChatFeedbackStudentManageDay('${day}', event)">${day}</button>`).join('');
  return `<div class="memoStudentSortPanel"><div class="memoStudentSortDayRow kcfRosterSortRow">${teacherButton}${dayButtons}</div></div>`;
}
function renderKinderChatFeedbackStudentManagePopup() {
  const popup = document.getElementById('kcfStudentManagePopup');
  if (!popup) return;
  applyKinderChatFeedbackStudentManageSortPrefs(false);
  const manageMode = isKinderChatFeedbackStudentManageMode();
  const students = getKinderChatFeedbackStudentManageStudents();
  const header = renderKinderChatFeedbackStudentManageHeader();
  const controls = renderKinderChatFeedbackStudentManageControls();
  if (!students.length) {
    let emptyText = kcfStudentManageDivision === 'kinder' ? '등록된 유치부 학생이 없습니다.' : '등록된 초등부 학생이 없습니다.';
    if (kcfStudentManageTeacherOnly && !kcfCurrentTeacherNames().length) emptyText = '현재 담임 이름을 확인할 수 없습니다.';
    else if (kcfStudentManageTeacherOnly) emptyText = '내 담당 학생이 없습니다.';
    else if (kcfStudentManageSortDay && !manageMode) emptyText = `${kcfStudentManageSortDay}요일 등원 학생이 없습니다.`;
    popup.innerHTML = `${header}<div class="memoStudentSelectList"><div class="memoStudentSelectEmpty">${escapeHtml(emptyText)}</div></div>${controls}`;
    return;
  }
  const rows = students.map(student => {
    const studentId = escapeHtml(String(student?.id || ''));
    const meta = getKinderChatFeedbackStudentMetaLine(student);
    const nameLabel = typeof getKcfStudentPickerName === 'function' ? getKcfStudentPickerName(student) : (student?.name || '이름 없음');
    const dot = manageMode ? '' : renderKcfRosterFeedbackDot(student);
    const textBlock = `${dot}<span class="memoStudentSelectName">${escapeHtml(nameLabel)}</span>${meta ? `<span class="memoStudentSelectMeta">${escapeHtml(meta)}</span>` : ''}`;
    if (manageMode) return `<div class="memoStudentSelectOption manageMode"><span class="memoStudentSelectTextBlock">${textBlock}</span><button type="button" class="memoStudentInfoDotsBtn" onclick="openKinderChatFeedbackStudentInfoFromManage('${studentId}', event)" aria-label="학생정보 수정">•••</button></div>`;
    return `<div class="memoStudentSelectOption"><button type="button" class="memoStudentSelectNameBtn" onclick="selectKinderChatFeedbackStudentFromManage('${studentId}', event)">${textBlock}</button></div>`;
  }).join('');
  popup.innerHTML = `${header}<div class="memoStudentSelectList">${rows}</div>${controls}`;
}
function openKinderChatFeedbackStudentManagePopup() {
  const popup = document.getElementById('kcfStudentManagePopup');
  if (!popup) return;
  applyKinderChatFeedbackStudentManageSortPrefs(false);
  renderKinderChatFeedbackStudentManagePopup();
  popup.classList.add('show');
}
function toggleKinderChatFeedbackStudentManagePopup(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const popup = document.getElementById('kcfStudentManagePopup');
  if (!popup) return;
  applyKinderChatFeedbackStudentManageSortPrefs(false);
  renderKinderChatFeedbackStudentManagePopup();
  popup.classList.toggle('show');
}
function closeKinderChatFeedbackStudentManagePopup() {
  const popup = document.getElementById('kcfStudentManagePopup');
  if (popup) popup.classList.remove('show');
}
function refreshKinderChatFeedbackStudentManagePopupIfOpen() {
  const popup = document.getElementById('kcfStudentManagePopup');
  if (popup && popup.classList.contains('show')) renderKinderChatFeedbackStudentManagePopup();
}
function toggleKinderChatFeedbackStudentManageMode(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  kcfStudentManageMode = !kcfStudentManageMode;
  refreshKinderChatFeedbackStudentManagePopupIfOpen();
}
function getKinderChatFeedbackStudentManageDivision() {
  applyKinderChatFeedbackStudentManageSortPrefs(false);
  return kcfStudentManageDivision === 'kinder' ? 'kinder' : 'elementary';
}
function setKinderChatFeedbackStudentManageDivision(division, event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const next = division === 'kinder' ? 'kinder' : 'elementary';
  if (kcfStudentManageDivision !== next) {
    kcfStudentManageDivision = next;
    kcfStudentManageSortDay = '';
    const selected = getKinderChatFeedbackManualSelection();
    if (selected && selected.studentDivision !== next) clearKinderChatFeedbackManualSelection();
  }
  saveKinderChatFeedbackStudentManageSortPrefs();
  refreshKinderChatFeedbackStudentManagePopupIfOpen();
  const teacherMode = getKinderChatFeedbackTeacherMode();
  if (teacherMode && typeof teacherMode.preloadRoster === 'function') {
    teacherMode.preloadRoster({ force:true });
  }
}
function toggleKinderChatFeedbackStudentManageTeacherOnly(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  kcfStudentManageTeacherOnly = !kcfStudentManageTeacherOnly;
  saveKinderChatFeedbackStudentManageSortPrefs();
  refreshKinderChatFeedbackStudentManagePopupIfOpen();
}
function toggleKinderChatFeedbackStudentManageDay(day, event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  kcfStudentManageSortDay = kcfStudentManageSortDay === day ? '' : day;
  saveKinderChatFeedbackStudentManageSortPrefs();
  refreshKinderChatFeedbackStudentManagePopupIfOpen();
}

function selectKinderChatFeedbackStudentFromManage(studentId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const student = typeof findStudentById === 'function' ? findStudentById(studentId) : null;
  if (!student) return;
  const teacherMode = getKinderChatFeedbackTeacherMode();
  if (teacherMode && typeof teacherMode.disableForManualSelection === 'function') {
    teacherMode.disableForManualSelection();
  }
  setKinderChatFeedbackManualSelection(student);
  const input = document.getElementById('kcfInput');
  if (input) {
    if (String(input.value || '').trim() === '학생') input.value = '';
    autoResizeKinderChatFeedbackInput(input);
    saveKinderChatFeedbackDraft();
    setKinderChatFeedbackWarning('');
    try { input.focus({ preventScroll:true }); }
    catch (_) { input.focus(); }
  }
  closeKinderChatFeedbackStudentManagePopup();
}

function openKinderChatFeedbackStudentAddFromManage(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const targetView = kcfStudentManageDivision === 'kinder' ? 'kinder' : 'elementary';
  currentRecordView = targetView;
  currentObservationView = targetView;
  openStudentModal();
}

function openKinderChatFeedbackStudentInfoFromManage(studentId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const student = typeof findStudentById === 'function' ? findStudentById(studentId) : null;
  if (!student) return;
  studentInfoModalTarget = student;
  if ((student.type || 'kinder') === 'elementary') openElementaryInfoModal();
  else openKinderInfoModal();
}

function isKinderChatFeedbackStudentManageOutsideTarget(target) {
  const wrap = document.getElementById('kcfStudentManageWrap');
  if (!wrap || !target) return false;
  if (target.closest && target.closest('#studentModal, #elementaryInfoModal, #kinderInfoModal')) return false;
  return !wrap.contains(target);
}

document.addEventListener('click', event => {
  const popup = document.getElementById('kcfStudentManagePopup');
  if (!popup || !popup.classList.contains('show')) return;
  if (isKinderChatFeedbackStudentManageOutsideTarget(event.target)) closeKinderChatFeedbackStudentManagePopup();
});

window.openKinderChatFeedbackPage = openKinderChatFeedbackPage;
window.closeKinderChatFeedbackPage = closeKinderChatFeedbackPage;
window.openKinderChatFeedbackStudentManagePopup = openKinderChatFeedbackStudentManagePopup;
window.getKinderChatFeedbackStudentManageDivision = getKinderChatFeedbackStudentManageDivision;
window.getKinderChatFeedbackManualSelection = getKinderChatFeedbackManualSelection;
window.setKinderChatFeedbackManualSelection = setKinderChatFeedbackManualSelection;
window.clearKinderChatFeedbackManualSelection = clearKinderChatFeedbackManualSelection;
window.openKinderChatFeedbackInbox = openKinderChatFeedbackInbox;
window.closeKinderChatFeedbackInbox = closeKinderChatFeedbackInbox;
window.editKinderChatFeedbackInboxItem = editKinderChatFeedbackInboxItem;
window.cancelKinderChatFeedbackInboxEdit = cancelKinderChatFeedbackInboxEdit;
window.deleteKinderChatFeedbackInboxItem = deleteKinderChatFeedbackInboxItem;
window.confirmKinderChatFeedbackInboxEdit = confirmKinderChatFeedbackInboxEdit;
window.toggleKinderChatFeedbackInboxItem = toggleKinderChatFeedbackInboxItem;
window.updateKinderChatFeedbackBadge = updateKinderChatFeedbackBadge;
window.renderKinderChatFeedbackInbox = renderKinderChatFeedbackInbox;
window.setKinderChatFeedbackPersistentTopVisible = setKinderChatFeedbackPersistentTopVisible;
window.toggleKinderChatFeedbackModeMenu = toggleKinderChatFeedbackModeMenu;
window.switchKinderChatFeedbackMode = switchKinderChatFeedbackMode;
window.closeKinderChatFeedbackModeMenu = closeKinderChatFeedbackModeMenu;
window.openKinderChatFeedbackSaveStudentPicker = openKinderChatFeedbackSaveStudentPicker;
window.closeKinderChatFeedbackSaveStudentPicker = closeKinderChatFeedbackSaveStudentPicker;
window.selectKinderChatFeedbackSaveStudent = selectKinderChatFeedbackSaveStudent;
window.confirmKinderChatFeedbackSaveStudentPicker = confirmKinderChatFeedbackSaveStudentPicker;
window.toggleMemoFeedbackArchiveCard = toggleMemoFeedbackArchiveCard;
window.openElementaryGrowthFeedbackSheet = openElementaryGrowthFeedbackSheet;
window.closeElementaryGrowthFeedbackSheet = closeElementaryGrowthFeedbackSheet;
window.submitElementaryGrowthFeedbackSheet = submitElementaryGrowthFeedbackSheet;
window.selectElementaryGrowthFeedbackSingle = selectElementaryGrowthFeedbackSingle;
window.toggleElementaryGrowthFeedbackMulti = toggleElementaryGrowthFeedbackMulti;
window.openKinderChatFeedbackGrowthSheet = openKinderChatFeedbackGrowthSheet;
window.closeKinderChatFeedbackGrowthSheet = closeKinderChatFeedbackGrowthSheet;
window.submitKinderChatFeedbackGrowthSheet = submitKinderChatFeedbackGrowthSheet;
window.selectKinderChatFeedbackGrowthSingle = selectKinderChatFeedbackGrowthSingle;
window.toggleKinderChatFeedbackGrowthMulti = toggleKinderChatFeedbackGrowthMulti;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreKinderChatFeedbackTopMode);
} else {
  restoreKinderChatFeedbackTopMode();
}
window.startKinderChatFeedbackLiveRequest = startKinderChatFeedbackLiveRequest;
window.getKinderChatFeedbackTopMode = getKinderChatFeedbackTopMode;
window.setKinderChatFeedbackTopMode = setKinderChatFeedbackTopMode;
window.toggleKinderChatFeedbackTopMode = toggleKinderChatFeedbackTopMode;


if (!window.__kcfLiveSessionLifecycleBound) {
  window.__kcfLiveSessionLifecycleBound = true;
  window.addEventListener('pagehide', () => {
    try { persistKinderChatFeedbackLiveSessionNow(); } catch(e) {}
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { persistKinderChatFeedbackLiveSessionNow(); } catch(e) {}
    } else if (document.visibilityState === 'visible') {
      const page = document.getElementById('kinderChatFeedbackScreen');
      if (page && page.style.display !== 'none') restoreKinderChatFeedbackLiveSession();
    }
  });
}
window.restoreKinderChatFeedbackLiveSession = restoreKinderChatFeedbackLiveSession;
window.persistKinderChatFeedbackLiveSessionNow = persistKinderChatFeedbackLiveSessionNow;
