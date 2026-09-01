# 올리 운영자 관리자 RPC 연결 규격

PC 버전의 `설정 → 올리 관리`는 브라우저에 `service_role` 키를 두지 않는다. 모든 운영자 조회와 변경은 현재 개인계정 세션 토큰을 받는 Supabase `SECURITY DEFINER` RPC에서 다시 권한을 확인한 뒤 실행한다.

## 현재 연결된 RPC

### `olli_admin_list_academies`

입력:

- `p_session_token text`

응답 예시:

```json
{
  "ok": true,
  "academies": [
    {
      "academy_id": "uuid",
      "academy_code": "VIVI-5578",
      "academy_name": "비비작아이성향미술학원",
      "region": "대구",
      "plan_type": "active",
      "access_status": "active",
      "trial_started_at": null,
      "trial_expires_at": null
    }
  ]
}
```

### `olli_admin_set_academy_access`

입력:

- `p_session_token text`
- `p_academy_id uuid`
- `p_plan_type text`
- `p_access_status text`
- `p_trial_started_at date`
- `p_trial_expires_at date`

성공 응답은 `{ "ok": true }`여야 한다. 이 RPC가 실패하면 PC 화면은 로컬 캐시도 변경하지 않는다.

## 다음 연결 RPC

### `olli_admin_list_records`

입력:

- `p_session_token text`
- `p_academy_id uuid`
- `p_record_type text`: `students`, `feedbacks`, `fail_feedbacks`, `summary_feedbacks` 중 하나
- `p_limit integer`: 최대 200

응답은 `{ "ok": true, "records": [...] }` 형식으로 반환한다. 휴지통 데이터도 구분해서 반환해야 하며 각 행에는 `id`와 `deleted_at` 또는 `is_deleted`가 포함되어야 한다.

### `olli_admin_set_record_deleted`

입력:

- `p_session_token text`
- `p_academy_id uuid`
- `p_record_type text`
- `p_record_id uuid`
- `p_deleted boolean`

`p_deleted=true`는 soft delete, `false`는 복구다. 실제 행을 영구 삭제하지 않는다. 성공 응답은 `{ "ok": true }`여야 한다.

### `olli_admin_list_logs`

입력:

- `p_session_token text`
- `p_limit integer`: 최대 200

응답은 `{ "ok": true, "logs": [...] }` 형식으로 반환한다. 권장 필드는 `created_at`, `academy_id`, `academy_name`, `feature`, `level`, `message`, `request_id`다.

## 필수 보안 규칙

- 모든 RPC 첫 단계에서 세션 토큰 유효기간과 운영자 권한을 확인한다.
- 운영자 권한은 화면의 학원명이나 학원 코드가 아니라 서버의 계정 권한 테이블로 판정한다.
- `record_type`은 허용 목록으로 검증하고 사용자 입력을 테이블명에 그대로 연결하지 않는다.
- 데이터 변경 전후 값을 별도 감사 로그에 남긴다.
- `service_role` 키는 PC/폰 코드, 로컬스토리지, Supabase 공개 테이블에 넣지 않는다.
- 프롬프트 관리 RPC와 테이블은 이번 관리자 화면 연결 범위에서 제외한다.
