# OLLI 공통화 후보 상세 비교

PC와 폰에 같은 이름으로 존재하지만 아직 내용이 다른 상위 후보를 실제 줄 단위로 비교한 문서다. 이 문서는 덮어쓰기 판단용이며 자동으로 기능 코드를 변경하지 않는다.

## `olli-settings-imports-base.js`

- 줄 유사도: **98.11%**
- 폰: **1,462 bytes / 52 lines**
- PC: **1,464 bytes / 54 lines**
- 끝 공백/개행 제거 후 동일: **아니오**
- 모든 공백 제거 후 동일: **예**

```diff
--- PHONE
+++ PC
@@ -35,4 +35,5 @@
 
 let studentManagementActiveTab = 'bulk';
+
 function getStudentManagementActiveTab() {
   return ['bulk', 'feedback', 'photo'].includes(studentManagementActiveTab) ? studentManagementActiveTab : 'bulk';
@@ -51,2 +52,3 @@
     + '</div>';
 }
+
```

## `olli-settings-existing-feedback-import.js`

- 줄 유사도: **99.86%**
- 폰: **53,334 bytes / 1,044 lines**
- PC: **53,234 bytes / 1,045 lines**
- 끝 공백/개행 제거 후 동일: **아니오**
- 모든 공백 제거 후 동일: **아니오**

```diff
--- PHONE
+++ PC
@@ -1003,5 +1003,5 @@
       if (typeof loadRecords === 'function') await loadRecords(searchValue);
     } catch(e) {}
-    try { if (typeof updateNotificationButtons === 'function') updateNotificationButtons(); } catch(e) {}
+    
     existingFeedbackImportState.statusMessage = savedIds.size
       ? `${savedIds.size}개의 기존 피드백을 앱에 저장했습니다.`
@@ -1043,2 +1043,3 @@
     + status + error + preview + renderExistingFeedbackImportResults();
 }
+
```

## `olli-settings-storage.js`

- 줄 유사도: **99.43%**
- 폰: **18,526 bytes / 352 lines**
- PC: **18,394 bytes / 350 lines**
- 끝 공백/개행 제거 후 동일: **아니오**
- 모든 공백 제거 후 동일: **아니오**

