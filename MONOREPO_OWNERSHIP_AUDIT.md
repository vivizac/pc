# Olli Monorepo Ownership Audit — 2026-09-29

## 기준점

- PC Production main: `0b56edcf5493d1a5224874eb30f0c2d1c68eadc6`
- Mobile Production main: `0e74868fbdd3b73b3e84f57fcd31e46b64df6484`
- 작업 브랜치: `work/olli-mobile-self-contained-20260929`
- Common inventory 정렬 커밋: `afdb02f5c50bdab2daaff86dbb23619f2c81f2d7`
- Mobile exact materialize 기준 커밋: `77b9eff0cdad0947e4a757c5f7864c065be23ecc`
- Mobile Production baseline tree: `8f56ad46a9ec014506e5a4bc0512737b483ab666` (246 blobs, exact match)

현재 `packages/common`은 **전환기 runtime parity 패키지**다. 현재 공유되고 있다는 사실과 최종 Common Core 소유권은 별개다.

## 현재 구조

- Mobile Production은 기존 `vivizac/mobile` 저장소와 raw GitHub bridge를 계속 사용한다.
- 작업 브랜치의 `apps/mobile`은 Mobile Production baseline 246개 파일을 누락 없이 materialize했다.
- 작업 브랜치의 Mobile build는 `packages/common`의 45개 runtime 파일을 기존 상대 경로로 stage하며 외부 PC raw runtime rewrite를 사용하지 않는다.
- Production Vercel 설정과 Production Mobile 저장소는 아직 변경하지 않았다.
- `packages/common`에는 전환기 parity를 위해 48개 shared snapshot이 있다.

## 전환 원칙

1. 먼저 현재 runtime을 self-contained 구조에서 바이트/동작 동일하게 만든다.
2. Production 안정화 후 UI-coupled 파일을 Common Core와 플랫폼 UI로 별도 분리한다.
3. 저장소 이동과 의미 리팩터링을 동시에 하지 않는다.

## A. 최종 Common Core / shared infrastructure 후보 — 15개

- `observation-memo-common.js`
- `observation-memo-edit-state-core.js`
- `observation-memo-feedback-clear-common.js`
- `observation-memo-session-common.js`
- `observation-memo-storage-common.js`
- `observation-memo-version-history-core.js`
- `olli-attendance-data.js`
- `olli-auth-member-validation.js`
- `olli-command-router-common.js`
- `olli-command-schedule-common.js`
- `olli-feedback-photo-storage-common.js`
- `olli-operations-consultation-policy.js`
- `olli-operations-feedback-policy.js`
- `olli-realtime-common.js`
- `scene-card-model-common.js`

## B. Mixed — Core와 UI 분리가 필요한 파일 — 19개

- `observation-memo-save-common.js`
- `olli-auth-academy-access.js`
- `olli-auth-account-session.js`
- `olli-auth-owner-onboarding.js`
- `olli-auth-teacher-membership.js`
- `olli-data-record-list.js`
- `olli-data-students.js`
- `olli-feedback-registration-runtime.js`
- `olli-settings-access.js`
- `olli-settings-common-core.js`
- `olli-settings-existing-feedback-import.js`
- `olli-settings-imports-base.js`
- `olli-settings-members.js`
- `olli-settings-storage.js`
- `olli-settings-student-bulk-import.js`
- `olli-settings-teacher-invite.js`
- `olli-settings-team-talk-common.js`
- `olli-student-bulk-edit-parser.js`
- `scene-feedback-text-common.js`

이 파일들은 이번 위치 전환에서는 내용 그대로 보존한다.

## C. Platform UI 성격이 강한 shared runtime — 14개

- `elementary-analysis.js`
- `observation-memo-version-history-common.js`
- `olli-auth-entry-ui.js`
- `olli-data-ui-utils.js`
- `olli-feedback-runtime.js`
- `olli-login-ui.js`
- `olli-login.css`
- `olli-record-scene-tools.js`
- `olli-record-student-picker.js`
- `olli-settings-detail.js`
- `olli-settings-team-talk-common.css`
- `record-feedback-mode-common.js`
- `scene-card-kinder-feedback-common.js`
- `scene-card-ui-common.js`

최종 소유권은 `apps/pc` / `apps/mobile`이다. 전환기에는 runtime parity를 위해 build-time staging 대상으로 유지할 수 있다.

## 위험도

### RED — 의미 변경 금지
- 관찰노트 CAS/revision/version history
- account session / academy context
- Realtime
- 학생 데이터 저장·복원
- 출석/시간표 A/B 공통 규칙
- signed photo storage

### ORANGE — 위치만 이전
- settings 계열
- feedback registration/runtime
- student picker / record list
- auth UI와 권한 데이터가 섞인 파일

### GREEN — 경로/정적 자산
- Mobile 전용 CSS/SVG/아이콘
- 순수 화면 adapter
- 테스트 fixture 및 문서

## 완료된 단계

1. Common inventory parity — 완료
2. 소유권/위험도 조사 — 완료
3. Mobile Production 246 blobs self-contained materialize — 완료
4. local `packages/common` 45개 staging build 구성 — 완료
5. 오래된 gitlink 계약 테스트/문서 정리 — 현재 단계

## 다음 게이트

1. CI: self-contained build + PC/Mobile 핵심 회귀 테스트
2. Mobile Vercel Preview: `apps/mobile` Root Directory + outside-root source access
3. script/css 404 및 로딩 순서
4. 로그인/학원 컨텍스트
5. 관찰노트 CAS/pending/conflict
6. 시간표 A/B + 출석/보강/대기/이동
7. Olli AI 빈자리
8. Realtime/재접속/week cache
9. 학생정보/설정/멤버 권한
10. signed photo upload/read
11. Team Chat
12. Preview 안정화 후 Production Root Directory cutover 검토

이 게이트가 통과하기 전에는 기존 Production raw/legacy 연결을 삭제하지 않는다.
