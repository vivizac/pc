# OLLI Sync Manifest 상태 기록

기준일: 2026-09-25  
작업 브랜치: `feat/local-first-sync-step2-20260925`

## 3단계 목적

서버의 큰 데이터를 다시 받지 않고도 현재 학원의 주요 도메인에 변경이 있었는지 아주 작은 payload로 확인할 수 있는 read-only Sync Manifest를 준비한다.

이번 단계에서는 기존 저장/불러오기/Realtime/CAS 경로를 교체하지 않는다.

## 추가 파일

- `supabase/migrations/20260925163000_add_olli_sync_manifest.sql`
- `tests/olli-sync-manifest-migration.test.cjs`
- 이 상태 문서

## RPC 계약

예정 RPC:

`public.olli_sync_manifest(p_session_token text, p_academy_id uuid)`

응답 protocol: `1`

### 현재 durable marker

#### schedule

- kind: `revision`
- source: `public.olli_schedule_sync_revisions.version`
- academy row가 아직 없으면 `0`
- 기존 `olli_schedule_sync_revision()` RPC는 호출하지 않는다.
- 이유: 기존 RPC는 row가 없을 때 insert를 수행하므로 Manifest의 read-only 원칙과 맞지 않는다.
- 기존 schedule revision/realtime 동작은 수정하지 않는다.

#### chat_messages

- kind: `message_id`
- source: 해당 academy의 최신 `olli_team_chat_messages.id`
- coverage: `message_insert_only`

중요:
이 marker는 새 메시지 insert만 의미한다.
Team Chat action 상태변경, attachment 삭제, message edit/delete 등 mutable change 전체를 의미하지 않는다.
4단계 Team Chat 개선에서 이 제한을 반드시 다시 확인한다.

#### materials

- kind: `event_id`
- source: 해당 academy의 최신 `olli_team_material_request_events.id`
- coverage: `create_and_status_change`
- 현재 create/status RPC가 event row를 남기는 구조를 그대로 사용한다.
- material request row revision/CAS는 변경하지 않는다.
- academy별 최신 event id 조회를 위해 `(academy_id, id desc)` 보조 index를 migration에 추가한다.

## marker를 만들지 않은 영역

이번 단계에서 다음 영역은 가짜 checkpoint를 만들지 않는다.

- students: 독립적인 durable checkpoint 없음
- observation: row별 revision은 있으나 academy 전체 checkpoint가 아님
- feedback: edit/delete까지 포괄하는 durable change cursor 없음
- consultation: academy 전체 durable checkpoint 없음
- chat_mutations: message id가 mutable change를 포괄하지 않음

Manifest는 이 항목들을 `pending`으로 명시한다.

## 보안

Manifest는 기존 OLLI 인증 방식을 그대로 따른다.

- `SECURITY DEFINER`
- `STABLE`
- `set search_path to ''`
- `private.olli_realtime_can_access(p_session_token, p_academy_id)`로 기존 OLLI session + academy membership 검증
- PUBLIC execute 권한 제거
- anon/authenticated에만 RPC execute 허용
- underlying table을 새로 공개하지 않음

SECURITY DEFINER를 사용하는 이유:
OLLI frontend는 자체 account session token을 RPC에 전달하고, underlying internal tables에 직접 접근하지 않는 기존 구조를 사용한다. 기존 Team Chat/Realtime RPC와 같은 경계다.

## read-only 보장

`olli_sync_manifest` function body에는 아래 작업이 없다.

- INSERT
- UPDATE
- DELETE
- TRUNCATE
- Realtime signal send
- session last_seen 갱신
- schedule revision row 생성

또한 `generated_at` 같은 매 호출마다 달라지는 값을 payload에 넣지 않는다.
marker가 동일하면 manifest 내용도 동일하게 유지할 수 있다.

## 기존 운영 코드 영향

3단계 branch 기준:

- PC HTML에서 Manifest를 호출하지 않음
- Phone HTML에서 Manifest를 호출하지 않음
- Sync Manager와 아직 연결하지 않음
- OlliRealtime 수정 없음
- schedule adapter 수정 없음
- observation CAS/session recovery 수정 없음
- student/feedback/chat/material UI 수정 없음

따라서 migration이 앱에 연결되기 전에는 현재 저장/불러오기 동작이 바뀌지 않는다.

## Production 적용 상태

현재 migration은 Git 작업 브랜치에만 있다.
Supabase Production에는 아직 적용하지 않았다.

