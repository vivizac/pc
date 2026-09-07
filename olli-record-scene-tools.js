function renderMemoModeMenu() {
  const menu = document.getElementById('memoModeDropup');
  if (!menu) return;
  const checkSvg = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
  const option = (active, title, guide, action) => `
    <button type="button" class="memoRecordOption ${active ? 'active' : ''}" onclick="${action}">
      <span class="memoModeCheck" aria-hidden="true">${active ? checkSvg : ''}</span>
      <span class="memoModeOptionText">
        <span class="memoModeOptionTitle">${title}</span>
        <span class="memoModeOptionGuide">${guide}</span>
      </span>
    </button>`;
  menu.innerHTML = `
    ${option(false, '1분 피드백(유치부)', '일상 관찰을 빠르게 정리', "closeMemoModeMenu(); openKinderChatFeedbackPage();")}
    ${option(false, '성장 피드백(유치부)', '막힘·전환 장면을 깊게 정리', "closeMemoModeMenu(); openKinderChatFeedbackGrowthSheet();")}
    ${option(true, '관찰 노트(초등부)', '초등부 관찰노트로 이동', "closeMemoModeMenu(); openMemoObservationMode(event);")}
  `;
}
function closeMemoModeMenu() { const menu = document.getElementById('memoModeDropup'); if (menu) menu.classList.remove('show'); }
function toggleMemoModeMenu(event) {
  if (event) event.stopPropagation();
  if (currentMemoType === 'kinder') return;
  renderMemoModeMenu();
  const menu = document.getElementById('memoModeDropup');
  if (menu) menu.classList.toggle('show');
}
function closeGlobalFeedbackModeMenus() {
  ['mainCardModeDropup'].forEach(id => {
    const menu = document.getElementById(id);
    if (menu) menu.classList.remove('show');
  });
}
function renderGlobalFeedbackModeMenu(active = 'main') {
  const make = (target) => {
    const menu = document.getElementById('mainCardModeDropup');
    if (!menu) return;

    menu.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'memoRecordsTitle';
    title.textContent = '노트 선택';
    menu.appendChild(title);

    const observationBtn = document.createElement('button');
    observationBtn.type = 'button';
    observationBtn.className = 'memoRecordOption ' + (active === 'main' ? 'active' : '');
    observationBtn.textContent = '1분 피드백';
    observationBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof closeGlobalFeedbackModeMenus === 'function') closeGlobalFeedbackModeMenus();
      if (typeof openGlobalObservationMode === 'function') openGlobalObservationMode(e);
    });
    menu.appendChild(observationBtn);

    const growthBtn = document.createElement('button');
    growthBtn.type = 'button';
    growthBtn.className = 'memoRecordOption ' + (active === 'fail' ? 'active' : '');
    growthBtn.textContent = '성장 피드백';
    growthBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof closeGlobalFeedbackModeMenus === 'function') closeGlobalFeedbackModeMenus();
      if (active !== 'fail' && typeof openGlobalFailGrowthMode === 'function') {
        openGlobalFailGrowthMode(e);
      }
    });
    menu.appendChild(growthBtn);
  };
  make('main');
}
function toggleGlobalFeedbackModeMenu(event, active = 'main') {
  if (event) event.stopPropagation();
  renderGlobalFeedbackModeMenu(active);
  const id = 'mainCardModeDropup';
  const menu = document.getElementById(id);
  if (!menu) return;
  const willOpen = !menu.classList.contains('show');
  closeGlobalFeedbackModeMenus();
  if (willOpen) menu.classList.add('show');
}
function openGlobalObservationMode(event) {
  if (event) event.stopPropagation();
  closeGlobalFeedbackModeMenus();
}
function openGlobalFailGrowthMode(event) {
  if (event) event.stopPropagation();
  closeGlobalFeedbackModeMenus();
  if (typeof openKinderChatFeedbackGrowthSheet === 'function') {
    openKinderChatFeedbackGrowthSheet();
    return;
  }
  alert('성장피드백은 새 버전으로 준비 중입니다.');
}
function openMemoObservationMode(event) { if (event) event.stopPropagation(); closeMemoModeMenu(); const memo = document.getElementById('studentMemoScreen'); if (memo) memo.style.display = 'flex'; if (typeof forceStudentMemoControlsVisible === 'function') { forceStudentMemoControlsVisible(); requestAnimationFrame(forceStudentMemoControlsVisible); } }
function openMemoFailGrowthMode(event) {
  if (event) event.stopPropagation();
  closeMemoModeMenu();
  if (typeof openElementaryGrowthFeedbackSheet === 'function') {
    openElementaryGrowthFeedbackSheet();
    return;
  }
  alert('초등부 성장피드백을 열 수 없습니다.');
}
document.addEventListener('click', (event) => { const wrap = document.getElementById('memoModeWrap'); if (wrap && !wrap.contains(event.target)) closeMemoModeMenu(); });
document.addEventListener('click', (event) => {
  const mainWrap = document.getElementById('mainCardModeWrap');
  if (!mainWrap || !mainWrap.contains(event.target)) closeGlobalFeedbackModeMenus();
});

