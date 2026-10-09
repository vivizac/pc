/* Phone-only 1-minute feedback labels. Keep UI wording separate from shared registration logic. */
window.__olliPhoneInlineStudentFeedbackEnabled = true;
document.addEventListener('DOMContentLoaded', function(){
  try {
    document.querySelectorAll('.kcfModeOptionTitle').forEach(function(el){
      if (el.textContent.trim() === '1분 피드백(유치부)') el.textContent = '1분 피드백';
    });
    document.querySelectorAll('.kcfModeOptionGuide').forEach(function(el){
      if (el.textContent.trim() === '일상 관찰을 빠르게 정리') el.textContent = '유치부·초등부 관찰을 빠르게 정리';
    });
  } catch(e) {}
});

/* Phone-only navigation lifecycle. Shared feedback execution stays in PC canonical sources. */
(function installPhoneOneMinuteFeedbackLifecycle(){
  function resetBeforeLeaving(){
    const main = document.getElementById('mainPageScreen');
    if (!main || typeof resetOneMinuteFeedback !== 'function') return;
    const style = window.getComputedStyle(main);
    if (style.display !== 'none') resetOneMinuteFeedback();
  }
  window.OlliOneMinuteFeedbackLifecycle = Object.freeze({ beforeLeave: resetBeforeLeaving });
})();

/*
 * Phone LIVE mode presentation policy.
 * The shared registration runtime intentionally owns submission/data logic, while Phone keeps
 * the two visual modes separate: LIVE uses the original full-text chat bubble and Inbox keeps
 * the document-card presentation.
 */
(function installPhoneKinderChatLivePresentation(){
  const originalAddDocumentMessage = window.addKinderChatDocumentMessage;
  if (typeof originalAddDocumentMessage === 'function' && !originalAddDocumentMessage.__olliPhoneLivePresentation) {
    function phoneAddKinderChatDocumentMessage(studentName, subtitle, bodyText, variant, photoMeta){
      const isLiveMinute = variant === 'minute' &&
        typeof window.getKinderChatFeedbackTopMode === 'function' &&
        window.getKinderChatFeedbackTopMode() === 'live' &&
        typeof window.startKinderChatFeedbackLiveRequest === 'function' &&
        typeof window.addKinderChatMessage === 'function';

      if (isLiveMinute) {
        window.addKinderChatMessage('user', String(bodyText || ''));
        return null;
      }
      return originalAddDocumentMessage.apply(this, arguments);
    }
    phoneAddKinderChatDocumentMessage.__olliPhoneLivePresentation = true;
    phoneAddKinderChatDocumentMessage.__olliOriginal = originalAddDocumentMessage;
    window.addKinderChatDocumentMessage = phoneAddKinderChatDocumentMessage;
  }
})();

