# OLLI PC·폰 공통 모듈 정리

이 문서는 PC와 폰 저장소의 루트 JavaScript/CSS를 자동 비교한 구조 점검표다. 화면 기능을 변경하지 않고, 앞으로 공통 코어와 플랫폼 전용 UI를 분리하기 위한 기준으로 사용한다.

## 현재 기준

- 폰 JS/CSS: **106개**
- PC JS/CSS: **94개**
- 같은 파일명: **30개**
- 내용까지 완전히 동일: **18개**
- 같은 이름 + 유사도 72% 이상: **10개**
- 같은 이름이지만 구조 차이가 큼: **2개**

## A. 현재 이미 동일한 공통 모듈

아래 파일은 두 저장소에서 파일명과 내용이 모두 동일하다. 기능 공통화 1순위이며, 다음 단계에서는 한 곳을 기준본으로 정해 자동 동기화하거나 별도 Shared Core로 이동할 수 있다.

| 영역 | 파일 |
|---|---|
| 출결·시간표 | `olli-attendance-data.js` |
| 로그인·계정·학원전환 | `olli-auth-academy-access.js` |
| 로그인·계정·학원전환 | `olli-auth-account-session.js` |
| 로그인·계정·학원전환 | `olli-auth-entry-ui.js` |
| 로그인·계정·학원전환 | `olli-auth-member-validation.js` |
| 로그인·계정·학원전환 | `olli-auth-owner-onboarding.js` |
| 로그인·계정·학원전환 | `olli-auth-teacher-membership.js` |
| 로그인·계정·학원전환 | `olli-login-ui.js` |
| 로그인·계정·학원전환 | `olli-login.css` |
| 운영·상담 정책 | `olli-operations-consultation-policy.js` |
| 운영·상담 정책 | `olli-operations-feedback-policy.js` |
| 설정 | `olli-settings-access.js` |
| 로그인·계정·학원전환 | `olli-settings-account-runtime.js` |
| 설정 | `olli-settings-base.js` |
| 설정 | `olli-settings-detail.js` |
| 설정 | `olli-settings-members.js` |
| 설정 | `olli-settings-student-bulk-import.js` |
| 설정 | `olli-settings-teacher-invite.js` |

## B. 공통화 후보 — 같은 이름이지만 차이가 남아 있음

이 그룹은 PC 코드를 폰에 그대로 덮어쓰지 않는다. 실제 차이가 UI/플랫폼 어댑터인지, 데이터 규칙 차이인지 먼저 확인한 뒤 공통 코어 + 어댑터 형태로 정리한다.

| 영역 | 파일 | 유사도 | 폰 크기 | PC 크기 |
|---|---|---:|---:|---:|
| 설정 | `olli-settings-imports-base.js` | 100.0% | 1,462 | 1,464 |
| 설정 | `olli-settings-existing-feedback-import.js` | 99.9% | 53,334 | 53,234 |
| 설정 | `olli-settings-storage.js` | 99.4% | 18,526 | 18,394 |
| 학생 | `olli-data-students.js` | 99.2% | 16,855 | 16,692 |
| 유치부·1분 피드백 | `kinder-feedback.js` | 98.7% | 86,326 | 84,437 |
| 설정 | `olli-settings-import-test-tools.js` | 98.2% | 10,691 | 10,485 |
| 데이터·저장 | `olli-storage-core.js` | 96.7% | 78,371 | 74,121 |
| 설정 | `olli-settings-attendance-export.js` | 95.4% | 28,647 | 35,354 |
| 유치부·1분 피드백 | `kinder-feedback.css` | 90.8% | 31,700 | 27,753 |
| 데이터·저장 | `olli-data-foundation.js` | 81.7% | 20,842 | 28,546 |

## C. 같은 이름이지만 플랫폼/기능 차이가 큰 모듈

| 영역 | 파일 | 유사도 | 폰 크기 | PC 크기 |
|---|---|---:|---:|---:|
| 학생 | `olli-student-bulk-edit-runtime.js` | 4.7% | 21,607 | 24,496 |
| 기록·관찰 | `olli-record-search-controls.js` | 66.7% | 9,636 | 12,247 |

## D. 폰 전용으로 유지할 가능성이 높은 모듈

파일명에 `phone`, `ipad`, `keyboard` 등 플랫폼 특성이 명시된 파일이다. iOS visualViewport, safe-area, 터치/키보드 보정은 PC와 합치지 않는 것을 기본 원칙으로 한다.

