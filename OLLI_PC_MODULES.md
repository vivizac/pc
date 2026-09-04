# OLLI PC 모듈 안내

PC 화면을 수정할 때는 먼저 아래 표에서 담당 파일만 확인한다. `index.html`은 공통 DOM 조립과 아직 분리되지 않은 레거시 연결만 유지하고, 로그인·설정·공통 저장·학생/기록 데이터·PC 기능·관찰/피드백 기능의 실제 동작은 각 모듈이 담당한다.

| 수정 대상 | JavaScript | CSS |
|---|---|---|
| 사이드바·상단 헤더·화면 전환 | `pc-shell.js` | `pc-shell.css` |
| 학생관리·할 일·상담예정 학생 영역 | `pc-student-management.js` | `pc-student-management.css` |
| 성향기록부·학생 명단·관찰기록 패널·공용 에디터 임베드 | `pc-attendance.js` | `pc-attendance.css` |
| 초등 관찰기록 공용 DOM | `observation-editor-ui.js` | `observation-editor.css` |
| 초등 관찰기록 저장·자동저장·보관함·피드백 연결 | `observation-memo-core.js` | `observation-editor.css` |
| 초등 오늘의 분석·분석 이력·상세보기 | `elementary-analysis.js` | `elementary-analysis-ui.css` |
| 유치부 1분 피드백 공용 UI·기능 | `kinder-feedback-ui.js`, `kinder-feedback.js` | `kinder-feedback.css` |
| 로그인·계정·학원 연결·세션 복구 | `olli-auth-core.js` | 현재 공통 스타일 |
| 설정 기본 상태·학원 전환·설정 화면·환경설정 | `olli-settings-base.js` | 현재 공통 스타일, `pc-settings-layout.css` |
| 선생님·관리자·권한·승인 관리 | `olli-settings-members.js` | 현재 공통 스타일 |
| 백업·저장 진단·재전송 | `olli-settings-storage.js` | 현재 공통 스타일 |
| 학생 일괄등록·기존 피드백·출석부 사진 가져오기·테스트 초기화 | `olli-settings-imports.js` | 현재 공통 스타일 |
| 선생님 초대·승인 링크 | `olli-settings-teacher-invite.js` | 현재 공통 스타일 |
| 체험기간·학원 접근상태·올리 관리자용 학원 상태·선생님 학원 찾기 | `olli-settings-access.js` | 현재 공통 스타일 |
| 출석부 출력·PDF 내보내기 | `olli-settings-attendance-export.js` | 현재 공통 스타일 |
| 설정 상세 화면 라우팅 | `olli-settings-detail.js` | 현재 공통 스타일 |
| 공통 저장 컨텍스트·FeatureRegistry·로컬/서버 동기화 기반 | `olli-storage-core.js` | - |
| Supabase 호출·학생/피드백 공통 저장·저장 큐 | `olli-data-core.js` | - |
| 기록 에디터 학생 선택·정렬·보관함/기록 편집 공용 동작 | `olli-record-editor-core.js` | 현재 공통 스타일 |
| 기록실·출석·학생 기록 목록 공용 동작 | `olli-record-room-core.js` | 현재 공통 스타일 |
| 시간표 화면·팝업 | `pc-timetable.js` | `pc-timetable.css` |
| 시간표 데이터 호출·변경 이력·복구 | `pc-timetable-service.js` | - |
| 상담설문 | `consultation-survey.js`, `consultation-survey-core.js` | `consultation-survey.css` |

## 공통 연결 원칙