function getPhoneKcfVisibleViewportRect(){
  const layoutWidth = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
  const layoutHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  const viewport = window.visualViewport;
  if (!viewport) {
    return { top:0, left:0, width:layoutWidth, height:layoutHeight };
  }
  return {
    top:Math.max(0, Number(viewport.offsetTop || 0)),
    left:Math.max(0, Number(viewport.offsetLeft || 0)),
    width:Math.max(1, Number(viewport.width || layoutWidth)),
    height:Math.max(1, Number(viewport.height || layoutHeight))
  };
}
function applyPhoneKcfVisibleViewport(overlay){
  if (!overlay || !overlay.classList.contains('show')) return;
  const rect = getPhoneKcfVisibleViewportRect();
  overlay.style.setProperty('--phone-kcf-vv-top', `${Math.round(rect.top)}px`);
  overlay.style.setProperty('--phone-kcf-vv-left', `${Math.round(rect.left)}px`);
  overlay.style.setProperty('--phone-kcf-vv-width', `${Math.round(rect.width)}px`);
  overlay.style.setProperty('--phone-kcf-vv-height', `${Math.round(rect.height)}px`);
}
function resetPhoneKcfVisibleViewport(overlay){
  if (!overlay) return;
  overlay.style.removeProperty('--phone-kcf-vv-top');
  overlay.style.removeProperty('--phone-kcf-vv-left');
  overlay.style.removeProperty('--phone-kcf-vv-width');
  overlay.style.removeProperty('--phone-kcf-vv-height');
}
let phoneKcfEditViewportFrame = 0;
let phoneKcfViewportUnlockTimer = 0;
function syncPhoneKcfDedicatedEditViewports(){
  applyPhoneKcfVisibleViewport(getPhoneKcfLiveEditOverlay());
  applyPhoneKcfVisibleViewport(getPhoneKcfRecordEditOverlay());
}
function schedulePhoneKcfDedicatedEditViewportSync(){
  if (phoneKcfEditViewportFrame) return;
  phoneKcfEditViewportFrame = requestAnimationFrame(function(){
    phoneKcfEditViewportFrame = 0;
    syncPhoneKcfDedicatedEditViewports();
  });
}
function focusPhoneKcfTextareaAtEnd(input){
  if (!input) return false;
  try { input.focus({ preventScroll:true }); } catch(e) {
    try { input.focus(); } catch(ignore) {}
  }
  if (document.activeElement !== input) {
    try { input.focus(); } catch(e) {}
  }
  const end = String(input.value || '').length;
  try { input.setSelectionRange(end, end); } catch(e) {}
  try { input.scrollTop = input.scrollHeight; } catch(e) {}
  return document.activeElement === input;
}
function syncPhoneKcfBasePageVisibility(){
  const liveOpen = !!getPhoneKcfLiveEditOverlay()?.classList.contains('show');
  const recordOpen = !!getPhoneKcfRecordEditOverlay()?.classList.contains('show');
  const open = liveOpen || recordOpen;
  document.body.classList.toggle('kcfDedicatedEditSheetOpen', open);

  if (phoneKcfViewportUnlockTimer) {
    window.clearTimeout(phoneKcfViewportUnlockTimer);
    phoneKcfViewportUnlockTimer = 0;
  }
  if (open) {
    document.documentElement.classList.add('kcfDedicatedEditViewportLocked');
    document.body.classList.add('kcfDedicatedEditViewportLocked');
    return;
  }
  phoneKcfViewportUnlockTimer = window.setTimeout(function(){
    document.documentElement.classList.remove('kcfDedicatedEditViewportLocked');
    document.body.classList.remove('kcfDedicatedEditViewportLocked');
    phoneKcfViewportUnlockTimer = 0;
  }, 320);
}
function isPhoneKcfDedicatedEditTextarea(target){
  return target && target.closest
    ? target.closest('.phoneKcfLiveEditInput, .phoneKcfRecordEditInput')
    : null;
}
function preventPhoneKcfDedicatedEditBackgroundTouchMove(event){
  if (!document.body.classList.contains('kcfDedicatedEditSheetOpen')) return;
  const textarea = isPhoneKcfDedicatedEditTextarea(event.target);
  if (textarea && textarea.scrollHeight > textarea.clientHeight + 1) return;
  if (event.cancelable) event.preventDefault();
}

/* LIVE 피드백 수정 전용 바텀시트. TODAY 입력창과 완전히 다른 DOM/레이어다. */
let phoneKcfLiveEditContext = null;

