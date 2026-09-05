from pathlib import Path

source_path = Path('olli-record-editor-core.js')
source = source_path.read_text(encoding='utf-8')

markers = [
    'function renderMemoModeMenu() {',
    'function getRecordSearchScreen() {',
    'function buildSceneCardUserText(extraText) {',
    'function getStudentModeEntries(records, mode) {',
    'function parseDateSafe(dateStr) {'
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
    raise SystemExit('split integrity failure')

files = [
    ('olli-record-student-picker.js', chunks[0]),
    ('olli-record-scene-tools.js', chunks[1]),
    ('olli-record-search-controls.js', chunks[2]),
    ('olli-record-feedback-generation.js', chunks[3]),
    ('olli-record-room-navigation.js', chunks[4]),
    ('olli-record-memo-storage.js', chunks[5]),
]
for name, content in files:
    Path(name).write_text(content, encoding='utf-8')
    print(name, len(content.encode('utf-8')))

index_path = Path('index.html')
html = index_path.read_text(encoding='utf-8')
old = '<script src="olli-record-editor-core.js"></script>'
new = '\n'.join(f'<script src="{name}"></script>' for name, _ in files)
if html.count(old) != 1:
    raise SystemExit(f'expected one old record editor script tag, found {html.count(old)}')
html = html.replace(old, new, 1)
index_path.write_text(html, encoding='utf-8')

doc_path = Path('OLLI_PC_MODULES.md')
doc = doc_path.read_text(encoding='utf-8')
old_row = '| 기록 에디터 학생 선택·정렬·보관함/기록 편집 공용 동작 | `olli-record-editor-core.js` | 현재 공통 스타일 |'
new_rows = '\n'.join([
    '| 기록 학생 선택·요일/그룹 정렬·학생 선택 팝업 | `olli-record-student-picker.js` | 현재 공통 스타일 |',
    '| 기록 모드 전환·장면카드·공용 모달 전환 | `olli-record-scene-tools.js` | 현재 공통 스타일 |',
    '| 기록 검색·검색 키보드 처리·추가 메뉴 | `olli-record-search-controls.js` | 현재 공통 스타일 |',
    '| 초등 장면카드 피드백 생성·저장·편집 | `olli-record-feedback-generation.js` | 현재 공통 스타일 |',
    '| 기록실 화면 전환·공유·초등/유치 보기 전환 | `olli-record-room-navigation.js` | 현재 공통 스타일 |',
    '| 관찰 메모 로컬/Supabase 초안 저장·학생등록 모달 | `olli-record-memo-storage.js` | 현재 공통 스타일 |',
])
if old_row not in doc:
    raise SystemExit('old record editor module row not found')
doc = doc.replace(old_row, new_rows, 1)
old_principle = '- 데이터 공통 흐름은 역할에 따라 `olli-data-foundation.js`, `olli-data-feedback.js`, `olli-data-consultation-summary.js`, `olli-data-students.js`, `olli-data-record-list.js`, `olli-data-attendance-feedback.js`, `olli-data-student-operations.js`, `olli-data-ui-utils.js`로 나뉜다. 기록 에디터 공용 동작은 `olli-record-editor-core.js`, 기록실 런타임은 `olli-record-list-view.js`, `olli-consultation-runtime.js`, `olli-student-info-runtime.js`, `olli-app-startup.js`, `olli-feedback-runtime.js`에서 수정하며 이 코드를 다시 `index.html`로 복사하지 않는다.'
new_principle = '- 데이터 공통 흐름은 역할에 따라 `olli-data-foundation.js`, `olli-data-feedback.js`, `olli-data-consultation-summary.js`, `olli-data-students.js`, `olli-data-record-list.js`, `olli-data-attendance-feedback.js`, `olli-data-student-operations.js`, `olli-data-ui-utils.js`로 나뉜다. 기록 에디터 공용 동작은 `olli-record-student-picker.js`, `olli-record-scene-tools.js`, `olli-record-search-controls.js`, `olli-record-feedback-generation.js`, `olli-record-room-navigation.js`, `olli-record-memo-storage.js`로 나뉘며, 기록실 런타임은 `olli-record-list-view.js`, `olli-consultation-runtime.js`, `olli-student-info-runtime.js`, `olli-app-startup.js`, `olli-feedback-runtime.js`에서 수정한다. 이 코드를 다시 `index.html`로 복사하지 않는다.'
if old_principle not in doc:
    raise SystemExit('record editor principle not found')
doc = doc.replace(old_principle, new_principle, 1)

append_marker = '## 기록실 런타임 모듈 경계\n'
section = '''## 기록 에디터 모듈 경계\n\n- `olli-record-student-picker.js`: 초등 관찰기록의 학생 선택 팝업, 요일/그룹 정렬, 학생 관리 진입과 선택 제스처.\n- `olli-record-scene-tools.js`: 기록 모드 메뉴, 장면카드 선택/메모 UI, 공용 모달 닫기와 화면 전환 보조.\n- `olli-record-search-controls.js`: 기록 검색 화면, 키보드/포커스 복구, 기록실 추가 메뉴와 학생/유치부 피드백 진입.\n- `olli-record-feedback-generation.js`: 장면카드 기반 초등 피드백 요청, 로딩, 저장, 편집과 다음 지도 방향 처리.\n- `olli-record-room-navigation.js`: 기록 공유, 헤더/보기 전환, 기록실 열기·닫기와 초등/유치 전환.\n- `olli-record-memo-storage.js`: 관찰 메모 로컬 캐시, Supabase `student_note_drafts` 동기화, 학생 등록 모달 흐름.\n\n이 6개 파일은 기존 `olli-record-editor-core.js`의 원본 실행 순서를 그대로 유지한 classic script 분리다. `index.html`에서 적힌 순서를 바꾸거나 임의로 `defer` 처리하지 않는다.\n\n'''
if append_marker not in doc:
    raise SystemExit('record runtime section marker not found')
doc = doc.replace(append_marker, section + append_marker, 1)
doc_path.write_text(doc, encoding='utf-8')

print('original bytes', len(source.encode('utf-8')))
print('split total bytes', sum(len(content.encode('utf-8')) for _, content in files))
