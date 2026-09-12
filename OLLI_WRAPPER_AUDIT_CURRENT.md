# Current wrapper / override audit

Generated from branch `refactor/source-owned-no-overrides-20260912`.

This is a candidate list only. Sync/idempotency/realtime guards are not removal targets without separate review.

Candidate signal rows: **222**

## `index.html`

| line | signal | excerpt |
|---:|---|---|
| 671 | patch/wrapped marker | `<style id="olliLookupResultListPatch">` |
| 2668 | patch/wrapped marker | `<script id="olliRecordAttendanceGuideButtonPatch">` |
| 2672 | alias-original/previous/old | `var originalRenderElementaryStudentRows = window.renderElementaryStudentRows;` |
| 2673 | alias-original/previous/old | `var originalRenderKinderStudentRows = window.renderKinderStudentRows;` |
| 2874 | alias-original/previous/old | `var oldUpdateRecordHeaderUI = window.updateRecordHeaderUI;` |
| 2877 | apply(this, arguments) | `var result = oldUpdateRecordHeaderUI.apply(this, arguments);` |
| 2991 | patch/wrapped marker | `<script id="olliRecordSortPatchScript" src="olli-record-sort-student-ui.js"></script>` |
| 2992 | patch/wrapped marker | `<!-- olliRecordSortPositionFinalFix removed: 하단바/검색창/정렬 버튼 위치는 olliRecordSearchFinalSingle에서 단일 관리 -->` |
| 2993 | patch/wrapped marker | `<!-- 2026-04-30 patch: 초등/유치 정렬 기준 분리 + 초등 정렬 미작동 원인 보정 -->` |
| 3167 | patch/wrapped marker | `<!-- 2026-04-30 patch: 초등 정렬 요일→담임 2칸 버튼 + 유치부 그룹 구분선 -->` |
| 3168 | patch/wrapped marker | `<!-- 2026-04-30 patch v2: 선생님 비활성화 되돌아감 방지 + 그룹 SVG 데이터 URL # 보정 -->` |
| 3934 | patch/wrapped marker | `<script id="olli-page-scroll-reset-patch">` |
| 3937 | patch/wrapped marker | `if (window.__olliPageScrollResetPatchV1) return;` |
| 3938 | patch/wrapped marker | `window.__olliPageScrollResetPatchV1 = true;` |
| 4005 | wrap/patch function | `function wrapPageFunction(name) {` |
| 4007 | patch/wrapped marker | `if (typeof original !== 'function' \|\| original.__olliScrollResetWrapped) return;` |
| 4009 | apply(this, arguments) | `const result = original.apply(this, arguments);` |
| 4013 | patch/wrapped marker | `wrapped.__olliScrollResetWrapped = true;` |
| 4017 | wrap/patch function | `function bindFunctionWrappers() {` |
| 4047 | patch/wrapped marker | `<script id="olliElementaryOneMinuteStudentValidationPatch" src="olli-feedback-registration-runtime.js"></script>` |
| 4048 | patch/wrapped marker | `<style id="olliStudentListButtonAndModalFinalFixStyle">/* 2026-06-27: 관찰노트/1분 피드백 원생목록 정렬 버튼 최종 기준 */` |
| 4129 | patch/wrapped marker | `<script id="olliStudentModalAndKcfAddFinalFixScript">` |
| 4131 | patch/wrapped marker | `if (window.__olliStudentModalAndKcfAddFinalFixApplied) return;` |
| 4132 | patch/wrapped marker | `window.__olliStudentModalAndKcfAddFinalFixApplied = true;` |
| 4184 | alias-original/previous/old | `var previousPatchStudentModalMarkup = window.olliPatchStudentModalMarkup;` |
| 4185 | patch/wrapped marker | `if (typeof previousPatchStudentModalMarkup === 'function' && !previousPatchStudentModalMarkup.__olliGuideTextWrapped) {` |
| 4186 | patch/wrapped marker | `var wrappedPatch = function(){` |
| 4187 | apply(this, arguments) | `var result = previousPatchStudentModalMarkup.apply(this, arguments);` |
| 4191 | patch/wrapped marker | `wrappedPatch.__olliGuideTextWrapped = true;` |
| 4192 | patch/wrapped marker | `window.olliPatchStudentModalMarkup = wrappedPatch;` |
| 4195 | alias-original/previous/old | `var previousOpenStudentModal = window.openStudentModal;` |
| 4196 | patch/wrapped marker | `if (typeof previousOpenStudentModal === 'function' && !previousOpenStudentModal.__olliGuideTextWrapped) {` |
| 4198 | apply(this, arguments) | `var result = previousOpenStudentModal.apply(this, arguments);` |
| 4202 | patch/wrapped marker | `wrappedOpenStudentModal.__olliGuideTextWrapped = true;` |
| 4267 | wrap/patch function | `function patchOlliLogoutSheetForDelete() {` |
| 4421 | wrap/patch function | `function patchOlliLogoutSheetForAcademyDelete(){` |
| 4439 | patch/wrapped marker | `<script id="olliStudentScheduleTimeAndDocImportPatch">` |
| 4494 | alias-original/previous/old | `const oldPatchMarkup = window.olliPatchStudentModalMarkup;` |
| 4496 | apply(this, arguments) | `if (typeof oldPatchMarkup === 'function') oldPatchMarkup.apply(this, arguments);` |
| 4507 | alias-original/previous/old | `const oldPrepareAdd = window.olliPrepareStudentAddExtra;` |
| 4509 | apply(this, arguments) | `if (typeof oldPrepareAdd === 'function') oldPrepareAdd.apply(this, arguments);` |
| 4515 | alias-original/previous/old | `const oldGetAdd = window.olliGetStudentAddExtra;` |
| 4517 | apply(this, arguments) | `const base = typeof oldGetAdd === 'function' ? (oldGetAdd.apply(this, arguments) \|\| {}) : {};` |
| 4521 | alias-original/previous/old | `const oldPrepareInfo = window.olliPrepareInfoExtra;` |
| 4523 | apply(this, arguments) | `if (typeof oldPrepareInfo === 'function') oldPrepareInfo.apply(this, arguments);` |
| 4533 | alias-original/previous/old | `const oldGetInfo = window.olliGetInfoExtra;` |
| 4535 | apply(this, arguments) | `const base = typeof oldGetInfo === 'function' ? (oldGetInfo.apply(this, arguments) \|\| {}) : {};` |
| 4578 | patch/wrapped marker | `<script id="olliStudentInfoManualEmptyAndDayTimePatch" src="olli-student-schedule-runtime.js"></script>` |
| 4579 | patch/wrapped marker | `<script id="olliAttendanceStudentGuideDayOnlyPatch">` |
| 4717 | alias-original/previous/old | `var oldUpdateRecordHeaderUI = window.updateRecordHeaderUI;` |
| 4718 | patch/wrapped marker | `if (typeof oldUpdateRecordHeaderUI === 'function' && !oldUpdateRecordHeaderUI.__olliAttendanceAlignWrapped) {` |
| 4720 | apply(this, arguments) | `var result = oldUpdateRecordHeaderUI.apply(this, arguments);` |
| 4724 | patch/wrapped marker | `wrappedUpdate.__olliAttendanceAlignWrapped = true;` |
| 4729 | alias-original/previous/old | `var oldToggleRecordAttendanceGuideMode = window.toggleRecordAttendanceGuideMode;` |
| 4730 | patch/wrapped marker | `if (typeof oldToggleRecordAttendanceGuideMode === 'function' && !oldToggleRecordAttendanceGuideMode.__olliAttendanceAlignWrapped) {` |
| 4732 | apply(this, arguments) | `var result = oldToggleRecordAttendanceGuideMode.apply(this, arguments);` |
| 4736 | patch/wrapped marker | `wrappedToggle.__olliAttendanceAlignWrapped = true;` |
| 4812 | patch/wrapped marker | `<script id="olliAttendancePolicySettingsPatch" src="olli-attendance-policy-runtime.js"></script>` |

