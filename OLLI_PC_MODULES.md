# OLLI PC 모듈 안내

PC 화면을 수정할 때는 먼저 아래 표에서 담당 파일만 확인한다. `index.html`은 공통 화면 마크업과 아직 분리되지 않은 공통 기능을 유지하며, 분리된 기능은 각 모듈이 담당한다.

| 수정 대상 | JavaScript | CSS |
|---|---|---|
| 사이드바·상단 헤더·화면 전환 | `pc-shell.js` | `pc-shell.css` |
| PC 시작 페이지 | `pc-start-page.js` | - |
| 학생관리·할 일·상담예정 학생 영역 | `pc-student-management.js` | `pc-student-management.css` |
| 성향기록부·학생 명단·관찰기록 패널·공용 기록 화면 임베드 | `pc-attendance.js` | `pc-attendance.css` |
| 초등 관찰 분석·분석 이력·분석 카드 | `elementary-analysis.js` | 기존 공통 스타일 |
| 초등 관찰기록 편집·자동저장·피드백 생성·관찰 관련 알림 | `observation-memo-core.js` | 기존 공통 스타일 |
| 유치부 1분 피드백 | `kinder-feedback.js` | `kinder-feedback.css` |
| 시간표 화면·팝업 | `pc-timetable.js` | `pc-timetable.css` |
| 시간표 데이터 호출·변경 이력·복구 | `pc-timetable-service.js` | - |
| 상담설문 | `consultation-survey.js`, `consultation-survey-core.js` | `consultation-survey.css` |

## 공통 연결 원칙

- `pc-shell.js`는 현재 메뉴와 공통 검색값을 보관하고 각 기능 모듈의 `open`, `renderContext`를 호출한다.
- PC 시작 페이지는 `pc-start-page.js`가 관리하며 `academy`(학생관리), `attendance`(성향기록부), `schedule`(시간표 • 출석부) 세 화면만 제공한다. 기존 관찰노트·1분 피드백 시작값은 PC에서 성향기록부로 호환 변환한다.
- 메뉴를 열 때 로컬 캐시를 먼저 그려 화면을 즉시 전환하고, Supabase 확인은 백그라운드에서 실행한다. 서버 내용이 실제로 달라졌을 때만 현재 화면을 다시 그린다.
- PC 화면의 관찰기록 입력은 별도 `관찰노트` 메뉴를 사용하지 않고 `성향기록부` 안에서 처리한다.
- 기존 `observation`, `feedback` PC route 호출은 `pc-shell.js`에서 `attendance`(성향기록부)로 흡수한다.
- 초등 관찰기록은 기존 `studentMemoScreen`, 유치부 1분 피드백은 기존 `kinderChatFeedbackScreen`을 복제하지 않고 `pc-attendance.js`가 성향기록부 카드 안으로 이동해 재사용한다.
- 초등 분석 로직은 `elementary-analysis.js`, 관찰기록 편집·저장과 피드백 생성의 공용 로직은 `observation-memo-core.js`, 유치부 1분 피드백 로직과 전용 스타일은 `kinder-feedback.js` / `kinder-feedback.css`로 분리되어 있다.
- 화면 DOM 중 아직 공용으로 사용하는 `studentMemoScreen`, `kinderChatFeedbackScreen` 마크업과 일부 공통 스타일은 `index.html`에 남아 있다. 기능 모듈을 분리해도 이 DOM을 임의로 삭제하지 않는다.
- 로그인 세션, `academy_id`, 학생 원본 데이터, Supabase 저장 함수는 공통 기존 코드를 그대로 사용한다.
- 기능을 수정할 때 다른 모듈 코드를 복사하지 않는다. 공통 연결이 필요하면 기존 공개 함수 또는 공용 모듈을 재사용한다.
- 시간표와 상담설문은 독립 모듈 상태를 유지하며 PC 셸의 메뉴 전환 함수만 연결한다.

## 시간표 변경 이력과 복구

