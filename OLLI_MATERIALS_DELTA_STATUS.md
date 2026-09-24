# OLLI Materials Delta Sync 상태 기록

기준일: 2026-09-25

PC 작업 브랜치: `feat/local-first-sync-step2-20260925`  
Phone 작업 브랜치: `feat/local-first-sync-step4-20260925`

## 5단계 목적

재료주문이 Team Chat의 `chat` Realtime domain을 공유하면서 서로 불필요한 전체 재조회를 일으키는 구조를 분리한다.

목표 구조:

- 재료 변경 신호: `materials`
- durable checkpoint: `olli_team_material_request_events.id`
- 최초/수동 복구: 기존 `olli_team_material_requests_list` full snapshot
- 이후 변경: `olli_team_material_requests_delta`
- 상태변경 동시성 보호: 기존 request row `revision` CAS 그대로 유지

## 사전 전수조사

현재 재료요청 row를 변경하는 application RPC는 다음 두 개다.

- `olli_team_material_request_create`
- `olli_team_material_request_set_status`

기존 두 RPC 모두 event row는 남겼지만 Realtime 신호는 `chat`으로 보냈다.

작업 전 Production 데이터:

- live request: 3
- event: 7
- created event: 3
- status_changed event: 4
- event head: 7
- deleted request: 0

## event 기록 중앙화

5단계부터 event 기록을 각 RPC가 수동으로 수행하지 않는다.

`private.olli_team_material_request_log_change()` trigger function을 만들고
`public.olli_team_material_requests`의 INSERT/UPDATE 뒤에 1개의 event를 남긴다.

event types:

- created
- status_changed
- updated
- deleted
- restored

따라서 향후 재료명/수량/메모 수정이나 `deleted_at` soft-delete 기능이 추가되어도 event cursor에서 빠지지 않는다.

기존 create idempotency와 status CAS는 변경하지 않는다.

- create: `(academy_id, client_mutation_id)` conflict-safe
- status: `revision = expected_revision` 조건
- 성공 시 revision + 1
- stale revision이면 기존 충돌 오류 유지

Hard DELETE는 현재 app write path에 존재하지 않는다.
material event의 request FK가 `ON DELETE CASCADE`이므로 durable history가 필요한 app 삭제는 앞으로도 `deleted_at` soft-delete를 사용해야 한다.

## Realtime domain 분리

정식 domain:
`materials`

서버 `private.olli_realtime_send_signal`과 공통 `OlliRealtime`의 valid domain에 materials를 추가했다.

새 재료 event가 생성되면:

`materials / revision = event_id`

신호를 보낸다.

### Rolling deploy 호환

배포 순간 이미 열려 있는 구버전 client는 materials domain을 모른다.

데이터 최신성을 놓치지 않기 위해 서버는 materials 신호와 함께 다음 구버전 호환 신호도 보낸다.

- domain: chat
- compatibility_alias: materials

구버전은 이를 기존 chat 신호로 받아 재료목록을 갱신한다.

신버전 `olli-realtime-common.js`는
`domain=chat + compatibility_alias=materials`를 무시하므로
신버전 Team Chat은 재료 변경으로 동작하지 않는다.

따라서 rolling deploy 중 데이터 최신성과 신버전 domain 분리를 동시에 보존한다.

## Delta RPC

새 예정 RPC:

`public.olli_team_material_requests_delta(p_session_token, p_academy_id, p_after_event_id, p_limit)`

반환:

- items: 이번 event page에서 변경된 현재 request row
- deleted_request_ids
- summary: 전체 live 상태 count
- current_role / can_process
- latest_event_id
- next_event_id
- has_more
- change_types

summary는 changed item만 계산하지 않고 서버에서 전체 live row 기준으로 계산한다.
따라서 로컬이 최근 300건만 보유해도 요청/보류/주문완료/도착 개수가 틀어지지 않는다.

## Full snapshot / cursor 경합 방지

중요 원칙:

`baseline head 캡처 → full snapshot 조회/적용 → 적용 성공 후 캡처했던 head를 checkpoint로 저장`

snapshot 뒤에 최신 head를 새로 읽어 checkpoint로 쓰지 않는다.