## `consultation-final-analysis-ui.js`

| line | signal | excerpt |
|---:|---|---|
| 142 | apply(this, arguments) | `if(originalOpen)window.openConsultationSurveyDetail=function(id){currentId=String(id\|\|'');const result=originalOpen.apply(this,arguments);queueMicrotask(ensureSection);return result;};` |
| 147 | apply(this, arguments) | `const result=await originalRefresh.apply(this,arguments);queueMicrotask(ensureSection);return result;` |

## `consultation-observation-ui.js`

| line | signal | excerpt |
|---:|---|---|
| 105 | apply(this, arguments) | `if(originalOpen)window.openConsultationSurveyDetail=function(id){currentId=String(id\|\|'');const result=originalOpen.apply(this,arguments);queueMicrotask(ensureSection);return result;};` |
| 110 | apply(this, arguments) | `const result=await originalRefresh.apply(this,arguments);queueMicrotask(ensureSection);return result;` |

## `consultation-result-sheet-ui.js`

| line | signal | excerpt |
|---:|---|---|
| 120 | apply(this, arguments) | `if(originalSet)window.setConsultationFinalStatus=function(){const result=originalSet.apply(this,arguments);queueMicrotask(ensureSection);return result;};` |
| 122 | apply(this, arguments) | `if(originalSave)window.saveConsultationFinalAnalysis=async function(id){const result=await originalSave.apply(this,arguments);cache.delete(String(id\|\|''));await loadState(String(id\|\|''));ensureSection();return res...` |
| 124 | apply(this, arguments) | `if(originalOpen)window.openConsultationSurveyDetail=function(id){currentId=String(id\|\|'');const result=originalOpen.apply(this,arguments);queueMicrotask(ensureSection);return result;};` |