- `pc-shell.js`는 현재 메뉴와 공통 검색값을 보관하고 각 기능 모듈의 `open`, `renderContext`를 호출한다.
- 메뉴를 열 때 로컬 캐시를 먼저 그려 화면을 즉시 전환하고, Supabase 확인은 백그라운드에서 실행한다. 서버 내용이 실제로 달라졌을 때만 현재 화면을 다시 그린다.
- PC 화면의 관찰기록 입력은 별도 `관찰노트` 메뉴를 사용하지 않고 `성향기록부` 안에서 처리한다.
- 기존 `observation`, `feedback` PC route 호출은 `pc-shell.js`에서 `attendance`(성향기록부)로 흡수한다. 별도 초등 관찰노트 진입 버튼은 제거한다. 유치부 기록은 1분 피드백을 사용한다.
- 초등 관찰기록은 기존 `studentMemoScreen`, 유치부 1분 피드백은 기존 `kinderChatFeedbackScreen`을 복제하지 않고 `pc-attendance.js`가 성향기록부 카드 안으로 이동해 재사용한다.
- `studentMemoScreen`과 초등 분석 모달의 정적 DOM은 더 이상 `index.html` 본문에 직접 두지 않고 `observation-editor-ui.js`가 원래 위치에서 동기적으로 주입한다.
- 유치부 `kinderChatFeedbackScreen`과 관련 오버레이의 정적 DOM은 `kinder-feedback-ui.js`가 `kinder-feedback.js`보다 먼저 원래 위치에 주입한다.
- 초등 분석의 선택값·이력·상세보기 함수는 `elementary-analysis.js`, 관찰 메모 저장/자동저장/피드백 연결은 `observation-memo-core.js`가 담당한다.
- 로그인·계정·학원 연결 함수는 `olli-auth-core.js`, 설정 공통 상태와 화면은 `olli-settings-base.js`, 선생님/권한은 `olli-settings-members.js`, 백업/진단은 `olli-settings-storage.js`, 공통 저장 기반은 `olli-storage-core.js`에서 수정한다.
- Supabase 직접 호출과 학생/피드백 공통 저장 흐름은 `olli-data-core.js`, 기록 에디터 공용 동작은 `olli-record-editor-core.js`, 기록실/출석 공용 동작은 `olli-record-room-core.js`에서 수정한다. 이 코드를 다시 `index.html`로 복사하지 않는다.
- `academy_id`, 학생 원본 데이터, Supabase 공통 저장 함수처럼 여러 기능이 함께 사용하는 값은 담당 공통 모듈을 통해 공유한다.
- 기능을 수정할 때 다른 모듈 코드를 복사하지 않는다. 공통 연결이 필요하면 기존 공개 함수나 `OlliPcCore`의 공개 함수만 사용한다.
- 외부 UI/공통 모듈은 현재 삽입 위치가 실행 순서를 보장하므로 임의로 `defer` 처리하거나 문서 맨 아래로 옮기지 않는다.
- 시간표와 상담설문은 독립 모듈 상태를 유지하며 PC 셸의 메뉴 전환 함수만 연결한다.

## 관찰기록·피드백 모듈 경계

### 초등 관찰기록

- `observation-editor-ui.js`: 학생 메모 화면, 분석 설문 모달, 분석 상세보기 모달의 DOM 템플릿.
- `observation-editor.css`: 초등 관찰기록 상단바, 하단 버튼, 학생 선택/보관함 등 에디터 UI 스타일.
- `observation-memo-core.js`: 학생 전환, 메모 자동저장, Supabase 동기화, 보관함, 피드백 생성 연결.
- `elementary-analysis.js`: 분석 선택값, 분석 이력, 요약 카드, 상세보기 로직.
- `elementary-analysis-ui.css`: 분석 바텀시트와 요약 카드 스타일.
- `olli-record-editor-core.js`: 학생 선택기, 정렬, 기록 편집에 필요한 공용 기록 동작. 초등 관찰기록에서 호출되더라도 기능을 중복 구현하지 않는다.

### 유치부 1분 피드백

- `kinder-feedback-ui.js`: `kinderChatFeedbackScreen`, 임시 보관함, 학생 선택, 성장 피드백 설문 오버레이 DOM.
- `kinder-feedback.js`: 초안, 키워드 질문, 사진, 저장, 피드백 생성, 성장 피드백 동작.
- `kinder-feedback.css`: 1분 피드백 전용 스타일.

