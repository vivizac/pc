from pathlib import Path

service_path = Path('pc-timetable-service.js')
service = service_path.read_text(encoding='utf-8')

if 'async function loadSyncRevision()' not in service:
    anchor = "  async function bootstrapLegacy() {\n"
    insert = "  async function loadSyncRevision() {\n    return rpc('olli_schedule_sync_revision', contextPayload());\n  }\n\n"
    if anchor not in service:
        raise SystemExit('service loadSyncRevision anchor not found')
    service = service.replace(anchor, insert + anchor, 1)

if '\n    loadSyncRevision,\n' not in service:
    anchor = "    currentAcademyId,\n    legacyPairs,\n"
    repl = "    currentAcademyId,\n    loadSyncRevision,\n    legacyPairs,\n"
    if anchor not in service:
        raise SystemExit('service export anchor not found')
    service = service.replace(anchor, repl, 1)

service_path.write_text(service, encoding='utf-8')

core_path = Path('pc-timetable.js')
core = core_path.read_text(encoding='utf-8')

if 'syncRevision: 0' not in core:
    anchor = "    historyLoadToken: 0\n"
    repl = "    historyLoadToken: 0,\n    syncRevision: 0,\n    syncAcademyId: '',\n    syncChecking: false\n"
    if anchor not in core:
        raise SystemExit('state anchor not found')
    core = core.replace(anchor, repl, 1)

if 'const LIVE_SYNC_INTERVAL_MS = 3000;' not in core:
    anchor = "  async function loadWeek() {\n"
    insert = r'''  const LIVE_SYNC_INTERVAL_MS = 3000;

  function currentSyncAcademyId() {
    return typeof service.currentAcademyId === 'function' ? clean(service.currentAcademyId()) : '';
  }

  async function refreshActiveSchedulePane() {
    if (!state.active || state.view !== 'schedule') return;
    await refreshStudentsFromServer();
    if (state.pane === 'attendance') await loadAttendanceRegister();
    else await loadWeek();
  }

  async function readScheduleSyncRevision() {
    if (typeof service.loadSyncRevision !== 'function') return 0;
    const info = await service.loadSyncRevision();
    return Number(info && info.version || 0);
  }

  async function checkLiveScheduleSync(forceRefresh) {
    if (!state.active || state.view !== 'schedule' || state.saving || state.syncChecking) return;
    if (!forceRefresh && typeof document !== 'undefined' && document.hidden) return;
    const academyId = currentSyncAcademyId();
    if (!academyId) return;
    if (state.syncAcademyId !== academyId) {
      state.syncAcademyId = academyId;
      state.syncRevision = 0;
    }

    state.syncChecking = true;
    try {
      const version = await readScheduleSyncRevision();
      if (!version) return;
      const previous = Number(state.syncRevision || 0);
      const shouldRefresh = !!forceRefresh || !previous || version !== previous;
      state.syncRevision = version;
      if (shouldRefresh) await refreshActiveSchedulePane();
    } catch (error) {
      console.warn('시간표 실시간 동기화 확인 실패:', error);
    } finally {
      state.syncChecking = false;
    }
  }

  async function syncBeforeScheduleMutation() {
    if (typeof service.loadSyncRevision !== 'function') return;
    const academyId = currentSyncAcademyId();
    if (!academyId) return;
    if (state.syncAcademyId !== academyId) {
      state.syncAcademyId = academyId;
      state.syncRevision = 0;
    }
    try {
      const version = await readScheduleSyncRevision();
      if (!version) return;
      const previous = Number(state.syncRevision || 0);
      if (!previous || version !== previous) {
        state.syncRevision = version;
        await refreshActiveSchedulePane();
      }
    } catch (error) {
      console.warn('저장 전 시간표 최신 확인 실패:', error);
    }
  }

  if (!global.__OLLI_TIMETABLE_LIVE_SYNC_V1__) {
    global.__OLLI_TIMETABLE_LIVE_SYNC_V1__ = true;
    global.setInterval(() => { checkLiveScheduleSync(false); }, LIVE_SYNC_INTERVAL_MS);
    global.addEventListener('focus', () => { checkLiveScheduleSync(true); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkLiveScheduleSync(true);
    });
  }

'''
    if anchor not in core:
        raise SystemExit('loadWeek anchor not found')
    core = core.replace(anchor, insert + anchor, 1)

old_refresh = "  async function refreshActiveSchedulePane() {\n    if (!state.active || state.view !== 'schedule') return;\n    if (state.pane === 'attendance') await loadAttendanceRegister();\n    else await loadWeek();\n  }\n"
new_refresh = "  async function refreshActiveSchedulePane() {\n    if (!state.active || state.view !== 'schedule') return;\n    await refreshStudentsFromServer();\n    if (state.pane === 'attendance') await loadAttendanceRegister();\n    else await loadWeek();\n  }\n"
if 'await refreshStudentsFromServer();\n    if (state.pane === \'attendance\')' not in core:
    if old_refresh not in core:
        raise SystemExit('refreshActiveSchedulePane anchor not found')
    core = core.replace(old_refresh, new_refresh, 1)

if 'await syncBeforeScheduleMutation();\n      const result = await task();' not in core:
    anchor = "    try {\n      const result = await task();\n      state.saving = false;\n      closeDialog();\n"
    repl = "    try {\n      await syncBeforeScheduleMutation();\n      const result = await task();\n      state.saving = false;\n      closeDialog();\n"
    if anchor not in core:
        raise SystemExit('withSaving anchor not found')
    core = core.replace(anchor, repl, 1)

if core.count('await syncBeforeScheduleMutation();') < 2:
    anchor = "    try {\n      const result = await task();\n      const requestedWeek = dateKey(state.weekStart);\n"
    repl = "    try {\n      await syncBeforeScheduleMutation();\n      const result = await task();\n      const requestedWeek = dateKey(state.weekStart);\n"
    if anchor not in core:
        raise SystemExit('withOpenDialogSaving anchor not found')
    core = core.replace(anchor, repl, 1)

core_path.write_text(core, encoding='utf-8')

print('Live schedule/attendance synchronization patch applied.')
