# OLLI Large Cache IndexedDB 전환 상태 기록

기준일: 2026-09-25

PC 작업 브랜치: `feat/local-first-sync-step2-20260925`  
Phone 작업 브랜치: `feat/local-first-sync-step4-20260925`

## 8단계 목적

작은 설정·checkpoint·세션 상태는 localStorage에 유지하고,
계속 커질 수 있는 로컬 캐시만 IndexedDB로 이동한다.

원칙:

- localStorage: 즉시 첫 화면용 소량 bootstrap + 작은 상태
- IndexedDB: 전체 대화/자료실/학생 피드백/재료 요청 snapshot
- 서버: authoritative source
- delta checkpoint: 전체 로컬 snapshot 저장 성공 뒤에만 전진
- IndexedDB 미지원/실패: 기존 localStorage 전체 저장 fallback

관찰노트 CAS/recovery, SyncQueue, conflict queue, session recovery는 이번 단계에서 건드리지 않는다.

## 공통 저장 계층

새 공통 원본:

`olli-large-cache-common.js`

DB:

- name: `olli_large_cache_v1`
- store: `snapshots`
- key: `domain:account:academy:scope`

지원:

- get
- put
- remove
- domain/account/academy 범위 prune

기존 Phone 첨부 썸네일 DB:

`olli_phone_attachment_cache_v1`

와 완전히 분리했다.

## 8A — Team Chat

### 메시지

이전:

- localStorage 최대 500 messages

현재:

- localStorage bootstrap: 최신 40 messages
- IndexedDB full: 최대 500 messages
- domain: `team_chat_messages`

첫 화면은 localStorage 40건으로 즉시 그린다.
화면 공개 후 IndexedDB 전체 snapshot을 hydrate한 뒤 delta/server merge를 수행한다.

### 자료실

이전:

- localStorage 최대 1000 messages

현재:

- localStorage bootstrap: 최신 30 archive rows
- IndexedDB full: 최대 1000 rows
- domain: `team_chat_archive`

Archive RPC가 `id desc` 최신순이므로 bootstrap도 배열 앞 30건을 보존한다.

### write ordering

메시지와 자료실 각각 독립된 Promise write chain을 둔다.

- 이전 IndexedDB write가 끝난 뒤 다음 write 수행
- read도 pending write chain 완료 후 수행
- 느린 이전 write가 최신 snapshot을 덮어쓰는 race 방지

Team Chat delta cursor는:

1. full message cache 저장
2. archive cache가 열려 있으면 archive full cache 저장
3. 둘 다 성공
4. delta checkpoint 저장

순서를 사용한다.

## 8B — 학생 피드백

기존 Phone 학생별 cache:

`olli_attendance_feedback_cache_v1:<academy>:<student>`

이전:

- feedbacks 최대 160
- summaries 최대 50
- 전부 localStorage

현재 bootstrap:

- feedbacks 12
- summaries 6

IndexedDB full:

- feedbacks 최대 160
- summaries 최대 50
- domain: `attendance_feedback`
- scope: student id/name

같은 학생 안에서는 write queue를 직렬화한다.
서로 다른 학생은 별도 queue라 한 학생의 느린 저장이 다른 학생을 막지 않는다.

academy/account 범위에서 최근 250 student cache까지만 유지한다.

기록지 open:

1. localStorage bootstrap 즉시 render
2. IndexedDB full hydrate
3. full local snapshot render
4. feedback delta
5. full snapshot 저장
6. checkpoint 저장

## 8C — 재료 요청

이전:

- localStorage 최대 300 items

현재:

- localStorage bootstrap: 상단 25 items + 전체 summary
- IndexedDB full: 최대 300 items
- domain: `material_requests`

summary는 bootstrap에서도 전체 requested/on_hold/ordered/arrived count를 유지하므로
25건만 로컬에 있어도 상단 상태 개수는 정확하다.

material delta/full snapshot 모두 IndexedDB 저장 완료 후 event checkpoint를 저장한다.

Work Hub local-only 진입에서는:

1. localStorage 25건 즉시 render
2. IndexedDB 300건 background hydrate
3. server request 없음

으로 동작한다.

## fallback / migration

기존 사용자의 localStorage full cache를 즉시 삭제하지 않는다.

IndexedDB 첫 read에서 해당 scope의 full record가 없으면:

1. 기존 localStorage cache 읽기
2. IndexedDB로 full snapshot 저장
3. 저장 성공 후 localStorage를 bootstrap 크기로 축소

IndexedDB가 없거나 오류가 나면 기존 full localStorage 저장을 유지한다.

따라서 migration 중 캐시 유실 때문에 server-only 화면으로 바뀌지 않는다.

## 보호 대상

이번 단계에서 수정하지 않음:

- observation CAS
- observation pending/blocked/conflict
- OlliStorageCore SyncQueue
- recovery issue queue
- schedule revision
- Supabase schema / migration
- save RPC
- server authoritative data

OlliStorageCore의 pending/conflict/recovery 데이터는 cache가 아니라 복구 장치이므로
IndexedDB 정리 대상에서 제외했다.

## 검증

### 공통 IndexedDB 모듈

실제 fake IndexedDB 실행:

- available
- put
- get
- domain prune
- remove

7/7 통과.

IndexedDB 미지원 fallback:

- available false
- get null
- put false
- prune 0

등 8/8 통과.

### Phone 구조 검사

23/23 통과.

확인:

- Team Chat bootstrap 40
- Archive bootstrap 30
- Archive 최신순 보존
- Team Chat/Archive write serialization
- message + archive durable save before delta checkpoint
- Feedback bootstrap 12 + 6
- Feedback per-student queue
- Feedback 250 scope prune
- Feedback durable save before cursor
- Materials bootstrap 25 + full summary
- Materials durable save before cursor
- local-only IndexedDB hydrate
- legacy fallback 유지

### 변경 범위

PC:

- `olli-large-cache-common.js`
- `tests/large-cache-common-step8.test.cjs`

Phone:

- `index.html`
- `vercel.json`
- `olli-talk-beta.js`
- `olli-data-attendance-feedback.js`
- `olli-talk-material-orders-mobile.js`
- `tests/phone-large-cache-step8.test.cjs`

8단계 Supabase migration 없음.

## 최종 병합 전 주의

Phone Preview의 `/olli-large-cache-common.js` rewrite는 현재 PC feature branch를 가리킨다.

PC 공통 파일을 main에 먼저 병합한 뒤 Phone main 병합 직전에:

`vivizac/pc/feat/local-first-sync-step2-20260925/olli-large-cache-common.js`

를:

`vivizac/pc/main/olli-large-cache-common.js`

로 변경해야 한다.

기존 Step 4~7 공통 rewrite도 동일하게 main으로 전환한다.

## 다음 단계

9단계는 boot/focus/online/reconnect reconciliation 중앙화다.

8단계까지 각 domain의 durable marker/cursor와 local repository가 준비됐으므로,
9단계에서는 페이지별 중복 focus/online/visibility refresh를 바로 삭제하지 않고
중앙 reconciliation coordinator로 먼저 연결한 뒤 fallback을 단계적으로 제거한다.
