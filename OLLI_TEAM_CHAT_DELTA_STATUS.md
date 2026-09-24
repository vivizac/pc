# OLLI Team Chat Delta Sync 상태 기록

기준일: 2026-09-25
작업 브랜치: `feat/local-first-sync-step2-20260925`

## 4단계 목적

Team Chat의 Realtime 신호마다 최근 100개 메시지와 자료실 최대 1000건을 다시 읽는 구조를 줄인다.

원칙:
- 새 메시지 insert는 증가하는 message id를 사용한다.
- 기존 message id 안에서 바뀌는 mutable state는 별도 durable change id를 사용한다.
- 기존 `olli_team_chat_list`는 삭제하지 않고 full snapshot fallback으로 유지한다.
- delta가 없거나 실패하면 기존 full 조회로 즉시 복구한다.

## 전수조사 결과

Team Chat은 message id만으로 최신성을 표현할 수 없다.

### message id로 잡히는 것
- 일반 메시지 insert
- AI/올리 응답 insert
- attachment message insert
- action card message insert
- action 완료/취소 시 생성되는 result system message insert

### 같은 message id 안에서 바뀌는 것
- action status / revision / resolved state
- attachment thumbnail metadata
- attachment 삭제 시 message soft-delete
- mention 대상 추가
- mention read_at
- member_state.last_read_message_id
- 향후 message edit/delete

특히 action execute/cancel은 새 result message를 추가하면서 원래 action message의 상태도 변경한다.
따라서 `after_message_id`만 사용하면 새 결과 메시지는 받지만 원래 action card의 상태 변경을 놓칠 수 있다.

읽음 처리도 기존 메시지들의 `unread_count`를 변경하므로 별도 mutable cursor가 필요하다.

## 서버 구조

### private.olli_team_chat_change_events

새 mutable change log.

- global identity `id bigint`
- academy_id
- change_type
- message_id
- from_message_id
- to_message_id
- created_at

private schema에 두고 public/anon/authenticated 직접 접근 권한을 제거한다.

change types:
- message_mutated
- action_mutated
- attachment_mutated
- mention_mutated
- read_state

### change log trigger

다음 변화만 기록한다.

- messages: UPDATE / DELETE
- actions: UPDATE / DELETE
- attachments: UPDATE / DELETE
- mentions: INSERT / UPDATE / DELETE
- member_state: INSERT / UPDATE / DELETE

일반 message INSERT는 change log에 중복 기록하지 않는다.
새 메시지는 기존 bigint message id cursor가 담당한다.

message/action/attachment mutation은 trigger가 chat Realtime wake signal도 보낸다.
mention/read RPC는 이미 작업 단위로 chat signal을 보내므로 row trigger에서 추가 broadcast를 만들지 않는다.

### thumbnail metadata

Phone `api/team-talk-file.js`는 attachment message 저장 후 service-role PATCH로 thumbnail metadata를 갱신한다.
기존에는 이 PATCH 자체가 별도 Realtime 신호를 보내지 않았다.
4단계 attachment UPDATE trigger가 이를 change event로 기록하고 chat wake signal을 보내므로 다른 기기도 최신 thumbnail metadata를 확인할 수 있다.

## public.olli_team_chat_delta

새 RPC.

입력:
- session token
- academy id
- after_message_id
- after_change_id
- limit

출력:
- new_messages
- changed_messages
- deleted_message_ids
- change_types
- next_message_id
- next_change_id
- latest_message_id
- latest_change_id
- has_more_messages
- has_more_changes

### baseline

두 cursor를 null로 호출하면 과거 change log를 재생하지 않고 현재 head만 반환한다.

full snapshot을 정상 적용한 뒤 baseline head를 저장하므로 migration 이전 데이터에 대해 가짜 event backfill을 만들지 않는다.

### read state

member_state 변화는 from/to message range를 기록한다.
delta RPC는 이 범위의 최신 message payload를 다시 계산한다.

Phone 로컬 message cache 최대 500개에 맞춰 read-state recalculation도 최신 500 message까지 반환한다.
그보다 오래된 기록은 과거 history page를 서버에서 다시 읽을 때 최신 값으로 확인한다.

## 공통 클라이언트 모듈

PC Source of Truth:
`olli-team-chat-delta-common.js`

담당:
- academy/account 범위 checkpoint
- baseline head
- forward paging
- message/change 두 cursor 독립 진행
- deleted id 제거
- changed message 교체
- archive cache merge
- stale academy/session context 차단