이유:
앱/DB 변경을 단계별 검증한 뒤 반영하고, 작업 중 Production schema만 앞서가는 상태를 만들지 않기 위해서다.

운영 DB의 기존 migration history와 PC/mobile Git migration filename timestamp가 일부 일치하지 않는 과거 이력이 확인되었다.
이 기존 drift는 3단계 범위를 넓혀 정리하지 않는다.
이번 작업부터는 migration SQL과 실제 적용 내용을 함께 검증한다.

## 검증

### live DB read-only marker query

현재 운영 DB를 수정하지 않고 동일한 marker 조회식을 실행했다.

- schedule revision: 정상
- chat latest message id: 정상
- materials latest event id: 정상
- 데이터가 없는 academy: 0 반환

### migration contract test

다음 항목을 검사한다.

- additive migration
- destructive DROP 없음
- STABLE + SECURITY DEFINER + empty search_path
- OLLI session/academy access helper 사용
- function body write statement 없음
- schedule 기존 write-capable RPC 미호출
- chat insert-only coverage 명시
- materials event coverage 명시
- unsupported domain 가짜 marker 없음
- PUBLIC execute revoke
- dynamic timestamp payload 없음
- material composite index 존재

## 4단계로 넘어갈 때

다음 단계는 Team Chat 최적화다.

주의:
`chat_messages.message_id`를 그대로 채팅 전체 cursor로 사용하면 안 된다.

먼저 아래 mutable path를 전수 확인한다.

- message edit/delete
- attachment create/delete
- action create/status/cancel/execute
- mention/read state가 화면 데이터 재조회에 미치는 영향
- archive 자료실 변경

그 뒤
- 새 메시지 insert는 `after_message_id` delta
- mutable change는 별도 durable change sequence가 필요한지 판단
하는 순서로 진행한다.

## 7단계 현재 상태 추가 — 2026-09-25

3단계의 `students/consultation = pending` 기록은 당시 상태를 보존한 역사 기록이다.
7단계 작업 브랜치에서는 현재 다음 marker가 추가되었다.

### students
- 별도 student revision 테이블을 만들지 않는다.
- 기존 `public.olli_schedule_sync_revisions.version`을 학생 snapshot의 durable marker로 재사용한다.
- Manifest coverage: `students_snapshot_via_schedule_revision`.
- `students` 테이블 변경은 기존 schedule revision을 계속 올리며, 같은 revision 값으로 `students` Realtime wake-up 신호를 추가한다.
- schedule-only 변경은 다음 reconnect/focus 시 학생 snapshot marker mismatch를 만들 수 있다. 이는 revision 중복 도입을 피하기 위한 보수적 재확인이다.

### consultation
- `private.olli_consultation_sync_revisions` academy별 revision을 추가한다.
- coverage: `consultation_surveys`, `consultation_observations`, `consultation_final_analyses`, `academy_settings.consultation_rules`, `consultation_progress`, `elementary_group_feedback_months`.
- Manifest coverage: `consultation_snapshot_revision`.
- 설문 명단과 상담 설정은 같은 remote revision을 보되 local checkpoint는 `consultation_surveys`, `consultation_settings`로 분리한다.

### checkpoint 안전 규칙
- server marker를 먼저 읽고 snapshot을 적용한다.
- snapshot 적용 성공 뒤에만 marker를 local checkpoint로 저장한다.
- snapshot 도중 서버 revision이 더 올라가면 선캡처 marker만 저장되어 다음 reconcile에서 다시 감지된다.
- Manifest RPC가 아직 배포되지 않은 rolling deploy 구간에는 기존 full snapshot 조회로 fallback하되 가짜 checkpoint는 만들지 않는다.
- 학원/세션 context가 바뀐 응답은 checkpoint를 전진시키지 않는다.

### polling 제거
- PC 학생 목록 기존 30초 전체조회 polling 제거.
- PC 상담 설문 기존 20초 전체조회 polling 제거.
- 상담 기준/진행상태 기존 30초 및 focus/online 강제 전체조회 제거.
- Realtime은 wake-up 용도이며 authoritative snapshot은 revision mismatch일 때만 읽는다.

### Production 상태
- 7단계 migration은 작업 브랜치에만 있다.
- Production DB에는 적용하지 않았다.
- SQL compile 및 trigger 기능 검증은 transaction 안에서 수행 후 rollback 완료했다.
