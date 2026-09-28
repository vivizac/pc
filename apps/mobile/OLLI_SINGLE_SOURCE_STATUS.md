# OLLI 공통 파일 단일 원본 진행 상태

기준일: 2026-09-11

## 수정 전 필수 확인 문서

공통화, 저장/데이터 계층 수정, PC↔Phone 동기화 관련 작업을 시작하기 전에 `OLLI_COMMON_SOURCE.md`를 먼저 확인한다.

특히 관찰노트·수업기록은 **공통 저장 코어 + Phone 전용 `olli-observation-autosave-phone-adapter.js`** 구조로 안정화되어 있다. 세션 복구, Phone 저장결과 보정, iOS no-op input 방지, dirty 상태 보정, pending/blocked 처리, revision/CAS 연결 규칙은 `OLLI_COMMON_SOURCE.md`의 보호 규칙을 따른다. 해당 Phone adapter를 단순 공통화·삭제·덮어쓰기하지 않는다.

## 현재 구조

- 공통 런타임 원본(Source of Truth): `vivizac/pc`의 `main`
- Phone 저장소 `vivizac/-`에는 통합 완료된 공통 파일의 로컬 복사본을 두지 않는다.
- Phone은 기존 파일 경로를 그대로 요청하고 `vercel.json` rewrite를 통해 PC 원본을 사용한다.
- `OLLI_COMMON_FILES.txt`가 단일 원본 대상 목록이다.
- `.github/workflows/validate-single-source-common.yml`이 로컬 복사본 재생성, 원본 누락, JS/CSS 타입, rewrite, 캐시 정책, 런타임 참조를 검증한다.

## 통합 완료

현재 `OLLI_COMMON_FILES.txt`에는 36개 공통 파일이 등록되어 있다. 관찰노트 전환 때 추가된 `olli-realtime-common.js`를 포함한다.

세부 파일 목록은 `OLLI_COMMON_FILES.txt`를 기준으로 한다.

진행 묶음:

1. 관찰노트·씬·피드백 공통 모듈
2. 올리 명령 라우터·시간표 조회 기반(`olli-command-router-common.js`, `olli-command-schedule-common.js`)
3. 로그인·인증 공통 모듈
4. 운영 정책·설정 공통 모듈
5. 로그인 CSS
6. 최근 PC/Phone 코드가 수렴한 설정·학생 데이터 모듈

## 통합하지 않은 파일

아래 파일은 현재 PC와 Phone 내용이 다르므로 로컬 파일을 유지한다. 단순 삭제하거나 PC 원본으로 덮어쓰지 않는다.

- `olli-settings-account-runtime.js`
- `olli-settings-import-test-tools.js`
- `olli-settings-attendance-export.js`
- `olli-storage-core.js`
- `olli-data-foundation.js`

이 파일들은 다음 단계에서 공통 코어와 플랫폼별 adapter/runtime 차이로 분리한 뒤 통합한다.

`olli-storage-core.js`와 `olli-data-foundation.js`는 관찰노트 저장·동기화에 영향을 줄 가능성이 있으므로 공통화할 때 `OLLI_COMMON_SOURCE.md`의 관찰노트 회귀 확인 항목을 반드시 함께 점검한다.

## 제거한 이전 방식

- PC 파일을 Phone 저장소로 주기적으로 복사하는 workflow 제거
- 관찰노트 공통 파일을 Phone에 다시 커밋하는 임시 동기화 workflow 제거

앞으로 공통 기능 수정은 PC 원본 한 곳에서만 하고, 플랫폼별 차이는 Phone/PC 전용 adapter 또는 runtime으로 분리한다.

구조나 보호 규칙이 변경되면 코드만 수정하지 말고 `OLLI_COMMON_SOURCE.md`와 이 진행상태 문서도 같은 작업 흐름에서 갱신한다.

## 시간표 Realtime 2단계

관찰노트 동작 확인 완료는 사용자가 보고했다. 다음 단계로 PC 시간표와 Phone 오늘 수업 목록의 Realtime 연결을 구현·로컬 검증했다. Phone `olli-attendance-phone-adapter.js`의 화면·캐시 보호 로직은 Phone 전용으로 유지한다. 공통 파일 개수나 rewrite 경로는 이번 단계에서 늘리지 않는다.

출석부·출석 체크·학생정보 전체의 전환 완료를 의미하지 않는다. 운영 배포와 실제 기기 시간표 검증은 별도다. 상세 범위와 테스트 기록은 [PC OLLI_REALTIME_STATUS.md](https://github.com/vivizac/pc/blob/main/OLLI_REALTIME_STATUS.md)를 기준으로 한다.
