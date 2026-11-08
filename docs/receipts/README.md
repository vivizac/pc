# 올리 수납 — 독립 모바일 웹앱

기준 main: aa94637cb68cd14f5360138ee7166cf8bc38802c. 앱 소스는 `apps/receipts`이며 기존 PC/모바일 런타임을 수정하지 않는다. Vercel `olli-receipts` 프로젝트가 이 디렉터리를 독립 배포한다. 기존 Supabase `fvkxipjwgeyosgnfhdnx`의 계정 로그인과 학원 목록, 교육비 계산기를 사용한다. 별도 도메인이므로 기존 올리 계정으로 다시 로그인한다.

## 저장 및 권한

기존 custom account token과 `private.olli_academy_finance_owner_member`를 매 호출 검증한다. 원장만 사용 가능하다. 클라이언트에는 기존 공개 anon 키만 포함한다. 장부 테이블은 private schema + RLS + 직접 접근 revoke, API RPC만 제한적으로 grant한다. 기존 학원·학생·교육비·출석·관찰노트 테이블과 기존 RPC는 변경하지 않는다.

조회는 `olli_receipts_overview`로 교육비 계산 결과와 확정 청구/납부를 합친다. 조회로 청구를 생성하지 않는다. 사용자가 청구 확정을 선택하면 기존 월별 교육비 계산기의 교육비 + 별도 비용을 snapshot으로 보존한다. 확인 필요 금액은 확정하지 않는다. 미납/완료 집계에는 확정 청구만 포함한다. 0원 청구는 납부 없이 완료다. 학생명이 나중에 바뀌어도 청구 당시 이름을 보존한다. 과거/재등록 재원 기간 판단은 기존 예상 교육비 계산기의 한계를 따른다.

`olli_receipts_write`는 학원별 advisory transaction lock, 요청 UUID + payload receipt, 납부 전 revision 검증, 잔액 상한, 취소 사유 및 원본 참조를 검증한다. 같은 요청 재시도는 기존 결과를 반환한다. 취소는 원본을 삭제하지 않고 역분개를 추가한다. 실제 결제/환불은 수행하지 않는다. 청구액의 임의 수정은 지원하지 않는다.

네트워크 저장 실패 시 정확한 요청을 localStorage에 보관하고, 새 요청 전에 기존 요청 결과를 확인하게 한다. 수납 내역과 학생 목록은 브라우저 영구 캐시에 넣지 않는다. Service Worker는 앱 shell만 오프라인 제공한다. 오프라인 수납은 지원하지 않는다. 학원/월 변경 시 늦은 응답을 폐기한다. 새로고침, 화면 복귀, 온라인 복귀 시 서버를 다시 읽는다. PC 수납 UI 연동은 이번 독립 앱 범위에 포함하지 않는다.

## 검증

- `node --test tests/receipts.integration.test.cjs`: 로컬 PGlite의 장부 권한, 읽기 무변경, 월별 청구 보존, 부분납부, 재시도, 충돌, 잔액 상한, 취소 이력.
- `npm test --prefix tests/tuition`: 기존 교육비/수입/급여 회귀.
- `node --test tests/receipts.browser.test.cjs`: 로컬 4173 서버 + Chromium, mock RPC로 로그인/검색/필터/즐겨찾기/수납 실패와 동일 요청 재시도/학원 전환/320·390px 레이아웃. 실제 운영 계정 로그인 검증과 구분한다.

실기기 iOS 설치·실제 원장 로그인·실납부 대사는 미검증. 운영 DB에는 실제 청구나 납부를 테스트 목적으로 생성하지 않는다.
