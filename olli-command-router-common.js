(function olliCommandRouterCommon(global) {
  'use strict';

  if (global.OlliCommandRouter) return;

  const VERSION = '2026-09-18-skeleton-1';

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
  }

  function normalizeContext(context) {
    const source = String(context && context.source || '').trim();
    return {
      source: source || 'unknown',
      selectedStudent: context && context.selectedStudent ? context.selectedStudent : null,
      autoSubmitContext: context && context.autoSubmitContext ? context.autoSubmitContext : null
    };
  }

  async function route(text, context) {
    const normalizedText = cleanText(text);
    normalizeContext(context);

    // Stage 1 is intentionally pass-through only.
    // Command recognition/execution will be added behind this stable entry point.
    return {
      handled: false,
      kind: 'feedback',
      intent: '',
      text: normalizedText,
      message: '',
      clearInput: false,
      payload: null
    };
  }

  global.OlliCommandRouter = Object.freeze({
    VERSION,
    route
  });
})(window);
