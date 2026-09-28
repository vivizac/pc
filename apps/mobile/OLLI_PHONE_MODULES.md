# OLLI PHONE 모듈 안내

폰 버전의 거대한 `index.html`을 기능 변경 없이 단계적으로 분리한다. 화면/기능을 재작성하지 않고, 기존 실행 순서와 CSS cascade 위치를 보존한 채 외부 classic JS/CSS로 이동하는 것이 원칙이다.

## PC·Phone 모듈 이름 통일 원칙

- `olli-record-sort-student-ui.js`는 학생정보 팝업 DOM을 재생성하지 않는다. 초등/유치 학생정보의 요일·시간은 `olli-student-schedule-runtime.js`, 팝업 열기·기본정보·저장은 `olli-student-info-runtime.js`가 담당한다.

- `olli-student-info-runtime.js`는 팝업 열기·기본정보 입력·저장만 담당하고, 시간표 RPC·요일/시간 상태·담임 조회는 PC와 같은 역할의 `olli-student-schedule-runtime.js`가 담당한다.

- 같은 기능의 핵심 모듈은 PC와 Phone에서 **동일한 파일명**을 사용한다.
- 화면 차이만 필요한 코드는 핵심 파일명을 바꾸지 않고 `*-phone-adapter.js` 또는 Phone 전용 CSS로 분리한다.
- 앞으로 PC에서 기능을 수정한 뒤 Phone을 수정할 때는 `OLLI_PC_MODULES.md`와 이 문서에서 같은 이름의 모듈을 먼저 확인한다.
- 학생정보는 `olli-student-info-runtime.js`, 학생 요일·시간은 `olli-student-schedule-runtime.js`, 앱 시작은 `olli-app-startup.js`, 피드백 런타임은 `olli-feedback-runtime.js`가 각각 단일 책임을 가진다.


## 현재 분리 완료

