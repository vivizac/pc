# OLLI Central Reconciliation 상태 기록

기준일: 2026-09-25

PC 작업 브랜치: `feat/local-first-sync-step2-20260925`  
Phone 작업 브랜치: `feat/local-first-sync-step4-20260925`

## 9단계 목적

앱 시작 / focus / online / visibility 복귀 / 같은 계정의 storage 변경 /
학원 전환 / Realtime 재구독을 각 화면이 따로 처리하지 않고,
하나의 중앙 Coordinator가 한 번 수신해 각 도메인에 reconciliation 신호를 전달한다.

데이터 저장·삭제·CAS 로직은 변경하지 않는다.

## 중앙 Coordinator

새 공통 원본:

`olli-reconciliation-common.js`

공개 API:

- start
- stop
- request
- flush
- getState
- captureContext
- isContextCurrent

### 중앙 lifecycle 입력

- boot
- focus
- online
- visible
- storage
- pageshow(BFCache restore)
- academy_context
- realtime_subscribed
- session_restored

focus + online + visible처럼 짧은 시간에 연속 발생하는 신호는 140ms 안에서 하나의 pass로 합친다.

## Realtime 역할 변경

기존:

각 `watchDomain()` watcher가 개별적으로

- focus
- online
- visibilitychange
- storage
- SUBSCRIBED

listener를 가졌다.

Realtime 공통 모듈 자체도 별도로 같은 lifecycle listener와 5초 context timer를 가졌다.

현재:

각 watcher는

- `olli:realtime-change`
- `olli:reconcile`

만 수신한다.

실제 change 신호의 retry-until-applied 로직은 그대로 유지한다.
즉 편집 중 보류 / in-flight / transient failure 시 재시도 동작은 변경하지 않았다.

중앙 reconciliation은 catch-up 1회 신호다.
이미 pending인 실제 change가 있으면 기존 change trigger가 우선 유지되어 retry semantics도 보존된다.

## Realtime 연결 lifecycle

정상 Step 9 빌드에서는 `OlliReconciliation`이 Realtime 연결 lifecycle을 소유한다.

기존 Realtime의:

- focus
- online
- storage
- visibilitychange
- 5초 context check interval
- boot ensure

은 정상 경로에서 제거했다.

다만 rolling deploy / 공통 파일 로드 실패에 대비해
`OlliReconciliation` 자체가 없는 경우에만 기존 lifecycle을 설치하는
`installLegacyLifecycleFallback()`을 남겼다.

통합 샌드박스에서 정상 빌드 기준:

- focus listener: 1
- online listener: 1
- storage listener: 1
- visibility listener: 1
- legacy fallback installed: false

를 확인했다.

## Sync Manager

2단계에서 만든 `OlliSyncManager`를 PC/Phone에서 실제로 로드한다.

Coordinator는 Manager의 `startLifecycle()`을 호출하지 않는다.
lifecycle listener가 두 벌 생기지 않도록 Coordinator가 유일한 lifecycle owner다.

Coordinator pass마다:

`OlliSyncManager.requestRegistered(...)`

를 호출한다.

현재 등록 adapter가 없으면 no-op이며,
향후 adapter가 등록되면 동일한 중앙 lifecycle에서 marker/cursor 확인 기회를 받는다.

## Academy switch

기존 browser `storage` 이벤트는 같은 창의 localStorage 변경에는 발생하지 않는다.

따라서 PC/Phone `AcademyContext.setCurrent()`에 읽기 전용 신호:

`olli:academy-context-changed`

를 추가했다.

기존:

- contextVersion
- localStorage persist
- stale response token
- runtime cleanup

로직은 변경하지 않았다.

Coordinator는 academy_context를 즉시 처리한다.

학원 전환 중 이전 academy 요청이 완료돼도
captured AcademyContext token이 stale이면 reconciliation을 적용하지 않고
새 academy pass를 trailing run으로 처리한다.

## Observation Note

### PC

기존 데이터 최신본 확인용:

- focus
- online
- visible