const SCENE_CARD_OPTIONS = [
  { id:'start', no:1, title:'시작 반응', question:'주제를 들었을 때 아이의 첫 표정과 말은?', main:'주제를 들었을 때 아이의 첫 반응은 어땠나요?', sub:'그 반응이 수업 흐름에 어떤 영향을 주었나요?', keywords:['첫 반응','표정','망설임','기대','긴장'], color:'#e8a66b', bg:'#fff5eb' },
  { id:'words', no:2, title:'아이의 말', question:'오늘 남기고 싶은 아이의 한마디는?', main:'오늘 아이가 한 말 중 기억나는 문장은 무엇인가요?', sub:'그 말 안에 아이의 감정이나 생각이 어떻게 담겨 있었나요?', keywords:['발화','생각','감정','질문','표현'], color:'#6caed6', bg:'#edf7ff' },
  { id:'choice', no:3, title:'선택', question:'아이가 스스로 고른 색·재료·방법은?', main:'오늘 아이가 스스로 선택한 것은 무엇인가요?', sub:'그 선택이 아이의 주도성이나 자신감과 어떻게 연결되었나요?', keywords:['선택','주도성','결정','취향','자기표현'], color:'#78b965', bg:'#f3fbef' },
  { id:'difficulty', no:4, title:'어려움', question:'잠시 망설이거나 힘들어한 순간은?', main:'오늘 아이가 어려움을 느낀 순간은 어디였나요?', sub:'그 어려움은 기술, 감정, 이해, 관계 중 어디에 가까웠나요?', keywords:['막힘','망설임','불안','난이도','도움'], color:'#d9bf3f', bg:'#fffbe8' },
  { id:'retry', no:5, title:'다시 시도', question:'어려움 뒤에 아이는 어떻게 해보았나요?', main:'어려움 뒤에 아이는 어떻게 다시 시작했나요?', sub:'선생님의 어떤 말이나 도움 뒤에 변화가 생겼나요?', keywords:['재도전','회복','용기','수정','지속'], color:'#a77ad1', bg:'#f7f0ff' },
  { id:'material', no:6, title:'재료 반응', question:'재료를 만났을 때 아이의 감각 반응은?', main:'재료를 만났을 때 아이는 어떻게 반응했나요?', sub:'그 반응이 몰입, 탐색, 표현으로 이어졌나요?', keywords:['재료','감각','탐색','흥미','표현'], color:'#4db58f', bg:'#effbf6' },
  { id:'focus', no:7, title:'몰입', question:'가장 오래 빠져든 순간은 언제였나요?', main:'오늘 아이가 가장 몰입한 순간은 언제였나요?', sub:'무엇이 아이의 집중을 오래 유지하게 했나요?', keywords:['몰입','집중','지속','흥미','깊이'], color:'#db74a0', bg:'#fff1f6' },
  { id:'relation', no:8, title:'관계', question:'친구·선생님과 함께한 따뜻한 장면은?', main:'오늘 관계 안에서 기억나는 장면은 무엇인가요?', sub:'친구나 선생님과의 상호작용이 아이에게 어떤 힘이 되었나요?', keywords:['관계','공감','협력','대화','신뢰'], color:'#6e86cf', bg:'#f1f4ff' },
  { id:'growth', no:9, title:'성장', question:'이전보다 달라진 작은 변화는?', main:'이전보다 달라진 작은 변화는 무엇인가요?', sub:'그 변화가 앞으로 어떤 성장으로 이어질 수 있을까요?', keywords:['성장','변화','자신감','가능성','다음 단계'], color:'#9b9b42', bg:'#fbfbef' }
];
let sceneCardsVisible = false;
const selectedSceneIds = new Set();
const flippedSceneIds = new Set();
const SCENE_MEMO_LABELS = {
  start: '시작 반응 :',
  words: '오늘 아이가 한 말 :',
  choice: '아이의 선택 :',
  difficulty: '어려움 :',
  retry: '다시 시도 :',
  material: '재료 반응 :',
  focus: '몰입한 순간 :',
  relation: '관계 형성 순간 :',
  growth: '성장 장면 :'
};
let previousScreenBeforeRecordRoom = 'mainPage';
function getSceneById(id) { return SCENE_CARD_OPTIONS.find(item => item.id === id); }
function renderSceneInput() {
  const area = document.getElementById('sceneInputArea');
  const tagArea = document.getElementById('sceneTagArea');
  const toggleBtn = document.getElementById('sceneModeToggleBtn');
  if (area) area.innerHTML = '';
  if (tagArea) tagArea.innerHTML = '';
  if (toggleBtn) {
    const opened = isSceneCardModalOpen();
    toggleBtn.classList.toggle('active', opened);
    toggleBtn.title = opened ? '장면카드 닫기' : '장면카드 열기';
    toggleBtn.setAttribute('aria-label', toggleBtn.title);
  }
  renderSceneCardModal();
  updateSelectedSceneUI();
}

