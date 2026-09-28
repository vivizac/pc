# OLLI Phone 공통 코드 단일 원본 규칙

## 원본

Phone과 PC가 함께 사용하는 공통 런타임 코드의 실제 원본(Source of Truth)은 `vivizac/pc`의 `main`이다.

`OLLI_COMMON_FILES.txt`에 적힌 파일은 Phone 저장소에 복사본을 두지 않는다. Phone이 기존과 같은 파일 경로를 요청하면 `vercel.json`의 rewrite가 PC 저장소의 원본 파일로 연결한다.

따라서 공통 기능을 수정할 때는 PC 원본 파일만 수정한다. Phone용 복사·동기화 커밋은 만들지 않는다.

## 런타임 연결 방식

- Phone HTML과 adapter는 기존의 상대 경로 파일명을 그대로 사용한다.
- Vercel rewrite가 해당 경로를 `https://raw.githubusercontent.com/vivizac/pc/main/<파일명>`으로 프록시한다.
- 공통 JS 응답은 `Cache-Control: no-store, max-age=0`을 사용한다.
- rewrite 캐시도 비활성화하여 PC `main`의 최신 원본을 사용한다.
- Phone 전용 adapter, iOS/키보드/보관함 정책, 화면 UI 파일은 Phone 저장소에 그대로 둔다.

## 관찰노트·수업기록 동기화 보호 규칙 — 중요

관찰노트/수업기록의 PC↔Phone 동기화는 **공통 저장 코어 + Phone 전용 보정 adapter** 구조로 동작한다. 이 구조는 최근 동기화 오류를 해결하면서 안정화한 것이므로 공통화 작업에서 단순 병합하거나 삭제하면 안 된다.

### 공통 저장 코어

아래 계열은 PC 원본을 Phone과 함께 사용하는 공통 코드다.

- `observation-memo-common.js`
- `observation-memo-save-common.js`
- `observation-memo-session-common.js`
- `observation-memo-storage-common.js`
- `observation-memo-request-guard-common.js`
- `observation-memo-version-history-common.js`

`observation-memo-save-common.js`의 revision/CAS 기반 저장·충돌 방지 로직은 공통 동작이다. 이 공통 CAS 자체를 Phone 전용 코드라고 오해하지 않는다.

### 반드시 Phone에 남겨야 하는 전용 adapter

- Phone 저장소: `olli-observation-autosave-phone-adapter.js`

이 파일은 `OLLI_COMMON_FILES.txt`에 넣지 않는다. PC raw rewrite 대상으로 만들지 않는다. 공통 파일과 이름/역할이 비슷하다는 이유로 삭제하거나 PC 코드로 덮어쓰지 않는다.

Phone adapter가 보호하는 핵심 동작:

1. Phone에서 실제로 쓰기 가능한 계정 세션인지 서버 기준으로 확인한다.
2. 승인된 선생님 기기의 세션이 끊겼을 때 기기 ID를 이용한 세션 복구를 시도한다.
3. Phone 런타임이 공통 저장 결과를 정상적으로 반환하지 못하는 차이를 보정하여 저장 완료 상태를 공통 로직이 인식하게 한다.
4. iOS/Safari에서 실제 수정 없이 textarea를 열거나 포커스할 때 발생할 수 있는 no-op `input` 이벤트가 `updatedAt` 또는 `syncStatus=pending`을 잘못 변경하지 않게 막는다.
5. 실제 내용이 달라졌을 때만 dirty 상태가 되도록 보정한다.
6. Phone 시작 과정에서 `saveCurrentMemo` 등이 다시 할당되어 보정 함수가 덮어써질 수 있으므로 adapter 보호 로직을 다시 설치한다.
7. 세션 문제로 저장하지 못한 `pending`/`blocked` 상태를 안전하게 다룬다. 읽기만 한 관찰노트를 자동으로 재저장하거나 과거 pending 내용을 무조건 재전송하면 안 된다.
8. 공통 revision/CAS 저장 흐름을 Phone의 세션·런타임 특성에 맞게 연결한다. Phone 전용 CAS 세션/결과 보정은 유지한다.

### 관찰노트 관련 금지 사항

