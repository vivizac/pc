/* Phone-only QuickNote normal-mode composer sheet.
 * This sheet never owns Class roster state. Class mode uses KcfTeacherSheet separately.
 */
(function initKcfNormalSheet(global) {
  'use strict';

  var state = {
    open:false,
    submitting:false,
    warningObserver:null,
    viewportFrame:0,
    caretRevealTimer:0,
    suppressBlurSync:false
  };

  function baseInput(){ return document.getElementById('kcfInput'); }
  function overlay(){ return document.getElementById('kcfNormalSheetOverlay'); }
  function editor(){ return document.getElementById('kcfNormalSheetInput'); }
  function warning(){ return document.getElementById('kcfNormalSheetWarning'); }
  function sendButton(){ return document.getElementById('kcfNormalSheetSendBtn'); }

  function classModeEnabled(){
    var mode = global.KcfTeacherMode || global.KcfAutoMode;
    try { return !!(mode && typeof mode.isEnabled === 'function' && mode.isEnabled()); }
    catch (_) { return false; }
  }

  function syncViewport(){
    var root = overlay();
    if (!root || !state.open) return;
    var viewport = global.visualViewport;
    var width = viewport ? Number(viewport.width || global.innerWidth || 0) : Math.max(global.innerWidth || 0, document.documentElement.clientWidth || 0);
    var height = viewport ? Number(viewport.height || global.innerHeight || 0) : Math.max(global.innerHeight || 0, document.documentElement.clientHeight || 0);
    root.style.setProperty('--kcf-normal-vv-width', Math.max(1, Math.round(width)) + 'px');
    root.style.setProperty('--kcf-normal-vv-height', Math.max(1, Math.round(height)) + 'px');
  }

  function scheduleViewportSync(){
    if (!state.open || state.viewportFrame) return;
    state.viewportFrame = requestAnimationFrame(function(){
      state.viewportFrame = 0;
      syncViewport();
    });
  }

  function preventNormalBackgroundTouchMove(event){
    if (!document.body.classList.contains('kcfNormalSheetOpen')) return;
    var target = event.target && event.target.closest ? event.target.closest('.kcfNormalSheetInput') : null;
    if (target && target.scrollHeight > target.clientHeight + 1) return;
    if (event.cancelable) event.preventDefault();
  }

  function syncWarning(){
    var source = document.getElementById('kcfInputWarning');
    var target = warning();
    if (!target) return;
    var text = source ? String(source.textContent || '').trim() : '';
    var show = !!(source && source.classList.contains('show') && text);
    target.textContent = text;
    target.classList.toggle('show', show);
  }

  function bindWarning(){
    if (state.warningObserver) state.warningObserver.disconnect();
    var source = document.getElementById('kcfInputWarning');
    if (!source || typeof MutationObserver !== 'function') return;
    state.warningObserver = new MutationObserver(syncWarning);
    state.warningObserver.observe(source, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
    syncWarning();
  }

  function unbindWarning(){
    if (state.warningObserver) state.warningObserver.disconnect();
    state.warningObserver = null;
  }

  function syncToBase(){
    var source = editor();
    var target = baseInput();
    if (!source || !target || source.value === target.value) return;
    target.value = source.value;
    target.dispatchEvent(new Event('input', { bubbles:true }));
  }

  function syncFromBase(options){
    var opts = options || {};
    var source = baseInput();
    var target = editor();
    if (!source || !target) return;
    if (target.value !== source.value) target.value = source.value;
    target.placeholder = source.placeholder || '수업기록을 적어주세요';
    syncWarning();
    if (opts.focus === true && state.open) focusEditor();
  }

  function focusEditor(){
    var input = editor();
    var keyboard = global.OlliMobileKeyboardActivation;
    if (!input || !state.open || !keyboard) return false;
    keyboard.focus(input, { selectionEnd:true });
    scheduleViewportSync();
    return document.activeElement === input;
  }

  function finishSheetEntrance(){
    var root = overlay();
    if (state.open && root && root.classList.contains('show')) {
      root.classList.add('entrance-complete');
    }
  }

  function scheduleSheetCaretReveal(){
    if (state.caretRevealTimer) clearTimeout(state.caretRevealTimer);
    // Fallback if the browser suppresses transitionend (e.g. reduced motion).
    state.caretRevealTimer = setTimeout(function(){
      state.caretRevealTimer = 0;
      finishSheetEntrance();
    }, 320);
  }

  function ensureSheet(){
    var existing = overlay();
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = 'kcfNormalSheetOverlay';
    root.className = 'kcfNormalSheetOverlay';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = [
      '<section class="kcfNormalSheet" role="dialog" aria-modal="true" aria-label="퀵노트 일반 입력">',
      '  <div class="kcfNormalSheetBody">',
      '    <textarea id="kcfNormalSheetInput" class="kcfNormalSheetInput" aria-label="퀵노트 일반 입력"></textarea>',
      '    <button id="kcfNormalSheetCloseBtn" class="kcfNormalSheetCloseBtn" type="button" aria-label="입력창 닫기" title="입력창 닫기">×</button>',
      '    <div id="kcfNormalSheetWarning" class="kcfNormalSheetWarning" aria-live="polite"></div>',
      '    <div class="kcfNormalSheetBottom">',
      '      <button id="kcfNormalSheetAttachBtn" class="kcfNormalSheetAttachBtn" type="button" aria-label="사진 추가" title="사진 추가">',
      '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
      '      </button>',
      '      <div class="kcfNormalSheetSpacer"></div>',
      '      <button id="kcfNormalSheetClassBtn" class="kcfNormalSheetClassBtn" type="button" aria-label="Class 모드 열기">Class</button>',
      '      <button id="kcfNormalSheetVoiceBtn" class="kcfNormalSheetVoiceBtn" type="button" aria-label="음성 입력" title="음성 입력">',
      '        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">',
      '          <rect x="8" y="3" width="8" height="13" rx="4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></rect>',
      '          <path d="M5 12.5C5 16.09 8.13 19 12 19C15.87 19 19 16.09 19 12.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>',
      '          <path d="M12 19V22" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>',
      '        </svg>',
      '      </button>',
      '      <button id="kcfNormalSheetSendBtn" class="kcfNormalSheetSendBtn" type="button" aria-label="피드백 전송">',
      '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path></svg>',
      '      </button>',
      '    </div>',
      '  </div>',
      '</section>'
    ].join('');
    document.body.appendChild(root);

    var panel = root.querySelector('.kcfNormalSheet');
    if (panel) {
      panel.addEventListener('transitionend', function(event){
        if (event.target !== panel || event.propertyName !== 'transform') return;
        if (state.caretRevealTimer) clearTimeout(state.caretRevealTimer);
        state.caretRevealTimer = 0;
        finishSheetEntrance();
      });
    }

    var input = editor();
    if (input) {
      input.addEventListener('input', function(){
        syncToBase();
        syncWarning();
      });
      input.addEventListener('blur', function(){
        if (state.suppressBlurSync) {
          scheduleViewportSync();
          return;
        }
        if (state.open && !state.submitting) {
          syncToBase();
          close({ sync:false });
          return;
        }
        scheduleViewportSync();
      });
      input.addEventListener('focus', scheduleViewportSync);
    }

    var closeBtn = document.getElementById('kcfNormalSheetCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('pointerdown', function(event){ if (event.cancelable) event.preventDefault(); });
      closeBtn.addEventListener('click', function(event){
        event.preventDefault();
        syncToBase();
        close({ sync:false });
      });
    }

    var attach = document.getElementById('kcfNormalSheetAttachBtn');
    if (attach) {
      attach.addEventListener('pointerdown', function(event){ if (event.cancelable) event.preventDefault(); });
      attach.addEventListener('click', function(event){
        event.preventDefault();
        syncToBase();
        close({ sync:false });
        if (typeof global.openKinderChatFeedbackPhotoPicker === 'function') {
          global.openKinderChatFeedbackPhotoPicker(event);
        } else {
          var source = document.getElementById('kcfAttachBtn');
          if (source) source.click();
        }
      });
    }

    var voice = document.getElementById('kcfNormalSheetVoiceBtn');
    if (voice) {
      voice.addEventListener('pointerdown', function(event){ if (event.cancelable) event.preventDefault(); });
      voice.addEventListener('click', function(event){
        event.preventDefault();
        syncToBase();
        close({ sync:false });
        var source = document.getElementById('kcfVoiceBtn');
        if (source) source.click();
      });
    }

    var classBtn = document.getElementById('kcfNormalSheetClassBtn');
    if (classBtn) {
      classBtn.addEventListener('pointerdown', function(event){ if (event.cancelable) event.preventDefault(); });
      classBtn.addEventListener('click', async function(event){
        event.preventDefault();
        syncToBase();
        close({ sync:false });
        if (typeof global.toggleKinderChatFeedbackTeacherMode === 'function') {
          await global.toggleKinderChatFeedbackTeacherMode(event);
        }
        if (!classModeEnabled()) {
          open(event);
        }
      });
    }

    var send = sendButton();
    if (send) {
      send.addEventListener('pointerdown', function(event){
        if (event.cancelable) event.preventDefault();
      });
      send.addEventListener('click', async function(event){
        event.preventDefault();
        if (state.submitting) return;
        syncToBase();
        state.submitting = true;
        send.disabled = true;
        try {
          if (typeof global.submitKinderChatFeedback === 'function') {
            await global.submitKinderChatFeedback();
          }
          if (state.open) {
            var source = baseInput();
            var sourceWarning = document.getElementById('kcfInputWarning');
            var hasWarning = !!(sourceWarning && sourceWarning.classList.contains('show') && String(sourceWarning.textContent || '').trim());
            var accepted = !!(source && !String(source.value || '').trim() && !hasWarning);
            if (accepted) close({ sync:false });
          }
        } finally {
          state.submitting = false;
          send.disabled = false;
          if (state.open) syncFromBase();
        }
      });
    }

    return root;
  }

  function open(event){
    if (classModeEnabled()) return false;
    try {
      if (typeof global.warmKinderChatFeedbackPromptCache === 'function') {
        global.warmKinderChatFeedbackPromptCache();
      }
    } catch (_) {}
    var root = ensureSheet();
    if (!root) return false;
    state.open = true;
    root.classList.remove('entrance-complete');
    root.classList.add('show');
    scheduleSheetCaretReveal();
    root.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('kcfNormalSheetOpen');
    document.body.classList.add('kcfNormalSheetOpen');
    bindWarning();
    syncFromBase();
    syncViewport();

    var keyboard = global.OlliMobileKeyboardActivation;
    if (!keyboard) return false;
    return !!keyboard.activate(event, {
      input:editor,
      selectionEnd:true,
      afterFocus:function(){ scheduleViewportSync(); }
    });
  }

  function close(options){
    var opts = options || {};
    if (!state.open) return;
    var shouldSync = opts.sync !== false;
    if (shouldSync) syncToBase();
    var activeEditor = editor();
    if (activeEditor && document.activeElement === activeEditor) {
      state.suppressBlurSync = !shouldSync;
      try { activeEditor.blur(); } catch (_) {}
      state.suppressBlurSync = false;
    }
    state.open = false;
    if (state.caretRevealTimer) clearTimeout(state.caretRevealTimer);
    state.caretRevealTimer = 0;
    var root = overlay();
    if (root) {
      root.classList.remove('show', 'entrance-complete');
      root.setAttribute('aria-hidden', 'true');
    }
    unbindWarning();
    document.documentElement.classList.remove('kcfNormalSheetOpen');
    document.body.classList.remove('kcfNormalSheetOpen');
    var inlineInput = baseInput();
    if (inlineInput) {
      try { inlineInput.blur(); } catch (_) {}
    }
    if (state.viewportFrame) cancelAnimationFrame(state.viewportFrame);
    state.viewportFrame = 0;
  }

  function init(){
    ensureSheet();
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', scheduleViewportSync);
    }
    global.addEventListener('resize', scheduleViewportSync);
    if (!global.__kcfNormalSheetTouchLockBound) {
      global.__kcfNormalSheetTouchLockBound = true;
      document.addEventListener('touchmove', preventNormalBackgroundTouchMove, { capture:true, passive:false });
    }
  }

  var api = {
    open:open,
    close:close,
    isOpen:function(){ return state.open; },
    syncFromBase:syncFromBase,
    syncToBase:syncToBase,
    focus:focusEditor
  };
  global.KcfNormalSheet = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})(window);