이유:
snapshot과 head 조회 사이에 변경이 생기면 snapshot에는 없는데 cursor만 앞으로 가는 누락이 발생할 수 있다.

baseline을 먼저 잡으면 중간 변경은 이후 delta에서 다시 전달된다.
이미 full snapshot에 포함된 row가 한 번 더 와도 request id 기반 merge라 안전하다.

이 원칙을 검토하면서 4단계 Team Chat의 baseline 순서도 동일하게 수정했다.

## 공통 클라이언트 모듈

PC Source of Truth:
`olli-materials-sync-common.js`

담당:

- academy/account scoped event checkpoint
- baseline head 캡처
- forward event paging
- request id merge
- deleted tombstone 제거
- 서버 목록과 같은 status/needed_on/created_at 정렬
- authoritative summary 적용
- stale academy/session 차단
- delta RPC 미지원 시 fallback 판별

Phone에 로직을 복사하지 않는다.

현재 Phone Preview에서는 Vercel rewrite로 PC 작업 브랜치의 공통 파일을 읽는다.

## PC

초기/수동 refresh:

1. event baseline head 캡처
2. 기존 full list 300 조회
3. 화면 state 적용
4. baseline checkpoint 저장

Realtime:

- `watchDomain('materials')`
- event delta 우선
- delta 불가/오류/cursor 없음 → 기존 full refresh

기존 CAS create/status write는 그대로이고,
write 성공 뒤 기존 full refresh 경로도 보존한다.

## Phone

기존 Local-first material cache를 유지한다.

초기:

1. local cache 즉시 render
2. baseline head 캡처
3. full list
4. local cache 저장
5. local cache 저장 성공 후 baseline checkpoint 저장

Realtime delta:

1. cached/current payload
2. event delta
3. request merge
4. local cache 저장
5. local cache 저장 성공 후에만 durable event checkpoint 저장

따라서 network 응답만 받고 local data 저장이 실패했는데 cursor가 앞서가는 구조가 없다.

## Manifest

materials marker 자체는 기존부터 event id였다.

5단계 migration에서 coverage 설명을:

`material_row_event_cursor`

로 갱신해 trigger의 create/status/update/soft-delete/restore 범위와 일치시켰다.

## Production 적용 상태

아직 Supabase Production에는 적용하지 않았다.

Production 현재 확인:

- `olli_team_material_requests_delta`: 없음
- material change trigger: 없음
- realtime valid domain: observation / schedule / chat 그대로
- event type constraint: created / status_changed 그대로
- request rows: 3
- event rows: 7
- event head: 7

4단계 + 5단계 migration을 실제 순서대로 하나의 transaction에서 생성/compile한 뒤 rollback했다.

compile 결과:

- Team Chat change log/RPC 정상
- Materials delta RPC 정상
- Materials trigger 정상
- Sync Manifest 정상
- materials Realtime domain 정상

Production 데이터/schema 변경은 0이다.

## 검증

- JS/test syntax 정상
- common materials runtime 핵심 시나리오 8/8 통과
- PC/Phone 연결 규칙 16/16 통과
- 기존 full-list fallback 보존
- create idempotency 보존
- revision CAS 보존
- Phone local cache first 보존
- Phone cursor-after-cache 보장
- Team Chat baseline race 수정
- PC Vercel Preview success
- Phone Vercel Preview success

## 최종 병합 전 필수

Phone work branch의 다음 rewrite는 테스트를 위해 PC feature branch를 가리킨다.

- `/olli-realtime-common.js`
- `/olli-team-chat-delta-common.js`
- `/olli-materials-sync-common.js`

PC 공통 파일들이 main에 먼저 들어간 뒤 Phone main 병합 직전에 모두
`vivizac/pc/main/...`
으로 변경한다.

feature branch raw URL을 Production에 남기지 않는다.

## 다음 단계

6단계는 Feedback이다.

Feedback은 material request처럼 기존 durable event cursor가 없고 edit/delete도 있으므로,
updated_at polling이나 전체 재다운로드로 대체하지 않고 durable feedback change sequence/log를 설계한다.