## `consultation-survey-core.js`

| line | signal | excerpt |
|---:|---|---|
| 183 | alias-original/previous/old | `const original=window.pcOpenSection;` |
| 191 | apply(this, arguments) | `return original.apply(this,arguments);` |

## `observation-memo-feedback-clear-common.js`

| line | signal | excerpt |
|---:|---|---|
| 138 | alias-original/previous/old | `const originalClear = global.clearStudentNoteDraftFromSupabase;` |
| 192 | alias-original/previous/old | `const originalReset = global.resetElementaryMemoAfterFeedbackSave;` |
| 248 | alias-original/previous/old | `const originalAutoSave = global.autoSaveMemoFeedback;` |
| 253 | alias-original/previous/old | `const originalVerified = global.saveFeedbackRowVerified;` |
| 295 | alias-original/previous/old | `const originalReconcile = global.reconcileObservationMemoDraft;` |

## `olli-attendance-policy-runtime.js`

| line | signal | excerpt |
|---:|---|---|
| 230 | alias-original/previous/old | `var previousElementaryRenderer = window.renderElementaryStudentRows;` |
| 231 | alias-original/previous/old | `var previousKinderRenderer = window.renderKinderStudentRows;` |
| 288 | alias-original/previous/old | `var previousMonthSummary = window.getRecordAttendanceStudentMonthSummary;` |
| 390 | alias-original/previous/old | `var oldSettingsApplyStateToUI = window.settingsApplyStateToUI;` |
| 391 | patch/wrapped marker | `if (typeof oldSettingsApplyStateToUI === 'function' && !oldSettingsApplyStateToUI.__olliAttendancePolicyWrapped) {` |
| 393 | apply(this, arguments) | `var result = oldSettingsApplyStateToUI.apply(this, arguments);` |
| 399 | patch/wrapped marker | `wrappedApply.__olliAttendancePolicyWrapped = true;` |

## `olli-attendance-timetable-bridge.js`

| line | signal | excerpt |
|---:|---|---|
| 257 | alias-original/previous/old | `var oldOpenSection = window.pcOpenSection;` |
| 262 | apply(this, arguments) | `return await oldOpenSection.apply(this, arguments);` |
| 271 | apply(this, arguments) | `window[name] = function(){ var result = original.apply(this, arguments); setTimeout(refresh, 0); return result; };` |

