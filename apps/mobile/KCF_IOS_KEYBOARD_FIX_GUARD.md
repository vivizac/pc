# 1분 피드백 iOS 키보드/스크롤 수정 보호 메모

이 문서는 2026-09-17에 확인한 iOS 키보드 종료 시점의 화면 걸림/스크롤 오류를 다시 만들지 않기 위한 유지보수 메모다.

## 절대 하나로 합치거나 삭제하지 말아야 하는 두 잠금 상태

`kcf-auto-mode.css`에는 아래 두 잠금 규칙이 따로 존재한다.

- `kcfComposerViewportLocked` — TODAY가 있는 일반 1분 피드백 입력창용
- `kcfDedicatedEditViewportLocked` — 피드백 수정 / 수업기록 수정 전용 바텀시트용

두 규칙은 `width:100%`, `height:100%`, `overflow:hidden`, `overscroll-behavior:none`가 비슷해 보여도 중복 코드가 아니다. 서로 다른 UI와 서로 다른 열림/닫힘 생명주기를 잠그기 때문에 둘 다 필요하다.

## 수정한 실제 오류

iOS에서 키보드가 내려갈 때 `body`에 `position:fixed; inset:0`을 사용하면 `visualViewport` 복귀 시점과 body fixed 해제 시점이 어긋났다. 그 결과 화면/입력창이 정상 위치 부근에서 한 번 멈췄다가 두 번째로 내려오는 듯한 현상이 발생했다.

피드백 수정/수업기록 수정 바텀시트에서 `body`의 fixed 좌표계를 제거했을 때 문제가 사라졌고, 같은 원인을 가진 일반 TODAY 입력창에도 동일하게 적용했다.

따라서 아래 원칙을 유지한다.

1. 두 잠금 규칙 모두 문서 스크롤 방지를 위한 `overflow:hidden` 계열은 유지한다.
2. 두 잠금 규칙 모두 `body`에 `position:fixed` 또는 `inset:0`을 다시 추가하지 않는다.
3. 일반 입력창 잠금과 전용 수정 바텀시트 잠금은 이름과 코드가 비슷해도 하나로 합치거나 한쪽을 삭제하지 않는다.
4. 관련 정리 작업 전에는 `tests/kcf-portrait-and-composer-lock.test.cjs`를 확인한다. 이 테스트는 두 잠금 블록이 각각 존재하고 fixed body가 다시 들어오지 않았는지 보호한다.

이 코드는 임시 보정이나 중복 wrapper가 아니라 iOS 키보드 닫힘 시 페이지 좌표계가 두 번 바뀌는 오류를 막기 위한 의도적인 플랫폼 보정이다.