function getPhoneKcfLiveEditOverlay(){
  return document.getElementById('phoneKcfLiveEditOverlay');
}
function getPhoneKcfLiveEditInput(){
  return document.getElementById('phoneKcfLiveEditInput');
}
function focusPhoneKcfLiveEditSheetInput(input){
  if (!input) return;
  focusPhoneKcfTextareaAtEnd(input);
  schedulePhoneKcfDedicatedEditViewportSync();
}
function setPhoneKcfLiveEditSheetBusy(busy){
  const overlay = getPhoneKcfLiveEditOverlay();
  if (!overlay) return;
  overlay.querySelectorAll('.phoneKcfLiveEditActionBtn').forEach(btn => {
    btn.disabled = !!busy;
  });
}
function closePhoneKcfLiveEditSheet(){
  const overlay = getPhoneKcfLiveEditOverlay();
  const input = getPhoneKcfLiveEditInput();
  if (input) {
    try { input.blur(); } catch(e) {}
  }
  if (overlay) {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.removeProperty('visibility');
    resetPhoneKcfVisibleViewport(overlay);
  }
  syncPhoneKcfBasePageVisibility();
  setPhoneKcfLiveEditSheetBusy(false);
  phoneKcfLiveEditContext = null;
}
async function submitPhoneKcfLiveEditSheet(btn){
  const context = phoneKcfLiveEditContext;
  const input = getPhoneKcfLiveEditInput();
  if (!context || !input || context.submitting) return false;
  const nextText = String(input.value || '').trim();
  if (!nextText) {
    try { showPushToast('수정할 피드백 내용이 비어 있어요.'); } catch(e) {}
    return false;
  }
  if (typeof window.confirmKinderChatFeedbackLiveEdit !== 'function') {
    try { showPushToast('피드백 수정 기능을 불러오지 못했습니다.'); } catch(e) {}
    return false;
  }

  context.submitting = true;
  setPhoneKcfLiveEditSheetBusy(true);
  context.editArea.value = nextText;
  let ok = false;
  try {
    ok = await window.confirmKinderChatFeedbackLiveEdit(context.id, btn || null);
  } catch(e) {
    console.error('Phone LIVE 피드백 수정 오류:', e);
    ok = false;
  }
  context.submitting = false;
  if (ok === true) {
    closePhoneKcfLiveEditSheet();
    return true;
  }
  setPhoneKcfLiveEditSheetBusy(false);
  return false;
}
function ensurePhoneKcfLiveEditSheet(){
  let overlay = getPhoneKcfLiveEditOverlay();
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'phoneKcfLiveEditOverlay';
  overlay.className = 'phoneKcfLiveEditOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <section class="phoneKcfLiveEditSheet" role="dialog" aria-modal="true" aria-label="피드백 수정">
      <div class="phoneKcfLiveEditHandle" aria-hidden="true"></div>
      <div class="phoneKcfLiveEditBody">
        <textarea id="phoneKcfLiveEditInput" class="phoneKcfLiveEditInput" aria-label="피드백 수정 내용"></textarea>
        <div class="phoneKcfLiveEditInlineActions">
          <button type="button" class="phoneKcfLiveEditActionBtn phoneKcfLiveEditCancelBtn">취소</button>
          <button type="button" class="phoneKcfLiveEditActionBtn phoneKcfLiveEditDoneBtn">완료</button>
        </div>
      </div>
    </section>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#phoneKcfLiveEditInput');
  const cancelBtn = overlay.querySelector('.phoneKcfLiveEditCancelBtn');
  const doneBtn = overlay.querySelector('.phoneKcfLiveEditDoneBtn');
  if (input) {
    input.addEventListener('focus', schedulePhoneKcfDedicatedEditViewportSync);
    input.addEventListener('blur', schedulePhoneKcfDedicatedEditViewportSync);
  }
  if (cancelBtn) cancelBtn.addEventListener('click', closePhoneKcfLiveEditSheet);
  if (doneBtn) doneBtn.addEventListener('click', function(){ submitPhoneKcfLiveEditSheet(doneBtn); });
  return overlay;
}
function openPhoneKcfLiveEditSheet(id){
  const item = typeof window.getKinderChatFeedbackLiveItem === 'function'
    ? window.getKinderChatFeedbackLiveItem(id)
    : null;
  const row = typeof window.getKinderChatFeedbackLiveRow === 'function'
    ? window.getKinderChatFeedbackLiveRow(id)
    : null;
  const editArea = row?.querySelector?.('.kcfLiveEditArea') || null;
  if (!item || !row || !editArea || !String(item.resultText || '').trim()) return false;

  const overlay = ensurePhoneKcfLiveEditSheet();
  const input = getPhoneKcfLiveEditInput();
  if (!overlay || !input) return false;

  phoneKcfLiveEditContext = { id:String(id || ''), editArea, submitting:false };
  input.value = String(item.resultText || '');
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.style.visibility = 'visible';
  syncPhoneKcfBasePageVisibility();
  syncPhoneKcfDedicatedEditViewports();
  void overlay.offsetHeight;
  focusPhoneKcfLiveEditSheetInput(input);
  requestAnimationFrame(function(){
    syncPhoneKcfDedicatedEditViewports();
    const current = getPhoneKcfLiveEditInput();
    if (current && document.activeElement === current) {
      const end = String(current.value || '').length;
      try { current.setSelectionRange(end, end); } catch(e) {}
      try { current.scrollTop = current.scrollHeight; } catch(e) {}
    }
  });
  return true;
}

/* 수업기록 수정 전용 바텀시트. 기존 TODAY 입력창을 거치지 않고 수정 상태만 직접 준비한다. */
let phoneKcfRecordEditContext = null;

