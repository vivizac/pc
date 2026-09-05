from pathlib import Path
import re

index_path = Path('index.html')
html = index_path.read_text(encoding='utf-8')


def first_nonempty(text):
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ''


def externalize_style_by_prefix(prefix, filename):
    global html
    pattern = re.compile(r'<style\b([^>]*)>(.*?)</style>', re.I | re.S)
    matches = []
    for m in pattern.finditer(html):
        if first_nonempty(m.group(2)).startswith(prefix):
            matches.append(m)
    if len(matches) != 1:
        raise SystemExit(f'style prefix {prefix!r} matched {len(matches)} blocks')
    m = matches[0]
    attrs = m.group(1) or ''
    body = m.group(2)
    id_match = re.search(r'\bid=["\']([^"\']+)["\']', attrs, re.I)
    media_match = re.search(r'\bmedia=["\']([^"\']+)["\']', attrs, re.I)
    parts = ['<link rel="stylesheet"']
    if id_match:
        parts.append(f' id="{id_match.group(1)}"')
    parts.append(f' href="{filename}"')
    if media_match:
        parts.append(f' media="{media_match.group(1)}"')
    parts.append('>')
    replacement = ''.join(parts)
    Path(filename).write_text(body, encoding='utf-8')
    html = html[:m.start()] + replacement + html[m.end():]
    print('STYLE', filename, len(body.encode('utf-8')), 'id=', id_match.group(1) if id_match else '')


def externalize_script_by_prefix(prefix, filename):
    global html
    pattern = re.compile(r'<script\b([^>]*)>(.*?)</script>', re.I | re.S)
    matches = []
    for m in pattern.finditer(html):
        attrs = m.group(1) or ''
        if re.search(r'\bsrc\s*=', attrs, re.I):
            continue
        if first_nonempty(m.group(2)).startswith(prefix):
            matches.append(m)
    if len(matches) != 1:
        raise SystemExit(f'script prefix {prefix!r} matched {len(matches)} blocks')
    m = matches[0]
    attrs = m.group(1) or ''
    body = m.group(2)
    id_match = re.search(r'\bid=["\']([^"\']+)["\']', attrs, re.I)
    type_match = re.search(r'\btype=["\']([^"\']+)["\']', attrs, re.I)
    parts = ['<script']
    if id_match:
        parts.append(f' id="{id_match.group(1)}"')
    if type_match:
        parts.append(f' type="{type_match.group(1)}"')
    parts.append(f' src="{filename}"></script>')
    replacement = ''.join(parts)
    Path(filename).write_text(body, encoding='utf-8')
    html = html[:m.start()] + replacement + html[m.end():]
    print('SCRIPT', filename, len(body.encode('utf-8')), 'id=', id_match.group(1) if id_match else '')


def externalize_script_by_id(script_id, filename):
    global html
    pattern = re.compile(r'<script\b([^>]*)>(.*?)</script>', re.I | re.S)
    matches = []
    for m in pattern.finditer(html):
        attrs = m.group(1) or ''
        if re.search(r'\bsrc\s*=', attrs, re.I):
            continue
        id_match = re.search(r'\bid=["\']([^"\']+)["\']', attrs, re.I)
        if id_match and id_match.group(1) == script_id:
            matches.append(m)
    if len(matches) != 1:
        raise SystemExit(f'script id {script_id!r} matched {len(matches)} blocks')
    m = matches[0]
    attrs = m.group(1) or ''
    body = m.group(2)
    type_match = re.search(r'\btype=["\']([^"\']+)["\']', attrs, re.I)
    parts = [f'<script id="{script_id}"']
    if type_match:
        parts.append(f' type="{type_match.group(1)}"')
    parts.append(f' src="{filename}"></script>')
    Path(filename).write_text(body, encoding='utf-8')
    html = html[:m.start()] + ''.join(parts) + html[m.end():]
    print('SCRIPT', filename, len(body.encode('utf-8')), 'id=', script_id)


# The three largest active style blocks are moved without changing their cascade position.
externalize_style_by_prefix('* { box-sizing: border-box; margin: 0; padding: 0; }', 'olli-base.css')
externalize_style_by_prefix('.modalTitle {', 'olli-common-components.css')
externalize_style_by_prefix('@media (max-width: 430px) {', 'olli-responsive.css')

# The largest active inline runtime blocks are moved to domain files at the exact same execution points.
externalize_script_by_prefix('/* 2026-04-28 settings sales-mode patch: profile storage, teacher roles, account logout */', 'olli-settings-account-runtime.js')
externalize_script_by_id('olliRecordSortPatchScript', 'olli-record-sort-student-ui.js')
externalize_script_by_prefix('/* 2026-06-27: 1분 피드백 초등부 사용 + 전송 전 등록 학생 검증 + 동명이인 선택 연결 */', 'olli-feedback-registration-runtime.js')
externalize_script_by_prefix('/* 2026-07-03 patch: 학생정보 일괄 수정 문서 형식 유연화 */', 'olli-student-bulk-edit-runtime.js')
externalize_script_by_prefix('/* 2026-07-03: 학생정보 수동 빈값 저장 + 요일별 시간 선택 */', 'olli-student-schedule-runtime.js')
externalize_script_by_prefix('/* 2026-07-04: 출결 보강 정책 + 중간 도입 학원 계산 시작일 */', 'olli-attendance-policy-runtime.js')
externalize_script_by_prefix('/* PC 사이드바 출석부의 명단/시간표 전환과 시간표 이동 */', 'olli-attendance-timetable-bridge.js')

index_path.write_text(html, encoding='utf-8')

# Document why these files exist: they are active runtime ownership, not dead-code buckets.
doc_path = Path('OLLI_PC_MODULES.md')
doc = doc_path.read_text(encoding='utf-8')
marker = '## 공통 연결 원칙\n'
section = '''## `index.html` 대형 인라인 코드 분리\n\n`index.html`에는 화면 조립에 필요한 DOM은 남기되, 큰 CSS/JavaScript 구현은 외부 파일이 담당한다. 아래 파일은 기존 인라인 블록의 내용과 실행 위치를 그대로 보존해 이동한 것이므로 로드 위치를 임의로 바꾸지 않는다.\n\n- `olli-base.css`: 공통 초기화와 기본 화면 스타일.\n- `olli-common-components.css`: 모달·버튼·공통 컴포넌트 스타일.\n- `olli-responsive.css`: 좁은 PC 창/터치 환경까지 포함하는 반응형 보정. 모바일 전용 코드로 간주해 삭제하지 않는다.\n- `olli-settings-account-runtime.js`: 설정 프로필·선생님 역할·계정 로그아웃 연결.\n- `olli-record-sort-student-ui.js`: 기록 정렬과 학생/담임 선택 UI 보정.\n- `olli-feedback-registration-runtime.js`: 1분 피드백의 등록 학생 검증과 동명이인 선택 연결.\n- `olli-student-bulk-edit-runtime.js`: 학생정보 일괄 수정 문서 파싱/적용.\n- `olli-student-schedule-runtime.js`: 학생정보 수동 저장과 요일별 시간 편집.\n- `olli-attendance-policy-runtime.js`: 출결/보강 정책과 계산 시작일 처리.\n- `olli-attendance-timetable-bridge.js`: 출석부 명단/시간표 전환과 시간표 이동 연결.\n\n'''
if marker not in doc:
    raise SystemExit('module documentation marker not found')
doc = doc.replace(marker, section + marker, 1)
doc_path.write_text(doc, encoding='utf-8')

print('INDEX_AFTER_BYTES', len(html.encode('utf-8')))