## `olli-data-consultation-summary.js`

| line | signal | excerpt |
|---:|---|---|
| 412 | patch/wrapped marker | `function setAcademyConsultationSummaryItem(key, patch) {` |
| 415 | patch/wrapped marker | `...(patch \|\| {})` |

## `olli-data-foundation.js`

| line | signal | excerpt |
|---:|---|---|
| 15 | patch/wrapped marker | `: (upperMethod === 'PATCH' \|\| upperMethod === 'DELETE' ? 'return=representation' : '');` |

## `olli-data-student-operations.js`

| line | signal | excerpt |
|---:|---|---|
| 222 | patch/wrapped marker | `throw new Error('student_soft_delete 공통 저장 응답을 확인하지 못했습니다. 직접 Supabase PATCH fallback은 사용하지 않습니다.');` |
| 726 | wrap/patch function | `async function patchStudentStatusReturning(path, payload) {` |
| 728 | patch/wrapped marker | `method: 'PATCH',` |
| 758 | patch/wrapped marker | `recordOlliStorageIssue({ feature: 'student_status', resource: 'students', operation: 'patch', student_id: studentId, message: error.message });` |
| 775 | patch/wrapped marker | `serverOptions: { operation: 'patch' }` |
| 787 | patch/wrapped marker | `feature: 'student_status', resource: 'students', operation: 'patch',` |

## `olli-feedback-registration-runtime.js`

| line | signal | excerpt |
|---:|---|---|
| 249 | alias-original/previous/old | `var originalCreateTodayFeedbackItem = window.createTodayFeedbackItem;` |
| 250 | patch/wrapped marker | `if (typeof originalCreateTodayFeedbackItem === 'function' && !originalCreateTodayFeedbackItem.__kcfStudentIdPatched) {` |
| 258 | patch/wrapped marker | `patchedCreate.__kcfStudentIdPatched = true;` |
| 262 | alias-original/previous/old | `var originalStartTodayFeedbackRequest = window.startTodayFeedbackRequest;` |
| 263 | patch/wrapped marker | `if (typeof originalStartTodayFeedbackRequest === 'function' && !originalStartTodayFeedbackRequest.__kcfStudentIdPatched) {` |
| 271 | patch/wrapped marker | `patchedStart.__kcfStudentIdPatched = true;` |
| 275 | alias-original/previous/old | `var originalSaveTodayFeedbackItem = window.saveTodayFeedbackItem;` |
| 276 | patch/wrapped marker | `if (typeof originalSaveTodayFeedbackItem === 'function' && !originalSaveTodayFeedbackItem.__kcfStudentIdPatched) {` |
| 282 | patch/wrapped marker | `patchedSave.__kcfStudentIdPatched = true;` |

## `olli-feedback-runtime.js`

| line | signal | excerpt |
|---:|---|---|
| 9 | wrap/patch function | `function wrapOneMinuteLeaveFunction(fnName) {` |
| 11 | patch/wrapped marker | `if (typeof original !== 'function' \|\| original.__oneMinuteWrapped) return;` |
| 16 | patch/wrapped marker | `wrapped.__oneMinuteWrapped = true;` |
| 165 | wrap/patch function | `function wrapOneMinuteLeaveFunction(fnName) {` |
| 167 | patch/wrapped marker | `if (typeof original !== 'function' \|\| original.__oneMinuteWrapped) return;` |
| 172 | patch/wrapped marker | `wrapped.__oneMinuteWrapped = true;` |
| 290 | wrap/patch function | `function wrapFunction(name, validator) {` |
| 293 | patch/wrapped marker | `if (original.__feedbackInputGuardWrapped) return true;` |
| 303 | patch/wrapped marker | `wrapped.__feedbackInputGuardWrapped = true;` |
| 532 | patch/wrapped marker | `function updateTodayFeedbackItem(id, patch = {}) {` |
| 538 | patch/wrapped marker | `return { ...item, ...patch, updatedAt: new Date().toISOString() };` |
| 572 | wrap/patch function | `async function patchSavedTodayFeedbackItem(item = {}, nextText = '') {` |
| 582 | patch/wrapped marker | `const patch = { content, updated_at: new Date().toISOString() };` |
| 587 | patch/wrapped marker | `data: patch,` |
| 591 | patch/wrapped marker | `return { ...patch, id: recordId, academy_id: academyId, student_id: studentId, __pending_sync: true };` |
| 597 | patch/wrapped marker | `return result.serverRow \|\| (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) \|\| { ...patch, id: recordId, academy_id: academyId, student_id: studentId };` |

