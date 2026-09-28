# Olli Monorepo Ownership Audit — 2026-09-29

## 기준점

- PC Production main: `0b56edcf5493d1a5224874eb30f0c2d1c68eadc6`
- Mobile Production main: `0e74868fbdd3b73b3e84f57fcd31e46b64df6484`
- 작업 브랜치: `work/olli-mobile-self-contained-20260929`
- Common inventory 정렬 커밋: `afdb02f5c50bdab2daaff86dbb23619f2c81f2d7`

이 문서는 코드 동작을 변경하지 않는다. self-contained 전환 전에 현재 공유 코드의 소유권과 위험도를 고정한다.

## 현재 구조

현재 Mobile Production은 자체 저장소의 플랫폼 파일을 사용하면서, 공통 경로는 Vercel rewrite를 통해 `vivizac/pc/main` raw 파일을 런타임에 읽는다.

현재 확인된 bridge:

- PC raw rewrite: 45개
- 그중 PC `main` 직접 참조: 44개
- 고정 commit 참조: `observation-memo-version-history-core.js` 1개
- `apps/mobile`: 아직 실제 디렉터리가 아니라 Mobile 저장소를 가리키는 gitlink
- `packages/common`: 현재 Production bridge와 전환용 shared 파일을 반영한 48개 snapshot
- 기존 PC root / 기존 Mobile 저장소 / Production raw rewrite는 아직 유지

## 최종 구조

```
Supabase
   ↓
packages/common
   ↓
┌───────────┬─────────────┐
│ apps/pc   │ apps/mobile │
└───────────┴─────────────┘
   ↓              ↓
PC Vercel      Mobile Vercel
(독립 배포)     (독립 배포)
```

최종적으로 Mobile이 PC 저장소의 raw 파일을 런타임에 직접 실행하지 않는다.

## 중요한 판단

**현재 공유되고 있다는 사실과 최종 Common Core에 속해야 한다는 사실은 다르다.**

기존 bridge에는 데이터/비즈니스 규칙뿐 아니라 DOM·팝업·버튼·CSS까지 직접 다루는 파일도 있다. 이 파일들을 self-contained 전환과 동시에 리팩터링하면 저장·인증·관찰노트·Realtime 회귀 원인을 분리하기 어렵다.

따라서 구조 전환은 두 종류의 작업을 섞지 않는다.

1. **위치 전환:** 현재 검증된 실행 내용을 그대로 유지한 채 raw runtime 의존성만 monorepo 내부 build-time 의존성으로 바꾼다.
2. **소유권 정리:** Production 전환이 안정화된 뒤 UI-coupled shared 파일을 Common Core와 플랫폼 UI로 별도 분리한다.

## A. 보호 대상 Common Core / shared infrastructure

아래 파일은 현재 분석에서 플랫폼 UI 상태를 직접 변경하지 않거나, 공통 데이터·동기화·계약 역할이 중심이다.

- `observation-memo-common.js`
- `observation-memo-edit-state-core.js`
- `observation-memo-feedback-clear-common.js`
- `observation-memo-save-common.js` — 관찰노트 CAS/save 흐름 보호 대상
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
- `olli-realtime-common.js` — document visibility 등 브라우저 상태는 읽지만 플랫폼 DOM을 직접 바꾸지 않음
- `olli-student-bulk-edit-parser.js` — 파서 중심, UI 쓰기 없음
- `scene-card-model-common.js`
- `scene-feedback-text-common.js` — UI 쓰기 없음

### 이 그룹에서 특히 건드리지 않을 것

- CAS / revision
- pending / blocked / conflict
- session recovery
- Realtime signal 보류·재시도
- academy/session context 검증
- server-first clear/save
- 기존 RPC payload 및 오류 계약

self-contained 이전에서는 위 로직을 리팩터링하지 않는다.

## B. Mixed — 공통 데이터와 UI가 한 파일에 섞인 고위험 파일

아래 파일은 데이터/권한/저장 역할과 DOM 변경이 함께 있다. 최종 구조에서는 분리가 필요하지만 **이번 위치 전환에서는 내용 그대로 보존**한다.

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

