# OLLI Sync Manager 상태 기록

기준일: 2026-09-25  
작업 브랜치: `feat/local-first-sync-step2-20260925`

## 2단계 목적

Local-first 최종 구조의 중앙 조정 계층을 먼저 만들되, 기존 저장/불러오기/Realtime/CAS 동작에는 연결하지 않는다.

이번 단계에서 추가한 공통 원본:

- `olli-sync-manager-common.js`
- `tests/olli-sync-manager-common.test.cjs`

Phone 저장소에는 복사본을 만들지 않았다. 아직 Phone HTML/rewrite에도 연결하지 않았다.

## 현재 상태

Sync Manager는 현재 **독립 모듈**이다.

- PC HTML에서 로드하지 않는다.
- Phone HTML에서 로드하지 않는다.
- Supabase를 직접 호출하지 않는다.
- OlliRealtime을 구독하지 않는다.
- schedule/observation/student/feedback/chat/materials 어느 실제 도메인도 등록하지 않는다.
- `startLifecycle()`도 자동 실행하지 않는다.
- 따라서 2단계 코드만으로 운영 데이터 저장·불러오기 동작은 바뀌지 않는다.

## 역할

Sync Manager는 데이터의 실제 저장 방식이나 cursor/revision 의미를 소유하지 않는다.

담당 범위:

1. 도메인 adapter 등록
2. 같은 도메인의 동시 sync 1개 제한
3. 실행 중 추가 요청을 하나의 후속 pass로 합치기
4. active/user/reconcile/background 우선순위 조정
5. academy/session/context token 캡처
6. 오래된 학원/세션 응답의 적용 차단
7. offline/hidden/no-context 상태에서 pending 유지
8. 실패 또는 adapter 보류 상태를 pending으로 남김
9. 명시적 resume 또는 lifecycle opt-in 때만 재시도
10. 상태 진단 제공

## 중요한 경계

### checkpoint

checkpoint/revision/cursor를 실제로 저장하는 책임은 각 도메인 adapter에 있다.

순서:

1. 서버 delta/snapshot 수신
2. LocalStore/로컬 DB 적용 성공
3. 로컬 일관성 확인
4. 그 뒤에 adapter가 checkpoint를 확정
5. adapter가 Sync Manager에 `true` 또는 `{ applied: true }` 반환

Sync Manager가 다운로드만 성공한 상태에서 checkpoint를 먼저 전진시키는 구조를 만들지 않는다.

### Realtime

Realtime은 앞으로 Sync Manager를 깨우는 입력 중 하나가 될 수 있지만, 이번 단계에서는 연결하지 않는다.

기존 `olli-realtime-common.js`의 안정화된 동작을 수정하지 않았다.

### 관찰노트

관찰노트 CAS/revision/mutation/pending/blocked/conflict/session recovery/version lineage 코드를 전혀 수정하지 않았다.

### 시간표

schedule revision, 현재 주/월 재조회, 편집 중 보류, stale-response 차단 코드를 전혀 수정하지 않았다.

## 공개 API

- `registerDomain(spec)`
- `unregisterDomain(domain)`
- `request(domain, options)`
- `requestMany(domains, options)`
- `requestRegistered(reason, options)`
- `resumePending(reason, options)`
- `setActiveDomain(domain)`
- `getState(domain)`
- `getStates()`
- `configure({ maxConcurrent })`
- `startLifecycle()`
- `stopLifecycle()`
- `captureContext()`
- `isContextCurrent(snapshot)`

## 우선순위

- background: 10
- reconcile: 30
- active: 50
- user: 70
- critical: 90

실제 화면에서 사용자가 연 도메인은 향후 `setActiveDomain()`으로 우선순위를 올릴 수 있다.

## 재시도 원칙

Sync Manager 자체는 주기 polling을 만들지 않는다.

adapter가 false를 반환하거나 예외가 발생해도 자동 무한 재시도하지 않는다. pending을 유지하고 아래와 같은 외부 계기가 생겼을 때만 다시 요청한다.

- Realtime change
- online
- focus/visibility 복귀
- academy switch
- 사용자 화면 진입
- 명시적 retry

`startLifecycle()`은 opt-in이며 2단계에서는 호출하지 않는다.

## 2단계 검증

실제 GitHub 브랜치에 저장된 `olli-sync-manager-common.js`를 실행해 다음 시나리오를 검증했다.

- 모듈 로드만으로 timer/network side effect 없음
- 단일 요청 정상 실행
- 같은 도메인 중복 요청 동시 실행 방지
- 실행 중 신호는 한 번의 trailing pass로 처리
- 우선순위 순서
- active domain 우선
- offline pending 보존 후 resume
- academy switch 중 이전 응답 폐기
- adapter 오류 후 자동 polling 없음
- adapter false 후 자동 polling 없음
- lifecycle 자동 시작 안 함
- context snapshot stale 판정

운영 코드 대비 변경 파일은 이 모듈과 테스트 파일뿐이며 기존 파일 수정은 없다.

## 다음 단계 전제

원래 확정한 1~9 단계 순서를 유지한다.

3단계는 실제 화면/domain 연결보다 먼저 **서버 Sync Manifest**를 검토하는 단계다. 학원별 최신 상태를 한 번에 작게 확인할 수 있도록 각 도메인의 기존 marker를 모으되, 하나의 전역 revision으로 합치지 않는다.

검토 후보:

- schedule: 기존 academy schedule revision
- chat: 최신 message id 또는 향후 chat change marker
- materials: 기존 event id / row revision
- feedback: 아직 durable cursor가 없으므로 3단계에서 marker 정의 가능 여부만 검토
- students / consultation: 현재 구조를 확인한 뒤 별도 revision 필요성 판단

3단계에서도 기존 저장/불러오기 로직을 바로 교체하지 않는다. DB/RPC 변경이 필요하면 migration과 운영 DB를 일치시키고, manifest가 기존 동작에 영향을 주지 않는 독립 read-only 계층인지 먼저 검증한다.

실제 schedule/observation adapter 연결은 그 이후 단계에서 진행하며, 안정화된 내부 코드를 재작성하지 않고 기존 조회/검증 함수를 adapter에서 호출하는 방식으로만 연결 가능성을 확인한다.