function buildSceneCardGridHtml() {
  const sceneIcon = `<div class="sceneIconBox"><svg class="sceneIconSvg" viewBox="0 0 92 72" aria-hidden="true"><rect class="cardBack" x="17" y="16" width="45" height="34" rx="9"></rect><rect class="cardFront" x="31" y="22" width="45" height="34" rx="9"></rect><path class="cardDiamond" d="M53.5 28.5l9 9-9 9-9-9 9-9z"></path></svg></div>`;
  return `<div class="sceneGrid">${SCENE_CARD_OPTIONS.map(item => {
    const selected = selectedSceneIds.has(item.id);
    const flipped = flippedSceneIds.has(item.id);
    const cls = ['sceneCard'];
    if (selected) cls.push('selected');
    if (flipped) cls.push('flipped');
    const slotCls = ['sceneCardSlot'];
    if (flipped) slotCls.push('hasFlipped');
    const numberContent = selected ? '<svg class="sceneCheckIcon" viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>' : item.no;
    const front = `<div class="sceneNumber">${item.no}</div>${sceneIcon}<div class="sceneTitle">${item.no}. ${item.title}</div>`;
    const back = `<span class="sceneBackCloseBtn" role="button" aria-label="닫기" onclick="handleSceneBackClose(event,'${item.id}')">×</span><div class="sceneNumber">${item.no}</div><div class="sceneBackMain">${item.main}</div><div class="sceneBackSub">${item.sub}</div><div class="sceneBackKeywords">${item.keywords.map(k => `<span>${k}</span>`).join('')}</div>`;
    return `<div class="${slotCls.join(' ')}"><button type="button" class="${cls.join(' ')}" onclick="handleSceneCardBodyClick('${item.id}')">${flipped ? back : front}</button><button type="button" class="sceneCardSelectBtn" onclick="handleSceneNumberClick(event,'${item.id}')">${numberContent}</button></div>`;
  }).join('')}</div>`;
}

function updateSceneCardModalMeta() {
  const count = document.getElementById('sceneCardModalCount');
  if (count) count.textContent = `${selectedSceneIds.size} / ${SCENE_CARD_OPTIONS.length} 선택`;
  const pageCount = document.getElementById('kinderSelectedCount');
  if (pageCount) pageCount.textContent = `${selectedSceneIds.size} / ${SCENE_CARD_OPTIONS.length} 선택`;
  const resetBtn = document.getElementById('sceneCardModalResetBtn');
  if (resetBtn) resetBtn.disabled = selectedSceneIds.size === 0;
}
function renderSceneCardModal() {
  const body = document.getElementById('sceneCardModalBody');
  if (!body) return;
  body.innerHTML = buildSceneCardGridHtml();
  updateSceneCardModalMeta();
}
function clearSceneSelections() {
  selectedSceneIds.clear();
  flippedSceneIds.clear();
  renderSceneInput();
}

function isSceneCardModalOpen() {
  const overlay = document.getElementById('sceneCardModalOverlay');
  return !!overlay && overlay.classList.contains('show');
}