function getPhoneKcfRecordEditOverlay(){
  return document.getElementById('phoneKcfRecordEditOverlay');
}
function getPhoneKcfRecordEditInput(){
  return document.getElementById('phoneKcfRecordEditInput');
}
function cleanPhoneKcfRecordEditValue(value){
  return String(value == null ? '' : value).trim();
}
function preparePhoneKcfRecordEdit(modeName, jobId, row){
  const state = (window.__kcfTeacherModeState || window.__kcfAutoModeState);
  const composerInput = document.getElementById('kcfInput');
  const id = cleanPhoneKcfRecordEditValue(jobId);
  const editMode = modeName === 'archive' ? 'archive' : 'live';
  if (!state || !composerInput || !id || state.editing) return null;

  let record = null;
  if (editMode === 'archive') {
    record = state.records && state.records[id];
  } else {
    let liveItem = null;
    try {
      liveItem = typeof window.getKinderChatFeedbackLiveItem === 'function'
        ? window.getKinderChatFeedbackLiveItem(id)
        : null;
    } catch(e) {}
    const bubble = row && row.querySelector ? row.querySelector('.kcfBubble') : null;
    const body = cleanPhoneKcfRecordEditValue(liveItem && liveItem.sourceText) || cleanPhoneKcfRecordEditValue(bubble && bubble.textContent);
    if (!body) return null;

    record = {
      jobId:id,
      row:row || null,
      studentName:cleanPhoneKcfRecordEditValue(liveItem && liveItem.studentName),
      studentId:cleanPhoneKcfRecordEditValue(liveItem && liveItem.studentId),
      body,
      live:true,
      options:{
        id,
        promptType:'class',
        userText:body,
        requestContent:body,
        studentName:cleanPhoneKcfRecordEditValue(liveItem && liveItem.studentName),
        studentDivision:cleanPhoneKcfRecordEditValue(liveItem && liveItem.studentDivision) || 'elementary',
        studentId:cleanPhoneKcfRecordEditValue(liveItem && liveItem.studentId),
        feedbackType:cleanPhoneKcfRecordEditValue(liveItem && liveItem.feedbackType) || 'class',
        label:cleanPhoneKcfRecordEditValue(liveItem && liveItem.label) || '피드백',
        sourcePage:'kinderChatFeedback',
        attachments:Array.isArray(liveItem && liveItem.attachments) ? liveItem.attachments.slice() : [],
        feedbackMonth:cleanPhoneKcfRecordEditValue(liveItem && liveItem.feedbackMonth),
        feedbackMonthNumber:Number(liveItem && liveItem.feedbackMonthNumber) || 0,
        silent:true
      }
    };
  }

  if (!record || !cleanPhoneKcfRecordEditValue(record.body)) return null;
  state.editing = {
    mode:editMode,
    record,
    resumeValue:composerInput.value || '',
    resumeSelectedStudentId:cleanPhoneKcfRecordEditValue(window.__kcfSelectedStudentId),
    phoneDedicatedSheet:true
  };
  return state.editing;
}
function cancelPhoneKcfRecordEditSheet(){
  const state = (window.__kcfTeacherModeState || window.__kcfAutoModeState);
  if (state && state.editing && state.editing.phoneDedicatedSheet) {
    state.editing = null;
  }
  closePhoneKcfRecordEditSheet();
}
function closePhoneKcfRecordEditSheet(){
  const overlay = getPhoneKcfRecordEditOverlay();
  const input = getPhoneKcfRecordEditInput();
  if (input) {
    try { input.blur(); } catch(e) {}
  }
  if (overlay) {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.removeProperty('visibility');
    resetPhoneKcfVisibleViewport(overlay);
  }
  syncPhoneKcfBasePageVisibility();
  phoneKcfRecordEditContext = null;
}
async function submitPhoneKcfRecordEditSheet(sendBtn){
  const context = phoneKcfRecordEditContext;
  const sheetInput = getPhoneKcfRecordEditInput();
  const composerInput = document.getElementById('kcfInput');
  const mode = (window.KcfTeacherMode || window.KcfAutoMode);
  const state = (window.__kcfTeacherModeState || window.__kcfAutoModeState);
  const editing = state && state.editing;
  if (!context || !sheetInput || !composerInput || !mode || !editing || context.submitting) return false;
  const nextText = String(sheetInput.value || '').trim();
  if (!nextText) {
    try { showPushToast('수정할 수업기록 내용을 입력해 주세요.'); } catch(e) {}
    return false;
  }

  context.submitting = true;
  if (sendBtn) sendBtn.disabled = true;
  const resumeValue = editing.resumeValue || '';
  editing.resumeValue = '';
  composerInput.value = nextText;
  try {
    await mode.saveSubmittedRecordEdit();
  } catch(e) {
    console.error('Phone 수업기록 수정 오류:', e);
  }
  const completed = typeof mode.isEditing === 'function' ? !mode.isEditing() : !((window.__kcfTeacherModeState || window.__kcfAutoModeState) && (window.__kcfTeacherModeState || window.__kcfAutoModeState).editing);
  context.submitting = false;
  if (sendBtn) sendBtn.disabled = false;
  if (completed) {
    if (context.sourceJobId && typeof mode.discardFeedbackJob === 'function') {
      mode.discardFeedbackJob(context.sourceJobId);
    }
    composerInput.value = resumeValue;
    if (typeof window.autoResizeKinderChatFeedbackInput === 'function') {
      window.autoResizeKinderChatFeedbackInput(composerInput);
    }
    closePhoneKcfRecordEditSheet();
    return true;
  }
  if (state && state.editing) state.editing.resumeValue = resumeValue;
  return false;
}
function ensurePhoneKcfRecordEditSheet(){
  let overlay = getPhoneKcfRecordEditOverlay();
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'phoneKcfRecordEditOverlay';
  overlay.className = 'phoneKcfRecordEditOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <section class="phoneKcfRecordEditSheet" role="dialog" aria-modal="true" aria-label="수업기록 수정">
      <div class="phoneKcfRecordEditHandle" aria-hidden="true"></div>
      <div class="phoneKcfRecordEditBody">
        <textarea id="phoneKcfRecordEditInput" class="phoneKcfRecordEditInput" aria-label="수업기록 수정 내용"></textarea>
        <div class="phoneKcfRecordEditInlineActions">
          <button type="button" class="phoneKcfRecordEditActionBtn phoneKcfRecordEditCancelBtn">취소</button>
          <button type="button" class="phoneKcfRecordEditActionBtn phoneKcfRecordEditSendBtn" aria-label="수정한 수업기록 전송" title="전송">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path></svg>
          </button>
        </div>
      </div>
    </section>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#phoneKcfRecordEditInput');
  const cancelBtn = overlay.querySelector('.phoneKcfRecordEditCancelBtn');
  const sendBtn = overlay.querySelector('.phoneKcfRecordEditSendBtn');
  if (input) {
    input.addEventListener('focus', schedulePhoneKcfDedicatedEditViewportSync);
    input.addEventListener('blur', schedulePhoneKcfDedicatedEditViewportSync);
  }
  if (cancelBtn) cancelBtn.addEventListener('click', cancelPhoneKcfRecordEditSheet);
  if (sendBtn) sendBtn.addEventListener('click', function(){ submitPhoneKcfRecordEditSheet(sendBtn); });
  return overlay;
}
function openPhoneKcfRecordEditSheet(sourceJobId){
  const state = (window.__kcfTeacherModeState || window.__kcfAutoModeState);
  const editing = state && state.editing;
  const record = editing && editing.record;
  if (!editing || !record || !String(record.body || '').trim()) return false;

  const overlay = ensurePhoneKcfRecordEditSheet();
  const input = getPhoneKcfRecordEditInput();
  if (!overlay || !input) return false;

  phoneKcfRecordEditContext = {
    submitting:false,
    sourceJobId:String(sourceJobId || '')
  };
  input.value = String(record.body || '');
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.style.visibility = 'visible';
  syncPhoneKcfBasePageVisibility();
  syncPhoneKcfDedicatedEditViewports();
  void overlay.offsetHeight;
  focusPhoneKcfTextareaAtEnd(input);
  schedulePhoneKcfDedicatedEditViewportSync();
  requestAnimationFrame(function(){
    syncPhoneKcfDedicatedEditViewports();
    const current = getPhoneKcfRecordEditInput();
    if (current && document.activeElement === current) {
      const end = String(current.value || '').length;
      try { current.setSelectionRange(end, end); } catch(e) {}
      try { current.scrollTop = current.scrollHeight; } catch(e) {}
    }
  });
  return true;
}
function installPhoneKcfRecordEditSheets(){
  const mode = (window.KcfTeacherMode || window.KcfAutoMode);
  const originalLiveEdit = window.editKinderChatLiveRecord;
  const originalArchiveEdit = window.editKinderChatSubmittedRecord;
  if (!mode || typeof originalLiveEdit !== 'function' || typeof originalArchiveEdit !== 'function') return false;
  if (window.__olliPhoneRecordEditSheetsInstalled) return true;

  window.editKinderChatLiveRecord = function(jobId, row){
    const editing = preparePhoneKcfRecordEdit('live', jobId, row);
    if (!editing) return false;
    return openPhoneKcfRecordEditSheet(jobId);
  };
  window.editKinderChatSubmittedRecord = function(jobId){
    const editing = preparePhoneKcfRecordEdit('archive', jobId, null);
    if (!editing) return false;
    return openPhoneKcfRecordEditSheet(jobId);
  };
  window.__olliPhoneRecordEditSheetsInstalled = true;
  return true;
}