- PC 시간표 상단의 `변경 이력`에서 최근 30일의 수정자, 수정 시각, 변경 전·후 내용을 확인한다.
- 시간표를 바꾸는 화면 호출은 `pc-timetable-service.js`의 `olli_schedule_execute` 경로를 사용해 수정자와 작업 종류를 함께 기록한다.
- 복구는 원장·관리자만 가능하며, 대상 변경을 한 번 더 비교하고 확인 체크를 해야 실행된다. 교사는 이력만 조회할 수 있다.
- 복구 작업도 새 이력으로 남는다. 대상 항목이 이후 다시 수정된 경우 서버가 복구를 거절하므로 최근 변경부터 확인한다.
- 서버 구조는 `supabase/migrations/20260903021908_olli_schedule_history.sql`에서 관리한다. 이력 테이블은 앱에서 직접 읽거나 쓰지 않고 권한을 확인하는 RPC만 사용한다.
- 대기는 `requested_at`의 한국 날짜가 포함된 주부터만 보인다. 과거 주를 열어도 이후에 만든 대기가 섞여 보이면 안 된다.
- 유치부 4시·5시 칸은 각각 A반과 B반으로 나뉜다. `class_group`(정규·보강), `target_class_group`(대기·변경 이력)은 현재 `A` 또는 `B`를 저장하며, 기존 데이터는 안전하게 A반으로 유지한다.
- 유치부 A반·B반은 정규 수업과 보강을 합쳐 각 칸 최대 6명이다. 반 영역의 외곽선은 표시하지 않는다.
- 학생 카드 본문은 날짜별 출석을 전환하며, 출석 시 글자색이 아닌 카드 배경만 밝은 초록색으로 바뀐다. 오른쪽의 연한 회색 버거 버튼만 수업·보강 설정을 연다.
- 초등부 시간표는 모든 행이 화면 높이에 맞게 균등하게 표시된다.
- 초등부의 `클래스 분리`는 학원·요일·시간 단위로 저장한다. 분리된 칸은 별도 박스나 A·B 텍스트 없이 가로선 하나로 위(A)·아래(B)를 나누며, 기존 학생은 A반에 유지한다. 같은 팝업의 `클래스 통합`으로 B반이 비어 있을 때 다시 한 칸으로 되돌릴 수 있다.
- 같은 요일·시간 안에서 A반과 B반 사이를 이동할 때는 이동 전 원본 수업을 중복 검사와 정원 계산에서 제외한다.
- 유치부 시간표 아래의 픽업 시간표는 요일별 4시·5시 수업에 각각 최대 6명을 등록하며 학생 이름, 픽업 장소, 실제 픽업 시간을 저장한다.

## 주요 로드 흐름

1. 기존 공통 `index.html` 스크립트 구간
2. `elementary-analysis.js` (기존 분석 코드가 있던 실행 위치)
3. `observation-memo-core.js` (기존 관찰기록 편집 코드가 있던 실행 위치)
4. `kinder-feedback.js` (기존 유치부 1분 피드백 코드가 있던 실행 위치)
5. 하단 PC 모듈: `pc-shell.js`, `pc-student-management.js`, `pc-attendance.js`, 시간표·상담설문 모듈
6. `pc-start-page.js`

## 수정 전 확인

- 화면 이름과 담당 모듈을 이 문서에서 먼저 확인한다.
- 데이터 구조 변경이 없는 UI 수정은 담당 JavaScript와 CSS만 연다.
- 공통 학생 데이터나 저장 방식을 바꿀 때만 `index.html`과 Supabase 연결 코드를 추가로 확인한다.
- `elementary-analysis.js`, `observation-memo-core.js`, `kinder-feedback.js`는 기존 전역 데이터와 공용 저장 함수를 재사용한다. 함수나 데이터를 새로 복제하지 않는다.
- `index.html`에 남아 있는 관찰기록 DOM·공통 스타일을 분리할 때는 기능 JS와 별도의 단계로 진행한다.
- 한 기능씩 수정·검증·배포해 다른 화면의 회귀 범위를 줄인다.
