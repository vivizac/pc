/* Phone-only QuickNote single composer: dialogue / continuous record. */
(function initKcfTeacherSheet(global) {
  'use strict';

  var state = {
    open:false,
    inlineOpen:false,
    inlineRosterMarker:null,
    inlineRosterNode:null,
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
    if (!state.open && !state.inlineOpen) return;
    var viewport = global.visualViewport;
    var width = viewport ? Number(viewport.width || global.innerWidth || 0) : Math.max(global.innerWidth || 0, document.documentElement.clientWidth || 0);
    var height = viewport ? Number(viewport.height || global.innerHeight || 0) : Math.max(global.innerHeight || 0, document.documentElement.clientHeight || 0);
    if (state.open) {
      var root = overlay();
      if (!root) return;
      root.style.setProperty('--kcf-teacher-vv-width', Math.max(1, Math.round(width)) + 'px');
      root.style.setProperty('--kcf-teacher-vv-height', Math.max(1, Math.round(height)) + 'px');
    }
    if (state.inlineOpen) {
      var layer = document.getElementById('kcfComposerLayer');
      var screen = document.getElementById('kinderChatFeedbackScreen');
      if (!layer || !screen) return;
      var left = viewport ? Number(viewport.offsetLeft || 0) : 0;
      var top = viewport ? Number(viewport.offsetTop || 0) : 0;
      layer.style.setProperty('--kcf-inline-vv-left', Math.round(left) + 'px');
      layer.style.setProperty('--kcf-inline-vv-top', Math.round(top) + 'px');
      layer.style.setProperty('--kcf-inline-vv-width', Math.max(1, Math.round(width)) + 'px');
      layer.style.setProperty('--kcf-inline-vv-height', Math.max(1, Math.round(height)) + 'px');
      // Extra scrollable space is only used when a message arrives. Do not
      // move the message pane or scroll it on keyboard focus/resize.
      var covered = Math.max(0, (global.innerHeight || height) - top - height);
      screen.style.setProperty('--kcf-inline-chat-reserve', Math.ceil(covered + 204) + 'px');
    }
  }

  function scheduleViewportSync(){
    if ((!state.open && !state.inlineOpen) || state.viewportFrame) return;
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
    target.placeholder = '수업 기록을 적어주세요';
    syncWarning();
    if (opts.focus === true && state.open) focusEditor();
    else if (opts.focus === true && state.inlineOpen) {
      global.OlliMobileKeyboardActivation?.focus(source, { selectionEnd:true });
    }
  }

  function focusEditor(){
    var keyboard = global.OlliMobileKeyboardActivation;
    if (state.inlineOpen && keyboard) {
      var base = keyboard.focus(baseInput(), { selectionEnd:true });
      scheduleViewportSync();
      return !!base && document.activeElement === base;
    }
    var input = editor();
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

  function placeModeButton(host){
    if (!host) return;
    var modeButton = document.getElementById('kcfModeSwitchBtn');
    if (!modeButton) {
      modeButton = document.createElement('button');
      modeButton.id = 'kcfModeSwitchBtn';
      modeButton.type = 'button';
      modeButton.className = 'kcfComposerModeBtn';
      modeButton.setAttribute('aria-label', '연속기록으로 전환');
      modeButton.innerHTML = '<span class="kcfComposerModeLabel">대화</span>'
        + '<svg class="kcfModeChevron" viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="m6 9 6 6 6-6"></path></svg>';
      attachModeToggle(modeButton);
    }
    if (host.classList.contains('kcfComposerBottom')) {
      host.insertBefore(modeButton, document.getElementById('kcfVoiceBtn'));
    } else host.appendChild(modeButton);
    syncModeUi();
  }

  function mountInlineRoster(){
    var roster = document.getElementById('kcfAutoStudentRoster');
    var bottom = document.querySelector('#kinderChatFeedbackScreen .kcfComposerBottom');
    if (!roster || !bottom || roster.parentNode === bottom) return;
    if (!state.inlineRosterMarker && roster.parentNode) {
      state.inlineRosterMarker = document.createComment('kcf-inline-roster-home');
      roster.parentNode.insertBefore(state.inlineRosterMarker, roster);
    }
    state.inlineRosterNode = roster;
    bottom.insertBefore(roster, document.getElementById('kcfVoiceBtn'));
  }

  function restoreInlineRoster(){
    if (state.inlineRosterNode && state.inlineRosterMarker?.parentNode) {
      state.inlineRosterMarker.parentNode.insertBefore(state.inlineRosterNode, state.inlineRosterMarker);
      state.inlineRosterMarker.remove();
    }
    state.inlineRosterMarker = null;
    state.inlineRosterNode = null;
  }

  // Preserve the existing button nodes, handlers and recording workflow.
  function mountSheetControls(){
    if (state.portaledControls.length) return;
    placeModeButton(sheetHost('kcfTeacherSheetModeHost'));
    [
      ['kcfAttachBtn','kcfTeacherSheetAttachHost'],
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
    syncModeUi();
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
    var wasContinuous = document.body.classList.contains('kcfContinuousMode');
    document.body.classList.toggle('kcfContinuousMode', continuous);
    if (continuous) document.body.classList.remove('kcfFeedbackCollectView');
    if (!continuous || !wasContinuous) document.body.classList.remove('kcfContinuousFeedbackFolded');
    if (typeof global.syncPhoneKcfContinuousRecordUi === 'function') {
      global.syncPhoneKcfContinuousRecordUi();
    }
    ['kcfModeSwitchBtn'].forEach(function(id){
      var btn = document.getElementById(id);
      if (!btn) return;
      var label = btn.querySelector('.kcfComposerModeLabel');
      if (label) label.textContent = continuous ? '연속기록' : '대화';
      btn.setAttribute('aria-label', continuous ? '대화로 전환' : '연속기록으로 전환');
    });
  }
  function setComposerMode(mode, event){
    var previous = state.composerMode;
    state.composerMode = mode === 'continuous' ? 'continuous' : 'dialogue';
    syncModeUi();
    if (previous === state.composerMode) return;
    if (state.inlineOpen && state.composerMode === 'continuous') {
      closeInline({ skipBlur:true });
      open(event);
    } else if (state.open && state.composerMode === 'dialogue') {
      close({ sync:true });
      openInline(event);
    }
  }
  function attachModeToggle(btn){
    if (!btn || btn.__kcfModeBound) return;
    btn.__kcfModeBound = true;
    btn.addEventListener('pointerdown',function(e){ if(e.cancelable)e.preventDefault(); });
    btn.addEventListener('click',function(event){
      event.preventDefault();
      event.stopPropagation();
      setComposerMode(state.composerMode === 'dialogue' ? 'continuous' : 'dialogue', event);
    });
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
      '    <button id="kcfTeacherSheetCloseBtn" class="kcfTeacherSheetCloseBtn" type="button" aria-label="입력창 닫기" title="입력창 닫기">×</button>',
      '    <div id="kcfTeacherSheetWarning" class="kcfTeacherSheetWarning" aria-live="polite"></div>',
      '    <div id="kcfTeacherSheetPhotoHost" class="kcfTeacherSheetPhotoHost"></div>',
      '    <div id="kcfTeacherSheetRosterHost" class="kcfTeacherSheetRosterHost" hidden></div>',
      '    <div class="kcfTeacherSheetBottom">',
      '      <div id="kcfTeacherSheetAttachHost" class="kcfTeacherSheetControlHost"></div>',
      '      <div class="kcfTeacherSheetSpacer"></div>',
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

    var closeBtn = document.getElementById('kcfTeacherSheetCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('pointerdown',function(event){ if(event.cancelable) event.preventDefault(); });
      closeBtn.addEventListener('click',function(event){
        event.preventDefault();
        syncToBase();
        close({ sync:false });
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

  // Like TeamChat: the keyboard follows visualViewport, while only the
  // composer height morphs (47px ↔ 183px) over 190ms.
  var inlineComposerAnimation = null;
  function animateInlineComposer(composer, fromHeight){
    if (inlineComposerAnimation) {
      var previous = inlineComposerAnimation;
      inlineComposerAnimation = null;
      previous.cancel();
      composer?.style.removeProperty('overflow');
    }
    if (!composer || !composer.isConnected || typeof composer.animate !== 'function') return;
    try {
      if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch (_) {}
    var toHeight = composer.getBoundingClientRect().height;
    if (!Number.isFinite(fromHeight) || !Number.isFinite(toHeight) || Math.abs(toHeight - fromHeight) < 1) return;

    composer.style.overflow = 'hidden';
    var animation;
    try {
      animation = composer.animate([
        { height:fromHeight+'px', minHeight:'0px', maxHeight:fromHeight+'px' },
        { height:toHeight+'px', minHeight:'0px', maxHeight:toHeight+'px' }
      ], { duration:190, easing:'cubic-bezier(.2,.65,.2,1)' });
    } catch (_) {
      composer.style.removeProperty('overflow');
      return;
    }
    inlineComposerAnimation = animation;
    var finish = function(){
      if (inlineComposerAnimation !== animation) return;
      inlineComposerAnimation = null;
      composer.style.removeProperty('overflow');
    };
    animation.addEventListener('finish', finish, { once:true });
    animation.addEventListener('cancel', finish, { once:true });
  }

  function openInline(event){
    if (state.open) close({ sync:true });
    var input = baseInput();
    var screen = document.getElementById('kinderChatFeedbackScreen');
    var keyboard = global.OlliMobileKeyboardActivation;
    if (!input || !screen || !keyboard) return false;
    if (!state.inlineOpen) {
      var composer = screen.querySelector('.kcfComposer');
      var fromHeight = composer?.getBoundingClientRect().height;
      state.inlineOpen = true;
      screen.classList.add('kcfInlineDialogueActive');
      input.readOnly = false;
      input.rows = 5;
      placeModeButton(screen.querySelector('.kcfComposerBottom'));
      mountInlineRoster();
      var teacherMode = global.KcfTeacherMode || global.KcfAutoMode;
      teacherMode?.refreshRoster?.();
      global.autoResizeKinderChatFeedbackInput?.(input);
      syncViewport();
      animateInlineComposer(composer, fromHeight);
    }
    return !!keyboard.activate(event, {
      input:input,
      selectionEnd:true,
      afterFocus:scheduleViewportSync
    });
  }

  function closeInline(options){
    if (!state.inlineOpen) return;
    var opts = options || {};
    state.inlineOpen = false;
    var input = baseInput();
    var screen = document.getElementById('kinderChatFeedbackScreen');
    var composer = screen?.querySelector('.kcfComposer');
    var fromHeight = composer?.getBoundingClientRect().height;
    if (screen) {
      screen.classList.remove('kcfInlineDialogueActive');
      screen.style.removeProperty('--kcf-inline-chat-reserve');
    }
    restoreInlineRoster();
    document.getElementById('kcfModeSwitchBtn')?.remove();
    if (input) {
      input.readOnly = true;
      input.rows = 1;
      if (!opts.skipBlur && document.activeElement === input) input.blur();
      global.autoResizeKinderChatFeedbackInput?.(input);
    }
    animateInlineComposer(composer, fromHeight);
  }

  function open(event){
    if (state.composerMode !== 'continuous') return openInline(event);
    if (!modeEnabled()) return false;
    if (state.inlineOpen) closeInline({ skipBlur:true });
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
    var teacherMode = global.KcfTeacherMode || global.KcfAutoMode;
    if (teacherMode && typeof teacherMode.refreshRoster === 'function') teacherMode.refreshRoster();
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
    if (!state.open) {
      closeInline();
      return;
    }
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
    document.getElementById('kcfModeSwitchBtn')?.remove();
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
    syncModeUi();
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', scheduleViewportSync);
      global.visualViewport.addEventListener('scroll', scheduleViewportSync);
    }
    global.addEventListener('resize', scheduleViewportSync);
    var inline = baseInput();
    if (inline) {
      inline.addEventListener('blur', function(){
        if (state.inlineOpen) closeInline({ skipBlur:true });
      });
    }
    var bottom = document.querySelector('#kinderChatFeedbackScreen .kcfComposerBottom');
    if (bottom) bottom.addEventListener('pointerdown', function(event){
      if (state.inlineOpen && event.target.closest('button, [role="button"]') && event.cancelable) {
        event.preventDefault();
      }
    }, true);
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
    isOpen:function(){ return state.open || state.inlineOpen; },
    isSheetOpen:function(){ return state.open; },
    openInline:openInline,
    closeInline:closeInline,
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