/* iOS 키보드가 visualViewport를 이동/축소할 때 두 수정 시트를 실제 보이는 화면에 다시 고정한다. */
(function bindPhoneKcfEditViewport(){
  if (window.__olliPhoneKcfEditViewportBound) return;
  window.__olliPhoneKcfEditViewportBound = true;
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedulePhoneKcfDedicatedEditViewportSync);
    window.visualViewport.addEventListener('scroll', schedulePhoneKcfDedicatedEditViewportSync);
  }
  window.addEventListener('resize', schedulePhoneKcfDedicatedEditViewportSync);
  document.addEventListener('touchmove', preventPhoneKcfDedicatedEditBackgroundTouchMove, { capture:true, passive:false });
})();

function installPhoneKcfLiveTypingIndicator(bubble){
  if (!bubble || bubble.getAttribute('aria-busy') !== 'true') return;
  if (bubble.querySelector('.kcfLiveTypingIndicator')) return;
  if (String(bubble.textContent || '').trim() !== '…') return;
  bubble.innerHTML = '<span class="kcfLiveTypingIndicator" aria-hidden="true"><span class="kcfLiveTypingDot"></span><span class="kcfLiveTypingDot"></span><span class="kcfLiveTypingDot"></span></span>';
}
// Continuous recording and "피드백 모아보기" share the very same LIVE rows.
function isPhoneKcfFeedbackCompact(){
  return document.body.classList.contains('kcfContinuousMode')
    || document.body.classList.contains('kcfFeedbackCollectView');
}

