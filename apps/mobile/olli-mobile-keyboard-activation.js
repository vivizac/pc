(function initOlliMobileKeyboardActivation(global){
  'use strict';

  function stopEvent(event){
    if (!event) return;
    if (event.cancelable !== false) event.preventDefault();
    event.stopPropagation();
  }

  function resolveInput(input){
    return typeof input === 'function' ? input() : input;
  }

  function focus(input, options){
    var target = resolveInput(input);
    var opts = options || {};
    if (!target || typeof target.focus !== 'function') return null;
    try { target.focus({ preventScroll:true }); }
    catch (_) { try { target.focus(); } catch (ignore) { return null; } }

    if (opts.selectionEnd === true) {
      var end = String(target.value || '').length;
      try { target.setSelectionRange(end, end); } catch (_) {}
    }
    if (opts.scrollToEnd === true) {
      try { target.scrollTop = target.scrollHeight; } catch (_) {}
    }
    return target;
  }

  function activate(event, options){
    var opts = options || {};
    stopEvent(event);
    if (typeof opts.beforeFocus === 'function' && opts.beforeFocus() === false) return null;
    var target = focus(opts.input, opts);
    if (!target) return null;
    if (typeof opts.afterFocus === 'function') opts.afterFocus(target);
    return target;
  }

  global.OlliMobileKeyboardActivation = Object.freeze({
    stopEvent:stopEvent,
    focus:focus,
    activate:activate
  });
})(window);
