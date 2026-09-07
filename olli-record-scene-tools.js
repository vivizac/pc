let sceneCardsVisible = false;
let previousScreenBeforeRecordRoom = 'mainPage';
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