| 수정 대상 | JavaScript | CSS |
|---|---|---|
| 출석부/기록실 검색, 실시간 이름 검색, iOS 키보드 위치 처리 | `olli-record-search-controls.js` | `olli-record-search-controls.css`, `olli-record-search-keyboard.css` |
| 공통 저장 컨텍스트·FeatureRegistry·로컬/서버 동기화 기반 | `olli-storage-core.js` | - |
| Supabase REST·저장 진단·피드백 공통 저장 기반 | `olli-data-foundation.js` | - |
| 학생 저장 키·삭제/복구 표시·상태 판정·학생 공통 기초 유틸 | `olli-student-core.js` | - |
| 학생 로컬 모델·그룹 피드백 월·학년/나이 생명주기 | `olli-data-students.js` | - |
| 기록 목록 정렬·그룹 아이콘·학생 선택/롱프레스 | `olli-data-record-list.js` | - |
| 학생목록 공통 정렬·요일·담임·성향 필터 런타임 | `olli-record-sort-student-ui.js` | `olli-record-roster-sort.css` |
| 출석부/관찰노트 정렬 상태·필터 UI 보정 | `olli-record-sort-filter-ui.js` | - |
| 1분 피드백 학생 연결·동명이인 선택·전송 검증 | `olli-feedback-registration-runtime.js + olli-feedback-registration-phone-adapter.js` | - |
| 1분 피드백 초등/유치·담임·요일 원생목록 필터 | `kcf-roster-filter-runtime.js` | `kcf-roster-filter.css` |
| 1분 피드백 월별 완료 점·완료상태 표시 | `kcf-feedback-status-runtime.js` | `kcf-feedback-status.css` |
| 폰 전용 다학원 전환·화면 캐시·전환 오버레이 | `olli-auth-academy-switch.js` | `olli-academy-switch-phone.css` |
| 폰 전용 계정 소프트 삭제·인증 입력 초기화 | `olli-account-soft-delete-phone.js` | - |
| 폰 전용 학원 소프트 삭제·삭제 후 학원 이동 | `olli-academy-soft-delete-phone.js` | - |
| 출석부 초등/유치 학생 행·재원/휴원/퇴원 목록 렌더링 | `olli-record-list-view.js` | - |
| 출석부 학생 피드백 시트·복사·삭제·재생성 | `olli-data-attendance-feedback.js` | - |
| 학생정보 수정 팝업·초등/유치 정보 입력·저장 UI 런타임 | `olli-student-info-runtime.js` | - |
| 학생정보 일괄수정 문서 파싱·요일/시간 정규화 | `olli-student-bulk-edit-parser.js` | - |
| 학생정보 일괄수정 저장·수동 빈값·요일별 시간 선택 런타임 | `olli-student-schedule-runtime.js` | - |
| 폰 전용 출결·보강 정책·계산 시작일 설정 런타임 | `olli-attendance-policy-runtime.js` | `olli-attendance-policy-phone.css` |
| 폰 출석부 출결 요약 가이드 UI | `olli-attendance-record-summary-ui.js` | `olli-attendance-record.css` |
| 학생등록/학생정보 입력줄·바텀시트 레이아웃 | - | `olli-student-info-layout.css` |
| 출석부 화면 전환·학원관리 전환·기록/학생 목록 로딩 | `olli-record-room-navigation.js` | - |
| 학생 이관·상태/삭제·Supabase 학생 저장·백그라운드 동기화 | `olli-data-student-operations.js` | - |
| 유치부 1분 피드백 화면·입력·사진·임시저장·키보드 처리 | `kinder-feedback.js` | `kinder-feedback.css`, `kinder-feedback-keyboard.css` |
| PC·폰 공통 계정 세션·로그인 진입 UI 동작·학원 접근·회원 검증·원장/선생님 인증 정책 | `olli-auth-account-session.js`, `olli-auth-entry-ui.js`, `olli-auth-academy-access.js`, `olli-auth-member-validation.js`, `olli-auth-owner-onboarding.js`, `olli-auth-teacher-membership.js` | - |
| PC·폰 공통 로그인 화면 DOM·스타일 | `olli-login-ui.js` | `olli-login.css` |
| 폰 전용 로그인 후 시작 페이지 라우팅 어댑터 | `olli-auth-entry-phone-adapter.js` | - |
| PC·폰 공통 상담 기준·상담 시점 계산·초등 그룹별 피드백 발송월 정책 | `olli-operations-consultation-policy.js`, `olli-operations-feedback-policy.js` | - |
| PC·폰 공통 출석 서버 읽기·쓰기·월 캐시 데이터 계층 + 폰 출석 어댑터 | `olli-attendance-data.js`, `olli-attendance-phone-adapter.js` | - |
| PC·폰 공통 설정 기본 상태·권한 UI·학원 정보·상담/피드백 월 설정 화면 기반 | `olli-settings-base.js` | - |
| 설정 공용값·상담 규칙·상담 진행상태 서버 동기화/로컬 미러 | `olli-settings-server-sync.js` | - |
| PC·폰 공통 설정 프로필·관리자 추가 권한·계정 로그아웃 런타임 | `olli-settings-account-runtime.js` | - |
| 설정 백업·저장 진단·재전송 | `olli-settings-storage.js` | - |
| 설정 가져오기 공통 상태·탭 | `olli-settings-imports-base.js` | - |
| 기존 피드백 파일 읽기·AI 분석·검수·저장 | `olli-settings-existing-feedback-import.js` | - |
| 출석부 사진 가져오기 전처리·정규화·압축 | `olli-settings-attendance-photo-import-core.js` | - |
| 출석부 사진 가져오기 분석·검수·학생 저장 | `olli-settings-attendance-photo-import-runtime.js` | - |
| 설정 가져오기 테스트 리셋 도구 | `olli-settings-import-test-tools.js` | - |
| 출석부 출력·인쇄·PDF 내보내기 | `olli-settings-attendance-export.js` | - |
| PC·폰 공통 설정 멤버·권한 관리 | `olli-settings-members.js` | - |
| PC·폰 공통 학생 요일·시간 일괄등록 | `olli-settings-student-bulk-import.js` | - |
| PC·폰 공통 선생님 초대·승인 링크 | `olli-settings-teacher-invite.js` | - |
| PC·폰 공통 체험기간·학원 접근 상태 | `olli-settings-access.js` | - |
| PC·폰 공통 설정 상세 화면 라우팅 | `olli-settings-detail.js` | - |
| 기록보드 롱프레스·선택·학생/피드백 soft delete 후속 동작 | `olli-record-board-actions-phone-adapter.js` | - |
| 폰 시작페이지 로컬 저장·설정 UI 브리지·로그인 시작 판정·PWA manifest | `olli-start-page-storage-phone.js`, `olli-start-page-settings-ui-bridge.js`, `olli-login-start-runtime.js`, `olli-pwa-manifest.js` | `olli-start-page-phone.css`, `olli-boot.css` |
| 관찰노트 iPad 화면 복구·페이지 전환 스크롤 초기화 | `olli-memo-ipad-runtime.js`, `olli-page-scroll-reset.js` | - |
| 1분 피드백 가이드 복구·원생목록 정렬 설정 유지 | `kcf-guide-restore-runtime.js`, `kcf-roster-sort-persist-runtime.js` | - |
| 학생 입력 안내·수업시간 선택·문서 가져오기·연도 생명주기 초기화 | `olli-student-modal-copy-runtime.js`, `olli-student-time-doc-import-runtime.js`, `olli-student-lifecycle-init.js` | `olli-student-time-options.css`, `olli-student-bulk-apply.css`, `olli-student-picker-text.css` |
| 폰 출결 요일 표시·결석 집계 시점·출결 버튼 정렬 보정 | `olli-attendance-day-guide-runtime.js`, `olli-attendance-past-date-runtime.js`, `olli-attendance-guide-align-runtime.js` | `olli-attendance-guide-button.css` |
| 학원관리/설정 상세·선생님 관리 후속 화면 스타일 및 레거시 정리 | `olli-settings-detail-data.js`, `olli-teacher-management-legacy-cleanup.js` | `olli-academy-dashboard.css`, `olli-teacher-invite-approval.css`, `olli-academy-consultation-status.css`, `olli-auth-lookup.css`, `olli-settings-teacher-management.css`, `olli-phone-final-overrides.css` |
| 폰 공통 기본 화면 스타일 | - | `olli-phone-base.css` |
| 초등 관찰노트 iPad·큰글자·반응형 보정 | - | `olli-observation-responsive.css` |
| 초등 관찰노트·분석·학생선택·화면전환·저장·피드백 생성 런타임 | `olli-observation-core.js` + `olli-data-ui-utils.js` + `elementary-analysis.js` + `elementary-analysis-phone-adapter.js` + `olli-record-student-picker.js` + `olli-record-student-picker-phone-adapter.js` + `olli-record-scene-tools.js` + `olli-record-scene-tools-phone-adapter.js`, `observation-memo-common.js` + `olli-observation-runtime.js` | 현재 `index.html` 유지 |

