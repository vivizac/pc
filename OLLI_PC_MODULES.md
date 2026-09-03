# OLLI PC 모듈 안내

PC 화면을 수정할 때는 먼저 아래 표에서 담당 파일만 확인한다. `index.html`은 공통 화면 마크업과 기존 모바일·공통 기능을 유지하며, PC 기능의 세부 동작은 각 모듈이 담당한다.

| 수정 대상 | JavaScript | CSS |
|---|---|---|
| 사이드바·상단 헤더·화면 전환 | `pc-shell.js` | `pc-shell.css` |
| 학생관리·할 일·상담예정 학생 영역 | `pc-student-management.js` | `pc-student-management.css` |
| 성향기록부·학생 명단·관찰기록 패널 | `pc-attendance.js` | `pc-attendance.css` |
| 관찰노트·1분 피드백 전환과 명단 | `pc-observation.js` | `pc-observation.css` |
| 시간표 화면·팝업 | `pc-timetable.js` | `pc-timetable.css` |
| 시간표 데이터 호출·변경 이력·복구 | `pc-timetable-service.js` | - |
| 상담설문 | `consultation-survey.js`, `consultation-survey-core.js` | `consultation-survey.css` |

## 공통 연결 원칙

- `pc-shell.js`는 현재 메뉴와 공통 검색값을 보관하고 각 기능 모듈의 `open`, `renderContext`를 호출한다.
- 메뉴를 열 때 로컬 캐시를 먼저 그려 화면을 즉시 전환하고, Supabase 확인은 백그라운드에서 실행한다. 서버 내용이 실제로 달라졌을 때만 현재 화면을 다시 그린다.
- 화면 표시명은 `성향기록부`, `관찰노트`를 사용한다.
- 내부 route key인 `attendance`, `observation`은 기존 저장값·onclick·모바일 공통 기능과의 호환을 위한 고정 식별자다. 새 PC 코드에서는 의미가 드러나는 `PERSONALITY_RECORDS`, `OBSERVATION_NOTE`, `OlliPcPersonalityRecords`, `OlliPcObservationNote` 이름을 사용하고, 과거 전역 이름은 호환 별칭으로만 유지한다.
- 로그인 세션, `academy_id`, 학생 원본 데이터, Supabase 저장 함수는 공통 기존 코드를 그대로 사용한다.
- 기능을 수정할 때 다른 모듈 코드를 복사하지 않는다. 공통 연결이 필요하면 `OlliPcCore`의 공개 함수만 사용한다.
- 시간표와 상담설문은 독립 모듈 상태를 유지하며 PC 셸의 메뉴 전환 함수만 연결한다.

## 시간표 변경 이력과 복구

- PC 시간표 상단의 `변경 이력`에서 최근 30일의 수정자, 수정 시각, 변경 전·후 내용을 확인한다.
- 시간표를 바꾸는 화면 호출은 `pc-timetable-service.js`의 `olli_schedule_execute` 경로를 사용해 수정자와 작업 종류를 함께 기록한다.
- 복구는 원장·관리자만 가능하며, 대상 변경을 한 번 더 비교하고 확인 체크를 해야 실행된다. 교사는 이력만 조회할 수 있다.
- 복구 작업도 새 이력으로 남는다. 대상 항목이 이후 다시 수정된 경우 서버가 복구를 거절하므로 최근 변경부터 확인한다.
- 서버 구조는 `supabase/migrations/20260903021908_olli_schedule_history.sql`에서 관리한다. 이력 테이블은 앱에서 직접 읽거나 쓰지 않고 권한을 확인하는 RPC만 사용한다.
- 대기는 `requested_at`의 한국 날짜가 포함된 주부터만 보인다. 과거 주를 열어도 이후에 만든 대기가 섞여 보이면 안 된다.
- 유치부 4시·5시 칸은 각각 A반과 B반으로 나뉜다. `class_group`(정규·보강), `target_class_group`(대기·변경 이력)은 현재 `A` 또는 `B`를 저장하며, 기존 데이터는 안전하게 A반으로 유지한다.

## 로드 순서

1. `pc-shell.js`
2. `pc-student-management.js`
3. `pc-attendance.js`
4. `pc-observation.js`
5. 시간표·상담설문 모듈

## 수정 전 확인

- 화면 이름과 담당 모듈을 이 문서에서 먼저 확인한다.
- 데이터 구조 변경이 없는 UI 수정은 담당 JavaScript와 CSS만 연다.
- 공통 학생 데이터나 저장 방식을 바꿀 때만 `index.html`과 Supabase 연결 코드를 추가로 확인한다.
- 한 기능씩 수정·검증·배포해 다른 화면의 회귀 범위를 줄인다.
