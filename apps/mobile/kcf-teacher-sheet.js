/* Phone-only QuickNote single composer: dialogue / continuous record. */
(function initKcfTeacherSheet(global) {
  'use strict';

  var state = {
    open:false,
    submitting:false,
    rosterMarker:null,
    rosterNode:null,
    portaledControls:[],
    warningObserver:null,
    viewportFrame:0,
    caretRevealTimer:0,
    suppressBlurSync:false,
    composerMode:'dialogue'
  };

  function baseInput(){ return document.getElementById('kcfInput'); }
  function overlay(){ return document.getElementById('kcfTeacherSheetOverlay'); }
  function editor(){ return document.getElementById('kcfTeacherSheetInput'); }
  function rosterHost(){ return document.getElementById('kcfTeacherSheetRosterHost'); }
  function sheetHost(id){ return document.getElementById(id); }
  function warning(){ return document.getElementById('kcfTeacherSheetWarning'); }
  function sendButton(){ return document.getElementById('kcfTeacherSheetSendBtn'); }

  function modeEnabled(){
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
    var keyboard = global.OlliMobileKeyboardActivation;
    if (!input || !state.open || !keyboard) return false;
    keyboard.focus(input, { selectionEnd:true });
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

  // Move the existing buttons, not copies: click handlers and identity stay intact.
  function mountSheetControls(){
    if (state.portaledControls.length) return;
    [
      ['kcfAttachBtn','kcfTeacherSheetAttachHost'],
      ['kcfModeSwitchBtn','kcfTeacherSheetModeHost'],
      ['kcfVoiceBtn','kcfTeacherSheetVoiceHost'],
      ['kcfPhotoPreview','kcfTeacherSheetPhotoHost']
    ].forEach(function(pair){
      var node = document.getElementById(pair[0]);
      var host = sheetHost(pair[1]);
      if (!node || !host || !node.parentNode) return;
      var marker = document.createComment('kcf-sheet-control-home:' + pair[0]);
      node.parentNode.insertBefore(marker,node);
      state.portaledControls.push({ node:node,marker:marker });
      host.appendChild(node);
    });
    var mic = document.getElementById('kcfVoiceBtn');
    if (mic && !mic.__kcfTeacherVoiceBridgeBound) {
      mic.__kcfTeacherVoiceBridgeBound = true;
      mic.addEventListener('pointerdown', function(event){
        if (state.open && event.cancelable) event.preventDefault();
      });
      mic.addEventListener('click', function(event){
        if (!state.open) return;
        // The original microphone targets the inline composer. Return it home
        // before invoking the existing voice recorder so its capture UI is visible.
        event.preventDefault();
        event.stopImmediatePropagation();
        close({ sync:true });
        var voice = global.KcfVoiceTranscription;
        if (voice && typeof voice.toggle === 'function') voice.toggle(event);
      }, true);
    }
    var photo = document.getElementById('kcfAttachBtn');
    if (photo && !photo.__kcfTeacherPhotoPointerBound) {
      photo.__kcfTeacherPhotoPointerBound = true;
      photo.addEventListener('pointerdown', function(event){
        if (state.open && event.cancelable) event.preventDefault();
      });
    }
  }

  function restoreSheetControls(){
    for (var i=state.portaledControls.length-1;i>=0;i--) {
      var entry=state.portaledControls[i];
      if (!entry.marker.parentNode) continue;
      entry.marker.parentNode.insertBefore(entry.node,entry.marker);
      entry.marker.remove();
    }
    state.portaledControls=[];
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
    }, 420);
  }

  function syncModeUi(){
    var continuous = state.composerMode === 'continuous';
    document.body.classList.toggle('kcfContinuousMode', continuous);
    var todayView = document.getElementById('kcfTodayRecordsView');
    if (todayView) todayView.hidden = !continuous;
    if (continuous && typeof global.renderKinderChatFeedbackTodayRecords === 'function') {
      global.renderKinderChatFeedbackTodayRecords();
    }
    ['kcfModeSwitchBtn'].forEach(function(id){
      var btn = document.getElementById(id);
      if (!btn) return;
      var label = btn.querySelector('.kcfComposerModeLabel');
      if (label) label.textContent = continuous ? '연속기록' : '대화';
      btn.setAttribute('aria-label', continuous ? '연속기록 모드 선택' : '대화 모드 선택');
    });
  }
  function closeModeMenus(){
    document.querySelectorAll('.kcfComposerModeMenu').forEach(function(menu){ menu.remove(); });
    document.querySelectorAll('.kcfComposerModeBtn[aria-expanded]').forEach(function(btn){ btn.setAttribute('aria-expanded','false'); });
  }
  function setComposerMode(mode){
    state.composerMode = mode === 'continuous' ? 'continuous' : 'dialogue';
    closeModeMenus();
    syncModeUi();
  }
  function attachModeSelector(btn){
    if (!btn || btn.__kcfModeBound) return;
    btn.__kcfModeBound = true;
    btn.addEventListener('pointerdown',function(e){ if(e.cancelable)e.preventDefault(); });
    btn.addEventListener('click',function(e){
      e.preventDefault(); e.stopPropagation();
      var wasOpen = btn.getAttribute('aria-expanded') === 'true';
      closeModeMenus();
      if(wasOpen)return;
      var menu = document.createElement('div');
      menu.className = 'kcfComposerModeMenu';
      menu.setAttribute('role','menu');
      [['dialogue','대화'],['continuous','연속기록']].forEach(function(mode){
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'kcfComposerModeOption';
        item.textContent = mode[1];
        item.setAttribute('role','menuitemradio');
        item.setAttribute('aria-checked',String(mode[0] === state.composerMode));
        item.addEventListener('pointerdown',function(event){ if(event.cancelable)event.preventDefault(); });
        item.addEventListener('click',function(event){
          event.preventDefault();event.stopPropagation();setComposerMode(mode[0]);
        });
        menu.appendChild(item);
      });
      btn.parentNode.appendChild(menu);
      btn.setAttribute('aria-expanded','true');
    });
  }
  document.addEventListener('click',function(e){
    if(!e.target || !e.target.closest || !e.target.closest('.kcfComposerModeMenu, .kcfComposerModeBtn'))closeModeMenus();
  });

  function ensureSheet(){
    var existing = overlay();
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = 'kcfTeacherSheetOverlay';
    root.className = 'kcfTeacherSheetOverlay';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = [
      '<section class="kcfTeacherSheet" role="dialog" aria-modal="true" aria-label="Class 수업기록 입력">',
      '  <div class="kcfTeacherSheetBody">',
      '    <textarea id="kcfTeacherSheetInput" class="kcfTeacherSheetInput" aria-label="Class 수업기록"></textarea>',
      '    <div id="kcfTeacherSheetWarning" class="kcfTeacherSheetWarning" aria-live="polite"></div>',
      '    <div id="kcfTeacherSheetPhotoHost" class="kcfTeacherSheetPhotoHost"></div>',
      '    <div class="kcfTeacherSheetBottom">',
      '      <div id="kcfTeacherSheetAttachHost" class="kcfTeacherSheetControlHost"></div>',
      '      <div id="kcfTeacherSheetRosterHost" class="kcfTeacherSheetRosterHost"></div>',
      '      <div id="kcfTeacherSheetModeHost" class="kcfTeacherSheetControlHost"></div>',
      '      <div id="kcfTeacherSheetVoiceHost" class="kcfTeacherSheetControlHost"></div>',
      '      <button id="kcfTeacherSheetSendBtn" class="kcfTeacherSheetSendBtn" type="button" aria-label="피드백 전송">',
      '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path></svg>',
      '      </button>',
      '    </div>',
      '  </div>',
      '</section>'
    ].join('');
    document.body.appendChild(root);

    var panel = root.querySelector('.kcfTeacherSheet');
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
            if (accepted && state.composerMode !== 'continuous') close({ sync:false });
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

  function open(event){
    if (!modeEnabled()) return false;
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
    document.documentElement.classList.add('kcfTeacherSheetOpen');
    document.body.classList.add('kcfTeacherSheetOpen');
    mountRoster();
    mountSheetControls();
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
    // Mark closed before blur; otherwise the blur listener can recursively close.
    state.open = false;
    var activeEditor = editor();
    if (activeEditor && document.activeElement === activeEditor) {
      state.suppressBlurSync = true;
      try { activeEditor.blur(); } catch (_) {}
      state.suppressBlurSync = false;
    }
    if (state.caretRevealTimer) clearTimeout(state.caretRevealTimer);
    state.caretRevealTimer = 0;
    var root = overlay();
    if (root) {
      root.classList.remove('show', 'entrance-complete');
      root.setAttribute('aria-hidden', 'true');
    }
    restoreRoster();
    restoreSheetControls();
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
    attachModeSelector(document.getElementById('kcfModeSwitchBtn'));
    syncModeUi();
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', scheduleViewportSync);
    }
    global.addEventListener('resize', scheduleViewportSync);
    if (!global.__kcfTeacherSheetTouchLockBound) {
      global.__kcfTeacherSheetTouchLockBound = true;
      document.addEventListener('touchmove', preventTeacherBackgroundTouchMove, { capture:true, passive:false });
    }
  }

  function onSuccessfulSubmit(){
    if (!state.open || state.composerMode === 'continuous') return;
    close({ sync:false });
  }

  var api = {
    open:open,
    close:close,
    isOpen:function(){ return state.open; },
    syncFromBase:syncFromBase,
    syncToBase:syncToBase,
    focus:focusEditor,
    onSuccessfulSubmit:onSuccessfulSubmit,
    getMode:function(){ return state.composerMode; },
    setMode:setComposerMode
  };
  global.KcfTeacherSheet = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})(window);