직접 listener를 제거하고 `olli:reconcile`로 전환했다.

유지:

- observation Realtime change 직접 반응
- memoEditor focusin 시 dirty가 아닐 때 최신본 확인
- dirty/pending/conflict/CAS 보호

### Phone CAS pending

기존:

- online
- focus → pending CAS retry

현재:

- `olli:reconcile` → pending CAS retry

retryAllPending 자체는 변경하지 않았다.

### Phone session recovery — 보호 예외

`olli-observation-autosave-phone-adapter.js`의:

- focus
- online
- visibility

세션 검증/복구 listener는 그대로 유지한다.

이 코드는 데이터 snapshot refresh가 아니라
관찰노트 저장 가능한 account session을 회복하는 안전 장치이므로 중앙화 대상에서 제외했다.

기기 승인으로 세션이 복구되면 기존:

`olli:phone-memo-session-restored`

신호를 Coordinator도 수신해 즉시 새 reconciliation을 시작한다.

## Schedule

PC 시간표의 직접:

- focus
- visibilitychange

revision 확인을 제거했다.

`OlliRealtime.watchDomain('schedule')`이 중앙 `olli:reconcile`을 받아
기존 `checkLiveScheduleSync()`를 실행한다.

보존:

- schedule revision
- 저장 중 보류
- dialog/editor open 보류
- attendance loading/saving 보류
- stale academy response 차단
- actual realtime change retry

## Students / Consultation

Step 7 공통 watcher의 자체 `ensureConnected()` boot 호출을 제거했다.

watcher 등록만 수행하고
연결 lifecycle은 Coordinator가 담당한다.

학생/상담 revision 및 snapshot 로직은 변경하지 않았다.

## Team Chat / Materials

PC Team Chat의 session/academy storage listener 기반 badge refresh는
`olli:reconcile` 기반으로 전환했다.

PC 재료요청의 storage 직접 full refresh도 제거했다.

자료 데이터는 이미 materials Realtime watcher가 중앙 reconcile을 받으므로,
fallback refresh는 watcher가 없는 경우에만 실행한다.

Phone Team Chat / Material / Feedback 화면을 사용자가 실제로 열 때의
`ensureConnected()`는 유지했다.

이는 lifecycle polling이 아니라 화면 진입 시 연결 확보이므로 유지 대상이다.

## 검증

### 실제 이벤트 샌드박스

정상 Realtime + Coordinator 통합:

- lifecycle listener 각 1개
- legacy fallback 미설치
- direct focus → watcher 호출 0
- central reconcile → watcher 호출 1

통과.

Coordinator:

- boot one pass
- focus + online + visible burst coalescing
- hidden defer
- offline defer

4/4 통과.

추가 안전 검증:

- Coordinator 자신이 만든 SUBSCRIBED 중복 방지
- academy switch stale response 차단
- phone session restored reconciliation

3/3 통과.

### 문법

수정된:

- reconciliation
- realtime
- storage core PC/Phone
- timetable
- observation
- team chat
- materials
- student sync
- consultation sync
- 관련 테스트

전부 JS 문법 통과.

### polling

Step 9 대상 코드에서 새 setInterval 없음.

Realtime의 기존 5초 context timer는 제거했다.

## 변경하지 않은 것

- Supabase schema
- DB migration
- save RPC
- schedule revision semantics
- observation CAS
- observation conflict/version lineage
- pending write 내용
- feedback cursor
- chat cursor
- materials cursor
- IndexedDB cache 구조
- UI

## 최종 병합 전 주의

Phone Preview의 공통 rewrite는 현재 PC feature branch를 가리킨다.

최종 병합 순서:

1. PC 공통 파일들을 main에 병합
2. 필요한 Supabase migrations를 순서대로 Production 적용
3. Phone rewrite destination을
   `vivizac/pc/feat/local-first-sync-step2-20260925/...`
   에서
   `vivizac/pc/main/...`
   로 변경
4. Phone main 병합
5. Production deploy 및 실제 기기 회귀 검증

9단계 자체에는 Supabase migration이 없다.