```diff
--- PHONE
+++ PC
@@ -4,9 +4,8 @@
     if (!academyId) throw new Error('academy_id가 없습니다.');
 
-    const [students, feedbacks, summaries, risks, members] = await Promise.all([
+    const [students, feedbacks, summaries, members] = await Promise.all([
       supabase('GET', `students?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
       supabase('GET', `feedbacks?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
       supabase('GET', `summary_feedbacks?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
-      supabase('GET', `risk_signals?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
       supabase('GET', `academy_members?select=*&academy_id=eq.${encodeURIComponent(academyId)}`)
     ]);
@@ -19,6 +18,5 @@
       feedbacks,
       summary_feedbacks: summaries,
-      risk_signals: risks
-    };
+};
 
     const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
```

## `olli-data-students.js`

- 줄 유사도: **99.18%**
- 폰: **16,855 bytes / 426 lines**
- PC: **16,692 bytes / 423 lines**
- 끝 공백/개행 제거 후 동일: **아니오**
- 모든 공백 제거 후 동일: **아니오**

```diff
--- PHONE
+++ PC
@@ -83,5 +83,5 @@
     return {
       id: uid(), type: fallbackType, name: item, year: getCurrentYear(), month: '', day: '',
-      enrolled_at: '', kindergarten: '', age: '', birth_year: '', school_entry_year: '', previous_division: '', division_changed_at: '', lesson_day: '', lesson_time: '', class_time: '', teacher: '', homeroom_teacher: '', group: '', group_months: '', feedback_months: '', personality: '', school: '', grade: '', className: '', memo1: '', memo2: '', memo3: '', memo4: '', memoUpdatedAt: '', status: 'active'
+      enrolled_at: '', kindergarten: '', age: '', birth_year: '', school_entry_year: '', previous_division: '', division_changed_at: '', lesson_day: '', lesson_time: '', class_time: '', teacher: '', homeroom_teacher: '', group: '', group_months: '', feedback_months: '', personality: '', school: '', grade: '', className: '', memoUpdatedAt: '', status: 'active'
     };
   }
@@ -112,8 +112,4 @@
     grade: item?.grade || '',
     className: item?.className || item?.class_no || '',
-    memo1: item?.memo1 || '',
-    memo2: item?.memo2 || '',
-    memo3: item?.memo3 || '',
-    memo4: item?.memo4 || '',
     memoUpdatedAt: item?.memoUpdatedAt || '',
     status: item?.status || 'active',
@@ -425,2 +421,3 @@
   return Number.isFinite(age) && age > 0 ? age : 999;
 }
+
```

## `olli-settings-import-test-tools.js`

- 줄 유사도: **97.94%**
- 폰: **10,691 bytes / 244 lines**
- PC: **10,485 bytes / 242 lines**
- 끝 공백/개행 제거 후 동일: **아니오**
- 모든 공백 제거 후 동일: **아니오**

```diff
--- PHONE
+++ PC
@@ -53,7 +53,5 @@
     ELEMENTARY_MEMO_PREFIX + id,
     ELEMENTARY_ANALYSIS_PREFIX + id,
-    ELEMENTARY_RECORDS_PREFIX + id,
     KINDER_MEMO_PREFIX + id,
-    MEMO_FEEDBACK_ARCHIVE_PREFIX + id
   ];
   directKeys.forEach(key => {
@@ -68,7 +66,5 @@
         key.startsWith(ELEMENTARY_MEMO_PREFIX) ||
         key.startsWith(ELEMENTARY_ANALYSIS_PREFIX) ||
-        key.startsWith(ELEMENTARY_RECORDS_PREFIX) ||
-        key.startsWith(KINDER_MEMO_PREFIX) ||
-        key.startsWith(MEMO_FEEDBACK_ARCHIVE_PREFIX)
+        key.startsWith(KINDER_MEMO_PREFIX)
       );
       if (isCommonStudentKey || isLegacyStudentKey) localStorage.removeItem(key);
@@ -135,5 +131,5 @@
   const encodedAcademyId = encodeURIComponent(academyId);
   const encodedStudentId = encodeURIComponent(studentId);
-  const tables = ['student_note_drafts', 'student_note_archives'];
+  const tables = ['student_note_drafts'];
   for (const table of tables) {
     try {
@@ -243,2 +239,4 @@
   }
 }
+
+
```

## `olli-settings-attendance-export.js`

- 줄 유사도: **95.33%**
- 폰: **28,647 bytes / 452 lines**
- PC: **35,354 bytes / 490 lines**
- 끝 공백/개행 제거 후 동일: **아니오**
- 모든 공백 제거 후 동일: **아니오**

```diff
--- PHONE
+++ PC
@@ -155,5 +155,7 @@
   const ym = settingsGetAttendanceYearMonth();
   const days = settingsGetDaysInMonth(ym.year, ym.month);
-  const students = settingsGetAttendanceRosterStudents();
+  const students = Array.isArray(options.students) ? options.students : settingsGetAttendanceRosterStudents();
+  const attendanceRows = Array.isArray(options.attendanceRows) ? options.attendanceRows : [];
+  const attendanceKeys = new Set(attendanceRows.map(row => String(row?.student_id || '') + '|' + String(row?.session_date || '').slice(0, 10)));
   const academyName = settingsAttendanceGetAcademyName();
   const divisionLabel = settingsAttendanceGetDivisionLabel(division);
@@ -188,5 +190,7 @@
       const day = i + 1;
       const cls = settingsAttendanceDayClass(ym.year, ym.month, day);
-      return '<td class="dateCol ' + cls + '"' + settingsAttendancePrintInlineStyle(cls, forPrint) + '></td>';
+      const dateKey = ym.year + '-' + String(ym.month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
+      const marked = attendanceKeys.has(String(student.id || '') + '|' + dateKey);
+      return '<td class="dateCol ' + cls + (marked ? ' attendanceLinkedMark' : '') + '"' + settingsAttendancePrintInlineStyle(cls, forPrint) + '>' + (marked ? '<span aria-label="출석">✓</span>' : '') + '</td>';
     }).join('');
     return '<tr>'
@@ -237,4 +241,17 @@
 }
 
+window.olliBuildLinkedAttendanceRegisterHtml = function(options = {}) {
+  const previous = { division: settingsAttendancePrintState.division, sort: settingsAttendancePrintState.sort, yearMonth: settingsAttendancePrintState.yearMonth };
+  settingsAttendancePrintState.division = options.division === 'combined' ? 'combined' : (options.division === 'kinder' ? 'kinder' : 'elementary');
+  settingsAttendancePrintState.sort = options.sort === 'name' ? 'name' : 'grade';
+  settingsAttendancePrintState.yearMonth = /^\d{4}-\d{2}$/.test(String(options.yearMonth || '')) ? String(options.yearMonth) : settingsGetCurrentYearMonthValue();
+  try {
+    const requestedIds = Array.isArray(options.students) ? new Set(options.students.map(student => String(student?.id || ''))) : null;
+    const students = requestedIds ? settingsGetAttendanceRosterStudents().filter(student => requestedIds.has(String(student?.id || ''))) : undefined;
+    return settingsBuildAttendanceRegisterHtml({ forPrint: false, attendanceRows: options.attendanceRows || [], students });
+  }
+  finally { settingsAttendancePrintState.division = previous.division; settingsAttendancePrintState.sort = previous.sort; settingsAttendancePrintState.yearMonth = previous.yearMonth; }
+};
+
 
 function settingsAttendanceFitTextCells(root) {
@@ -356,5 +373,5 @@
     + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.css">'
     + '<style>html,body{margin:0;padding:0;background:#fff;font-family:\'Pretendard\',-apple-system,BlinkMacSystemFont,sans-serif;color:#111;}body{padding:4mm 5mm;}@page{size:A4 portrait;margin:4mm 5mm;}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}'
-    + '.attendancePrintSheet{width:100%;background:#fff;color:#111;font-family:\'Pretendard\',-apple-system,BlinkMacSystemFont,sans-serif}.attendancePrintPage{width:100%;page-break-after:always;break-after:page;page-break-inside:avoid;break-inside:avoid}.attendancePrintPage:last-child{page-break-after:auto;break-after:auto}.attendancePrintHeader{padding-top:10px;margin-bottom:5px}.attendancePrintAcademy{font-size:15px;line-height:1.05;font-weight:760;color:#1f4776;letter-spacing:-.035em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.attendancePrintMonth{margin-top:1px;font-size:31px;line-height:.98;font-weight:900;color:#1f4776;letter-spacing:-.055em}.attendancePrintTable{width:100%;border-collapse:collapse;border-spacing:0;table-layout:fixed;color:#111}.attendancePrintTable th,.attendancePrintTable td{border:0.5px solid #777777;height:23px;padding:.5px 1.5px;text-align:center;vertical-align:middle;overflow:hidden;white-space:nowrap;text-overflow:clip}.attendancePrintTable th{background:#2f6f9f!important;background-color:#2f6f9f!important;color:#fff!important;font-size:8.4px;font-weight:760;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}.attendancePrintTable tbody td{font-size:10.6px;font-weight:560}.attendancePrintTable tbody td.nameCol,.attendancePrintTable tbody td.schoolGradeCol,.attendancePrintTable tbody td.personalityCol{line-height:1.05}.attendancePrintTable tbody td.nameCol{font-size:12px;font-weight:700}.attendancePrintTable tbody td.schoolGradeCol{font-size:11.6px;font-weight:600}.attendancePrintTable tbody td.personalityCol{font-size:11.4px;font-weight:600}.attendancePrintTable .noCol{width:20px;padding-left:0!important;padding-right:0!important}.attendancePrintTable .divisionCol{width:25px}.attendancePrintTable .nameCol{width:43px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:780}.attendancePrintTable .schoolGradeCol{width:52px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:660}.attendancePrintTable .personalityCol{width:20px;padding-left:0!important;padding-right:0!important}.attendancePrintTable .dateCol,.attendancePrintTable col.dateCol{width:var(--attendance-date-col-width,14px);padding-left:0!important;padding-right:0!important}.attendancePrintTable th.daySat,.attendancePrintTable td.daySat{background:#fff7c8!important;background-color:#fff7c8!important;color:#111!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}.attendancePrintTable th.daySun,.attendancePrintTable td.daySun{background:#ffd9df!important;background-color:#ffd9df!important;color:#111!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}body{padding:0}.attendancePrintTable th,.attendancePrintTable td{height:6mm;box-sizing:border-box}}'
+    + '.attendancePrintSheet{width:100%;background:#fff;color:#111;font-family:\'Pretendard\',-apple-system,BlinkMacSystemFont,sans-serif}.attendancePrintPage{width:100%;page-break-after:always;break-after:page;page-break-inside:avoid;break-inside:avoid}.attendancePrintPage:last-child{page-break-after:auto;break-after:auto}.attendancePrintHeader{padding-top:10px;margin-bottom:5px}.attendancePrintAcademy{font-size:15px;line-height:1.05;font-weight:760;color:#1f4776;letter-spacing:-.035em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.attendancePrintMonth{margin-top:1px;font-size:31px;line-height:.98;font-weight:900;color:#1f4776;letter-spacing:-.055em}.attendancePrintTable{width:100%;border-collapse:collapse;border-spacing:0;table-layout:fixed;color:#111}.attendancePrintTable th,.attendancePrintTable td{border:0.5px solid #777777;height:23px;padding:.5px 1.5px;text-align:center;vertical-align:middle;overflow:hidden;white-space:nowrap;text-overflow:clip}.attendancePrintTable th{background:#2f6f9f!important;background-color:#2f6f9f!important;color:#fff!important;font-size:8.4px;font-weight:760;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}.attendancePrintTable tbody td{font-size:10.6px;font-weight:560}.attendancePrintTable tbody td.nameCol,.attendancePrintTable tbody td.schoolGradeCol,.attendancePrintTable tbody td.personalityCol{line-height:1.05}.attendancePrintTable tbody td.nameCol{font-size:12px;font-weight:700}.attendancePrintTable tbody td.schoolGradeCol{font-size:11.6px;font-weight:600}.attendancePrintTable tbody td.personalityCol{font-size:11.4px;font-weight:600}.attendancePrintTable .noCol{width:20px;padding-left:0!important;padding-right:0!important}.attendancePrintTable .divisionCol{width:25px}.attendancePrintTable .nameCol{width:43px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:780}.attendancePrintTable .schoolGradeCol{width:52px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:660}.attendancePrintTable .personalityCol{width:20px;padding-left:0!important;padding-right:0!important}.attendancePrintTable .dateCol,.attendancePrintTable col.dateCol{width:var(--attendance-date-col-width,14px);padding-left:0!important;padding-right:0!important}.attendancePrintTable th.daySat,.attendancePrintTable td.daySat{background:#fff7c8!important;background-color:#fff7c8!important;color:#111!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}.attendancePrintTable th.daySun,.attendancePrintTable td.daySun{background:#ffd9df!important;background-color:#ffd9df!important;color:#111!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}body{padding:0}}'
     + '</style>'
     + '</head><body>' + html + '<script>(function(){function fitTextCells(){var cells=document.querySelectorAll(".attendancePrintTable tbody td.nameCol,.attendancePrintTable tbody td.schoolGradeCol,.attendancePrintTable tbody td.personalityCol");cells.forEach(function(cell){if(!cell||!String(cell.textContent||"").trim())return;cell.style.whiteSpace="nowrap";cell.style.overflow="hidden";cell.style.textOverflow="clip";cell.style.fontSize="";var availableWidth=Math.max(0,cell.clientWidth-1);if(availableWidth<=4)return;if(cell.scrollWidth<=availableWidth+1)return;var cs=window.getComputedStyle(cell);var size=parseFloat(cs.fontSize)||10;var min=10.2;var loop=0;while(cell.scrollWidth>availableWidth+1&&size>min&&loop<12){size=Math.max(min,size-0.3);cell.style.fontSize=size.toFixed(1)+"px";loop++}})};var didPrint=false;var closeTimer=null;var printStartedAt=0;function backToApp(){if(closeTimer)return;closeTimer=setTimeout(function(){try{if(window.opener&&!window.opener.closed){window.opener.focus();}}catch(e){}try{window.close();}catch(e){}},120);}window.addEventListener("afterprint",backToApp);window.addEventListener("focus",function(){if(didPrint&&Date.now()-printStartedAt>900){setTimeout(backToApp,450);}});setTimeout(function(){fitTextCells();didPrint=true;printStartedAt=Date.now();window.focus();setTimeout(function(){window.print();},80);},350);})();<\/script></body></html>';
@@ -451,2 +468,23 @@
 }
 window.downloadSettingsAttendanceRegisterPdf = downloadSettingsAttendanceRegisterPdf;
+
+const settingsDetailData = {
+  storageDiagnostics:{title:'저장 진단',html:renderOlliStorageDiagnostics},
+  platformAdmin:{title:'올리 관리',html:renderOlliPlatformAdminSettings,beforeOpen:loadOlliPlatformAdminAcademies},
+  academySwitch:{title:'학원 관리',html:renderOlliAcademySwitchOptions,instantRender:true,beforeOpen:async function(){ if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true }); if (typeof loadOlliAcademyManagementData === 'function') await loadOlliAcademyManagementData(); }},
+  ownerOtherAcademyFind:{title:'다른 학원 찾기',html:renderOlliOwnerOtherAcademyFindOptions,instantRender:true,beforeOpen:async function(){ if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true }); }},
+  teacherMyAcademies:{title:'내가 속한 학원',html:renderSettingsTeacherMyAcademies,instantRender:true,beforeOpen:async function(){ if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true }); }},
+  teacherAcademyFind:{title:'다른 학원 찾기',html:renderSettingsTeacherAcademyFind,instantRender:true},
+  academyAccess:{title:'사용 상태',html:renderOlliAcademyAccessSettings,beforeOpen:settingsLoadAcademy},
+  attendancePhotoImport:{title:'학생정보 일괄 수정',html:renderSettingsAttendancePhotoImport},
+  attendancePrint:{title:'출석부 출력',html:renderSettingsAttendancePrint,instantRender:true},
+  roles:{title:'권한 설정',html:function(){return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">역할에 맞는 권한으로<br/>학생 기록을 안전하게 관리합니다.</div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">원장</div><span class="settingsStatusBadge">전체 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">전체 학생과 모든 피드백 확인</div><div class="settingsRoleItem">백업 / 내보내기 사용 가능</div><div class="settingsRoleItem">선생님 계정과 권한 관리</div></div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">관리자</div><span class="settingsStatusBadge">점검 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">학생 기록과 피드백 흐름 점검</div><div class="settingsRoleItem">선생님 기록 상태 확인</div><div class="settingsRoleItem">백업/내보내기와 운영 판단은 제한</div></div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">선생님</div><span class="settingsStatusBadge">기록 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">담당 학생 기록 작성</div><div class="settingsRoleItem">피드백 작성과 성장 피드백 입력</div><div class="settingsRoleItem">권한 변경과 데이터 내보내기는 제한</div></div></div>';}},
+  teachers:{title:'선생님 관리',html:renderSettingsMembers,instantRender:true,beforeOpen:settingsLoadTeacherManagementMembers},
+  teacherInvite:{title:'선생님 초대',html:renderSettingsTeacherInvite,instantRender:true,beforeOpen:settingsLoadAllApprovalRequests},
+  approval:{title:'승인 요청',html:renderSettingsApprovalRequests, beforeOpen:settingsLoadAllApprovalRequests},
+  backup:{title:'백업 / 내보내기',html:function(){return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">백업과 내보내기는<br/>원장만 사용할 수 있습니다.</div></div><div class="settingsCard"><div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">전체 학생 데이터</span></div><span class="settingsBadge">JSON</span></div><div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">피드백 기록</span></div><span class="settingsBadge">JSON</span></div></div><button class="settingsExportBtn" onclick="downloadSettingsBackup()" type="button">전체 데이터 내보내기</button>';}},
+  privacy:{title:'개인정보 처리방침',html:function(){return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">학생 기록은<br/>안전하게 관리되어야 합니다.</div></div><div class="settingsInfoCard"><div class="settingsInfoHead">수집되는 정보</div><div class="settingsInfoList"><div class="settingsInfoItem">학생 이름, 등록일, 반 정보</div><div class="settingsInfoItem">수업 기록과 피드백 내용</div><div class="settingsInfoItem">선생님 계정 및 작성 기록</div></div></div><div class="settingsInfoCard"><div class="settingsInfoHead">AI 사용 안내</div><div class="settingsInfoList"><div class="settingsInfoItem">AI 생성 문구는 자동 발송되지 않습니다.</div><div class="settingsInfoItem">선생님 또는 원장의 검토 후 사용해야 합니다.</div></div></div>';}}
+};
+
+let settingsCurrentDetailType = '';
+
```

## 판정 원칙

- 끝 개행/공백만 다른 파일은 즉시 기준본에 맞춰도 기능 영향이 없다.
- 함수 본문 차이가 있는 파일은 PC 또는 폰을 통째로 덮어쓰지 않는다.
- 브라우저/화면 전용 차이는 어댑터로 이동하고, 데이터·정규화·저장 규칙만 공통 코어로 남긴다.
- 특히 출석부 출력과 키보드/visualViewport는 플랫폼 전용을 유지한다.
