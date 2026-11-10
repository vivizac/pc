# 올리 공동 팀챗 개발 기록 — 2026-11-06

상태: 핵심 회귀 검증 완료 / 운영 DB 구조 적용 / 공동 팀챗 비활성 상태.

원본 인수인계: https://docs.google.com/document/d/1eBiyMXqDtJmgbaw2qwimgjshFmCeSVbGRChtUTLp-IM/edit

## 기준점과 조사 보완

| 항목 | 시작 시 읽기 전용 확인 |
|---|---|
| `vivizac/pc` main | `db9b117e0a1ebda19fcb28d616d1f1db0f4baef4` |
| PC Production | `e7bcc408de6a7b0343508d3370f321a43fcc4e9a`, READY, `dpl_jsuCJAwmghf7oQAeSStrzgEAmiFj` |
| Mobile Production | `6be93ae5277b73f45a3b9da3ec6559d322d9c760`, READY, `dpl_A9hqNVihkchxC2EHqhCoWm1TabR6` |
| Supabase | `fvkxipjwgeyosgnfhdnx`, ACTIVE_HEALTHY, Postgres 17.6, 운영 main만 존재 |
| Push | 기존 `olli-team-chat-push` ACTIVE version 6 소스 확인 |
| Storage RLS | 기존 객체 정책 4개 모두 `academy_profiles` 버킷 한정 |

기존 `olli_team_chat_list/send/members/mark_read/set_mentions/push_targets`, 급여 미리보기·개인 급여 알림을
처리하는 `private.olli_team_chat_message_visible_to_member`, 학원별 Realtime 트리거의 최신 정의를 읽었다.
이 기존 RPC와 공개 범위 함수는 대체하지 않았다. main과 두 Production 커밋은 인수인계의 값과 같았다.

2026-11-06 사용자 결정: 새 Supabase 개발 브랜치 생성 보류, 로컬 검증만 진행.
조회된 기본 비용은 시간당 US$0.01344였으며 실제 생성·결제·운영 변경은 하지 않았다.
별도 테스트 계정, 운영 백업 복구 실습 및 Supabase 전체 로컬 스택 검증은 아직 없다.

## 단계별 구현 범위

| 단계 | 코드 및 현재 한계 |
|---|---|
| 1 조사 | 기준점·RPC·Storage 정책·영향 경로 재확인. 실제 데이터 백업/복구 검증은 미완료 |
| 2 DB 기반 | 신규 migration에 전용 방·참여 이력·메시지·멘션·읽음·첨부·푸시 claim·권한 RPC 구현. PGlite에서 실제 SQL 실행. Supabase 적용 안 함 |
| 3 통합 관리 | PC 공통 설정과 Phone 설정에 원장 전용 진입. 전체 참여 학원 소유권 검증, CAS revision, 표시 이름·참여 저장, 현재 학원 해제. 서버 성공 후 상태 반영 |
| 4 공동 대화 | 양 앱에서 같은 공통 대화 UI 사용. 목록·이전 페이지·전송·답장·수정·삭제·첨부·시스템 공지·지점 배지. 원래 학원 대화는 보존 |
| 5 멘션·읽음·알림 | 계정별 중복 제거, @전체·지점 구분, 읽음 단조 증가, 별도 미읽음 진입 배지, 기존 구독 재사용, 새 푸시 함수 및 PC worker. 실제 푸시 제공자·iOS 백그라운드 미검증 |
| 6 AI·개인정보 | 공동 대화에는 text/system/file만 허용. `올리에게 비공개로 질문`은 현재 학원 원래 입력창에 초안만 전달하며 전송은 사용자가 결정. 공동 history/room ID를 AI 또는 업무 RPC로 전달하지 않음. 실제 업무 RPC 전체 보안 회귀는 미완료 |
| 7 전체 회귀·출시 | 신규 로컬 SQL/서버/브라우저 검사와 기존 전체 테스트 기준선 비교 수행. 기존 회귀 실패·비운영 실제 연동·실기기 검증 잔여. 병합·배포 안 함 |

