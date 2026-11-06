# 팀챗 전체 회귀 실패 분류 및 테스트 복구

2026-11-06, 작업 브랜치 `feat/team-chat-integration`, Draft PR #561.
이번 변경은 테스트 코드·검사 도구·문서에 한정된다. 앱 런타임, migration, DB, Production 변경은 없다.

## 비교 조건과 결과

원래 main 대비 팀챗 변경의 전체 비교에서는 양쪽에 같은 431개 실패가 있었다.
이번에는 테스트 복구 직전 팀챗 브랜치 `f5f398bc279a76e697754a2c4e60438e13bbefaf`와
복구 후 작업 트리를 다시 비교했다. Node 24.22.1, 양쪽 LF 정규화, 같은 설치 의존성,
root → 앱별 공통 소스 staging → PC → Mobile 순서로 격리된 복사본에서 전체 파일을 실행했다.
검사 파일은 root 142→143개(새 runner 검증 파일), PC 72개, Mobile 195개다.

| 범위 | 복구 전 통과/전체 | 복구 후 통과/전체 | 복구 후 실패 |
|---|---:|---:|---:|
| root | 848/904 | 855/908 | 53 |
| PC | 450/516 | 455/516 | 61 |
| Mobile | 870/1179 | 897/1246 | 349 |
| 합계 | 2168/2599 | 2207/2670 | **463** |

전후 동일한 이름·파일의 기존 실패 **12개가 통과**했다. 기존 통과 항목이 실패로 바뀐 경우는 0개다.
Mobile의 `olli-talk-mentions-tasks.test.cjs` 문법 오류를 고치면서 파일 초기화 실패 1개가 사라지고,
숨겨졌던 실제 검사 **68개(23 통과·45 실패)**가 실행되었다. 따라서 실패 합계는
`431 - 12 - 1 + 45 = 463`이다. 실패 감소 또는 전체 회귀 통과로 보고하지 않는다.
root의 새 reporter 검증 4개도 통과했다. 모든 suite가 끝까지 실행되었고 skip/cancel/todo는 0개,
전체 audit 명령의 종료 코드는 **1**이다.

## 확인해 수정한 테스트 결함

- 상담 문자 UI: 이미 제거된 raw `channel_id` 입력 대신 현재 승인 채널 선택을 사용하도록 fixture 수정.
  승인 목록 밖의 선택은 channel RPC를 호출하지 않는지, 일반 설정 저장으로 채널 식별자를 덮어쓰지 않는지 확인.
  PC 1280px·Mobile 390px Chromium에서 실행했고 실제 발송은 mock이다.
- 상담 요약 SQL provenance: 괄호 정규식의 이중 이스케이프로 발생하던 SyntaxError 수정.
- 팀챗 avatar: 선언되지 않은 migration fixture 변수를 실제 기존 migration 파일에 연결.
- 시간표: 공통 원본을 `packages/common`에서 읽고 VM 배열/객체를 host 값으로 바꿔 비교.
  날짜별 A/B 그룹과 결석 payload의 기대 값은 유지했다.
- 관찰노트: clean 함수가 실제로 정의된 PC core와 필요한 document.head fixture를 로딩.
  현재 학생 dirty/clean 동작 및 다른 학생 상태 격리 검사가 통과했다.
- Mobile: keyboard blur·검색 style·window event fixture 누락 보완.
- Mobile mention: 잘못 붙여넣어진 테스트 구문을 제거하고 실제 escapeRegExp 함수를 실행해
  한국어, 괄호, 더하기, 대괄호, 점, 역슬래시, 앵커를 포함한 교사 이름을 검사.

실패한 테스트를 삭제하거나 skip하지 않았다. 오래된 API 이름·카피·CSS·캐시 문자열의 기대 값을
현재 소스에 맞춰 일괄 치환하지 않았다. 일부 파일은 fixture가 복구되어도 다른 검사가 계속 실패한다.

## 실패를 해석할 때 필요한 근거

최초 431개는 실패 형태 기준으로 source 정규식 323개, runtime/fixture 형태 36개,
기타 assertion 67개, 파일 초기화 5개로 분류했다. 이는 제품 결함 여부의 판정이 아니다.

현재 계약과 충돌하는 사례가 있다. `phone-main-drawer-frames`는 이전 idle/prewarm 공개 함수를
호출하지만 `phone-drawer-attendance-scale`는 해당 함수가 없어야 한다고 검사한다.
현재 원본은 새 예약 경로와 rear 캐시를 사용한다. 과거 계약 둘을 그대로 만족시키려고 제품을 바꾸면 안 된다.
또한 `.github/workflows/validate-olli-monorepo-transition.yml`에는 제거된 October HTML/layout
assertion이 기존에 남아 있어 현재 status/cache 계약만 골라 실행한다는 주석이 이미 있다.

`56f971ac`는 PC/common 최신본과 Mobile의 9월 기준선을 조합한 이력이므로 화면의 시점도 확인해야 한다.
pickup v2 기대와 현행 v3 경로, `?v=2026...` 고정 문자열, 삭제된 KCF CSS 및 request-guard 참조는
각각 현행 요구·호출 경로·관련 커밋을 확인하고 재현 검사를 작성한 뒤에 수정해야 한다.

## 다음 검증 순서와 출시 게이트

1. 새로 실행된 Mobile mention/teamchat 45개 실패를 현재 팀챗 계약과 대조한다.
   이전 bot 버튼·헤더·material 주문 기대와 현재 공통 진입/권한·메시지 동작을 분리해서 재현한다.
2. 나머지 초기화 실패 4개를 검토한다. 삭제된 observation request-guard 및 KCF CSS 의존,
   KCF local-session top-level assertion을 현재 모듈 소유권과 대조한다.
3. drawer의 상충하는 과거 계약과 시간표 pickup 버전을 정리하되 앱의 현행 동작을 먼저 검증한다.
4. 고위험 저장·세션·CAS·출석 시나리오의 실제 오류를 먼저 해소하고 전체 audit을 반복한다.

새 `tests/regression/run.cjs`는 모든 테스트를 발견하고 실패·파일 초기화 진단·skip·완료 여부를
JSONL/JSON에 기록한다. 완료 summary가 없으면 성공으로 판정하지 않는다.
사용법은 [runner README](../tests/regression/README.md), focused CI는
`.github/workflows/validate-regression-harness.yml`이다. 이 CI의 성공은 전체 audit 성공이 아니다.

사용자는 유료 Supabase 개발 브랜치 생성을 보류하고 로컬 검증만 승인했다.
실제 Storage·Realtime·푸시·iOS PWA·백업 복구 drill 및 이전 앱/신규 DB 호환성의 비운영 환경 검증은
여전히 미완료다. 모든 단계와 전체 회귀가 끝나기 전 main 병합·운영 DB 변경·Production 배포는 금지한다.