function syncSceneToggleButton() {
  const toggleBtn = document.getElementById('sceneModeToggleBtn');
  if (!toggleBtn) return;
  const opened = isSceneCardModalOpen();
  toggleBtn.classList.toggle('active', opened);
  toggleBtn.title = opened ? '장면카드 닫기' : '장면카드 열기';
  toggleBtn.setAttribute('aria-label', toggleBtn.title);
}

function openSceneCardModal() {
  const overlay = document.getElementById('sceneCardModalOverlay');
  if (!overlay) return;
  renderSceneCardModal();
  overlay.classList.add('show');
  document.body.classList.add('modalOpen');
  syncSceneToggleButton();
}

function closeSceneCardModal() {
  const overlay = document.getElementById('sceneCardModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  document.body.classList.remove('modalOpen');
  syncSceneToggleButton();
}

function handleSceneCardModalOverlayClick(event) {
  if (event.target && event.target.id === 'sceneCardModalOverlay') closeSceneCardModal();
}

function insertSceneMemoLabel(id) {
  const textarea = document.getElementById('sceneMemoInput');
  const label = SCENE_MEMO_LABELS[id];
  if (!textarea || !label) return;

  const current = textarea.value || '';
  const lines = current.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.includes(label)) return;

  textarea.value = current.trim() ? `${current.trim()}\n${label}` : label;

  updateSceneMemoPlaceholder();
  autoResizeSceneMemoInput(textarea);
}
function updateSceneMemoPlaceholder() {
  const textarea = document.getElementById('sceneMemoInput');
  const placeholder = document.getElementById('sceneMemoPlaceholder');
  if (!textarea || !placeholder) return;
  placeholder.classList.toggle('hide', !!textarea.value.trim());
}

function resetSceneMemoViewIfEmpty(textarea) {
  if (!textarea) return;
  textarea.value = (textarea.value || '').replace(/ /g, ' ').trim();
  updateSceneMemoPlaceholder();
  if (textarea.value) return;
  try {
    textarea.selectionStart = 0;
    textarea.selectionEnd = 0;
  } catch {}
  textarea.scrollTop = 0;
  textarea.scrollLeft = 0;
  textarea.blur();
  requestAnimationFrame(() => {
    textarea.scrollTop = 0;
    textarea.scrollLeft = 0;
    updateSceneMemoPlaceholder();
  });
}
function removeSceneMemoLabel(id) {
  const textarea = document.getElementById('sceneMemoInput');
  const label = SCENE_MEMO_LABELS[id];
  if (!textarea || !label) return;

  const current = textarea.value || '';
  const lines = current.split('\n');
  let removed = false;
  const nextLines = lines.filter(line => {
    if (!removed && line.trim() === label) {
      removed = true;
      return false;
    }
    return true;
  });

  if (!removed) return;

  textarea.value = nextLines
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');

  autoResizeSceneMemoInput(textarea);
  resetSceneMemoViewIfEmpty(textarea);
}
function handleSceneNumberClick(event, id) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (selectedSceneIds.has(id)) {
    selectedSceneIds.delete(id);
    flippedSceneIds.delete(id);
    removeSceneMemoLabel(id);
  } else {
    selectedSceneIds.add(id);
    flippedSceneIds.delete(id);
    insertSceneMemoLabel(id);
  }
  renderSceneInput();
}

function handleSceneBackClose(event, id) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  flippedSceneIds.delete(id);
  renderSceneInput();
}

function handleSceneCardBodyClick(id) {
  if (!selectedSceneIds.has(id)) {
    selectedSceneIds.add(id);
    flippedSceneIds.clear();
    insertSceneMemoLabel(id);
    renderSceneInput();
    return;
  }
  if (flippedSceneIds.has(id)) {
    flippedSceneIds.delete(id);
  } else {
    flippedSceneIds.clear();
    flippedSceneIds.add(id);
  }
  renderSceneInput();
}
function toggleSceneTag(id) { handleSceneNumberClick(null, id); }
function toggleSceneInputMode() {
  if (isSceneCardModalOpen()) closeSceneCardModal();
  else openSceneCardModal();
}
function openSceneCardsFromAnyPage() { openSceneCardModal(); }
function getSelectedScenePayload() { return Array.from(selectedSceneIds).map(id => getSceneById(id)).filter(Boolean); }
function renderKinderFeedbackSceneGrid() {
  const area = document.getElementById('kinderSceneGrid');
  if (!area) return;
  area.innerHTML = SCENE_CARD_OPTIONS.map(item => {
    const active = selectedSceneIds.has(item.id) ? ' active' : '';
    return `<div role="button" tabindex="0" class="kinderSceneChip${active}" data-id="${item.id}" onclick="handleKinderSceneCardTap(event, '${item.id}')">
      <button type="button" class="kinderSceneMarkerWrap" onclick="toggleKinderSceneMarker(event, '${item.id}')" aria-label="선택 토글">
        <span class="kinderChipNum">
          <span class="kinderSceneNumText">${item.no}</span>
          <svg class="kinderSceneCheckIcon" viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7.3" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>
      <span class="kinderChipTitle">${escapeHtml(item.title)}</span>
    </div>`;
  }).join('');
}
function updateSelectedSceneUI() {
  renderKinderFeedbackSceneGrid();
  updateSceneCardModalMeta();
}