## 분리 원칙

- `index.html`에는 화면 DOM 조립과 아직 분리되지 않은 레거시 연결만 남긴다.
- 기존 인라인 JavaScript는 실행 위치를 바꾸지 않기 위해 같은 위치에서 외부 classic script로 교체한다.
- CSS도 기존 cascade 순서를 유지한다. 문서 끝의 키보드 보정처럼 최종 우선순위가 필요한 스타일은 별도 파일로 같은 위치에서 로드한다.
- 분리 작업 중 기능 변경을 함께 하지 않는다. 기능 수정은 모듈 분리가 끝난 뒤 해당 담당 파일에서 진행한다.
- PC와 폰 UI는 별도로 유지하되, 이후 학생/저장/피드백/출석 정책 같은 UI 비의존 로직부터 공통화를 검토한다.
- 출석 원본 데이터는 PC·폰이 같은 서버 기록을 사용하지만, 출석부 화면·인쇄·PDF 출력 값과 레이아웃은 PC/폰 전용 모듈로 각각 유지한다.
- 위험신호 페이지·알림함·위험신호 저장 코드는 제거했다. 일반 알림 기능은 사용 방향 확정 전까지 PC·폰 공통화 대상에서 제외한다.

## 다음 분리 순서

1. 학생 데이터 / Supabase 저장 기반 (1차 분리 완료)
2. 출석부 학생 목록과 화면 전환 (명단·정렬·화면 로딩 1차 분리 완료)
3. 유치부 1분 피드백 (화면·입력·사진·임시저장·키보드 1차 분리 완료)
4. 초등 관찰/피드백 (JS 코어·런타임 및 반응형 CSS 1차 분리 완료)
5. 로그인 공통 코어·진입 동작·화면 DOM·CSS (PC 기준 1차 통합 완료)
6. 설정 / 공통 유틸 (설정 베이스 + 계정/저장 + 가져오기 3종 + 테스트 도구 + 출석부 출력 1차 분리 완료)

## 주의

- iOS `visualViewport`, safe-area, 키보드 보정은 폰 전용 UI 계층으로 유지한다.
- Supabase 원본 데이터와 AI promptType 규칙은 PC/폰 공통화 후보로 관리한다.
