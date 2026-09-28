
let kinderInfoDraft = { personality: '' };
let elementaryInfoDraft = { group: '', personality: '' };

function openCurrentStudentInfoModal() {
  const target = typeof getStudentInfoModalTarget === 'function' ? getStudentInfoModalTarget() : null;
  if (!target) return;
  if (target.type === 'kinder' && typeof window.openKinderInfoModal === 'function') {
    return window.openKinderInfoModal();
  }
  if (target.type === 'elementary' && typeof window.openElementaryInfoModal === 'function') {
    return window.openElementaryInfoModal();
  }
}

function renderElementaryGroupMonthButtons(containerId, group, setterName) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const groupKey = String(group || '').trim();
  if (!groupKey) {
    el.innerHTML = '<div class="infoMonthEmpty">그룹을 먼저 선택해 주세요.</div>';
    return;
  }
  const selected = new Set(getElementaryGroupFeedbackMonths(groupKey));
  el.innerHTML = ELEMENTARY_GROUP_MONTH_VALUES.map(month => `<button type="button" class="infoDayBtn ${selected.has(month) ? 'active' : ''}" onclick="${setterName}(${month})">${month}월</button>`).join('');
}

function syncElementaryInfoButtons() {
  document.querySelectorAll('#elementaryGroupToggleRow .infoToggleBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.group === elementaryInfoDraft.group);
  });
  document.querySelectorAll('#elementaryPersonalityToggleRow .infoToggleBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.personality === elementaryInfoDraft.personality);
  });
}

function selectElementaryGroup(group) {
  elementaryInfoDraft.group = elementaryInfoDraft.group === group ? '' : group;
  syncElementaryInfoButtons();
}

function toggleElementaryInfoGroupMonth(month) {
  if (!elementaryInfoDraft.group) {
    alert('먼저 그룹을 선택해 주세요.');
    return;
  }
  toggleElementaryGroupFeedbackMonth(elementaryInfoDraft.group, month);
  syncElementaryInfoButtons();
}

function selectElementaryPersonality(personality) {
  elementaryInfoDraft.personality = elementaryInfoDraft.personality === personality ? '' : personality;
  if (window.__olliPersonalityDropdownOpen) window.__olliPersonalityDropdownOpen.elementaryPersonalityToggleRow = false;
  syncElementaryInfoButtons();
  if (typeof window.refreshStudentModalPersonalityDropdowns === 'function') window.refreshStudentModalPersonalityDropdowns();
}