## `olli-operations-feedback-policy.js`

| line | signal | excerpt |
|---:|---|---|
| 296 | patch/wrapped marker | `const patch = {` |
| 310 | patch/wrapped marker | `if (existing) core.SyncQueue.update(entry.academyId, existing.queue_id, patch);` |
| 311 | patch/wrapped marker | `else core.SyncQueue.enqueue(patch, { coalesce: false });` |
| 365 | patch/wrapped marker | `function updatePending(entry, patch) {` |
| 369 | patch/wrapped marker | `let nextEntry = { ...entry, ...(patch \|\| {}), updatedAt: new Date().toISOString() };` |
| 371 | patch/wrapped marker | `list[index] = { ...list[index], ...(patch \|\| {}), updatedAt: nextEntry.updatedAt };` |
| 573 | apply(this, arguments) | `if (!TARGETS[table]) return legacySave.apply(this, arguments);` |

## `olli-realtime-common.js`

| line | signal | excerpt |
|---:|---|---|
| 51 | wrap/patch function | `function dispatchStatus(reason) {` |

## `olli-record-list-view.js`

| line | signal | excerpt |
|---:|---|---|
| 424 | patch/wrapped marker | `const err = new Error('deleteOlliData 공통 삭제 함수를 사용할 수 없어 피드백 삭제를 중단합니다. 직접 Supabase PATCH/DELETE fallback은 사용하지 않습니다.');` |

## `olli-record-sort-student-ui.js`

| line | signal | excerpt |
|---:|---|---|
| 382 | wrap/patch function | `function patchStudentModalMarkup(){` |

## `olli-settings-access.js`

| line | signal | excerpt |
|---:|---|---|
| 25 | patch/wrapped marker | `function saveOlliAcademyAccessLocal(patch = {}, academyId = '') {` |
| 28 | patch/wrapped marker | `const next = { ...current, ...(patch \|\| {}), updated_at: new Date().toISOString() };` |
| 73 | patch/wrapped marker | `async function persistOlliAcademyAccessState(patch = {}) {` |
| 77 | patch/wrapped marker | `if (Object.prototype.hasOwnProperty.call(patch, 'plan_type') \|\| Object.prototype.hasOwnProperty.call(patch, 'planType')) {` |
| 78 | patch/wrapped marker | `normalized.plan_type = String(patch.plan_type ?? patch.planType ?? '').trim();` |
| 80 | patch/wrapped marker | `if (Object.prototype.hasOwnProperty.call(patch, 'access_status') \|\| Object.prototype.hasOwnProperty.call(patch, 'accessStatus')) {` |
| 81 | patch/wrapped marker | `normalized.access_status = String(patch.access_status ?? patch.accessStatus ?? '').trim();` |
| 83 | patch/wrapped marker | `if (Object.prototype.hasOwnProperty.call(patch, 'trial_started_at') \|\| Object.prototype.hasOwnProperty.call(patch, 'trialStartedAt')) {` |
| 84 | patch/wrapped marker | `normalized.trial_started_at = normalizeOlliIsoDate(patch.trial_started_at ?? patch.trialStartedAt ?? '') \|\| '';` |
| 86 | patch/wrapped marker | `if (Object.prototype.hasOwnProperty.call(patch, 'trial_expires_at') \|\| Object.prototype.hasOwnProperty.call(patch, 'trialExpiresAt')) {` |
| 87 | patch/wrapped marker | `normalized.trial_expires_at = normalizeOlliIsoDate(patch.trial_expires_at ?? patch.trialExpiresAt ?? '') \|\| '';` |
| 103 | patch/wrapped marker | `await supabase('PATCH', `academies?id=eq.${encodeURIComponent(academyId)}`, remotePayload);` |

