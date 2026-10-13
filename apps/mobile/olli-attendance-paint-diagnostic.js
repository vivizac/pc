(() => {
  'use strict';
  // Local, opt-in visual diagnostics only. No student names, IDs, network, or storage.
  const BUTTON_SELECTOR = 'button[onclick*="openOlliMainSubpageDrawer"]';
  const HOLD_MS = 1200;
  const MAX_RUNS = 5;
  const SAMPLE_MS = 690;
  const CARD_SELECTOR = '.elementaryStudentRow,.kinderStudentRow';
  let enabled = false;
  let panel = null;
  let textArea = null;
  let holdTimer = 0;
  let heldButton = null;
  let downPoint = null;
  let suppressButton = null;
  let suppressUntil = 0;
  let active = null;
  const results = [];

  const now = () => performance.now();
  const since = r => Math.round((now() - r.t) * 10) / 10;
  const isInstalled = () => !!(navigator.standalone
    || window.matchMedia?.('(display-mode: standalone)').matches);
  const cardCount = () => document.querySelectorAll('#recordList ' + CARD_SELECTOR.replace(',', ',#recordList ')).length;
  const reportValue = n => n == null ? '-' : n;
  const timeline = (r, what) => {
    if (r && r.events.length < 25) r.events.push(Math.round(since(r)) + 'ms ' + what);
  };

  function roomSnapshot(room) {
    if (!room) return 'missing';
    const style = getComputedStyle(room);
    const bounds = room.getBoundingClientRect();
    return [
      'display=' + style.display,
      'visibility=' + style.visibility,
      'opacity=' + style.opacity,
      'transform=' + style.transform,
      'size=' + Math.round(bounds.width) + 'x' + Math.round(bounds.height),
      'prepared=' + room.classList.contains('olliAttendanceRearPrepared'),
      'drawer=' + room.classList.contains('olliMainDrawerSubpage'),
      'revealed=' + room.classList.contains('is-olli-attendance-revealed')
    ].join(' ');
  }

  function installObservers(r) {
    const list = document.getElementById('recordList');
    if (typeof MutationObserver !== 'function') return;
    const record = new MutationObserver(entries => {
      for (const entry of entries) {
        r.listMutations++;
        r.nodesAdded += entry.addedNodes.length;
        r.nodesRemoved += entry.removedNodes.length;
      }
      timeline(r, 'list nodes changed');
    });
    if (list) record.observe(list, { childList: true, subtree: true });
    r.observers.push(record);

    const attributes = (node, field, filter) => {
      if (!node) return;
      const observer = new MutationObserver(entries => {
        r[field] += entries.length;
        timeline(r, field + ' (' + entries.length + ')');
      });
      observer.observe(node, { attributes: true, attributeFilter: filter });
      r.observers.push(observer);
    };
    attributes(r.room, 'rearAttrs', ['style', 'class', 'aria-hidden', 'inert']);
    attributes(r.front, 'frontAttrs', ['style', 'class']);
    attributes(document.body, 'bodyAttrs', ['class']);
  }

  function sampleFrames(r) {
    const sample = time => {
      if (active !== r || r.finished) return;
      if (r.lastFrame !== null) {
        const gap = time - r.lastFrame;
        r.maxGap = Math.max(r.maxGap, gap);
        if (gap > 25) r.slowFrames++;
      }
      r.lastFrame = time;
      r.frameCount++;
      const elapsed = time - (r.slideT || r.t);
      if (elapsed >= 160 && !r.middleSnapshot) r.middleSnapshot = roomSnapshot(r.room);
      if (elapsed < SAMPLE_MS) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }

  function finish(r, outcome) {
    if (!r || r.finished) return;
    r.finished = true;
    r.outcome = outcome;
    r.endMs = since(r);
    r.after = roomSnapshot(r.room);
    r.cardsAfter = cardCount();
    for (const observer of r.observers) {
      observer.takeRecords().forEach(entry => {
        if (entry.type === 'childList') {
          r.listMutations++;
          r.nodesAdded += entry.addedNodes.length;
          r.nodesRemoved += entry.removedNodes.length;
        } else if (entry.target === r.room) r.rearAttrs++;
        else if (entry.target === r.front) r.frontAttrs++;
        else if (entry.target === document.body) r.bodyAttrs++;
      });
      observer.disconnect();
    }
    r.observers = [];
    timeline(r, outcome);
    results.unshift(r);
    results.length = Math.min(results.length, MAX_RUNS);
    if (active === r) active = null;
    showPanel();
  }

  function report() {
    const lines = [
      'OLLI iPhone attendance layer diagnostic',
      'Read-only visual timing; NOT a GPU paint detector.',
      'Enabled=' + enabled + ' | runs=' + results.length
    ];
    for (const [i, r] of results.entries()) {
      lines.push('', '#' + (i + 1) + ' ' + r.launchMode + ' ' + r.outcome,
        'duration=' + reportValue(r.endMs) + 'ms'
          + ' | firstTapToMove=' + reportValue(r.moveMs) + 'ms'
          + ' | transitionStart=' + reportValue(r.transitionStartMs) + 'ms'
          + ' | transitionDone=' + reportValue(r.doneMs) + 'ms',
        'coldPreparation=' + r.cold
          + ' | localPrepReady=' + reportValue(r.coldReadyMs) + 'ms'
          + ' | initialPrepared=' + r.wasPrepared,
        'cards=' + r.cardsBefore + ' -> ' + r.cardsAfter
          + ' | listMutations=' + r.listMutations
          + ' | nodesAdded=' + r.nodesAdded
          + ' | nodesRemoved=' + r.nodesRemoved,
        'rearAttributes=' + r.rearAttrs
          + ' | frontAttributes=' + r.frontAttrs
          + ' | bodyAttributes=' + r.bodyAttrs,
        'frames=' + r.frameCount
          + ' | framesOver25ms=' + r.slowFrames
          + ' | maxFrameGap=' + Math.round(r.maxGap) + 'ms',
        'before: ' + r.before,
        'middle: ' + (r.middleSnapshot || '-'),
        'after: ' + r.after,
        'events: ' + r.events.join(' / ')
      );
    }
    return lines.join('\n');
  }

  function showPanel() {
    if (!enabled && !results.length) return;
    if (!panel) {
      panel = document.createElement('section');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', '출석부 화면 진단');
      panel.style.cssText = 'position:fixed;z-index:2147483646;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));max-height:46vh;overflow:auto;background:#fff;color:#111;border:1px solid #d6dce2;border-radius:14px;box-shadow:0 3px 20px #0003;padding:12px;font:12px/1.5 sans-serif;';
      const heading = document.createElement('div');
      heading.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:6px';
      heading.textContent = '출석부 화면 진단';
      const description = document.createElement('div');
      description.style.cssText = 'font-size:12px;color:#555;margin-bottom:8px';
      description.textContent = '햄버거 버튼을 평소처럼 누르면 자동으로 측정합니다. GPU 페인트 자체는 측정할 수 없습니다.';
      textArea = document.createElement('pre');
      textArea.style.cssText = 'font:10px/1.4 monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:19vh;overflow:auto;background:#f6f7f8;padding:8px;border-radius:8px';
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:7px;margin-top:9px;flex-wrap:wrap';
      const makeButton = (label, handler) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = 'border:1px solid #d3d6da;border-radius:9px;background:#fff;color:#111;padding:7px 10px;font:600 12px sans-serif;';
        b.addEventListener('click', handler);
        actions.appendChild(b);
        return b;
      };
      makeButton('결과 복사', async () => {
        const value = report();
        try { await navigator.clipboard.writeText(value); }
        catch (_) { window.prompt('진단 결과 복사', value); }
      });
      makeButton('화면 닫기', () => { panel.style.display = 'none'; });
      makeButton('진단 끄기', () => {
        enabled = false;
        if (active) finish(active, 'stopped');
        panel.style.display = 'none';
      });
      panel.append(heading, description, textArea, actions);
      document.body.appendChild(panel);
    }
    textArea.textContent = (enabled ? '진단 켜짐 · ' : '진단 꺼짐 · ')
      + '다음 슬라이드에서 자동 측정\n\n' + report();
    panel.style.display = 'block';
  }

  function clearHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = 0;
    heldButton = null;
    downPoint = null;
  }

  document.addEventListener('pointerdown', event => {
    const button = event.target?.closest?.(BUTTON_SELECTOR);
    if (!button || (event.pointerType === 'mouse' && event.button !== 0)) return;
    clearHold();
    heldButton = button;
    downPoint = { x: event.clientX, y: event.clientY };
    holdTimer = window.setTimeout(() => {
      if (!heldButton || !heldButton.isConnected || document.hidden) return;
      suppressButton = heldButton;
      suppressUntil = now() + 2200;
      enabled = !enabled;
      if (active && !enabled) finish(active, 'stopped');
      showPanel();
      clearHold();
    }, HOLD_MS);
  }, true);
  document.addEventListener('pointermove', event => {
    if (downPoint && Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y) > 14) clearHold();
  }, true);
  document.addEventListener('pointerup', clearHold, true);
  document.addEventListener('pointercancel', clearHold, true);
  document.addEventListener('contextmenu', event => {
    if (heldButton && heldButton.contains(event.target)) event.preventDefault();
  }, true);
  document.addEventListener('click', event => {
    if (!suppressButton || now() > suppressUntil) return;
    if (event.target?.closest?.(BUTTON_SELECTOR) !== suppressButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressButton = null;
  }, true);

  function onIntent(front, room) {
    if (!enabled) return;
    if (active && active.phase === 'preparing') {
      timeline(active, 'reentered after preparation');
      return;
    }
    if (active && !active.finished) finish(active, 'interrupted');
    const r = {
      t: now(), room, front, launchMode: isInstalled() ? 'installed-app' : 'browser',
      phase: 'clicked', wasPrepared: room.classList.contains('olliAttendanceRearPrepared'),
      cold: false, before: roomSnapshot(room), middleSnapshot: '',
      after: '', cardsBefore: cardCount(), cardsAfter: 0, coldReadyMs:null,
      moveMs:null, transitionStartMs:null, doneMs:null, endMs:null,
      events:[], observers:[], listMutations:0,nodesAdded:0,nodesRemoved:0,
      rearAttrs:0,frontAttrs:0,bodyAttrs:0,
      frameCount:0,slowFrames:0,maxGap:0,lastFrame:null,finished:false
    };
    active = r;
    installObservers(r);
    timeline(r, 'hamburger tap');
  }

  function onColdStart() {
    if (!active) return;
    active.phase = 'preparing';
    active.cold = true;
    timeline(active, 'cold local preparation requested');
  }
  function onColdReady() {
    if (!active) return;
    active.coldReadyMs = since(active);
    timeline(active, 'local preparation finished');
  }
  function onColdFailure() { if (active) finish(active, 'local-preparation-failed'); }
  function onSlideStart() {
    if (!active) return;
    const r = active;
    r.phase = 'sliding';
    r.slideT = now();
    timeline(r, 'foreground slide scheduled');
    // If iOS never dispatches transitionend, still show the captured trace.
    window.setTimeout(() => {
      if (active === r && !r.finished) finish(r, 'transition-timeout');
    }, 1400);
    const onStart = event => {
      if (event.target !== r.front || event.propertyName !== 'transform') return;
      if (r.transitionStartMs == null) r.transitionStartMs = since(r);
    };
    r.front.addEventListener('transitionstart', onStart);
    r.removeStart = () => r.front.removeEventListener('transitionstart', onStart);
    sampleFrames(r);
  }
  function onMotionTriggered() {
    if (!active) return;
    active.moveMs = since(active);
    timeline(active, 'foreground transform class requested');
  }
  function onTransitionDone() {
    if (!active) return;
    const r = active;
    r.doneMs = since(r);
    timeline(r, 'foreground transition finished');
    r.removeStart?.();
    window.setTimeout(() => finish(r, 'completed'), 220);
  }

  window.olliAttendancePaintDiagnostic = {
    onIntent, onColdStart, onColdReady, onColdFailure,
    onSlideStart, onMotionTriggered, onTransitionDone
  };
})();