## 권한과 기록 정책

1. 업무 학원 ID와 공동 방 ID는 서로 다른 값이다. 모든 신규 RPC는 Olli의
   `olli_account_id_from_session` 및 현재 활성 `academy_members`와 `academies`를 확인한다.
   클라이언트의 member ID·role·표시 이름은 권한의 근거가 아니다.
2. 기존 학원 기록, 첨부, 읽음, 구독, 급여·관리자·업무 메시지는 이동·복사·삭제하지 않는다.
   공동 대화는 신규 private 테이블만 사용한다. 학생/시간표/출석 테이블·저장 코어·CAS를 변경하지 않는다.
3. 통합 설정은 현재 선택 학원 및 참여 학원 모두의 owner 권한을 검사한다. manager/teacher는 관리할 수 없다.
   활성 학원당 하나의 방, 활성 방 내 표시 이름 중복 금지, 최소 2개 학원이다.
4. 가입 기준은 시간 문자열 대신 방의 메시지 sequence다. 가입 이후 sequence만 조회·답장·첨부 접근이 가능하다.
   가입/해제와 전송은 같은 방 row lock을 사용한다. retained 학원의 이름 변경은 가입 epoch를 바꾸지 않는다.
5. 해제 즉시 해당 학원의 공동 기록 접근을 철회한다. 재가입은 새 참여 ID/가입 기준을 사용하며 이전 기록을 다시 열지 않는다.
   참여 학원이 1개 이하가 되면 방을 보관 처리하고 모두의 공동 접근을 닫는다. 데이터는 삭제하지 않는다.
6. 다중 소속 계정의 멘션·읽음·미읽음 수는 account 단위로 중복을 제거한다. 다른 계정의 동명이인은 이름과 지점으로 구별한다.
   푸시는 endpoint 단위로 중복 제거하여 여러 기기는 각각 받을 수 있다.
7. 메시지 작성 시의 지점 이름과 멘션 이름은 스냅샷이다. 이름 수정 후 새 메시지와 멘션 선택 목록은 새 이름을 사용한다.
8. 공동 기록은 디스크/IDB/localStorage에 캐시하지 않는다. 메모리 상태는 계정/학원/contextVersion/방/참여 ID로 구분하고
   전환·로그아웃 시 제거한다. 백그라운드 전환 시 메시지를 비우고 복귀 시 서버 권한을 재확인한다.
   오프라인에서는 새 공동 기록 열람을 중단하며, 기존 학원 대화의 캐시 정책은 변경하지 않는다.

## 첨부·푸시와 공개 범위

새 private 버킷 `olli_shared_chat_files`만 사용한다. 기존 버킷과 객체 정책은 유지하고 새 버킷에 한정된
restrictive 차단 정책을 추가한다. client는 테이블/객체에 직접 접근하거나 다운로드 signed URL을 얻을 수 없다.
서버 broker는 세션·현재 참여 epoch를 확인하고 업로드 주소만 발급한다. 객체 HEAD 크기 검증 뒤 메시지를 확정한다.
다운로드는 메시지 공개 범위를 검사하고 객체 fetch 뒤 한 번 더 검사한 후 no-store/attachment로 스트리밍한다.
파일 최대 20MiB. 업로드·확정 실패 시 미확정 객체가 남을 수 있다. 자동 삭제 작업은 추가하지 않았다.

일반 공동 메시지에 사용자가 직접 입력한 학생 정보는 참여자에게 공개될 수 있으므로 입력창에 안내한다.
AI 답변, 업무 결과, 급여, 개인·관리자 알림을 공동 메시지로 저장하는 API는 제공하지 않는다.
AI 질문 초안 이동 시 원래 선택 학원을 유지하고, 기존 서버 멤버십 검증·확인/실행 경로를 사용한다.