## `olli-settings-account-runtime.js`

| line | signal | excerpt |
|---:|---|---|
| 1 | patch/wrapped marker | `/* 2026-04-28 settings sales-mode patch: profile storage, teacher roles, account logout */` |
| 10 | alias-original/previous/old, patch/wrapped marker | `const oldSettingsSetCachedAcademy=window.settingsSetCachedAcademy;window.settingsSetCachedAcademy=function(academy){if(typeof oldSettingsSetCachedAcademy==='function')oldSettingsSetCachedAcademy(academy);if(!academy)r...` |
| 11 | alias-original/previous/old | `const oldSettingsApplyStateToUI=window.settingsApplyStateToUI;window.settingsApplyStateToUI=function(){if(typeof oldSettingsApplyStateToUI==='function')oldSettingsApplyStateToUI();const academyName=getSettingsAcademyN...` |
| 106 | patch/wrapped marker | `if(typeof settingsSheetData !== 'undefined' && settingsSheetData.profile){settingsSheetData.profile.desc='학원 이름과 프로필 이미지를 설정합니다.';settingsSheetData.profile.html=function(){const academyName=getSettingsAcademyName();co...` |
| 107 | alias-original/previous/old | `const oldOpenSettingsSheetForSettingsFix=window.openSettingsSheet\|\|openSettingsSheet;` |
| 124 | patch/wrapped marker | `async function setManagerPermission(roleKey,value){const cached=settingsGetCachedState();const managerPermissions={...(cached.managerPermissions\|\|{}),[roleKey]:!!value};settingsSaveCachePatch({managerPermissions});c...` |

## `olli-settings-base.js`

| line | signal | excerpt |
|---:|---|---|
| 228 | wrap/patch function, patch/wrapped marker | `function settingsSaveCachePatch(patch) {` |
| 230 | patch/wrapped marker | `const next = { ...old, ...(patch \|\| {}) };` |
| 1268 | patch/wrapped marker | `settingsSaveCachePatch({ notificationEnabled: next });` |
| 1295 | patch/wrapped marker | `settingsSaveCachePatch({ profileImageDataUrl: '' });` |
| 1376 | patch/wrapped marker | `settingsSaveCachePatch({ academyName: newName });` |
| 1380 | patch/wrapped marker | `const rows = await supabase('PATCH', `academies?id=eq.${encodeURIComponent(academyId)}`, { academy_name: newName });` |

## `olli-storage-core.js`

| line | signal | excerpt |
|---:|---|---|
| 260 | patch/wrapped marker | `spec.server = Object.assign({ kind: null, table: null, operation: 'patch', identityColumns: [], valueColumns: [], requiredColumns: [], selectColumns: [] }, spec.server \|\| {});` |
| 524 | patch/wrapped marker | `function update(academyId, queueId, patch) {` |
| 528 | patch/wrapped marker | `list[index] = Object.assign({}, list[index], cloneValue(patch \|\| {}));` |
| 698 | patch/wrapped marker | `const operation = normalizeString((options && options.operation) \|\| spec.server.operation \|\| 'patch').toLowerCase();` |
| 707 | patch/wrapped marker | `if (operation === 'patch' \|\| operation === 'update') {` |
| 711 | patch/wrapped marker | `let rows = await global.supabase('PATCH', `${spec.server.table}?${filter}`, patchData);` |
| 747 | patch/wrapped marker | `return global.supabase('PATCH', `${spec.server.table}?${filter}`, payload);` |
| 1077 | patch/wrapped marker | `operation: 'patch',` |
| 1106 | patch/wrapped marker | `operation: 'patch',` |
| 1134 | patch/wrapped marker | `operation: 'patch',` |
| 1243 | patch/wrapped marker | `operation: 'patch',` |
| 1267 | patch/wrapped marker | `operation: 'patch',` |
| 1291 | patch/wrapped marker | `operation: 'patch',` |
| 1375 | patch/wrapped marker | `operation: 'patch',` |
| 1404 | patch/wrapped marker | `operation: 'patch',` |
| 1539 | patch/wrapped marker | `operation: 'patch',` |
| 1578 | patch/wrapped marker | `operation: 'patch',` |
| 1656 | patch/wrapped marker | `operation: 'patch',` |

