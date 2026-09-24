# OLLI Feedback Delta Sync 상태 기록

기준일: 2026-09-25

PC 작업 브랜치: `feat/local-first-sync-step2-20260925`  
Phone 작업 브랜치: `feat/local-first-sync-step4-20260925`

## 6단계 목적

Feedback 데이터를 전체 재다운로드하지 않고도 insert/update/delete/restore를 놓치지 않는 durable change cursor를 만든다.

대상:

- `feedbacks`
- `fail_feedbacks`
- `summary_feedbacks`

기존 저장/수정/삭제/휴지통 RPC와 UI 동작은 유지한다.

## 기존 구조 확인

Production 기준:

- feedbacks: 385
- fail_feedbacks: 4
- summary_feedbacks: 31
- feedbacks soft deleted: 8

현재 저장 경로에는 idempotent insert RPC가 존재한다.

- `olli_feedback_insert_idempotent`
- `olli_growth_feedback_insert_idempotent`
- `olli_summary_feedback_insert_idempotent`

삭제는 플랫폼/기능에 따라 두 종류가 공존한다.

- PC/휴지통: is_deleted 기반 soft delete/restore
- Phone 일부 일반·성장 기록: REST hard DELETE

따라서 soft delete만 추적하는 방식은 사용할 수 없다.

## Durable change log

새 예정 테이블:

`private.olli_feedback_change_events`

필드:

- id bigint identity
- academy_id
- student_id / student_name
- previous_student_id / previous_student_name
- source_table
- record_id text
- change_type
- created_at

record_id를 text로 둔 이유:

- feedbacks.id: bigint
- summary_feedbacks.id: bigint
- fail_feedbacks.id: uuid

세 타입을 하나의 event cursor에서 안전하게 다루기 위해 row id를 문자열 식별자로 기록한다.

change types:

- inserted
- updated
- deleted
- restored

## DB trigger

세 테이블 모두:

`AFTER INSERT OR UPDATE OR DELETE`

trigger를 사용한다.

따라서 다음 경로가 자동으로 잡힌다.

- idempotent insert
- 기존 direct insert RPC
- 공통 수정 저장
- 휴지통 soft delete
- 휴지통 restore
- Phone hard DELETE
- 향후 동일 테이블의 새로운 update/delete 경로

기존 write RPC 안에 change log 코드를 중복 삽입하지 않는다.

academy_id가 없는 과거 레거시 row는 academy sync 대상이 아니므로 event log에서 제외한다.

## 학생 이동/레거시 이름 변경 안전성

UPDATE event에는 현재 학생 식별값뿐 아니라 이전 학생 식별값도 기록한다.

- previous_student_id
- previous_student_name

delta는 현재 학생 또는 이전 학생 어느 쪽과 일치해도 해당 event를 본다.

현재 row가 더 이상 그 학생에게 속하지 않으면 current record를 반환하지 않고 tombstone으로 반환한다.

따라서 학생 연결이 변경되더라도 이전 학생 cache에 잘못된 기록이 남지 않는다.

## Realtime

정식 domain:

`feedback`

공통 Realtime valid domain:

- observation
- schedule
- chat
- materials
- feedback

Feedback row change event 생성 뒤:

`feedback / revision = feedback_event_id`

신호를 보낸다.

Feedback은 기존 client가 realtime으로 보고 있던 영역이 아니므로 materials처럼 별도의 legacy chat alias는 만들지 않는다.

## 학생별 Delta RPC

새 예정 RPC:

`public.olli_feedback_delta(...)`

입력 핵심:

- session token
- academy id
- student id
- student name
- after_event_id
- limit

학생별 local cache checkpoint를 사용한다.

서버는 요청 시작 시 academy 전체 `window_head`를 먼저 고정한다.

그 후:

- cursor보다 크고
- window_head 이하이며
- 현재 학생 또는 이전 학생 identity와 관련된 event

만 읽는다.

다른 학생 event만 존재하는 구간에서는 해당 학생 checkpoint가 window_head까지 안전하게 전진한다.

동시 변경은 window_head 이후 event가 되므로 다음 delta에서 빠짐없이 받는다.

## Delta 반환

- records
  - source_table
  - record_id
  - 현재 live row
- deleted_records
  - source_table
  - record_id
- change_types
- latest_event_id
- next_event_id
- has_more

soft-deleted row와 hard-deleted row 모두 deleted_records로 처리된다.

## 공통 클라이언트 모듈

PC Source of Truth:

`olli-feedback-sync-common.js`