function setFeedbackPageBackgroundActive(active) {
  document.body.classList.toggle('feedbackPageActive', !!active);
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', '#FEFEFE');
}

function resetVisibleFailGrowthPagesOnLeave() {}

function vivizacSlideInPage(pageOrId) {
  const page = typeof pageOrId === 'string' ? document.getElementById(pageOrId) : pageOrId;
  if (!page) return;
  const fromBottom = false;
  page.classList.remove('vivizac-slide-in', 'vivizac-slide-out', 'vivizac-slide-from-bottom');
  if (fromBottom) page.classList.add('vivizac-slide-from-bottom');
  page.classList.add('vivizac-slide-page');
  void page.offsetWidth;
  page.classList.add('vivizac-slide-in');
  setTimeout(() => {
    page.classList.remove('vivizac-slide-page', 'vivizac-slide-in', 'vivizac-slide-from-bottom');
  }, 330);
}

function vivizacSlideOutPageToRecord(pageOrId, after) {
  const page = typeof pageOrId === 'string' ? document.getElementById(pageOrId) : pageOrId;
  const record = document.getElementById('recordRoomScreen');

  if (!page) {
    if (typeof after === 'function') after();
    return;
  }

  if (record) record.style.display = 'flex';

  page.classList.remove('vivizac-slide-in', 'vivizac-slide-out');
  page.classList.add('vivizac-slide-page');
  void page.offsetWidth;
  page.classList.add('vivizac-slide-out');

  setTimeout(() => {
    page.classList.remove('vivizac-slide-page', 'vivizac-slide-out');
    page.style.display = 'none';
    if (typeof after === 'function') after();
  }, 280);
}

function vivizacGetVisibleNotePage() {
  const ids = ['studentMemoScreen',  'settingsPageScreen', 'settingsDetailScreen'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none') return el;
  }
  return null;
}

function hideModalOnly(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.style.display = 'none';
}

function closeModalById(modalId) {
  switch (modalId) {
    case 'elementaryAnalysisModal': closeElementaryAnalysisModal(); break;
    case 'saveModal': closeSaveModal(); break;
    case 'studentModal': closeStudentModal(); break;
    case 'elementaryInfoModal': closeElementaryInfoModal(); break;
    case 'kinderInfoModal': closeKinderInfoModal(); break;
    case 'kinderTransferModal': closeKinderTransferModal(); break;
    default: hideModalOnly(modalId);
  }
}

function bindModalCloseEvents() {
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    if (btn.dataset.modalBound === '1') return;
    btn.dataset.modalBound = '1';
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeModalById(btn.dataset.modalClose);
    });
  });

  document.querySelectorAll('.modalOverlay').forEach(modal => {
    if (modal.dataset.overlayBound === '1') return;
    modal.dataset.overlayBound = '1';
    modal.addEventListener('click', event => {
      if (event.target === modal) closeModalById(modal.id);
    });
  });
}


/* 2026-05-01: 모달 취소 버튼 안정화
   팝업 내부 HTML이 다시 그려져도 data-modal-close 버튼은 항상 닫히게 document 위임으로 처리 */
if (!window.__olliDelegatedModalCloseBound) {
  window.__olliDelegatedModalCloseBound = true;
  document.addEventListener('click', function(event) {
    const closeBtn = event.target && event.target.closest ? event.target.closest('[data-modal-close]') : null;
    if (!closeBtn) return;

    const modalId = closeBtn.getAttribute('data-modal-close');
    if (!modalId) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

    if (typeof closeModalById === 'function') {
      closeModalById(modalId);
    } else {
      const modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'none';
    }
  }, true);
}