function syncPhoneKcfContinuousRecordUi(){
  const compact = isPhoneKcfFeedbackCompact();
  document.querySelectorAll('#kinderChatFeedbackScreen .kcfLiveResponseRow').forEach(function(row){
    const bubble = row.querySelector('.kcfLiveBubble');
    if (!bubble) return;
    if (!compact) row.classList.remove('kcfContinuousFeedbackExpanded');
    const canExpand = compact && !row.classList.contains('kcfLiveResponseError')
      && bubble.getAttribute('aria-busy') !== 'true';
    if (canExpand) {
      const expanded = row.classList.contains('kcfContinuousFeedbackExpanded');
      bubble.setAttribute('role', 'button');
      bubble.tabIndex = 0;
      bubble.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      bubble.setAttribute('aria-label', expanded ? '피드백 접기' : '피드백 전체 보기');
    } else {
      bubble.removeAttribute('role');
      bubble.removeAttribute('tabindex');
      bubble.removeAttribute('aria-expanded');
      bubble.removeAttribute('aria-label');
    }
    const collectBtn = row.querySelector('.kcfLiveInboxBtn');
    if (collectBtn) collectBtn.textContent = compact ? '대화로 돌아가기' : '피드백 모아보기';
  });
}

function ensurePhoneKcfFeedbackCollectBack(){
  const screen = document.getElementById('kinderChatFeedbackScreen');
  if (!screen) return;
  if (screen.querySelector('.kcfFeedbackCollectBackBtn')) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'kcfFeedbackCollectBackBtn';
  back.textContent = '대화로 돌아가기';
  back.setAttribute('aria-label', '피드백 모아보기 닫고 대화로 돌아가기');
  back.addEventListener('click', togglePhoneKcfFeedbackCollectedView);
  (screen.querySelector('.kcfInner') || screen).appendChild(back);
}
function togglePhoneKcfFeedbackCollectedView(){
  if (document.body.classList.contains('kcfContinuousMode')) return;
  const area = document.getElementById('kcfChatArea');
  if (!area) return;
  ensurePhoneKcfFeedbackCollectBack();
  document.body.classList.add('kcfFeedbackCollectReady');
  // Measure source rows before changing layout, so they collapse in place
  // instead of disappearing and jumping the scroll container.
  area.querySelectorAll('.kcfMsgRow:not(.kcfLiveResponseRow)').forEach(function(row){
    if (!document.body.classList.contains('kcfFeedbackCollectView')) {
      row.style.setProperty('--kcf-collect-source-height', Math.ceil(row.getBoundingClientRect().height + 2) + 'px');
    }
  });
  const feedbackHeights = Array.from(area.querySelectorAll('.kcfLiveResponseRow .kcfLiveBubble'))
    .map(function(node){ return { node:node, height:node.getBoundingClientRect().height }; });
  void area.offsetHeight;
  document.body.classList.toggle('kcfFeedbackCollectView');
  syncPhoneKcfContinuousRecordUi();
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    requestAnimationFrame(function(){
      feedbackHeights.forEach(function(entry){
        if (!entry.node.isConnected || typeof entry.node.animate !== 'function') return;
        const targetHeight = entry.node.getBoundingClientRect().height;
        if (Math.abs(entry.height - targetHeight) < 2) return;
        entry.node.animate(
          [{ height:entry.height + 'px', overflow:'hidden' }, { height:targetHeight + 'px', overflow:'hidden' }],
          { duration:240, easing:'cubic-bezier(.22,.61,.36,1)' }
        );
      });
    });
  }
}
window.syncPhoneKcfContinuousRecordUi = syncPhoneKcfContinuousRecordUi;
window.togglePhoneKcfFeedbackCollectedView = togglePhoneKcfFeedbackCollectedView;

