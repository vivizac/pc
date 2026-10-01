/* Phone-only QuickNote composer sheet shared by normal and Class modes.
 * #kcfInput remains the storage/source field while all keyboard editing happens here.
 */
(function initKcfTeacherSheet(global) {
  'use strict';

  var state = {
    open:false,
    submitting:false,
    rosterMarker:null,
    rosterNode:null,
    warningObserver:null,
    viewportFrame:0,
    suppressBlurSync:false
  };

  function baseInput(){ return document.getElementById('kcfInput'); }
  function overlay(){ return document.getElementById('kcfTeacherSheetOverlay'); }
  function editor(){ return document.getElementById('kcfTeacherSheetInput'); }
  function rosterHost(){ return document.getElementById('kcfTeacherSheetRosterHost'); }
  function normalSpacer(){ return document.getElementById('kcfTeacherSheetNormalSpacer'); }
  function attachButton(){ return document.getElementById('kcfTeacherSheetAttachBtn'); }
  function voiceButton(){ return document.getElementById('kcfTeacherSheetVoiceBtn'); }
  function warning(){ return document.getElementById('kcfTeacherSheetWarning'); }
  function sendButton(){ return document.getElementById('kcfTeacherSheetSendBtn'); }

  function modeEnabled(){
    var mode = global.KcfTeacherMode || global.KcfAutoMode;
    try { return !!(mode && typeof mode.isEnabled === 'function' && mode.isEnabled()); }
    catch (_) { return false; }
  }

  function syncModeUi(){
    var enabled = modeEnabled();
    var modeBtn = document.getElementById('kcfTeacherSheetModeBtn');
    if (modeBtn) {
      modeBtn.classList.toggle('active', enabled);
      modeBtn.textContent = enabled ? 'C' : 'Class';
      modeBtn.setAttribute('aria-label', enabled ? 'Class 모드 닫기' : 'Class 모드 열기');
      modeBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      modeBtn.title = enabled ? 'Class 모드 닫기' : 'Class 모드 열기';
    }
    var host = rosterHost();
    var spacer = normalSpacer();
    var attach = attachButton();
    var voice = voiceButton();
    if (host) host.hidden = !enabled;
    if (spacer) spacer.hidden = enabled;
    if (attach) attach.hidden = enabled;
    if (voice) voice.hidden = enabled;
  }

  function syncViewport(){
    var root = overlay();
    if (!root || !state.open) return;
    var viewport = global.visualViewport;
    var width = viewport ? Number(viewport.width || global.innerWidth || 0) : Math.max(global.innerWidth || 0, document.documentElement.clientWidth || 0);
    var height = viewport ? Number(viewport.height || global.innerHeight || 0) : Math.max(global.innerHeight || 0, document.documentElement.clientHeight || 0);
    var left = viewport ? Number(viewport.offsetLeft || 0) : 0;
    var top = viewport ? Number(viewport.offsetTop || 0) : 0;
    root.style.setProperty('--kcf-teacher-vv-left', Math.round(left) + 'px');
    root.style.setProperty('--kcf-teacher-vv-top', Math.round(top) + 'px');
    root.style.setProperty('--kcf-teacher-vv-width', Math.max(1, Math.round(width)) + 'px');
    root.style.setProperty('--kcf-teacher-vv-height', Math.max(1, Math.round(height)) + 'px');
  }

  function scheduleViewportSync(){
    if (!state.open || state.viewportFrame) return;
    state.viewportFrame = requestAnimationFrame(function(){
      state.viewportFrame = 0;
      syncViewport();
    });
  }

  function teacherScrollableTarget(target){
    if (!target || !target.closest) return null;
    return target.closest('.kcfTeacherSheetInput, .kcfAutoStudentRosterScroller');
  }

  function preventTeacherBackgroundTouchMove(event){
    if (!document.body.classList.contains('kcfTeacherSheetOpen')) return;
    var scrollable = teacherScrollableTarget(event.target);
    if (scrollable) {
      if (scrollable.classList.contains('kcfAutoStudentRosterScroller')) return;
      if (scrollable.scrollHeight > scrollable.clientHeight + 1) return;
    }
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
    if (!input || !state.open) return false;
    try { input.focus({ preventScroll:true }); } catch (_) { try { input.focus(); } catch (ignore) {} }
    if (document.activeElement !== input) {
      try { input.focus(); } catch (_) {}
    }
    var end = String(input.value || '').length;
    try { input.setSelectionRange(end, end); } catch (_) {}
    try { input.scrollTop = input.scrollHeight; } catch (_) {}
    scheduleViewportSync();
    return document.activeElement === input;
  }

  function mountRoster(){
    var host = rosterHost();
    var roster = document.getElementById('kcfAutoStudentRoster');
    if (!host || !roster || roster.parentNode === host) return;
    if (!state.rosterMarker && roster.parentNode) {
      state.rosterMarker = document.createComment('kcf-teacher-roster-home');
      roster.parentNode.insertBefore(state.rosterMarker, roster);
    }
    state.rosterNode = roster;
    host.appendChild(roster);
    roster.hidden = false;
  }

  function restoreRoster(){
    if (state.rosterNode && state.rosterMarker && state.rosterMarker.parentNode) {
      state.rosterMarker.parentNode.insertBefore(state.rosterNode, state.rosterMarker);
      state.rosterMarker.remove();
    }
    state.rosterMarker = null;
    state.rosterNode = null;
  }

  function ensureSheet(){
    var existing = overlay();
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = 'kcfTeacherSheetOverlay';
    root.className = 'kcfTeacherSheetOverlay';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = [
      '<section class="kcfTeacherSheet" role="dialog" aria-modal="true" aria-label="퀵노트 수업기록 입력">',
      '  <div class="kcfTeacherSheetBody">',
      '    <textarea id="kcfTeacherSheetInput" class="kcfTeacherSheetInput" aria-label="퀵노트 수업기록"></textarea>',
      '    <div id="kcfTeacherSheetWarning" class="kcfTeacherSheetWarning" aria-live="polite"></div>',
      '    <div class="kcfTeacherSheetBottom">',
      '      <button id="kcfTeacherSheetAttachBtn" class="kcfTeacherSheetAttachBtn" type="button" aria-label="사진 추가" title="사진 추가">',
      '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
      '      </button>',
      '      <div id="kcfTeacherSheetNormalSpacer" class="kcfTeacherSheetNormalSpacer"></div>',
      '      <button id="kcfTeacherSheetModeBtn" class="kcfTeacherSheetModeBtn" type="button" aria-label="Class 모드 열기" aria-pressed="false">Class</button>',
      '      <div id="kcfTeacherSheetRosterHost" class="kcfTeacherSheetRosterHost" hidden></div>',
      '      <button id="kcfTeacherSheetVoiceBtn" class="kcfTeacherSheetVoiceBtn" type="button" aria-label="음성 입력" title="음성 입력">',
      '        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">',
      '          <rect x="8" y="3" width="8" height="13" rx="4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></rect>',
      '          <path d="M5 12.5C5 16.09 8.13 19 12 19C15.87 19 19 16.09 19 12.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>',
      '          <path d="M12 19V22" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>',
      '        </svg>',
      '      </button>',
      '      <button id="kcfTeacherSheetSendBtn" class="kcfTeacherSheetSendBtn" type="button" aria-label="피드백 전송">',
      '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path></svg>',
      '      </button>',
      '    </div>',
      '  </div>',
      '</section>'
    ].join('');
    document.body.appendChild(root);

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

        // iOS keyboard accessory ✓ ends textarea focus rather than emitting
        // a dedicated key event. Treat that focus end as Cancel:
        // preserve the draft, close Teacher, and return to the inline composer.
        if (state.open && !state.submitting) {
          syncToBase();
          close({ sync:false });
          return;
        }
        scheduleViewportSync();
      });
      input.addEventListener('focus', scheduleViewportSync);
    }

    var attach = attachButton();
    if (attach) {
      attach.addEventListener('pointerdown', function(event){ if (event.cancelable) event.preventDefault(); });
      attach.addEventListener('click', function(event){
        event.preventDefault();
        if (modeEnabled()) return;
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

    var voice = voiceButton();
    if (voice) {
      voice.addEventListener('pointerdown', function(event){ if (event.cancelable) event.preventDefault(); });
      voice.addEventListener('click', function(event){
        event.preventDefault();
        if (modeEnabled()) return;
        syncToBase();
        close({ sync:false });
        var source = document.getElementById('kcfVoiceBtn');
        if (source) source.click();
      });
    }

    var modeBtn = document.getElementById('kcfTeacherSheetModeBtn');
    if (modeBtn) {
      modeBtn.addEventListener('pointerdown', function(event){ if (event.cancelable) event.preventDefault(); });
      modeBtn.addEventListener('click', async function(event){
        event.preventDefault();
        if (typeof global.toggleKinderChatFeedbackTeacherMode === 'function') {
          await global.toggleKinderChatFeedbackTeacherMode(event);
        }
        if (!state.open) return;
        syncModeUi();
        if (modeEnabled()) mountRoster();
        else restoreRoster();
        syncFromBase();
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

    var host = rosterHost();
    if (host) {
      host.addEventListener('pointerdown', function(event){
        var chip = event.target && event.target.closest ? event.target.closest('.kcfAutoStudentChip') : null;
        if (chip && event.cancelable) event.preventDefault();
      }, true);
      host.addEventListener('click', function(){
        requestAnimationFrame(function(){ syncFromBase(); });
      }, true);
    }

    return root;
  }

  function open(){
    try {
      if (typeof global.warmKinderChatFeedbackPromptCache === 'function') {
        global.warmKinderChatFeedbackPromptCache();
      }
    } catch (_) {}
    var root = ensureSheet();
    if (!root) return false;
    state.open = true;
    root.classList.add('show');
    root.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('kcfTeacherSheetOpen');
    document.body.classList.add('kcfTeacherSheetOpen');
    syncModeUi();
    if (modeEnabled()) mountRoster();
    else restoreRoster();
    bindWarning();
    syncFromBase();
    syncViewport();

    // Focus synchronously first so iOS shows the cursor/keyboard in the same tap.
    focusEditor();
    requestAnimationFrame(function(){
      syncViewport();
      focusEditor();
    });
    setTimeout(focusEditor, 40);
    return true;
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
    var root = overlay();
    if (root) {
      root.classList.remove('show');
      root.setAttribute('aria-hidden', 'true');
    }
    restoreRoster();
    unbindWarning();
    document.documentElement.classList.remove('kcfTeacherSheetOpen');
    document.body.classList.remove('kcfTeacherSheetOpen');
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
      global.visualViewport.addEventListener('scroll', scheduleViewportSync);
    }
    global.addEventListener('resize', scheduleViewportSync);
    if (!global.__kcfTeacherSheetTouchLockBound) {
      global.__kcfTeacherSheetTouchLockBound = true;
      document.addEventListener('touchmove', preventTeacherBackgroundTouchMove, { capture:true, passive:false });
    }
  }

  function onSuccessfulSubmit(){
    if (!state.open) return;
    close({ sync:false });
  }

  var api = {
    open:open,
    close:close,
    isOpen:function(){ return state.open; },
    syncFromBase:syncFromBase,
    syncToBase:syncToBase,
    syncModeUi:syncModeUi,
    focus:focusEditor,
    onSuccessfulSubmit:onSuccessfulSubmit
  };
  global.KcfTeacherSheet = api;
  global.KcfComposerSheet = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})(window);