이 그룹을 구조 전환과 동시에 쪼개지 않는다. 데이터 저장/권한과 UI 변경을 동시에 수정하면 회귀 원인 추적이 어려워진다.

## C. UI 성격이 강한 shared runtime

아래 파일은 실제 DOM·화면·버튼·CSS 소유가 강하다. 최종적으로는 해당 플랫폼 UI 또는 명확한 UI 패키지 계약으로 재분류해야 한다.

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

현재 PC/Mobile이 같은 화면 조각을 재사용하고 있으므로 self-contained 1차 전환에서는 동작을 바꾸지 않고 snapshot을 그대로 소비한다. UI/Core 재분리는 별도 작업으로 한다.

## 위험도

### RED — 구조 이전 중 동작 변경 금지

- 관찰노트 저장/CAS/revision/version history
- 인증 account session / academy context
- Realtime
- 학생 데이터 저장·복원
- 출석/시간표 공통 데이터
- 사진 signed storage

### ORANGE — 위치만 이전, 의미 리팩터링 금지

- settings 계열
- feedback registration/runtime
- student picker / record list
- auth UI와 권한 데이터가 섞인 파일

### GREEN — 경로/정적 자산

- Mobile 전용 CSS/SVG/아이콘
- 순수 화면 adapter
- 테스트 fixture 및 문서

GREEN도 self-contained 복사 시 원본 SHA/바이트를 보존하고 누락 여부를 검증한다.

## self-contained 전환 계약

1. `apps/mobile`은 Mobile Production main `0e74868f...`를 기준으로 materialize한다.
2. 첫 전환에서는 Mobile 앱 소스의 기능 코드를 수정하지 않는다.
3. 공통 파일의 내용도 수정하지 않는다.
4. 빌드 단계에서 `packages/common`의 현재 snapshot을 Mobile 정적 배포물의 기존 상대 경로에 복사한다.
5. 따라서 Mobile `index.html`의 기존 script/css 로딩 순서를 가능한 한 바꾸지 않는다.
6. Vercel raw rewrite는 Preview 검증 전 제거하지 않는다.
7. 기존 `vivizac/mobile` 저장소는 Production 전환과 회귀검증 완료 전 삭제/비활성화하지 않는다.
8. PC Vercel과 Mobile Vercel은 계속 별도 Project로 유지한다.
9. Supabase schema/migration은 이 구조 작업에서 변경하지 않는다.

## 다음 작업 순서

1. Mobile Production tree를 `apps/mobile`에 self-contained snapshot으로 materialize한다.
2. `packages/common` → Mobile deploy output 복사 build script를 만든다.
3. 기존 Mobile `vercel.json`의 raw rewrite를 아직 삭제하지 않은 상태에서 local/static 구조 검증을 한다.
4. Mobile 테스트 + Common 테스트 + PC 영향 테스트를 실행한다.
5. Preview 배포에서 script/css 404, 로딩 순서, 로그인, 관찰노트, 시간표, 출석, Team Chat을 검증한다.
6. Preview 안정화 후 Mobile Vercel Root Directory를 새 구조로 전환한다.
7. Production smoke 이후에만 raw rewrite와 gitlink/legacy bridge를 제거한다.
8. 마지막으로 UI-coupled shared runtime의 소유권 분리는 별도 안정화 작업으로 진행한다.

## 회귀 게이트

- 관찰노트 PC→Phone / Phone→PC
- 읽기만 한 관찰노트는 revision·updatedAt 변화 없음
- 동시 수정 conflict/CAS 보호
- pending/blocked 임의 재전송 없음
- 세션 복구 후 실제 수정 저장
- 시간표 과거/현재/미래 A/B 날짜 판정
- 보강/체험/대기/수업이동/출석
- Olli AI 빈자리
- Realtime 다른 기기 갱신/재접속/week cache
- 학생정보
- 설정/멤버 권한
- 사진 signed read/upload
- Team Chat

이 게이트가 통과하기 전에는 기존 raw/legacy 연결을 삭제하지 않는다.
