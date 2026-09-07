# OLLI 공통 코드 원본 운영 규칙

## 상태

파일 분리 작업은 여기서 동결한다. 명백한 구조 문제나 기능 변경 사유가 없는 한 추가로 잘게 나누지 않는다.

현재 별도 `vivizac/olli-common` 저장소를 만들 수 있는 자동화 권한이 없으므로, **`vivizac/pc`의 `main`을 임시 공통 원본(Source of Truth)** 으로 사용한다.

Phone 저장소 `vivizac/-`의 공통 파일은 직접 수정하지 않는다. Phone의 `sync-common-from-pc.yml` workflow가 PC 원본을 내려받아 문법 검사 후 자동 반영한다.

## 공통 원본 파일

정확한 목록은 `OLLI_COMMON_FILES.txt`가 유일한 기준이다.

현재 목록:

- observation-memo-common.js
- observation-memo-save-common.js
- observation-memo-session-common.js
- observation-memo-storage-common.js
- olli-record-scene-tools.js
- record-feedback-mode-common.js
- scene-card-kinder-feedback-common.js
- scene-card-model-common.js
- scene-card-ui-common.js
- scene-feedback-text-common.js

## 변경 방법

1. 위 파일은 PC 저장소에서만 직접 수정한다.
2. PC의 공통 원본 검증 workflow가 모든 JS 문법을 검사한다.
3. Phone은 PC `main`의 원본 파일을 자동 동기화한다.
4. Phone 전용 adapter, iOS/키보드 처리, 보관함 읽기 전용 정책 등 플랫폼별 코드는 동기화 대상에 넣지 않는다.
5. 출석 출력/내보내기, 일반 알림, risk-signal 등 보호 영역은 유사해 보여도 자동 공통화하지 않는다.

## 향후 전용 공통 저장소로 이동할 때

사용자가 `vivizac/olli-common` 저장소를 만들면 `OLLI_COMMON_FILES.txt`의 파일들을 그 저장소로 옮기고 Phone 동기화 workflow의 SOURCE_REPO만 변경한다. 각 앱의 런타임에서는 계속 로컬 사본을 사용하므로 외부 CDN 장애가 앱 실행에 영향을 주지 않는다.
