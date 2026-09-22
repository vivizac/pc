# OLLI 공통 코드 원본 운영 규칙

## 현재 원본과 로딩 경로

공통 런타임 원본은 `vivizac/pc`의 `main`이다. Phone `vivizac/-`는 공통 파일 복사본을 저장하지 않고 `vercel.json` rewrite로 PC main 원본을 읽는다. 공통 응답에는 no-store 캐시 정책이 적용된다.

Phone에서 사용하는 실제 공통 파일 목록은 [Phone OLLI_COMMON_FILES.txt](https://github.com/vivizac/-/blob/main/OLLI_COMMON_FILES.txt)를 기준으로 한다. PC의 동명 목록은 기존 PC 검증 workflow용 부분 목록이다. 두 목록을 같은 의미로 간주하지 않는다.

이 문서의 과거 자동 복사 workflow 설명은 폐기했다. Phone용 공통 파일 복사·동기화 커밋을 다시 만들지 않는다.

## 수정 전 보호 규칙

[Phone OLLI_COMMON_SOURCE.md](https://github.com/vivizac/-/blob/main/OLLI_COMMON_SOURCE.md)의 관찰노트·수업기록 보호 규칙을 함께 확인한다.

- 공통 저장 코어의 revision/CAS 충돌 보호를 유지한다.
- `olli-observation-autosave-phone-adapter.js`는 Phone 전용이다. 공통 목록 추가, 단순 병합, 삭제, PC 파일로 덮어쓰기를 금지한다.
- 폰 세션 복구, 저장 반환값 보정, iOS no-op input 방지, dirty 보정, pending/blocked 보호를 유지한다.
- 조회만으로 관찰노트 수정시간·revision을 변경하거나 과거 미저장 데이터를 자동 전송하지 않는다.
- 저장/데이터 계층을 수정하면 관찰노트 양방향 동기화와 읽기만 한 기록의 무변경을 회귀 확인한다.
- 출석 출력/내보내기·일반 알림·risk-signal 등 보호 영역은 유사하다는 이유로 공통화하지 않는다.
- 파일 분리는 명확한 구조 문제나 기능 변경 사유가 있을 때만 진행한다.

## 2026-09-18 올리 명령 라우터 기반

- 공통 명령 진입점은 `olli-command-router-common.js`이며, 시간표 조회 공통 계층은 `olli-command-schedule-common.js`다. 둘 다 PC `main`이 단일 원본이다.
- 1분 피드백 입력은 기존 피드백 처리 전에 이 라우터를 먼저 확인한다.
- 1단계 pass-through 검증을 마쳤고, 현재 빈자리 조회(`find_available_slots`)는 `오늘`, `내일`, `이번 주 ○요일`, `다음 주 ○요일`, 단독 `○요일`을 지원한다. 단독 요일은 오늘을 포함한 가장 가까운 해당 요일로 해석한다. 보강·체험·신규등록·수업이동은 조회 목적을 구분하며 정원 계산은 서버와 동일하게 정규수업 + 보강 + 체험을 합산한다.
- 쓰기 명령 1차로 `add_makeup`(보강 등록)과 `move_class`(정규수업 이동)를 지원한다. 실제 저장 전 학생·기존수업·목적지 정원을 검증하고 `확인`/`취소` 대화를 거친 뒤 기존 시간표 서비스/RPC를 호출한다. 수업이동은 자동 대기 전환을 막기 위해 `allowWait:false`로 실행하고, 확인 시 목적지 자리를 다시 조회한다.
- Phone은 로컬 복사본을 두지 않고 기존 공통 파일과 동일하게 PC 원본 rewrite를 사용한다.
- 명령 기능을 추가하더라도 시간표·출석·학생 데이터 저장 로직을 라우터 안에 새로 만들지 말고 기존 서비스/RPC를 호출한다. 빈자리 조회는 PC `OlliTimetableService` 또는 Phone `OlliPhoneStudentScheduleService`가 읽은 서버 최신 주간 데이터를 사용한다.
- 라우터 오류 시 기존 1분 피드백 흐름으로 계속 진행하도록 fallback을 유지한다.


## 2026-09-21 팀톡 액션카드 1단계 — 판별·준비만

- 팀톡의 향후 액션카드용 진입점은 `OlliCommandRouter.prepareAction(text, context)`이다.
- 이 함수는 등록·삭제·변경 요청을 해석하고 학생/날짜/시간/정원 등 기존 시간표 규칙으로 검증한 뒤 `action_pending` 또는 `action_needs_reason`을 반환한다.
- **1단계에서는 실제 저장 함수를 호출하지 않는다.** 버튼 UI, 액션 상태 DB, 실행/취소 처리는 후속 단계에서 연결한다.
- `classifyRequest(text)`는 요청을 `mutation` / `query` / `other`로 구분한다.
- 날짜가 명시된 일반 문장(예: “김민서 10월 5일 초등부 5시 수업 등록해줘”)은 `add_class_once`로 준비한다. 이 의도는 1회 수업 등록을 뜻하며 정규 주간 등록과 구분한다.
- 기존 1분 피드백의 `route()` 확인/실행 흐름은 이번 단계에서 변경하지 않는다. 팀톡 액션카드가 준비되기 전 기존 동작을 깨지 않기 위한 분리다.


## 2026-09-21 팀톡 액션카드 2단계 — 저장·상태만

- Supabase `public.olli_team_chat_actions`가 액션카드 서버 원본이다. 상태는 `pending / completed / cancelled / failed`이며 `revision`으로 상태 변경을 구분한다.
- 액션카드는 팀톡 메시지 1개와 1:1로 연결된다. `olli_team_chat_send_action`은 확인용 AI 메시지와 pending 액션을 한 트랜잭션에서 저장하고, 같은 `client_message_id` 재시도는 같은 작업으로 취급한다.
- 브라우저에는 `action_payload`를 다시 내려주지 않는다. `olli_team_chat_list`는 카드 ID, 종류, 상태, revision, 완료시각/오류 등 표시용 메타데이터만 반환한다.
- 테이블 직접 접근은 `anon/authenticated` 모두 막고, 세션 토큰과 academy membership을 검사하는 RPC만 사용한다.
- 취소는 `olli_team_chat_action_cancel`이 row lock 후 `pending → cancelled`만 허용한다. 이미 cancelled면 멱등 성공으로 처리한다.
- **2단계에는 실제 시간표 등록·삭제 실행 RPC가 없다.** 과거 중간 시도에서 존재했던 `olli_team_chat_action_execute`는 제거했다.
- 실제 실행은 후속 단계에서 버튼 클릭과 연결할 때 추가하며, 클라이언트가 payload를 다시 보내지 않고 `action_id`만 보내 서버에 저장된 payload를 사용하도록 한다.


## 2026-09-21 팀톡 액션카드 3단계 — PC 확인·실행

- PC 팀톡 AI 모드에서 변경 명령은 OpenAI 응답 전에 `OlliCommandRouter.prepareAction()`으로 분리한다. 일반 대화만 기존 OpenAI 경로로 간다.
- 준비가 끝난 작업은 `olli_team_chat_send_action`으로 AI 확인 메시지 + pending 액션을 저장하고, AI 말풍선 아래 작은 확인 카드로 렌더링한다.
- pending 카드의 보조 버튼은 작업 취소, 주 버튼은 작업 종류에 따라 `등록 / 변경 / 결석 처리 / 취소 실행`으로 표시한다.
- 주 버튼 클릭은 `action_id`만 `olli_team_chat_action_execute`에 전송한다. 클라이언트가 학생/날짜/시간 payload를 다시 보내 실행 내용을 바꿀 수 없게 한다.
- 실행 RPC는 action row를 `FOR UPDATE`로 잠근 뒤 pending 상태만 처리하고, 기존 시간표 RPC를 호출해 권한/정원/중복을 다시 검증한다. 완료 후 `completed`, 실패 후 `failed`로 상태를 바꾸고 팀톡 system 메시지를 생성한다.
- 결석·보강취소·체험취소처럼 사유가 필요한 작업은 PC 메모리에 준비 상태를 잠시 보관하고, 사용자가 사유를 입력한 뒤에만 액션카드를 만든다. 서버에서도 사유 누락을 실제 변경 전에 다시 차단한다.
- 이번 단계 UI는 PC만 적용한다. Phone은 4단계에서 같은 DB action 상태와 RPC를 사용해 표시/실행한다.


## 2026-09-21 팀톡 5단계 — AI 읽기 도구

- 읽기 요청은 `OlliCommandRouter.runQuery(text, context)`에서 처리한다. 이 함수는 시간표를 변경하지 않고 서버 원본을 조회해 메시지와 결과 payload만 반환한다.
- 기존 빈자리/시간표 조회를 `runQuery()`로 분리해 봇 모드와 AI 모드가 같은 읽기 규칙을 사용한다.
- 픽업 조회 `find_pickups`를 추가했다. 오늘/내일/날짜/요일, 4시·5시 수업, 픽업/하원 필터를 지원하며 기존 `olli_schedule_week` 및 픽업 하원 flag 조회를 재사용한다.
- 예: `오늘 픽업 등록된 학생 있어?`, `다음주 화요일 5시 수업 하원 픽업 학생 보여줘`, `10월 4일 초등부 5시 자리 있어?`.
- AI 모드에서도 변경 명령은 먼저 `prepareAction()`, 읽기 요청은 그 다음 `runQuery()`, 나머지 일반 대화만 OpenAI로 보낸다.
- 조회 결과에 학생 이름이 포함될 수 있으므로 읽기 결과는 OpenAI 대화 history에 추가하지 않는다. 학생 식별 정보는 조회 응답을 자연어로 바꾸기 위해 OpenAI에 다시 전송하지 않는다.

## Realtime 단계별 진행

`olli-realtime-common.js` 한 파일이 연결과 변경 신호 전달을 담당한다. `watchDomain`은 신호 보류·합치기·재시도·재연결 확인을 공통 처리한다. PC·Phone adapter는 기존 서버 조회와 해당 화면 반영만 담당한다.

현재 적용 범위, 보류 기능, 배포 순서와 검증 방법은 [OLLI_REALTIME_STATUS.md](OLLI_REALTIME_STATUS.md)에 기록한다. 구조와 보호 규칙을 변경하면 코드와 같은 작업에서 이 문서와 상태 문서를 갱신한다.

## 2026-09-21 팀톡 설정 공통화

- `olli-settings-team-talk-common.js`와 `olli-settings-team-talk-common.css`는 PC `main`이 단일 원본이다.
- Phone은 로컬 복사본을 두지 않고 기존 공통 파일과 동일하게 Vercel rewrite로 PC 원본을 읽는다.
- 기존 설정 화면 안의 `팀톡 설정` 행과 상세 UI, 팀톡 배경(밝은 회색 `#F3F3F3` / 어두운 회색 `#666D77`) 적용, 올리봇 알림 설정 조회/저장을 이 공통 모듈이 담당한다.
- 플랫폼별 채팅 레이아웃 자체는 기존 Phone/PC 전용 CSS를 유지하고, 공통 설정은 각각의 팀톡 화면에 theme 값만 전달한다.


## 2026-09-23 팀톡 짧은 시간표 조회

- 팀톡/워크의 봇·AI 공통 조회에서 `초등 화요일 4시`, `유치부 화요일 4시`, `화요일 4시`처럼 별도 질문어가 없는 짧은 입력도 정규 시간표 조회로 해석한다.
- 부서가 있으면 해당 부서만 조회하고, 부서가 없으면 같은 요일·시간의 초등부와 유치부를 함께 조회한다. 한쪽 부서에 운영 수업이 없으면 그 사실도 명시한다.
- 짧은 시간표 조회는 현재 정규 인원과 잔여 자리, 향후 정규 인원 변경, 날짜별 보강·체험 예약을 기존 1년 조회 데이터에서 함께 보여준다. 미래 정규 인원 증가의 원인이 신규등록인지 수업이동인지 클라이언트가 단정할 수 없으므로 `정규 등록 +N명 예정`으로 표시한다.
- DB/RPC/저장·동기화 로직은 변경하지 않는다. 공통 Source of Truth는 계속 PC `main`의 `olli-command-router-common.js`와 `olli-command-schedule-common.js`이며 Phone은 기존 rewrite로 같은 원본을 사용한다.
