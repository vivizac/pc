from pathlib import Path

source_path = Path('olli-auth-core.js')
source = source_path.read_text(encoding='utf-8')

markers = [
    "const OLLI_ACCOUNT_SESSION_TOKEN_KEY = 'olli_account_session_token_v1';",
    'function getOlliMultiAcademyState() {',
    'async function submitOlliOwnerIdLogin() {',
    'function normalizeOlliTeacherNameForMatch(value) {',
    'function clearOlliOwnerExistingAcademyLookupResult() {',
    'function getOlliDeviceName() {'
]
positions = []
for marker in markers:
    pos = source.find(marker)
    if pos < 0:
        raise SystemExit(f'marker not found: {marker}')
    positions.append(pos)
if positions != sorted(positions):
    raise SystemExit(f'bad marker order: {positions}')

cuts = [0] + positions + [len(source)]
chunks = [source[cuts[i]:cuts[i + 1]] for i in range(len(cuts) - 1)]
if ''.join(chunks) != source:
    raise SystemExit('auth split integrity failure')

files = [
    ('olli-auth-entry-ui.js', chunks[0]),
    ('olli-auth-account-session.js', chunks[1]),
    ('olli-auth-academy-switch.js', chunks[2]),
    ('olli-auth-owner-onboarding.js', chunks[3]),
    ('olli-auth-teacher-membership.js', chunks[4]),
    ('olli-auth-academy-access.js', chunks[5]),
    ('olli-auth-member-validation.js', chunks[6]),
]
for name, content in files:
    Path(name).write_text(content, encoding='utf-8')
    print(name, len(content.encode('utf-8')))

index_path = Path('index.html')
html = index_path.read_text(encoding='utf-8')
old = '<script src="olli-auth-core.js"></script>'
new = '\n'.join(f'<script src="{name}"></script>' for name, _ in files)
if html.count(old) != 1:
    raise SystemExit(f'expected one auth core tag, found {html.count(old)}')
html = html.replace(old, new, 1)
index_path.write_text(html, encoding='utf-8')

doc_path = Path('OLLI_PC_MODULES.md')
doc = doc_path.read_text(encoding='utf-8')
old_row = '| 로그인·계정·학원 연결·세션 복구 | `olli-auth-core.js` | 현재 공통 스타일 |'
new_rows = '\n'.join([
    '| 로그인 진입 화면·계정/학원 연결 화면 전환 | `olli-auth-entry-ui.js` | 현재 공통 스타일 |',
    '| 계정 로그인 상태·세션 복구·접근 학원 캐시 | `olli-auth-account-session.js` | 현재 공통 스타일 |',
    '| 여러 학원 전환·전환 전 저장·전환 후 재로딩 | `olli-auth-academy-switch.js` | 현재 공통 스타일 |',
    '| 원장 로그인·새 학원 생성·초기 원장 연결 | `olli-auth-owner-onboarding.js` | 현재 공통 스타일 |',
    '| 승인된 선생님 멤버십 확인·선생님 입장 | `olli-auth-teacher-membership.js` | 현재 공통 스타일 |',
    '| 기존 학원 찾기·학원 접근 요청·승인 상태 확인 | `olli-auth-academy-access.js` | 현재 공통 스타일 |',
    '| 기기 식별·현재 멤버 접근 권한 재검증 | `olli-auth-member-validation.js` | 현재 공통 스타일 |',
])
if old_row not in doc:
    raise SystemExit('old auth module row not found')
doc = doc.replace(old_row, new_rows, 1)
old_principle = '- 로그인·계정·학원 연결 함수는 `olli-auth-core.js`, 설정 공통 상태와 화면은 `olli-settings-base.js`, 선생님/권한은 `olli-settings-members.js`, 백업/진단은 `olli-settings-storage.js`, 공통 저장 기반은 `olli-storage-core.js`에서 수정한다.'
new_principle = '- 로그인 계층은 `olli-auth-entry-ui.js`, `olli-auth-account-session.js`, `olli-auth-academy-switch.js`, `olli-auth-owner-onboarding.js`, `olli-auth-teacher-membership.js`, `olli-auth-academy-access.js`, `olli-auth-member-validation.js`로 나뉜다. 설정 공통 상태와 화면은 `olli-settings-base.js`, 선생님/권한은 `olli-settings-members.js`, 백업/진단은 `olli-settings-storage.js`, 공통 저장 기반은 `olli-storage-core.js`에서 수정한다.'
if old_principle not in doc:
    raise SystemExit('auth principle not found')
doc = doc.replace(old_principle, new_principle, 1)
marker = '## 공통 연결 원칙\n'
section = '''## 로그인·계정 모듈 경계\n\n- `olli-auth-entry-ui.js`: 로그인/계정생성/학원연결/선생님 요청 화면 전환과 진입 폼 연결.\n- `olli-auth-account-session.js`: 계정 세션 토큰, 접근 가능한 학원 캐시, 학원 존재 확인, 로그인 상태 저장과 세션 복구.\n- `olli-auth-academy-switch.js`: 다학원 상태, 학원 전환 오버레이, 전환 전 미저장 데이터 보존과 전환 후 데이터 재로딩.\n- `olli-auth-owner-onboarding.js`: 원장 계정 로그인, 새 학원 생성, 레거시 학원 생성 후 원장 멤버 연결과 최초 진입.\n- `olli-auth-teacher-membership.js`: 승인된 선생님 멤버십 탐색과 선생님 계정 입장.\n- `olli-auth-academy-access.js`: 기존 학원 검색, 계정의 학원 접근 요청, 승인 여부 확인과 요청 상태 UI.\n- `olli-auth-member-validation.js`: 기기 이름/기기 ID와 현재 멤버 접근 권한 재검증.\n\n이 7개 파일은 기존 `olli-auth-core.js`의 실행 순서를 그대로 보존한 classic script 분리다. 로그인 화면 바로 뒤에서 표기된 순서대로 동기 로드하며 임의로 `defer` 처리하지 않는다.\n\n'''
if marker not in doc:
    raise SystemExit('common principle marker not found')
doc = doc.replace(marker, section + marker, 1)
doc_path.write_text(doc, encoding='utf-8')

print('original bytes', len(source.encode('utf-8')))
print('split total bytes', sum(len(content.encode('utf-8')) for _, content in files))