### 삭제 금지 원칙

- 사이드바에서 `관찰노트` 메뉴를 제거했다고 해서 관찰기록 엔진을 삭제하면 안 된다.
- 성향기록부가 초등 `studentMemoScreen`과 유치부 `kinderChatFeedbackScreen`을 공용 에디터로 계속 사용한다.
- 레거시 화면을 없애고 싶다면 먼저 호출 경로를 검색해 공용 모듈을 사용하는 모든 화면이 정상 동작하는지 확인한 뒤 래퍼만 삭제한다.

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

## 로드 순서

공통 코어는 `index.html`에서 원래 실행되던 위치를 그대로 유지한다. `olli-data-core.js`, `olli-record-editor-core.js`, `olli-record-room-core.js`, 설정 모듈 묶음, `olli-auth-core.js`, `olli-storage-core.js`를 임의로 문서 맨 아래로 이동하거나 `defer` 처리하지 않는다.

설정 모듈은 다음 순서를 유지한다.

1. `olli-settings-base.js`
2. `olli-settings-members.js`
3. `olli-settings-storage.js`
4. `olli-settings-imports.js`
5. `olli-settings-teacher-invite.js`
6. `olli-settings-access.js`
7. `olli-settings-attendance-export.js`
8. `olli-settings-detail.js`

이 8개 파일은 기존 `olli-settings-core.js`의 코드를 순서 그대로 나눈 것이므로 중간 순서를 바꾸지 않는다.

PC 전용 모듈의 기본 순서는 다음과 같다.

1. `pc-shell.js`
2. `pc-student-management.js`
3. `pc-attendance.js`
4. 시간표·상담설문 모듈

관찰기록/피드백 공용 모듈도 `index.html`에서 원래 기능이 있던 위치를 유지한다. 특히 UI 템플릿 파일은 대응 기능 JS보다 먼저 실행되어 DOM을 준비해야 한다.

## 수정 전 확인

- 화면 이름과 담당 모듈을 이 문서에서 먼저 확인한다.
- 데이터 구조 변경이 없는 UI 수정은 담당 JavaScript와 CSS만 연다.
- 초등 관찰기록 UI를 수정할 때는 우선 `observation-editor-ui.js`, `observation-editor.css`, `elementary-analysis-ui.css`를 확인한다.
- 초등 관찰기록 저장/분석 동작을 수정할 때는 `observation-memo-core.js`, `elementary-analysis.js`, 필요 시 `olli-record-editor-core.js`를 확인한다.
- 유치부 1분 피드백은 `kinder-feedback-ui.js`, `kinder-feedback.js`, `kinder-feedback.css`에서 수정한다.
- 로그인/계정은 `olli-auth-core.js`, 설정 기본 화면은 `olli-settings-base.js`, 선생님/권한은 `olli-settings-members.js`, 백업/진단은 `olli-settings-storage.js`, 가져오기 기능은 `olli-settings-imports.js`, 초대는 `olli-settings-teacher-invite.js`, 학원 접근/체험은 `olli-settings-access.js`, 출석부 출력은 `olli-settings-attendance-export.js`, 설정 상세 라우팅은 `olli-settings-detail.js`에서 먼저 확인한다.
- 기록실·출석 공용 동작은 `olli-record-room-core.js`, 기록 편집/학생 선택 공용 동작은 `olli-record-editor-core.js`에서 먼저 확인한다.
- `index.html`은 새 기능의 구현 파일로 사용하지 않는다. 정말 문서 조립이나 아직 미분리된 레거시 연결이 필요한 경우에만 수정한다.
- `index.html`에 같은 기능을 다시 복사해 넣지 않는다. 새 UI/기능은 기존 모듈을 확장한다.
- 한 기능씩 수정·검증·배포해 다른 화면의 회귀 범위를 줄인다.