Realtime은 내용 없는 기존 `chat` invalidation만 활성 참여 학원에 fan-out한다. 해제 학원에도 철회 신호를 보낸다.
클라이언트는 상태/멤버십/메시지를 다시 읽는다. 같은 읽음 위치를 재저장할 때 신호를 만들지 않아 루프를 막는다.
원래 observation/schedule watcher와 저장 큐는 수정하지 않았다.

공동 푸시는 메시지 본문을 포함하지 않는다. 기존 Work·상담·급여 배지 상태를 변경하지 않는 별도 worker 분기를 사용한다.
PC는 기존 worker를 교체하지 않도록 `/shared-chat-push/` scope를 사용한다.
알림 클릭으로 학원을 자동 전환하거나 권한을 부여하지 않는다. 현재 선택 학원의 참여를 재검증한다.

## 영향 지도

| 경로 | 읽기/쓰기·영향 |
|---|---|
| `packages/common/olli-shared-team-chat.*` | 신규 RPC/공동 UI, 메모리 상태, 현재 학원 원래 AI 입력창으로 명시적 초안 이동 |
| PC/Phone 설정 모듈, `index.html` | 원장 진입·공동 대화 버튼·공통 JS/CSS 로딩 및 캐시 버전 |
| PC/Phone 팀챗 모듈 | 기존 open 경로에서 공동 진입 상태 재조회만 추가 |
| `apps/mobile/api/_lib/shared-team-chat-files.cjs` | 새 버킷 broker, 서비스 전용 RPC, 객체 크기/현재 권한 검증 |
| `apps/pc/api/shared-team-chat-file.js` | 기존 Mobile 서버 패턴을 따른 고정 대상 프록시 |
| `supabase/functions/olli-shared-chat-push` | 소스만 추가. 기존 push 함수/구독 테이블은 재사용하되 운영 함수 교체 없음 |
| 새 migration | private 테이블/새 public RPC/새 버킷만 추가. 기존 메시지 공개 범위 함수 및 업무 RPC 변경 없음 |

## 재현과 출시 차단 조건

최신 로컬 신규 기능 + 빌드·급여·기존 알림 보호 검사: **84/84 통과**.
동일한 LF 정규화 및 의존성 조건에서 전체 기준선과 변경본을 비교한 결과는 다음과 같다.
추가 실패는 0개지만 기존 431개 실패가 남으므로 전체 회귀 통과는 아니다.

| 전체 검사 | main 기준선 통과/전체 | 변경본 통과/전체 | 기존 실패 | 추가 실패 |
|---|---:|---:|---:|---:|
| 루트 | 823/879 | 847/903 | 56 | 0 |
| PC | 450/516 | 450/516 | 66 | 0 |
| Mobile | 870/1179 | 870/1179 | 309 | 0 |

전체 비교 뒤 신규 첨부 재시도 및 AI 초안 이동 검사를 추가한 최신 영향 검사가 위 84개다.
기존 실패에는 이전 모노레포 경로, 이미 변경된 자산 버전/DOM/명령 라우팅에 대한 정적 계약 등이 포함된다.
검사 실패를 삭제·skip하거나 기존 업무 코드를 광범위하게 변경해 숨기지 않았다.

```sh
npm ci --prefix tests/shared-chat --ignore-scripts
npx --prefix tests/shared-chat playwright install --with-deps chromium
node --test tests/shared-chat/*.test.cjs
node --test tests/pc-self-contained-build.test.cjs tests/mobile-self-contained-build.test.cjs tests/pc-build-closure.test.cjs tests/mobile-entry-integrity.test.cjs tests/teacher-payroll-contract.test.cjs
```

