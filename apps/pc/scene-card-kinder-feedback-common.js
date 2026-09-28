/* PC/Phone common scene-card bridge for the kinder feedback screen. */

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
