(() => {
  'use strict';

  const DRAWER_OPEN_CLASS = 'olli-main-subpage-drawer-open';
  const MAIN_PAGE_CLASS = 'olliMainDrawerMainPage';
  const COMPANION_CLASS = 'olliMainDrawerCompanion';
  const OPEN_CLASS = 'is-olli-main-drawer-open';
  const RETURNING_CLASS = 'is-olli-main-drawer-returning';
  const SWITCH_EXIT_CLASS = 'is-olli-main-drawer-switch-exit';
  const SWITCH_ENTER_CLASS = 'is-olli-main-drawer-switch-enter';
  const DRAWER_RETURN_FALLBACK_MS = 430;
  const DRAWER_SWITCH_EXIT_FALLBACK_MS = 370;
  const DRAWER_SWITCH_ENTER_FALLBACK_MS = 430;

  let drawerState = null;
  let navigationInFlight = false;
  let drawerSearchReturnTimer = 0;
  let attendancePreparedKey = '';
  let attendancePrewarmScheduled = false;
  let attendanceRearMountState = null;
  let deferredAttendanceRender = null;
  let attendanceTransitionInFlight = false;

  function isReducedMotion(){
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  function isVisible(element){
    if (!element) return false;
    try { return getComputedStyle(element).display !== 'none'; }
    catch (_) { return element.style.display !== 'none'; }
  }

  function getVisibleMainPage(){
    const ids = ['studentMemoScreen', 'observationRosterScreen', 'kinderChatFeedbackScreen', 'olliTalkBetaScreen'];
    for (const id of ids) {
      const page = document.getElementById(id);
      if (isVisible(page)) return page;
    }
    return null;
  }

  function getMainPageFromExplicitSource(sourceKind){
    const normalized = String(sourceKind || '').trim().toLowerCase();
    if (normalized === 'quicknote') {
      return document.getElementById('kinderChatFeedbackScreen');
    }
    if (normalized === 'observation') {
      const memo = document.getElementById('studentMemoScreen');
      if (isVisible(memo)) return memo;
      return document.getElementById('observationRosterScreen');
    }
    if (normalized === 'work') {
      return document.getElementById('olliTalkBetaScreen');
    }
    return null;
  }

  function getCompanionLayer(mainPage){
    const id = String(mainPage?.id || '');
    if (id === 'kinderChatFeedbackScreen') return document.getElementById('kcfPersistentTopLayer');
    if (id === 'observationRosterScreen' || id === 'studentMemoScreen') {
      return document.getElementById('observationPersistentNavLayer');
    }
    return null;
  }

  function captureInlineState(element){
    if (!element) return null;
    return {
      display: element.style.display,
      visibility: element.style.visibility,
      zIndex: element.style.zIndex,
      transform: element.style.transform,
      opacity: element.style.opacity,
      filter: element.style.filter,
      pointerEvents: element.style.pointerEvents,
      ariaHidden: element.getAttribute('aria-hidden'),
      inert: element.hasAttribute('inert')
    };
  }

  function restoreInlineState(element, saved){
    if (!element || !saved) return;
    element.style.display = saved.display;
    element.style.visibility = saved.visibility;
    element.style.zIndex = saved.zIndex;
    element.style.transform = saved.transform;
    element.style.opacity = saved.opacity;
    element.style.filter = saved.filter;
    element.style.pointerEvents = saved.pointerEvents;
    if (saved.ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', saved.ariaHidden);
    if (saved.inert) element.setAttribute('inert', '');
    else element.removeAttribute('inert');
  }

  function getReturnHit(){
    let hit = document.getElementById('olliMainDrawerReturnHit');
    if (hit) return hit;
    hit = document.createElement('button');
    hit.id = 'olliMainDrawerReturnHit';
    hit.type = 'button';
    hit.className = 'olliMainDrawerReturnHit';
    hit.setAttribute('aria-label', '메인 페이지로 돌아가기');
    hit.addEventListener('click', closeOlliMainSubpageDrawer);
    document.body.appendChild(hit);
    return hit;
  }

  async function prepareAttendanceState(options = {}){
    const openAttendance = window.openRecordAttendanceDashboard
      || (typeof openRecordAttendanceDashboard === 'function' ? openRecordAttendanceDashboard : null);
    if (typeof openAttendance === 'function') {
      await openAttendance({ localOnly: options.localOnly === true });
      return true;
    }

    const targetView = typeof window.getOlliLastRecordDivisionView === 'function'
      ? window.getOlliLastRecordDivisionView()
      : 'elementary';
    try {
      if (typeof currentObservationView !== 'undefined') currentObservationView = targetView;
      if (typeof currentRecordView !== 'undefined') currentRecordView = targetView;
      if (typeof updateRecordHeaderUI === 'function') updateRecordHeaderUI();
      if (typeof loadRecords === 'function') await loadRecords('', { localOnly: options.localOnly === true });
      return true;
    } catch (_) {
      return false;
    }
  }

  function releaseAttendanceRearPage(){
    const state = attendanceRearMountState;
    if (!state) return;
    attendanceRearMountState = null;
    // The navigator decides whether Attendance is now visible or hidden.
    const display = state.recordRoom.style.display;
    restoreInlineState(state.recordRoom, state.recordSaved);
    state.recordRoom.style.display = display;
    state.recordRoom.removeAttribute('data-olli-drawer-rear-mounted');
    state.mainPage.removeAttribute('data-olli-drawer-rear-host');
    if (state.mainPage.style.zIndex === state.mainZIndex) {
      state.mainPage.style.zIndex = state.mainSavedZIndex;
    }
  }

  function mountAttendanceRearPage(){
    if (drawerState || navigationInFlight) return false;
    const mainPage = getVisibleMainPage();
    const recordRoom = document.getElementById('recordRoomScreen');
    if (!mainPage || !recordRoom || !hasReadyAttendanceBehindDrawer(recordRoom)) return false;
    if (attendanceRearMountState?.mainPage !== mainPage) {
      releaseAttendanceRearPage();
      const computedZIndex = Number.parseInt(getComputedStyle(mainPage).zIndex, 10);
      const mainZIndex = String(Number.isFinite(computedZIndex) && computedZIndex > 0 ? computedZIndex : 1);
      attendanceRearMountState = {
        mainPage, recordRoom, mainZIndex,
        mainSavedZIndex: mainPage.style.zIndex,
        recordSaved: captureInlineState(recordRoom)
      };
    }
    const state = attendanceRearMountState;
    const rearZIndex = String(Number(state.mainZIndex) - 1);
    if (mainPage.style.zIndex !== state.mainZIndex) mainPage.style.zIndex = state.mainZIndex;
    if (recordRoom.style.zIndex !== rearZIndex) recordRoom.style.zIndex = rearZIndex;
    if (recordRoom.style.display !== 'flex') recordRoom.style.display = 'flex';
    if (recordRoom.style.pointerEvents !== 'none') recordRoom.style.pointerEvents = 'none';
    recordRoom.setAttribute('aria-hidden', 'true');
    recordRoom.setAttribute('inert', '');
    recordRoom.setAttribute('data-olli-drawer-rear-mounted', '');
    mainPage.setAttribute('data-olli-drawer-rear-host', '');
    return true;
  }

  function syncAttendanceRearPage(){
    if (drawerState || navigationInFlight) return;
    if (!getVisibleMainPage() || !getAttendancePreparationKey()) {
      releaseAttendanceRearPage();
      return;
    }
    if (!mountAttendanceRearPage()) scheduleOlliMainDrawerAttendancePrewarm();
  }

  function getAttendancePreparationKey(){
    const academyId = String(
      (typeof window.getOlliCurrentAcademyId === 'function' ? window.getOlliCurrentAcademyId() : '') || ''
    ).trim();
    const division = typeof window.getOlliLastRecordDivisionView === 'function'
      ? window.getOlliLastRecordDivisionView()
      : (typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary');
    return academyId ? academyId + ':' + division : '';
  }

  function refreshRecordRoomSubpage(options = {}){
    if (options.reuseRendered) {
      // Keep the existing student cards until the server confirms new data.
      if (typeof loadRecords === 'function') {
        Promise.resolve(loadRecords('', { reuseRendered: true })).catch(() => {});
      }
      return;
    }
    const key = getAttendancePreparationKey();
    prepareAttendanceState({ localOnly: options.localOnly === true }).then(() => {
      if (options.localOnly && key === getAttendancePreparationKey()) attendancePreparedKey = key;
    }).catch(() => {});
  }

  function hasReadyAttendanceBehindDrawer(recordRoom){
    const list = recordRoom?.querySelector('#recordList');
    const mode = typeof currentRecordView === 'undefined' ? '' : currentRecordView;
    const key = getAttendancePreparationKey();
    return !!(key && attendancePreparedKey === key && list && list.children.length
      && (mode === 'elementary' || mode === 'kinder') && key.endsWith(':' + mode));
  }

  async function prewarmOlliMainDrawerAttendanceLocal(){
    const recordRoom = document.getElementById('recordRoomScreen');
    const key = getAttendancePreparationKey();
    if (!recordRoom || !key || drawerState || navigationInFlight || !getVisibleMainPage()) return false;
    if (hasReadyAttendanceBehindDrawer(recordRoom)) return mountAttendanceRearPage();
    if (isVisible(recordRoom) && !attendanceRearMountState) return false;
    // Prepare the hidden rear page from local caches, without navigation or network.
    try {
      await prepareAttendanceState({ localOnly: true });
      if (key !== getAttendancePreparationKey() || drawerState) return false;
      attendancePreparedKey = key;
      return mountAttendanceRearPage();
    } catch (_) {
      return false;
    }
  }

  function scheduleOlliMainDrawerAttendancePrewarm(){
    if (attendancePrewarmScheduled) return;
    attendancePrewarmScheduled = true;
    const run = () => {
      attendancePrewarmScheduled = false;
      void prewarmOlliMainDrawerAttendanceLocal();
    };
    // Do not block the first foreground paint to prepare the rear roster.
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      window.setTimeout(run, 120);
    }
  }

  function deferAttendanceRender(view, name){
    if (!attendanceTransitionInFlight && !drawerState?.attendanceOpening) return false;
    // Never delay the first local roster when there are no mounted cards yet.
    const list = document.getElementById('recordList');
    const key = getAttendancePreparationKey();
    if (!list?.children.length || !key) return false;
    deferredAttendanceRender = { view, name, key };
    return true;
  }

  function flushDeferredAttendanceRender(){
    if (attendanceTransitionInFlight || drawerState?.attendanceOpening) return;
    const pending = deferredAttendanceRender;
    deferredAttendanceRender = null;
    if (!pending || pending.key !== getAttendancePreparationKey()) return;
    if (typeof currentRecordView === 'undefined' || currentRecordView !== pending.view) return;
    // Read the latest data now; intermediate refreshes only replace this request.
    if (pending.view === 'elementary' && typeof renderElementaryRecords === 'function') {
      renderElementaryRecords(pending.name);
    } else if (pending.view === 'kinder' && typeof renderKinderRecords === 'function') {
      renderKinderRecords(pending.name);
    }
  }

  function getRecordUtilityItem(buttonId){
    const button = document.getElementById(buttonId);
    return button ? button.closest('.recordUtilityBtn') : null;
  }

  function applyRecordUtilityOrder(mainPage){
    const observationItem = getRecordUtilityItem('recordModeToggleBtn');
    const quickNoteItem = getRecordUtilityItem('recordStorageToggleBtn');
    const saved = [
      { element: observationItem, order: observationItem?.style.order || '' },
      { element: quickNoteItem, order: quickNoteItem?.style.order || '' }
    ];
    const sourceId = String(mainPage?.id || '');
    const fromObservation = sourceId === 'observationRosterScreen' || sourceId === 'studentMemoScreen';

    if (observationItem) observationItem.style.order = fromObservation ? '4' : '3';
    if (quickNoteItem) quickNoteItem.style.order = fromObservation ? '3' : '4';
    return saved;
  }

  function restoreRecordUtilityOrder(saved){
    (saved || []).forEach((item) => {
      if (item?.element) item.element.style.order = item.order || '';
    });
  }

  function waitForTransition(element, propertyName, trigger, fallbackMs){
    if (!element) {
      trigger?.();
      return Promise.resolve();
    }
    if (isReducedMotion()) {
      trigger?.();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let finished = false;
      let timer = null;
      const finish = () => {
        if (finished) return;
        finished = true;
        element.removeEventListener('transitionend', onEnd);
        if (timer) window.clearTimeout(timer);
        resolve();
      };
      const onEnd = (event) => {
        if (event.target !== element) return;
        if (propertyName && event.propertyName !== propertyName) return;
        finish();
      };
      element.addEventListener('transitionend', onEnd);
      trigger?.();
      timer = window.setTimeout(finish, fallbackMs);
    });
  }

  function waitForAnimation(element, animationName, trigger, fallbackMs){
    if (!element) {
      trigger?.();
      return Promise.resolve();
    }
    if (isReducedMotion()) {
      trigger?.();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let finished = false;
      let timer = null;
      const finish = () => {
        if (finished) return;
        finished = true;
        element.removeEventListener('animationend', onEnd);
        if (timer) window.clearTimeout(timer);
        resolve();
      };
      const onEnd = (event) => {
        if (event.target !== element) return;
        if (animationName && event.animationName !== animationName) return;
        finish();
      };
      element.addEventListener('animationend', onEnd);
      trigger?.();
      timer = window.setTimeout(finish, fallbackMs);
    });
  }

  function getMainPageKind(mainPage){
    const id = String(mainPage?.id || '');
    if (id === 'kinderChatFeedbackScreen') return 'quicknote';
    if (id === 'observationRosterScreen' || id === 'studentMemoScreen') return 'observation';
    if (id === 'olliTalkBetaScreen') return 'work';
    return '';
  }

  function getDrawerDivision(){
    try {
      const saved = String(window.getOlliLastRecordDivisionView?.() || '');
      if (saved === 'kinder' || saved === 'elementary') return saved;
    } catch (_) {}
    try {
      return currentObservationView === 'kinder' ? 'kinder' : 'elementary';
    } catch (_) {
      return 'elementary';
    }
  }

  function hideDrawerCompanion(companion){
    if (!companion) return;
    companion.classList.remove(COMPANION_CLASS, OPEN_CLASS, RETURNING_CLASS, SWITCH_EXIT_CLASS, SWITCH_ENTER_CLASS);
    companion.classList.remove('show');
    companion.setAttribute('aria-hidden', 'true');
  }

  function showRecordRoomBehindTransition(state, options = {}){
    const recordRoom = state?.recordRoom;
    if (!recordRoom) return;
    const fullWidth = options?.fullWidth === true;
    recordRoom.style.display = 'flex';
    recordRoom.style.zIndex = '119700';
    recordRoom.style.pointerEvents = 'auto';
    recordRoom.setAttribute('aria-hidden', 'false');
    recordRoom.classList.toggle('olliMainDrawerSubpage', !fullWidth);
  }

  async function prepareDrawerTargetMainPage(targetKind, division){
    if (targetKind === 'observation') {
      const openObservation = window.openObservationNoteFromRecord
        || (typeof openObservationNoteFromRecord === 'function' ? openObservationNoteFromRecord : null);
      if (typeof openObservation !== 'function') return null;
      const opened = openObservation({ division, navigationManaged:true });
      if (opened === false) return null;
      return document.getElementById('observationRosterScreen');
    }

    const openQuickNote = window.openKinderChatFeedbackPage
      || (typeof openKinderChatFeedbackPage === 'function' ? openKinderChatFeedbackPage : null);
    if (typeof openQuickNote !== 'function') return null;
    const opened = openQuickNote({ division, navigationManaged:true });
    if (opened === false) return null;
    return document.getElementById('kinderChatFeedbackScreen');
  }

  function restoreDrawerSourceAfterFailedSwitch(state){
    const sourceMain = state?.mainPage;
    const sourceCompanion = state?.companion;
    if (sourceMain) {
      restoreInlineState(sourceMain, state.mainSaved);
      sourceMain.style.display = 'flex';
      sourceMain.style.zIndex = '120500';
      sourceMain.style.pointerEvents = 'none';
      sourceMain.setAttribute('aria-hidden', 'false');
      sourceMain.classList.add(MAIN_PAGE_CLASS);
    }
    if (sourceCompanion) {
      restoreInlineState(sourceCompanion, state.companionSaved);
      sourceCompanion.style.zIndex = '120600';
      sourceCompanion.style.pointerEvents = 'none';
      sourceCompanion.classList.add(COMPANION_CLASS, 'show');
      sourceCompanion.setAttribute('aria-hidden', 'false');
    }
    void sourceMain?.offsetWidth;
    requestAnimationFrame(() => {
      sourceMain?.classList.add(OPEN_CLASS);
      sourceCompanion?.classList.add(OPEN_CLASS);
    });
    const hit = document.getElementById('olliMainDrawerReturnHit');
    if (hit) hit.hidden = false;
  }

  async function switchOlliMainSubpageDrawerPage(targetKind, event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (navigationInFlight || !drawerState) return false;

    const state = drawerState;
    const normalizedTarget = targetKind === 'observation' ? 'observation' : 'quicknote';
    if (getMainPageKind(state.mainPage) === normalizedTarget) {
      return closeOlliMainSubpageDrawer();
    }

    navigationInFlight = true;
    attendanceTransitionInFlight = true;
    const hit = document.getElementById('olliMainDrawerReturnHit');
    if (hit) hit.hidden = true;

    try {
      const sourceMain = state.mainPage;
      const sourceCompanion = state.companion;
      const sourceKind = getMainPageKind(sourceMain);
      const hideSourceImmediately =
        (sourceKind === 'quicknote' && normalizedTarget === 'observation')
        || (sourceKind === 'observation' && normalizedTarget === 'quicknote');

      if (!hideSourceImmediately) {
        await waitForTransition(sourceMain, 'transform', () => {
          sourceMain?.classList.add(SWITCH_EXIT_CLASS);
          sourceCompanion?.classList.add(SWITCH_EXIT_CLASS);
        }, DRAWER_SWITCH_EXIT_FALLBACK_MS);
      }

      if (drawerState !== state) return false;

      if (sourceMain) {
        sourceMain.style.display = 'none';
        sourceMain.setAttribute('aria-hidden', 'true');
        sourceMain.classList.remove(MAIN_PAGE_CLASS, OPEN_CLASS, RETURNING_CLASS, SWITCH_EXIT_CLASS);
        restoreInlineState(sourceMain, state.mainSaved);
        sourceMain.style.display = 'none';
        sourceMain.setAttribute('aria-hidden', 'true');
      }
      hideDrawerCompanion(sourceCompanion);
      restoreInlineState(sourceCompanion, state.companionSaved);
      hideDrawerCompanion(sourceCompanion);

      // The retained 25% strip is gone now. Reveal Attendance at full width
      // before preparing the next main page so no white clipped area remains.
      showRecordRoomBehindTransition(state, { fullWidth:true });

      const division = getDrawerDivision();
      const targetMain = await prepareDrawerTargetMainPage(normalizedTarget, division);
      if (!targetMain || !isVisible(targetMain)) {
        restoreDrawerSourceAfterFailedSwitch(state);
        return false;
      }

      const targetCompanion = getCompanionLayer(targetMain);
      showRecordRoomBehindTransition(state, { fullWidth:true });

      targetMain.style.zIndex = '120500';
      targetMain.style.pointerEvents = 'none';
      targetMain.setAttribute('aria-hidden', 'false');
      targetMain.classList.add(MAIN_PAGE_CLASS);
      if (targetCompanion) {
        targetCompanion.style.zIndex = '120600';
        targetCompanion.style.pointerEvents = 'none';
        targetCompanion.setAttribute('aria-hidden', 'false');
        targetCompanion.classList.add(COMPANION_CLASS);
      }

      await waitForAnimation(targetMain, 'vivizacSlideInFromRight', () => {
        targetMain.classList.add(SWITCH_ENTER_CLASS);
        targetCompanion?.classList.add(SWITCH_ENTER_CLASS);
      }, DRAWER_SWITCH_ENTER_FALLBACK_MS);

      targetMain.classList.remove(MAIN_PAGE_CLASS, SWITCH_ENTER_CLASS);
      targetMain.style.zIndex = '';
      targetMain.style.pointerEvents = '';
      if (targetCompanion) {
        targetCompanion.classList.remove(COMPANION_CLASS, SWITCH_ENTER_CLASS);
        targetCompanion.style.zIndex = '';
        targetCompanion.style.pointerEvents = '';
      }

      state.recordRoom.classList.remove('olliMainDrawerSubpage', 'vivizac-slide-under-fade');
      state.recordRoom.style.zIndex = state.recordSaved.zIndex;
      state.recordRoom.style.pointerEvents = state.recordSaved.pointerEvents;
      state.recordRoom.style.display = state.recordSaved.display;
      state.recordRoom.setAttribute('aria-hidden', 'true');

      restoreRecordUtilityOrder(state.utilityOrderSaved);
      document.body.classList.remove(DRAWER_OPEN_CLASS);
      document.body.classList.remove('olli-main-subpage-drawer-search-active');
      drawerState = null;
      return true;
    } finally {
      navigationInFlight = false;
      attendanceTransitionInFlight = false;
      syncAttendanceRearPage();
      flushDeferredAttendanceRender();
    }
  }

  function openOlliObservationFromRecordShortcut(event){
    if (drawerState) return switchOlliMainSubpageDrawerPage('observation', event);
    if (navigationInFlight) return false;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const fn = window.openObservationNoteFromRecord
      || (typeof openObservationNoteFromRecord === 'function' ? openObservationNoteFromRecord : null);
    if (typeof fn === 'function') return fn();
    return false;
  }

  async function openQuickNoteFromAcademyWithSlide(fn){
    const recordRoom = document.getElementById('recordRoomScreen');
    const page = document.getElementById('kinderChatFeedbackScreen');
    if (!recordRoom || !page || typeof fn !== 'function') return false;

    const companion = document.getElementById('kcfPersistentTopLayer');
    const pageZIndex = page.style.zIndex;
    const pagePointerEvents = page.style.pointerEvents;
    const companionZIndex = companion?.style.zIndex || '';
    const companionPointerEvents = companion?.style.pointerEvents || '';

    navigationInFlight = true;
    attendanceTransitionInFlight = true;
    try {
      const division = getDrawerDivision();
      const opened = fn({ division, navigationManaged:true });
      if (opened === false) return false;

      page.style.zIndex = '120500';
      page.style.pointerEvents = 'none';
      page.setAttribute('aria-hidden', 'false');
      page.classList.add(MAIN_PAGE_CLASS);

      if (companion) {
        companion.style.zIndex = '120600';
        companion.style.pointerEvents = 'none';
        companion.setAttribute('aria-hidden', 'false');
        companion.classList.add(COMPANION_CLASS);
      }

      await waitForAnimation(page, 'vivizacSlideInFromRight', () => {
        page.classList.add(SWITCH_ENTER_CLASS);
        companion?.classList.add(SWITCH_ENTER_CLASS);
      }, DRAWER_SWITCH_ENTER_FALLBACK_MS);

      page.classList.remove(MAIN_PAGE_CLASS, SWITCH_ENTER_CLASS);
      page.style.zIndex = pageZIndex;
      page.style.pointerEvents = pagePointerEvents;

      if (companion) {
        companion.classList.remove(COMPANION_CLASS, SWITCH_ENTER_CLASS);
        companion.style.zIndex = companionZIndex;
        companion.style.pointerEvents = companionPointerEvents;
      }
      recordRoom.style.display = 'flex';
      recordRoom.setAttribute('aria-hidden', 'true');
      return true;
    } finally {
      navigationInFlight = false;
      attendanceTransitionInFlight = false;
      syncAttendanceRearPage();
      flushDeferredAttendanceRender();
    }
  }

  function openOlliQuickNoteFromRecordShortcut(event){
    if (drawerState) return switchOlliMainSubpageDrawerPage('quicknote', event);
    if (navigationInFlight) return false;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const fn = window.openKinderChatFeedbackPage
      || (typeof openKinderChatFeedbackPage === 'function' ? openKinderChatFeedbackPage : null);
    if (typeof fn !== 'function') return false;

    const recordRoom = document.getElementById('recordRoomScreen');
    const fromAcademyPage = !!recordRoom
      && isVisible(recordRoom)
      && recordRoom.classList.contains('record-academy-view');

    if (fromAcademyPage) return openQuickNoteFromAcademyWithSlide(fn);
    return fn();
  }

  function finishDrawerClose(state){
    if (!state || drawerState !== state) return;
    drawerState = null;
    document.body.classList.remove(DRAWER_OPEN_CLASS);

    state.mainPage?.classList.remove(MAIN_PAGE_CLASS, OPEN_CLASS, RETURNING_CLASS, SWITCH_EXIT_CLASS, SWITCH_ENTER_CLASS);
    state.companion?.classList.remove(COMPANION_CLASS, OPEN_CLASS, RETURNING_CLASS, SWITCH_EXIT_CLASS, SWITCH_ENTER_CLASS);
    restoreInlineState(state.mainPage, state.mainSaved);
    restoreInlineState(state.companion, state.companionSaved);

    if (state.recordRoom) {
      state.recordRoom.classList.remove('olliMainDrawerSubpage', 'vivizac-slide-under-fade');
      restoreInlineState(state.recordRoom, state.recordSaved);
    }

    restoreRecordUtilityOrder(state.utilityOrderSaved);
    const hit = document.getElementById('olliMainDrawerReturnHit');
    if (hit) hit.hidden = true;
  }

  async function closeOlliMainSubpageDrawer(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (navigationInFlight || !drawerState) return false;

    if (drawerSearchReturnTimer) {
      clearTimeout(drawerSearchReturnTimer);
      drawerSearchReturnTimer = 0;
    }
    document.body.classList.remove('olli-main-subpage-drawer-search-active');
    document.body.classList.remove('olli-main-subpage-drawer-search-returning');
    document.body.classList.remove('olli-main-subpage-drawer-modal-fade-active');

    navigationInFlight = true;
    attendanceTransitionInFlight = true;
    const state = drawerState;
    const { mainPage, companion, recordRoom } = state;
    const hit = document.getElementById('olliMainDrawerReturnHit');
    if (hit) hit.hidden = true;

    try {
      await waitForTransition(mainPage, 'transform', () => {
        mainPage?.classList.add(RETURNING_CLASS);
        companion?.classList.add(RETURNING_CLASS);
        mainPage?.classList.remove(OPEN_CLASS);
        companion?.classList.remove(OPEN_CLASS);
      }, DRAWER_RETURN_FALLBACK_MS);
      finishDrawerClose(state);
      return true;
    } finally {
      navigationInFlight = false;
      attendanceTransitionInFlight = false;
      syncAttendanceRearPage();
      flushDeferredAttendanceRender();
    }
  }

  function openOlliMainSubpageDrawer(event, sourceKind){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (navigationInFlight || drawerState) return false;

    const explicitMainPage = getMainPageFromExplicitSource(sourceKind);
    const mainPage = explicitMainPage || getVisibleMainPage();
    const recordRoom = document.getElementById('recordRoomScreen');
    if (!mainPage || !recordRoom) return false;

    try {
      const active = document.activeElement;
      if (active && typeof active.blur === 'function') active.blur();
    } catch (_) {}

    const companion = getCompanionLayer(mainPage);
    const hit = getReturnHit();
    const utilityOrderSaved = applyRecordUtilityOrder(mainPage);

    drawerState = {
      mainPage,
      companion,
      recordRoom,
      mainSaved: captureInlineState(mainPage),
      companionSaved: captureInlineState(companion),
      recordSaved: captureInlineState(recordRoom),
      utilityOrderSaved
    };

    // Keep a mounted rear's stacking order unchanged throughout the slide.
    const reuseRearLayers = attendanceRearMountState?.mainPage === mainPage
      && attendanceRearMountState.recordRoom === recordRoom;
    recordRoom.style.display = 'flex';
    if (!reuseRearLayers) recordRoom.style.zIndex = '119700';
    recordRoom.style.pointerEvents = 'auto';
    recordRoom.setAttribute('aria-hidden', 'false');
    recordRoom.removeAttribute('inert');
    recordRoom.classList.add('olliMainDrawerSubpage');

    if (!reuseRearLayers) mainPage.style.zIndex = '120500';
    mainPage.style.pointerEvents = 'none';
    mainPage.removeAttribute('inert');
    mainPage.classList.add(MAIN_PAGE_CLASS);

    if (companion) {
      companion.style.zIndex = '120600';
      companion.style.pointerEvents = 'none';
      companion.removeAttribute('inert');
      companion.classList.add(COMPANION_CLASS);
    }

    hit.hidden = false;
    document.body.classList.add(DRAWER_OPEN_CLASS);
    // Reuse the roster prepared at idle. Only a very early click or a changed
    // academy/division needs a local-only first render here.
    if (!hasReadyAttendanceBehindDrawer(recordRoom)) {
      refreshRecordRoomSubpage({ localOnly: true });
    }
    // The local fallback above remains synchronous; pause only subsequent paints.
    drawerState.attendanceOpening = true;
    void mainPage.offsetWidth;
    const openingState = drawerState;
    requestAnimationFrame(() => {
      if (drawerState !== openingState || navigationInFlight) return;
      mainPage.classList.add(OPEN_CLASS);
      companion?.classList.add(OPEN_CLASS);
      void waitForTransition(mainPage, 'transform', null, 400).then(() => {
        if (drawerState !== openingState || navigationInFlight) return;
        if (!mainPage.classList.contains(OPEN_CLASS)) return;
        openingState.attendanceOpening = false;
        flushDeferredAttendanceRender();
        if (document.body.classList.contains('olli-main-subpage-drawer-search-active')) return;
        // Preserve the mounted cards during motion; sync after the slide.
        refreshRecordRoomSubpage({ reuseRendered: true });
      });
    });
    return true;
  }

  async function openOlliAttendancePage(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (navigationInFlight) return false;
    navigationInFlight = true;
    try {
      const previousState = drawerState;
      drawerState = null;
      document.body.classList.remove(DRAWER_OPEN_CLASS);
      if (previousState) {
        restoreInlineState(previousState.mainPage, previousState.mainSaved);
        restoreInlineState(previousState.companion, previousState.companionSaved);
        restoreInlineState(previousState.recordRoom, previousState.recordSaved);
      }
      restoreRecordUtilityOrder(previousState?.utilityOrderSaved);

      releaseAttendanceRearPage();

      document.querySelectorAll('.pageScreen').forEach((screen) => {
        screen.classList.remove(MAIN_PAGE_CLASS, OPEN_CLASS, RETURNING_CLASS, SWITCH_EXIT_CLASS, SWITCH_ENTER_CLASS, 'vivizac-slide-under-fade');
        screen.style.display = screen.id === 'recordRoomScreen' ? 'flex' : 'none';
        screen.setAttribute('aria-hidden', screen.id === 'recordRoomScreen' ? 'false' : 'true');
      });
      try { window.setObservationPersistentNavVisible?.(false); } catch (_) {}
      try { window.setKinderChatFeedbackPersistentTopVisible?.(false); } catch (_) {}

      const recordRoom = document.getElementById('recordRoomScreen');
      if (recordRoom) {
        recordRoom.classList.remove('olliMainDrawerSubpage');
        recordRoom.style.zIndex = '';
        recordRoom.style.pointerEvents = '';
      }
      const hit = document.getElementById('olliMainDrawerReturnHit');
      if (hit) hit.hidden = true;

      await prepareAttendanceState();
      return true;
    } finally {
      navigationInFlight = false;
      syncAttendanceRearPage();
      flushDeferredAttendanceRender();
    }
  }

  function setOlliMainSubpageDrawerCompanionHidden(active){
    if (drawerSearchReturnTimer) {
      clearTimeout(drawerSearchReturnTimer);
      drawerSearchReturnTimer = 0;
    }

    const wasActive = document.body.classList.contains('olli-main-subpage-drawer-search-active');
    const enabled = !!active && !!drawerState;
    const hit = document.getElementById('olliMainDrawerReturnHit');

    if (enabled) {
      document.body.classList.remove('olli-main-subpage-drawer-search-returning');
      document.body.classList.add('olli-main-subpage-drawer-search-active');
      if (hit) hit.hidden = true;
      return true;
    }

    document.body.classList.remove('olli-main-subpage-drawer-search-active');

    if (!drawerState) {
      document.body.classList.remove('olli-main-subpage-drawer-search-returning');
      if (hit) hit.hidden = true;
      return false;
    }

    if (!wasActive) {
      document.body.classList.remove('olli-main-subpage-drawer-search-returning');
      if (hit) {
        hit.hidden = document.body.classList.contains('olli-main-subpage-drawer-modal-fade-active');
      }
      return false;
    }

    document.body.classList.add('olli-main-subpage-drawer-search-returning');
    if (hit) hit.hidden = true;

    drawerSearchReturnTimer = window.setTimeout(() => {
      drawerSearchReturnTimer = 0;
      document.body.classList.remove('olli-main-subpage-drawer-search-returning');
      const currentHit = document.getElementById('olliMainDrawerReturnHit');
      if (currentHit && drawerState) {
        currentHit.hidden = document.body.classList.contains('olli-main-subpage-drawer-modal-fade-active');
      }
    }, isReducedMotion() ? 0 : 340);

    return false;
  }

  window.deferOlliMainDrawerAttendanceRender = deferAttendanceRender;
  window.openOlliMainSubpageDrawer = openOlliMainSubpageDrawer;
  window.scheduleOlliMainDrawerAttendancePrewarm = scheduleOlliMainDrawerAttendancePrewarm;
  window.syncOlliMainDrawerAttendanceRearPage = syncAttendanceRearPage;
  window.releaseOlliMainDrawerAttendanceRearPage = releaseAttendanceRearPage;
  window.closeOlliMainSubpageDrawer = closeOlliMainSubpageDrawer;
  window.openOlliObservationFromRecordShortcut = openOlliObservationFromRecordShortcut;
  window.openOlliQuickNoteFromRecordShortcut = openOlliQuickNoteFromRecordShortcut;
  window.openOlliAttendancePage = openOlliAttendancePage;
  window.isOlliMainSubpageDrawerOpen = () => !!drawerState;
  function setOlliMainSubpageDrawerSearchActive(active){
    return setOlliMainSubpageDrawerCompanionHidden(active);
  }

  function setOlliMainSubpageDrawerCompanionFaded(active){
    const enabled = !!active && !!drawerState;
    document.body.classList.toggle('olli-main-subpage-drawer-modal-fade-active', enabled);

    const hit = document.getElementById('olliMainDrawerReturnHit');
    if (hit) {
      hit.hidden = enabled ? true : !drawerState;
    }
    return enabled;
  }

  window.setOlliMainSubpageDrawerCompanionHidden = setOlliMainSubpageDrawerCompanionHidden;
  window.setOlliMainSubpageDrawerSearchActive = setOlliMainSubpageDrawerSearchActive;
  window.setOlliMainSubpageDrawerCompanionFaded = setOlliMainSubpageDrawerCompanionFaded;
  window.isOlliPhoneNavigationInFlight = () => navigationInFlight;
})();