function decoratePhoneKcfLiveMessage(ui){
  const row = ui && ui.row;
  if (!row || !row.querySelector) return ui;

  if (!row.__olliContinuousRecordBound) {
    row.__olliContinuousRecordBound = true;
    const studentTitle = row.querySelector('.kcfLiveStudentTitle');
    const bubble = row.querySelector('.kcfLiveBubble');
    if (studentTitle) {
      const studentName = studentTitle.textContent.trim();
      const left = document.createElement('span');
      left.className = 'kcfLiveTitleLeft';
      const headerCopy = document.createElement('button');
      headerCopy.type = 'button';
      headerCopy.className = 'kcfLiveHeaderCopyBtn';
      headerCopy.title = '피드백 복사';
      headerCopy.setAttribute('aria-label', studentName + ' 피드백 복사');
      headerCopy.innerHTML = typeof window.getKinderChatFeedbackInboxCopyIconSvg === 'function'
        ? window.getKinderChatFeedbackInboxCopyIconSvg()
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.2" y="8.2" width="10.3" height="10.3" rx="2"></rect><path d="M15.8 8.2V6.7A2.2 2.2 0 0 0 13.6 4.5H6.7A2.2 2.2 0 0 0 4.5 6.7v6.9a2.2 2.2 0 0 0 2.2 2.2h1.5"></path></svg>';
      headerCopy.addEventListener('click', function(event){
        event.preventDefault();
        event.stopPropagation();
        if (headerCopy.disabled) return;
        const jobId = String(row.dataset.kcfLiveFeedbackId || '');
        if (jobId && typeof window.copyKinderChatFeedbackLive === 'function') {
          window.copyKinderChatFeedbackLive(jobId, headerCopy);
        }
      });
      const name = document.createElement('span');
      name.className = 'kcfLiveStudentNameText';
      name.textContent = studentName;
      left.append(headerCopy, name);
      studentTitle.replaceChildren(left);
      const refreshHeaderCopy = function(){
        const originalCopy = row.querySelector('.kcfLiveCopyBtn');
        headerCopy.disabled = bubble?.getAttribute('aria-busy') === 'true'
          || !!originalCopy?.disabled || row.classList.contains('kcfLiveResponseError');
      };
      refreshHeaderCopy();
      if (typeof MutationObserver === 'function' && bubble) {
        const observer = new MutationObserver(function(){
          refreshHeaderCopy();
          syncPhoneKcfContinuousRecordUi();
        });
        observer.observe(bubble, { attributes:true, attributeFilter:['aria-busy'] });
        const copyAction = row.querySelector('.kcfLiveCopyBtn');
        if (copyAction) observer.observe(copyAction, { attributes:true, attributeFilter:['disabled'] });
      }
      const editSource = document.createElement('button');
      editSource.type = 'button';
      editSource.className = 'kcfLiveRecordEditBtn';
      editSource.setAttribute('aria-label', studentTitle.textContent.trim() + ' 수업기록 수정하기');
      editSource.title = '수업기록 수정';
      editSource.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"></path></svg><span>수업기록 수정</span>';
      editSource.addEventListener('click', function(event){
        event.preventDefault();
        event.stopPropagation();
        const jobId = String(row.dataset.kcfLiveFeedbackId || '');
        if (!jobId) return;
        const sourceRow = Array.from(document.querySelectorAll('#kcfChatArea .kcfMsgRow.user[data-kcf-live-user-for]'))
          .find(function(node){ return node.dataset.kcfLiveUserFor === jobId; }) || null;
        // Reuse the normal dialogue-mode "수정하기" button, which opens the
        // existing source-record editor with the original text prefilled.
        const originalEditButton = sourceRow?.querySelector(':scope > .kcfRecordEditBtn');
        if (originalEditButton) originalEditButton.click();
        else if (typeof window.editKinderChatLiveRecord === 'function') {
          // Restored/live rows can briefly exist before their edit button mounts.
          window.editKinderChatLiveRecord(jobId, sourceRow);
        }
      });
      studentTitle.appendChild(editSource);
    }
    if (bubble) {
      const togglePreview = function(){
        if (!isPhoneKcfFeedbackCompact()
            || row.classList.contains('kcfLiveResponseError')
            || bubble.getAttribute('aria-busy') === 'true') return;
        row.classList.toggle('kcfContinuousFeedbackExpanded');
        syncPhoneKcfContinuousRecordUi();
      };
      bubble.addEventListener('click', togglePreview);
      bubble.addEventListener('keydown', function(event){
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (!isPhoneKcfFeedbackCompact()) return;
        event.preventDefault();
        togglePreview();
      });
    }
  }
  syncPhoneKcfContinuousRecordUi();

  const originalInboxBtn = row.querySelector('.kcfLiveInboxBtn');
  if (originalInboxBtn) {
    // Replace the old inbox click binding; the normal chat stays in the same DOM.
    const collectBtn = originalInboxBtn.cloneNode(true);
    collectBtn.classList.add('kcfLivePhoneTextActionBtn');
    collectBtn.textContent = '피드백 모아보기';
    collectBtn.setAttribute('aria-label', '피드백 모아보기');
    collectBtn.title = '피드백 모아보기';
    originalInboxBtn.replaceWith(collectBtn);
    collectBtn.addEventListener('click', function(event){
      event.preventDefault();
      event.stopPropagation();
      togglePhoneKcfFeedbackCollectedView();
    });
  }

  const copyBtn = row.querySelector('.kcfLiveCopyBtn');
  if (copyBtn) {
    copyBtn.classList.add('kcfLivePhoneTextActionBtn');
    copyBtn.textContent = '복사';
    copyBtn.setAttribute('aria-label', '피드백 본문 복사');
    copyBtn.title = '복사';
  }

  const bubble = row.querySelector('.kcfLiveBubble');
  installPhoneKcfLiveTypingIndicator(bubble);

  const editArea = row.querySelector('.kcfLiveEditArea');
  const originalEditBtn = row.querySelector('.kcfLiveEditBtn');
  const cancelBtn = row.querySelector('.kcfLiveCancelBtn');
  const doneBtn = row.querySelector('.kcfLiveDoneBtn');
  if (cancelBtn) cancelBtn.remove();
  if (doneBtn) doneBtn.remove();
  if (editArea) {
    editArea.tabIndex = -1;
    editArea.setAttribute('aria-hidden', 'true');
  }

  if (originalEditBtn && !originalEditBtn.__olliPhoneSeparateEditSheet) {
    const editBtn = originalEditBtn.cloneNode(true);
    editBtn.__olliPhoneSeparateEditSheet = true;
    editBtn.classList.add('kcfLivePhoneTextActionBtn');
    editBtn.textContent = '수정하기';
    editBtn.setAttribute('aria-label', '피드백 수정하기');
    editBtn.title = '피드백 수정하기';
    originalEditBtn.replaceWith(editBtn);
    editBtn.addEventListener('click', function(event){
      event.preventDefault();
      openPhoneKcfLiveEditSheet(row.dataset.kcfLiveFeedbackId || '');
    });
  }
  syncPhoneKcfContinuousRecordUi();
  return ui;
}