## `olli-student-bulk-edit-parser.js`

| line | signal | excerpt |
|---:|---|---|
| 2 | patch/wrapped marker | `/* 2026-07-03 patch: 학생정보 일괄 수정 문서 형식 유연화 */` |

## `olli-student-schedule-runtime.js`

| line | signal | excerpt |
|---:|---|---|
| 321 | wrap/patch function | `function patchScheduleLabels(){` |
| 326 | alias-original/previous/old | `const oldPatchStudentModalMarkup = window.olliPatchStudentModalMarkup;` |
| 328 | apply(this, arguments) | `if (typeof oldPatchStudentModalMarkup === 'function') oldPatchStudentModalMarkup.apply(this, arguments);` |
| 335 | alias-original/previous/old | `const oldPrepareStudentAddExtra = window.olliPrepareStudentAddExtra;` |
| 337 | apply(this, arguments) | `if (typeof oldPrepareStudentAddExtra === 'function') oldPrepareStudentAddExtra.apply(this, arguments);` |
| 343 | alias-original/previous/old | `const oldGetStudentAddExtra = window.olliGetStudentAddExtra;` |
| 345 | apply(this, arguments) | `const base = typeof oldGetStudentAddExtra === 'function' ? (oldGetStudentAddExtra.apply(this, arguments) \|\| {}) : {};` |
| 355 | alias-original/previous/old | `const oldPrepareInfoExtra = window.olliPrepareInfoExtra;` |
| 357 | apply(this, arguments) | `if (typeof oldPrepareInfoExtra === 'function') oldPrepareInfoExtra.apply(this, arguments);` |
| 368 | alias-original/previous/old | `const oldGetInfoExtra = window.olliGetInfoExtra;` |
| 370 | apply(this, arguments) | `const base = typeof oldGetInfoExtra === 'function' ? (oldGetInfoExtra.apply(this, arguments) \|\| {}) : {};` |

## `pc-attendance.js`

| line | signal | excerpt |
|---:|---|---|
| 713 | apply(this, arguments) | `return state.legacyOpenFeedback.apply(this, arguments);` |
| 722 | apply(this, arguments) | `const result = await original.apply(this, arguments);` |

## `pc-kinder-feedback.js`

| line | signal | excerpt |
|---:|---|---|
| 212 | alias-original/previous/old | `const previous = window.readOlliLocal(KCF_PHOTO_COMMON_FEATURE, { academyId, fileId: photoId }, { fallback: null });` |
| 333 | patch/wrapped marker | `serverOptions: { operation: 'patch' }` |

## `pc-settings-layout.js`

| line | signal | excerpt |
|---:|---|---|
| 6 | alias-original/previous/old | `const originalOpenSettingsPage=window.openSettingsPage;` |
| 7 | alias-original/previous/old | `const originalCloseSettingsPage=window.closeSettingsPage;` |
| 8 | alias-original/previous/old | `const originalOpenSettingsDetail=window.openSettingsDetail;` |
| 9 | alias-original/previous/old | `const originalCloseSettingsDetail=window.closeSettingsDetail;` |
| 10 | alias-original/previous/old | `const originalPcOpenSection=window.pcOpenSection;` |
| 89 | apply(this, arguments) | `if(typeof originalOpenSettingsPage==='function') result=originalOpenSettingsPage.apply(this,arguments);` |
| 99 | apply(this, arguments) | `if(typeof originalCloseSettingsPage==='function') result=originalCloseSettingsPage.apply(this,arguments);` |
| 109 | apply(this, arguments) | `if(typeof originalOpenSettingsDetail==='function') result=originalOpenSettingsDetail.apply(this,arguments);` |
| 123 | apply(this, arguments) | `if(typeof originalCloseSettingsDetail==='function') result=originalCloseSettingsDetail.apply(this,arguments);` |
| 136 | apply(this, arguments) | `if(typeof originalPcOpenSection==='function') return originalPcOpenSection.apply(this,arguments);` |

