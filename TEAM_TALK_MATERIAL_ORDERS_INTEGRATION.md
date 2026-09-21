# PC 팀톡 재료주문 모듈 연결 메모

이 브랜치는 진행 중인 팀톡 레이아웃 파일(index.html / pc-team-talk.css / pc-team-talk.js)을 직접 수정하지 않는다.
레이아웃 작업이 끝난 뒤 아래 모듈을 새 2/3 업무영역의 "재료주문" 탭에 연결한다.

## 준비된 파일

- `pc-team-talk-material-orders.js`
- `pc-team-talk-material-orders.css`

DB 마이그레이션 원본은 mobile 저장소의
`feat/team-talk-material-orders-db-20260921`
브랜치에 준비되어 있다.

## 레이아웃 연결 방법

1. PC index.html의 CSS 영역에 추가

```html
<link rel="stylesheet" href="pc-team-talk-material-orders.css?v=20260921-1">
```

2. 새 "재료주문" 탭 본문에 mount 포인트 하나만 둔다.

```html
<div class="팀톡-새-레이아웃에서-정한-래퍼">
  <div data-olli-team-material-orders></div>
</div>
```

3. 기존 `pc-team-talk.js`보다 뒤쪽 스크립트 영역에 추가

```html
<script src="pc-team-talk-material-orders.js?v=20260921-1"></script>
```

`data-olli-team-material-orders`가 이미 DOM에 있으면 자동 mount된다.
탭 본문을 동적으로 만드는 구조라면 DOM 생성 직후 아래만 호출한다.

```js
OlliTeamTalkMaterialOrders.mount(targetElement);
```

자료실에서 재료주문 탭으로 돌아올 때 최신 상태를 다시 확인하고 싶으면:

```js
OlliTeamTalkMaterialOrders.activate();
```

## UI 구조

- 상단: 요청 / 주문완료 / 도착 현황
- 좌측: 검색 + 상태 필터 + 요청 목록
- 우측: 선택한 요청 상세 + 상태 처리
- 요청 등록: 모든 활성 학원 구성원
- 상태 변경: 원장(owner), 관리자(manager)
- 상태: requested / on_hold / ordered / arrived
- 서버 저장 성공 후에만 다시 조회하여 UI를 갱신한다.
- 상태 변경은 revision 비교를 사용하여 다른 기기에서 먼저 바뀐 데이터를 덮어쓰지 않는다.

## DB 적용 순서

레이아웃 연결이 끝난 뒤에만 DB 마이그레이션을 운영 Supabase에 적용한다.

1. mobile 브랜치의 `20260921060000_team_talk_material_orders.sql` 검토
2. Supabase migration으로 적용
3. RPC 3개 확인
   - `olli_team_material_requests_list`
   - `olli_team_material_request_create`
   - `olli_team_material_request_set_status`
4. PC 새 레이아웃에 모듈 연결
5. 요청 등록 → 주문완료 → 도착처리 회귀 테스트
6. 선생님 계정에서 상태 처리 버튼이 보이지 않는지 확인
7. 다른 기기에서 상태 변경 후 Realtime 재조회 확인

기존 관찰노트/시간표 동기화 코어는 수정하지 않는다.
재료주문 변경 신호는 기존 Team Talk의 `chat` realtime domain을 재사용한다.