Phone에 같은 로직을 복사하지 않는다.

현재 작업 브랜치 Preview에서는 Phone `vercel.json`이 PC 작업 브랜치의 raw common file을 rewrite로 읽는다.

중요:
main 병합 직전에는 이 rewrite destination을 반드시
`vivizac/pc/main/olli-team-chat-delta-common.js`
로 변경하고 공통 파일 관리 목록에 최종 반영한다.
작업 브랜치 URL을 Production에 남기지 않는다.

## Phone

기존 local-first message cache 최대 500개를 유지한다.

full snapshot:
1. 기존 `olli_team_chat_list` 호출
2. server deleted_message_ids를 local cache merge에서 제거
3. local cache 저장
4. 저장 성공 후 delta baseline checkpoint 저장

delta:
1. local payload + checkpoint 읽기
2. `olli_team_chat_delta`
3. new/changed/deleted 적용
4. local message cache 저장
5. cache 저장 성공 후에만 durable cursor 저장

따라서 cursor가 local data보다 앞서지 않는다.

local cache 저장이 실패하면 화면에는 적용할 수 있지만 cursor는 저장하지 않는다.
다음 신호에서 같은 delta를 다시 받아도 id 기반 merge가 중복을 제거한다.

기존 full load 함수는 그대로 남아 있으며 delta RPC 미존재/오류/없는 checkpoint일 때 fallback으로 사용한다.

기존 full snapshot merge에서 `deleted_message_ids`를 무시해 로컬 cache에 삭제된 attachment message가 남을 수 있던 문제도 이번 단계에서 함께 수정했다.

기존 Work Hub archive cache가 존재하면 chat delta를 그 cache에도 merge한다.
매 chat signal마다 archive 1000건을 다시 읽지 않는다.

## PC

기존 full snapshot은 그대로 유지한다.

초기/open/manual refresh:
- 기존 `olli_team_chat_list` 100개 full load
- delta baseline 설정

Realtime:
- `syncTeamTalkDelta()` 우선
- 오류/미지원 시 기존 `loadMessages()` fallback

기존 Realtime은 chat signal마다:
- mention summary
- messages 100개
- archive 최대 1000개
를 다시 읽었다.

4단계에서는 Realtime 경로의 archive full reload를 제거하고,
기존 archive payload가 있으면 delta를 메모리에서 merge한다.

PC message window는 기존 최근 100개 의미를 유지한다.

## 기존 기능 보존

수정하지 않은 것:
- `olli_team_chat_list` full snapshot RPC 계약
- message send idempotency
- before_message_id 과거 pagination
- mention summary RPC
- mark_read RPC
- action execute/cancel RPC
- attachment upload/download RPC
- archive full RPC
- OlliRealtime common watcher
- schedule/observation 저장 구조
- material order 구조

## DB 적용 상태

`20260925170000_add_team_chat_delta_sync.sql`은 Git 작업 브랜치에만 있다.

Supabase Production에는 아직 적용하지 않았다.

실제 Production DB에서:
1. transaction BEGIN
2. migration SQL 생성/컴파일
3. invalid-session delta RPC 호출 확인
4. ROLLBACK

검증을 수행했다.

rollback 뒤:
- private.olli_team_chat_change_events 없음
- public.olli_team_chat_delta 없음

을 다시 확인했다.

즉 Production schema 변경은 0건이다.

## 테스트

추가:
- tests/team-chat-delta-migration.test.cjs
- tests/team-chat-delta-common.test.cjs
- tests/pc-team-chat-delta-step4.test.cjs
- mobile/tests/phone-teamchat-delta-step4.test.cjs

확인:
- common JS syntax 정상
- PC Team Talk syntax 정상
- Phone Team Talk syntax 정상
- test syntax 정상
- common runtime 핵심 시나리오 5/5 통과
- migration 실제 PostgreSQL transaction compile 통과
- PC Vercel Preview success
- Phone Vercel Preview success

## 다음 단계 전제

5단계는 재료주문이다.

Team Chat 4단계에서 재료주문 domain은 아직 분리하지 않았다.
현재 material request가 chat Realtime을 공유하는 문제는 5단계에서 별도로 처리한다.

4단계 chat change log와 material request event log를 합치지 않는다.
두 데이터의 변경 의미와 cursor는 독립적으로 유지한다.
