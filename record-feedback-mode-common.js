/* PC/Phone common record-room feedback mode menu helpers. */

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

document.addEventListener('click', (event) => {
  const mainWrap = document.getElementById('mainCardModeWrap');
  if (!mainWrap || !mainWrap.contains(event.target)) closeGlobalFeedbackModeMenus();
});