- `olli-observation-autosave-phone-adapter.js`를 공통 파일 목록에 추가하지 않는다.
- Phone 전용 세션 복구 코드를 PC 공통 파일로 단순 이동하지 않는다.
- `pending` 또는 `blocked` 데이터를 앱 시작/화면 열기만으로 자동 저장하지 않는다.
- 관찰노트를 단순 조회한 것만으로 `updatedAt`, `syncStatus`, revision이 바뀌게 만들지 않는다.
- Phone의 no-op input guard를 제거하지 않는다.
- `saveCurrentMemo`의 반환값/dirty 정리 보정을 제거하기 전에 PC와 Phone의 저장 완료 처리 차이가 완전히 사라졌는지 먼저 검증한다.
- 공통 저장 코어를 변경할 때 Phone adapter와의 호출 순서 및 전역 함수 재할당 여부를 반드시 확인한다.

### 데이터·저장 계층 수정 시 회귀 확인

`olli-storage-core.js`, `olli-data-foundation.js`, 학생 데이터/저장 관련 공통 모듈을 수정하거나 공통화할 때는 관찰노트 동기화 영향도 함께 확인한다. 최소한 다음 흐름이 유지되어야 한다.

- PC에서 관찰노트 수정 → Phone에서 최신 내용 확인
- Phone에서 관찰노트 수정 → PC에서 최신 내용 확인
- Phone에서 관찰노트를 열기만 하고 수정하지 않음 → 서버의 수정시간/상태가 변하지 않음
- Phone 세션이 복구된 뒤 실제 수정 내용이 정상 저장됨
- 동일 기록을 PC/Phone에서 수정할 때 revision/CAS 충돌 보호가 유지됨
- `pending`/`blocked` 상태가 과거 내용을 임의로 덮어쓰지 않음

위 항목 중 하나라도 깨지면 저장/데이터 계층 공통화는 완료된 것으로 보지 않는다.

## 검증

`.github/workflows/validate-single-source-common.yml`이 다음을 검사한다.

1. 공통 파일의 로컬 복사본이 Phone 저장소에 다시 생기지 않았는지 확인한다.
2. PC 원본 파일을 내려받아 JavaScript/CSS 기본 검증을 수행한다.
3. `vercel.json`에 모든 공통 파일의 rewrite와 no-store 설정이 있는지 확인한다.
4. Phone에서 각 공통 모듈이 기존 로딩 위치에서 한 번만 호출되는지 확인한다.

자동 검증은 파일 배치와 로딩 구조를 보호하지만, 관찰노트의 실제 PC↔Phone 동기화 의미까지 모두 검증하지는 못한다. 저장/세션/데이터 코어 변경 시에는 위의 관찰노트 회귀 확인 항목도 함께 확인한다.

## 피드백 저장 후 관찰노트 초기화 보호

`observation-memo-feedback-clear-common.js`는 2026-09-20부터 PC `main`을 Source of Truth로 Phone에서도 함께 사용한다. Phone은 로컬 복사본을 두지 않고 `vercel.json` rewrite를 통해 공통 원본을 로드한다.

이 모듈은 성장 피드백 저장 이후 관찰노트를 지울 때 **서버의 `elementary_observation` clear 성공을 먼저 확인한 뒤 로컬/UI를 비우는 역할**을 한다. 초등부와 유치부 모두 같은 보호를 사용하며, 유치부의 기존 `kinder_risk` 초안에는 영향을 주지 않는다.

## 앞으로 문서에 반드시 남길 내용

공통화·분리·동기화 오류 수정 등 구조에 영향을 주는 작업을 할 때는 코드 수정만 하고 끝내지 않는다. 다음 작업자가 과거 대화 내용을 모르더라도 안전하게 수정할 수 있도록 이 문서 또는 관련 상태 문서에 함께 기록한다.

기록 대상:

- 실제 Source of Truth 파일 경로와 로딩 경로
- PC 전용 / Phone 전용 adapter·runtime과 분리 이유
- 삭제하거나 합치면 안 되는 보호 코드
- 과거 실제로 발생했던 오류의 원인과 이를 막는 현재 구조
- 데이터 저장 형식, revision/CAS, pending/blocked 등 동기화 규칙
- 공통 파일을 수정할 때 함께 확인해야 하는 다른 파일
- 통합을 보류한 파일과 보류 이유
- 리팩터링 후 반드시 확인해야 하는 회귀 테스트

새로운 구조 변경으로 이 문서의 내용이 오래된 정보가 되면 코드와 같은 작업에서 문서도 함께 갱신한다.

## 2026-09-18 올리 명령 라우터

