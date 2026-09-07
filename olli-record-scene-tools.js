let sceneCardsVisible = false;
let previousScreenBeforeRecordRoom = 'mainPage';
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


