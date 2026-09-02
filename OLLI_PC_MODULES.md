# OLLI PC 모듈 안내

PC 화면을 수정할 때는 먼저 아래 표에서 담당 파일만 확인한다. `index.html`은 공통 화면 마크업과 기존 모바일·공통 기능을 유지하며, PC 기능의 세부 동작은 각 모듈이 담당한다.

| 수정 대상 | JavaScript | CSS |
|---|---|---|
| 사이드바·상단 헤더·화면 전환 | `pc-shell.js` | `pc-shell.css` |
| 학생관리·할 일·상담예정 학생 영역 | `pc-student-management.js` | `pc-student-management.css` |
| 성향기록·출석 학생 명단 | `pc-attendance.js` | `pc-attendance.css` |
| 관찰기록·1분 피드백 전환과 명단 | `pc-observation.js` | `pc-observation.css` |
| 시간표 화면·팝업 | `pc-timetable.js` | `pc-timetable.css` |
| 시간표 데이터 호출 | `pc-timetable-service.js` | - |
| 상담설문 | `consultation-survey.js`, `consultation-survey-core.js` | `consultation-survey.css` |

## 공통 연결 원칙

- `pc-shell.js`는 현재 메뉴와 공통 검색값을 보관하고 각 기능 모듈의 `open`, `renderContext`를 호출한다.
- 학생관리, 성향기록, 관찰기록 모듈은 기존 전역 함수 이름을 직접 바꾸지 않는다.
- 로그인 세션, `academy_id`, 학생 원본 데이터, Supabase 저장 함수는 공통 기존 코드를 그대로 사용한다.
- 기능을 수정할 때 다른 모듈 코드를 복사하지 않는다. 공통 연결이 필요하면 `OlliPcCore`의 공개 함수만 사용한다.
- 시간표와 상담설문은 독립 모듈 상태를 유지하며 PC 셸의 메뉴 전환 함수만 연결한다.

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
