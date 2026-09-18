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

## Realtime 단계별 진행

`olli-realtime-common.js` 한 파일이 연결과 변경 신호 전달을 담당한다. `watchDomain`은 신호 보류·합치기·재시도·재연결 확인을 공통 처리한다. PC·Phone adapter는 기존 서버 조회와 해당 화면 반영만 담당한다.

현재 적용 범위, 보류 기능, 배포 순서와 검증 방법은 [OLLI_REALTIME_STATUS.md](OLLI_REALTIME_STATUS.md)에 기록한다. 구조와 보호 규칙을 변경하면 코드와 같은 작업에서 이 문서와 상태 문서를 갱신한다.