- `kinder-feedback-keyboard.css` — 유치부·1분 피드백
- `olli-academy-soft-delete-phone.js` — 기타
- `olli-academy-switch-phone.css` — 로그인·계정·학원전환
- `olli-academy-switch-phone.js` — 로그인·계정·학원전환
- `olli-account-soft-delete-phone.js` — 로그인·계정·학원전환
- `olli-attendance-phone-adapter.js` — 출결·시간표
- `olli-attendance-policy-phone.css` — 출결·시간표
- `olli-attendance-policy-phone.js` — 출결·시간표
- `olli-auth-entry-phone-adapter.js` — 로그인·계정·학원전환
- `olli-memo-ipad-runtime.js` — 기록·관찰
- `olli-phone-base.css` — 기타
- `olli-phone-final-overrides.css` — 기타
- `olli-record-search-keyboard.css` — 기록·관찰
- `olli-start-page-phone.css` — 기타
- `olli-start-page-storage-phone.js` — 데이터·저장

## E. 폰에만 존재하는 기능 모듈

아래 파일은 현재 PC에 같은 이름의 대응 파일이 없다. 이름이 다를 뿐 같은 기능일 수도 있으므로 자동 공통화하지 않고 기능 단위로 대응 관계를 확인한다.

### 기록·관찰

- `olli-observation-core.js`
- `olli-observation-responsive.css`
- `olli-observation-runtime.js`
- `olli-record-board-actions.js`
- `olli-record-list-sort.js`
- `olli-record-render-ui.js`
- `olli-record-roster-sort.css`
- `olli-record-search-controls.css`
- `olli-record-sort-filter-ui.js`
- `olli-record-view.js`

### 기타

- `olli-academy-dashboard.css`
- `olli-boot.css`
- `olli-page-scroll-reset.js`
- `olli-pwa-manifest.js`
- `olli-teacher-invite-approval.css`
- `olli-teacher-management-legacy-cleanup.js`

### 로그인·계정·학원전환

- `olli-auth-lookup.css`
- `olli-login-start-runtime.js`

### 설정

- `olli-settings-attendance-photo-import-core.js`
- `olli-settings-attendance-photo-import-runtime.js`
- `olli-settings-detail-data.js`
- `olli-settings-server-sync.js`
- `olli-settings-teacher-management.css`
- `olli-start-page-settings-ui-bridge.js`

### 운영·상담 정책

- `olli-academy-consultation-status.css`

### 유치부·1분 피드백

- `kcf-feedback-status-runtime.js`
- `kcf-feedback-status.css`
- `kcf-guide-restore-runtime.js`
- `kcf-roster-filter-runtime.js`
- `kcf-roster-filter.css`
- `kcf-roster-sort-persist-runtime.js`
- `kinder-growth-survey-ui.js`

### 출결·시간표

- `olli-attendance-day-guide-runtime.js`
- `olli-attendance-guide-align-runtime.js`
- `olli-attendance-guide-button.css`
- `olli-attendance-past-date-runtime.js`
- `olli-attendance-record-summary-ui.js`
- `olli-attendance-record.css`

### 학생

- `kcf-student-link-runtime.js`
- `olli-data-student-sync.js`
- `olli-record-student-list.js`
- `olli-student-bulk-apply.css`
- `olli-student-bulk-edit-parser.js`
- `olli-student-core.js`
- `olli-student-info-layout.css`
- `olli-student-info-ui.js`
- `olli-student-lifecycle-init.js`
- `olli-student-list-sort-filter-runtime.js`
- `olli-student-modal-copy-runtime.js`
- `olli-student-picker-text.css`
- `olli-student-time-doc-import-runtime.js`
- `olli-student-time-options.css`

## 다음 공통화 순서

1. **완전 동일 파일**부터 기준본을 정하고 자동 동기화 구조를 만든다.
2. **유사도 높은 데이터·설정·정책 파일**은 실제 차이를 함수 단위로 비교해 공통 코어와 PC/폰 어댑터로 분리한다.
3. `phone`/`ipad`/키보드/레이아웃 파일은 플랫폼 전용으로 고정한다.
4. 화면 DOM과 CSS를 억지로 통합하지 않고, 학생·출석·상담·피드백·저장 규칙을 우선 공통화한다.
5. 공통 파일이 안정되면 Operations Center도 같은 Shared Core를 사용하도록 연결한다.

## 운영 원칙

- PC와 폰은 화면 계층을 별도로 유지한다.
- Supabase 원본 데이터 구조와 서버 저장 규칙은 하나의 기준을 사용한다.
- 공통 파일을 수정할 때 두 저장소에 수동 복사하는 상태를 장기적으로 유지하지 않는다.
- 공통화 과정에서 기능 변경과 구조 변경을 한 커밋에 섞지 않는다.

## 보류 항목

- 위험신호 페이지와 위험신호 전용 알림함은 제거했다.
- 일반 알림 기능은 사용 방향이 정해질 때까지 PC·폰 공통화 및 연동을 보류한다.
- Supabase의 기존 위험신호 테이블/과거 데이터는 코드 제거와 별개로 보존한다.