- `olli-command-router-common.js`와 `olli-command-schedule-common.js`는 PC `main`이 단일 원본이며 Phone 저장소에는 복사본을 두지 않는다.
- Phone의 1분 피드백 입력은 이 공통 라우터를 기존 피드백 등록 공통 런타임보다 먼저 로드한다.
- 초기 pass-through 검증 후 빈자리 조회는 `오늘`, `내일`, `이번 주 ○요일`, `다음 주 ○요일`, 단독 `○요일`을 지원한다. 보강·체험·신규등록·수업이동 목적을 구분하며, Phone은 `OlliPhoneStudentScheduleService`의 서버 주간 데이터를 공통 시간표 명령 계층에 제공한다.
- 공통 라우터는 `add_makeup`(보강 등록)과 `move_class`(정규수업 이동) 쓰기 명령을 지원한다. Phone도 별도 저장 로직을 만들지 않고 `OlliPhoneStudentScheduleService.request()`를 통해 기존 `olli_schedule_execute` RPC를 호출하며, 저장 전 `확인`/`취소` 대화를 거친다.
- 명령 기능을 추가할 때 Phone 전용 시간표 저장 코드를 새로 만들지 않고 기존 서버 RPC/서비스 계층을 재사용한다.
- 라우터 오류가 기존 피드백 전송을 막지 않도록 fallback을 유지한다.

## 운영 원칙

### 2026-09-11 시간표 Realtime 2단계

`olli-realtime-common.js` 1.1.0의 `watchDomain`이 변경 신호 보류·합치기·재시도를 공통 처리한다. Phone `olli-attendance-phone-adapter.js`는 이 API로 **현재 보이는 오늘 수업 목록**만 기존 조회 함수로 갱신한다. 이 adapter 전체를 공통화하지 않는다. 출석 저장·월별 출석 갱신 및 학생정보 편집 화면의 Realtime 전환은 후속 단계다.

PC 공통 helper를 먼저 main에 반영한 뒤 Phone adapter를 배포한다. 진행·검증·보류 이유는 [PC OLLI_REALTIME_STATUS.md](https://github.com/vivizac/pc/blob/main/OLLI_REALTIME_STATUS.md)를 함께 확인한다.

공통 코드를 바꿀 때는 PC만 수정한다. Phone은 공통 파일을 저장하지 않고 같은 원본을 사용한다. 플랫폼별 동작 차이가 필요하면 공통 파일을 복제하지 말고 Phone adapter 또는 PC 전용 모듈에서 차이를 처리한다.

특히 관찰노트처럼 플랫폼별 런타임 차이가 실제 데이터 동기화 안정성에 영향을 주는 기능은 **공통 기능과 플랫폼 보정 기능을 구분해서 유지**한다. 파일 내용이 비슷하다는 이유만으로 플랫폼 전용 보호 코드를 단일 원본화하지 않는다.

### 2026-09-20 올리톡 Realtime 베타

- 올리톡은 별도 polling을 추가하지 않고 PC 단일 원본 `olli-realtime-common.js`의 `chat` 도메인을 사용한다.
- Supabase DB는 메시지 저장 완료 후 학원 전용 public Broadcast topic에 `domain: chat` 신호만 보낸다. 신호에 메시지 본문을 싣지 않는다.
- Phone `olli-talk-beta.js`는 채팅 화면이 실제로 열려 있을 때만 신호를 받아 기존 session-aware `olli_team_chat_list` RPC로 서버 원본을 다시 읽는다.
- 채팅 화면이 닫혀 있으면 백그라운드 조회를 만들지 않고, 다음 진입 시 전체 최신 메시지를 다시 읽는다. 기존 observation/schedule Realtime과 저장·CAS·출석 동기화 코드는 변경하지 않는다.


## 2026-09-23 일반 팀톡의 올리 응답 버튼

- Phone 팀톡의 일반 채팅 말풍선은 PC 공통 원본 `OlliCommandRouter.isOlliReplyCandidate()`를 사용해 날짜·요일·시간 중 2종류 이상이 들어간 내 일반 텍스트에만 `올리 응답` 버튼을 표시한다.
- 버튼을 누르면 현재 팀톡 설정의 봇/AI 모드를 그대로 사용해 해당 메시지 원문을 처리하며, 응답은 기존 `reply_to_message_id`로 원문과 연결한다.
- 이미 연결된 AI 응답이 있는 메시지는 서버 목록이나 로컬 캐시를 다시 렌더링해도 버튼을 표시하지 않는다.
- Phone은 공통 판별/조회 로직 복사본을 만들지 않고 PC `main` rewrite를 계속 사용하며, Phone 저장소에는 말풍선 UI와 클릭 adapter만 둔다.