/* LIVE feedback actions reuse the same buttons in conversation and compact view. */
(function installPhoneKinderChatLiveActions(){
  const originalCreateLiveMessage = window.createKinderChatFeedbackLiveMessage;
  if (typeof originalCreateLiveMessage === 'function' && !originalCreateLiveMessage.__olliPhoneTextActions) {
    function phoneCreateKinderChatFeedbackLiveMessage(){
      const ui = originalCreateLiveMessage.apply(this, arguments);
      decoratePhoneKcfLiveMessage(ui);
      return ui;
    }
    phoneCreateKinderChatFeedbackLiveMessage.__olliPhoneTextActions = true;
    phoneCreateKinderChatFeedbackLiveMessage.__olliOriginal = originalCreateLiveMessage;
    window.createKinderChatFeedbackLiveMessage = phoneCreateKinderChatFeedbackLiveMessage;
  }
})();

/* Phone command confirmation actions. */
(function installPhoneKcfInlineCommandUi(){
  function clearExistingCommandActions(){
    document.querySelectorAll('#kcfChatArea .kcfCommandConfirmActions').forEach(function(row){
      row.remove();
    });
  }

  window.renderKinderChatFeedbackCommandConfirmation = function(){
    const area = document.getElementById('kcfChatArea');
    if (!area) return;
    clearExistingCommandActions();

    const row = document.createElement('div');
    row.className = 'kcfCommandConfirmActions';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', '명령 실행 확인');

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'kcfCommandConfirmBtn kcfCommandCancelBtn';
    cancelBtn.textContent = '취소';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'kcfCommandConfirmBtn kcfCommandExecuteBtn';
    confirmBtn.textContent = '확인';

    async function choose(choice){
      cancelBtn.disabled = true;
      confirmBtn.disabled = true;
      row.remove();
      if (typeof window.submitKinderChatFeedbackCommandChoice === 'function') {
        await window.submitKinderChatFeedbackCommandChoice(choice);
      }
    }

    cancelBtn.addEventListener('click', function(){ void choose('cancel'); });
    confirmBtn.addEventListener('click', function(){ void choose('confirm'); });

    row.appendChild(cancelBtn);
    row.appendChild(confirmBtn);
    area.appendChild(row);
    requestAnimationFrame(function(){ area.scrollTop = area.scrollHeight; });
  };
})();

/* Teacher/dedicated edit sheets keep their own focus lifecycle. */
(function installPhoneKcfEditHooks(){
  function install(){
    installPhoneKcfRecordEditSheets();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once:true });
  } else {
    install();
    window.setTimeout(install, 0);
  }
})();