PGlite fixture는 루트 Realtime migration과 공동 팀챗 migration을 실제로 실행한다.
공동 팀챗은 기존 학원 채널에 본문과 메시지 ID가 없는 갱신 신호를 보낸다. 루트 migration의 공통 발송 함수가
`chat`을 무시하는 경우에도 동작하며, 이번 변경에서 해제된 학원에만 철회 신호를 보낸다.
인증 토큰 확인, `realtime.send` 전송 서비스와 Storage는 로컬 대역으로 검증한다.
브라우저 검증은 공통 신규 UI + 로컬 HTTP RPC 서버 + PGlite를 연결한다. 기존 앱 전체 로그인 및 실기기 검증으로 간주하지 않는다.
파일 broker와 Edge Function의 외부 제공자는 로컬 mock이다.
향후 비운영 검증 시 Mobile broker의 `OLLI_SHARED_CHAT_SUPABASE_URL`, PC proxy의
`OLLI_SHARED_CHAT_FILE_SERVER_URL`을 해당 테스트 환경에만 설정한다. 공동 UI의 RPC와 푸시는 같은
Supabase 설정을 사용하므로 브랜치 UI에서 운영 푸시 URL을 별도로 호출하지 않는다.

출시 전 다음을 모두 완료해야 한다.

- 기존 main 실패와 이번 변경 실패를 구분한 전체 회귀 결과 검토 및 필수 실패 해소, 최종 CI 성공.
- 운영과 분리된 Supabase 전체 환경에서 migration/기존 스키마 호환성, RPC·RLS·Storage 실제 요청 검증.
- 합성 owner/manager/teacher와 2~3 학원으로 학생 검색·시간표·출석·보강/체험·취소·이동의 타 학원 차단 검증.
- 개인 급여·급여 미리보기·관리자 메시지·업무 알림과 기존 첨부의 보호 확인.
- 실제 WebSocket·구독 해제·재접속, PC와 iOS PWA 푸시/읽음/동일 계정 다중 소속 검증.
- 관찰노트 양방향 쓰기, read-only 무변경, CAS 충돌, pending/blocked 및 세션 복구, 시간표 1/2회차·출석·과거/미래 주 검증.
- 실제 백업 복구 drill, 별도 환경에서 이전 앱 버전 + 신규 DB 호환성 확인.
- 마지막으로 사용자의 명시적 출시 승인. 현재 승인은 개발 및 로컬 검증에 한정된다.

## 2026-11-09 운영 반영과 복구 절차

사용자 승인에 따라 학원 간 접근 차단, 기존 기능 호환성, 기능 비활성화 검증을 먼저 수행한다.
iOS 실기기와 실제 푸시 수신은 운영 반영 후 확인할 항목이다. 로컬 전체 회귀 2,663건 중 2,248건이
통과했고, 실패 415건은 모두 기준선 `b870b30`에서도 재현됐다. GitHub 검사 33개가 통과했다.
선생님의 기존 등록을 삭제해도 작성한 공동 메시지가 보존되도록 수정했고, 삭제된 등록으로는 방에 접근할 수 없다.

후속 테스트 복구 및 전체 재비교 결과는 [회귀 실패 분류 기록](olli-regression-triage-20261106.md)을 따른다.
위 431개는 최초 비교 수치이며, 숨겨졌던 Mobile 검사 실행 후 463개가 기록됐다.
11월 9일 전체 재실행에서는 기존 미해결 실패 418개와 로컬 HTTP 연결 차단 2개가 남았다.

Supabase 운영 이력과 동일한 `supabase/migrations/20261109100845_team_chat_shared_rooms.sql`을 적용했다.
비공개 첨부 버킷, 브라우저 직접 접근을 막는 RLS, 서버 전용 파일 RPC 권한, `enabled=false`를 읽기 전용으로 확인했다.
새 푸시 함수 `olli-shared-chat-push`는 버전 1이며 Olli 세션 RPC로 인증한다.
운영 PC·모바일 반영과 기본 접근 차단을 확인한 뒤 별도의 release migration으로 활성화한다.

문제가 생기면 우선 release gate를 닫고 앱을 이전 커밋으로 되돌린다. 신규 테이블·메시지·객체를 DROP/DELETE하지 않는다.
기존 운영 테이블의 데이터 이동이 없으므로 원래 학원 대화는 계속 사용할 수 있다.
미확정 업로드 청소·보관 자료의 장기 retention은 운영 적용 전 별도 정책을 확정한다.
