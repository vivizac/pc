/* PC/Phone common scene-card DOM UI and memo interaction. */

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