## `pc-shell.js`

| line | signal | excerpt |
|---:|---|---|
| 296 | alias-original/previous/old | `const original = global.openStudentModal;` |
| 297 | patch/wrapped marker | `if (typeof original === 'function' && !original.__olliPcStudentAddTabsWrapped) {` |
| 303 | patch/wrapped marker | `wrapped.__olliPcStudentAddTabsWrapped = true;` |
| 311 | alias-original/previous/old | `const original = global.confirmStudent;` |
| 312 | patch/wrapped marker | `if (typeof original !== 'function' \|\| original.__olliPcScheduleSyncWrapped) return;` |
| 331 | patch/wrapped marker | `wrapped.__olliPcScheduleSyncWrapped = true;` |
| 392 | alias-original/previous/old | `const originalMemoOpen = global.openStudentMemoPageById;` |
| 396 | apply(this, arguments) | `return originalMemoOpen.apply(this, arguments);` |
| 405 | alias-original/previous/old | `const originalKinderOpen = global.openKinderChatFeedbackPage;` |
| 409 | apply(this, arguments) | `return originalKinderOpen.apply(this, arguments);` |

## `pc-student-class-routing.js`

| line | signal | excerpt |
|---:|---|---|
| 32 | wrap/patch function | `function unwrapRpc(value) { return Array.isArray(value) && value.length === 1 ? value[0] : value; }` |
| 350 | apply(this, arguments) | `const result = typeof basePrepare === 'function' ? basePrepare.apply(this, arguments) : undefined;` |
| 361 | apply(this, arguments) | `const base = typeof baseGetExtra === 'function' ? (baseGetExtra.apply(this, arguments) \|\| {}) : {};` |
| 372 | alias-original/previous/old | `const originalConfirm = global.confirmStudent;` |
| 388 | apply(this, arguments) | `const result = await originalConfirm.apply(this, arguments);` |

## `pc-student-info-card-runtime.js`

| line | signal | excerpt |
|---:|---|---|
| 47 | wrap/patch function | `function unwrapRpc(value) { return Array.isArray(value) && value.length === 1 ? value[0] : value; }` |
| 370 | apply(this, arguments) | `if (typeof basePrepareAdd === 'function') basePrepareAdd.apply(this, arguments);` |
| 376 | apply(this, arguments) | `const base = typeof baseGetAdd === 'function' ? (baseGetAdd.apply(this, arguments) \|\| {}) : {};` |
| 381 | apply(this, arguments) | `if (typeof basePrepareInfo === 'function') basePrepareInfo.apply(this, arguments);` |
| 389 | apply(this, arguments) | `base = typeof baseGetInfo === 'function' ? (baseGetInfo.apply(this, arguments) \|\| {}) : {};` |

## `pc-timetable.js`

| line | signal | excerpt |
|---:|---|---|
| 2086 | alias-original/previous/old | `const original = global.olliPrepareInfoExtra;` |
| 2087 | patch/wrapped marker | `if (typeof original !== 'function' \|\| original.__olliTimetableWrapped) return;` |
| 2090 | apply(this, arguments) | `const result = original.apply(this, arguments);` |
| 2100 | patch/wrapped marker | `wrapped.__olliTimetableWrapped = true;` |
| 2119 | alias-original/previous/old | `const originalSearch = global.pcHandleTopSearch;` |
| 2120 | patch/wrapped marker | `if (typeof originalSearch === 'function' && !originalSearch.__olliTimetableWrapped) {` |
| 2128 | apply(this, arguments) | `return originalSearch.apply(this, arguments);` |
| 2130 | patch/wrapped marker | `wrappedSearch.__olliTimetableWrapped = true;` |

