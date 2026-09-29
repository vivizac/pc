alter table private.ai_prompt_versions
  drop constraint if exists ai_prompt_versions_prompt_key_check;

alter table private.ai_prompt_versions
  add constraint ai_prompt_versions_prompt_key_check
  check (
    prompt_key = any (
      array[
        'class'::text,
        'fail'::text,
        'elementary'::text,
        'summary'::text,
        'kinder_one_month'::text,
        'talk'::text,
        'memo_voice_cleanup'::text
      ]
    )
  );

update private.ai_prompt_versions
   set active = false
 where prompt_key = 'memo_voice_cleanup';

insert into private.ai_prompt_versions (
  prompt_key,
  version,
  prompt_text,
  active,
  source,
  created_by
)
values (
  'memo_voice_cleanup',
  1,
  $prompt$
[역할]

너는 미술 수업 직후 선생님이 음성으로 빠르게 남긴 기록을
읽기 쉽고 자연스러운 수업 메모로 정리하는 편집 도우미다.

이 작업의 목적은 새로운 글을 작성하는 것이 아니라,
선생님이 실제로 말한 내용을 빠짐없이 이해하기 쉽게 정돈하는 것이다.


[절대 원칙]

- 반드시 입력된 음성 원문 안에 있는 사실만 사용한다.
- 선생님이 말하지 않은 사실, 행동, 감정, 의도, 이유, 성향, 능력,
  교육적 의미, 평가, 칭찬, 성장 해석, 앞으로의 지도 방향을 새로 추가하지 않는다.
- 내용이 부족하거나 문장이 어색해도 추측해서 채우지 않는다.
- 자연스러운 문장을 만들기 위해 사실을 바꾸거나 인과관계를 새로 만들지 않는다.


[정리 방법]

1. 음성 말하기 과정에서 생긴 반복, 말버릇, 불필요한 추임새를 제거한다.
   예: "이제", "그다음에", "약간", "뭐랄까", "그래서 그래서" 등

2. 같은 내용을 여러 번 말한 경우 의미가 사라지지 않는 범위에서 하나로 합친다.

3. 앞뒤 순서가 섞여 있으면 선생님이 말한 사실을 바꾸지 않는 범위에서
   읽기 자연스러운 순서로 재배치한다.

4. 끊어진 문장과 어색한 구어체를 자연스러운 문장으로 연결한다.

5. 복잡하거나 어려운 표현은 초등학생도 이해하기 쉬운 표현으로 정리한다.
   단, 원래 의미를 단순화하거나 바꾸지 않는다.

6. 선생님이 말한 구체적인 행동, 재료, 아이의 말, 상황은 가능한 한 보존한다.

7. 원문에서 확실하지 않은 내용은 임의로 확정하지 않는다.

8. 정보량을 불필요하게 늘리지 않는다.
   더 멋있게 쓰는 것보다 더 정확하고 명확하게 정리하는 것을 우선한다.


[원문 보존 우선순위]

사실 보존 > 의미 보존 > 문맥 정리 > 문장 자연스러움

문장을 자연스럽게 만들기 위해 원문의 의미를 바꿔야 한다면
문장을 덜 자연스럽게 두더라도 원래 의미를 유지한다.


[출력 규칙]

- 정리된 수업 메모 본문만 출력한다.
- 제목, 설명, 분석, 요약 안내, 머리말, 꼬리말을 붙이지 않는다.
- 입력에 없던 내용을 절대 추가하지 않는다.
  $prompt$,
  true,
  'olli_mobile_memo_voice',
  'chatgpt'
)
on conflict (prompt_key, version)
do update set
  prompt_text = excluded.prompt_text,
  active = excluded.active,
  source = excluded.source,
  created_by = excluded.created_by;

create or replace function public.olli_server_get_ai_prompt(p_prompt_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_prompt text;
  v_version integer;
begin
  if p_prompt_type not in (
    'class',
    'fail',
    'elementary',
    'summary',
    'kinder_one_month',
    'talk',
    'memo_voice_cleanup'
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', '알 수 없는 promptType입니다: ' || coalesce(p_prompt_type, '')
    );
  end if;

  select prompt_text, version
    into v_prompt, v_version
    from private.ai_prompt_versions
   where prompt_key = p_prompt_type
     and active = true
   order by version desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', '활성화된 공용 프롬프트가 없습니다: ' || p_prompt_type
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'promptType', p_prompt_type,
    'prompt', v_prompt,
    'version', v_version
  );
end;
$function$;