담당:

- academy/account/student 범위 checkpoint
- baseline head
- multi-page delta
- heterogeneous record id 처리
- feedbacks + fail_feedbacks 병합
- summary_feedbacks 별도 병합
- update replacement
- delete tombstone 제거
- 최신순 정렬
- stale academy/session/student 응답 차단

Phone에 동기화 알고리즘을 복사하지 않는다.

## Full snapshot race 방지

순서:

1. 학생별 baseline event head 선캡처
2. 기존 3개 테이블 full snapshot
3. 로컬 cache 저장
4. cache 저장 성공
5. 선캡처 checkpoint 저장

snapshot 이후 최신 head를 다시 읽어 checkpoint로 쓰지 않는다.

따라서 snapshot 중 발생한 변경은 다음 delta에서 다시 전달되고 누락되지 않는다.

## Phone

기존 Local-first cache:

`olli_attendance_feedback_cache_v1:<academy>:<student>`

유지.

기록지 열기:

1. local cache 즉시 render
2. cache + checkpoint 존재 시 delta 우선
3. delta 미지원/오류/checkpoint 없음이면 기존 3테이블 full snapshot
4. local cache 저장 성공 후 checkpoint 저장

Realtime:

- 화면에 현재 학생 기록지가 열려 있을 때만 feedback delta 적용
- 닫혀 있으면 기존 cache를 억지로 갱신하지 않음
- 다음 open 시 delta/full reconciliation

기존 Phone hard DELETE 경로는 변경하지 않았다.
DB trigger가 이를 관찰한다.

## PC

PC 성향기록부의 기존 `recordCache`를 그대로 사용한다.

학생 선택:

- 기존 cache 즉시 render
- cache가 있으면 학생별 delta 우선
- checkpoint/RPC가 없으면 기존 3테이블 full 조회
- cache 저장 성공 후 checkpoint 저장

Realtime:

`watchDomain('feedback')`

현재 선택 학생의 cache를 delta로 갱신하고 combined record panel을 다시 render한다.

기존 복사/수정/삭제/종합피드백 재생성 UI는 변경하지 않는다.

## Manifest

Feedback marker 추가:

- kind: event_id
- coverage: feedback_row_event_cursor

기존 pending의:

`feedback: no_durable_change_cursor`

항목은 제거한다.

## Production 적용 상태

아직 Production DB에는 적용하지 않았다.

현재 Production 확인:

- private.olli_feedback_change_events: 없음
- public.olli_feedback_delta: 없음
- private.olli_feedback_log_change: 없음
- feedback change trigger: 0개
- 기존 feedback data count 그대로

4→5→6 migration을 실제 순서대로 transaction 안에서 생성/compile 후 rollback했다.

검증:

- feedback event table 정상
- delta RPC 정상
- trigger function 정상
- 세 feedback table trigger 3개 정상
- manifest feedback marker 정상
- realtime feedback domain 정상

Production schema/data 변경은 0이다.

## 테스트

공통 모듈 실제 실행 핵심 시나리오: 9/9 통과

연결 구조 검사: 15/15 통과

확인 항목:

- student checkpoint isolation
- baseline head
- paged delta
- latest update wins
- hard/soft delete tombstone
- PC record cache 사용
- Phone Local-first cache 사용
- full 3-table fallback 유지
- baseline-before-snapshot
- cache-before-checkpoint
- feedback-only realtime watcher
- 기존 Phone hard DELETE 유지
- stale context 차단

PC Vercel Preview: success  
Phone Vercel Preview: success

## 최종 병합 전 필수

Phone work branch rewrite 중 다음 파일은 현재 PC feature branch를 가리킨다.

- `/olli-realtime-common.js`
- `/olli-team-chat-delta-common.js`
- `/olli-materials-sync-common.js`
- `/olli-feedback-sync-common.js`

최종 병합 시 PC 공통 파일들을 main에 먼저 반영하고,
Phone rewrite destination을 모두 `vivizac/pc/main/...`으로 변경한 뒤 배포한다.

## 다음 단계

7단계는 Students / Consultation이다.

Feedback처럼 무한히 증가하는 row log가 반드시 필요한 영역인지 먼저 재확인한다.
학생/상담은 데이터 크기와 mutation 패턴상 academy revision + snapshot mismatch 방식이 더 적합할 가능성이 높다.
기존 schedule revision과 학생 변경 연결이 이미 존재하므로 중복 revision을 만들지 않도록 먼저 영향도를 확인한다.
