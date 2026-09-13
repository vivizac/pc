from pathlib import Path

ui = Path('olli-record-sort-student-ui.js')
text = ui.read_text()

replacements = [
    (
        "        + '<div id=\"elementaryStudentLessonDayField\" class=\"kinderInfoModalField\"><div class=\"modalLabel\">요일</div><div id=\"elementaryStudentLessonDayToggleRow\" class=\"infoDayToggleRow\"></div></div>'",
        "        + '<div id=\"elementaryStudentLessonDayField\" class=\"kinderInfoModalField\"><div class=\"modalLabel\">요일</div><div id=\"elementaryStudentLessonDayToggleRow\" class=\"infoDayToggleRow\"></div></div>'\n        + '<div id=\"elementaryStudentLessonTimeField\" class=\"kinderInfoModalField studentScheduleTimeField\"><div class=\"modalLabel\">시간</div><div id=\"elementaryStudentLessonTimeToggleRow\" class=\"infoTimeToggleRow\"></div><input type=\"hidden\" id=\"elementaryStudentLessonTimeToggleRowInput\"></div>'"
    ),
    (
        "        + '<div class=\"kinderInfoModalField\"><div class=\"modalLabel\">요일</div><div id=\"studentLessonDayToggleRow\" class=\"infoDayToggleRow\"></div><input id=\"studentLessonDayInput\" type=\"hidden\"></div>'",
        "        + '<div class=\"kinderInfoModalField\"><div class=\"modalLabel\">요일</div><div id=\"studentLessonDayToggleRow\" class=\"infoDayToggleRow\"></div><input id=\"studentLessonDayInput\" type=\"hidden\"></div>'\n        + '<div id=\"studentLessonTimeField\" class=\"kinderInfoModalField studentScheduleTimeField\"><div class=\"modalLabel\">시간</div><div id=\"studentLessonTimeToggleRow\" class=\"infoTimeToggleRow\"></div><input type=\"hidden\" id=\"studentLessonTimeToggleRowInput\"></div>'"
    ),
    (
        "        + '<div class=\"kinderInfoModalField\"><div class=\"modalLabel\">요일</div><div id=\"elementaryLessonDayToggleRow\" class=\"infoDayToggleRow\"></div></div>'",
        "        + '<div class=\"kinderInfoModalField\"><div class=\"modalLabel\">요일</div><div id=\"elementaryLessonDayToggleRow\" class=\"infoDayToggleRow\"></div></div>'\n        + '<div id=\"elementaryLessonTimeField\" class=\"kinderInfoModalField studentScheduleTimeField\"><div class=\"modalLabel\">시간</div><div id=\"elementaryLessonTimeToggleRow\" class=\"infoTimeToggleRow\"></div><input type=\"hidden\" id=\"elementaryLessonTimeToggleRowInput\"></div>'"
    ),
    (
        "        + '<div class=\"kinderInfoModalField\"><div class=\"modalLabel\">요일</div><div id=\"kinderLessonDayToggleRow\" class=\"infoDayToggleRow\"></div><input id=\"kinderLessonDayInput\" type=\"hidden\"></div>'",
        "        + '<div class=\"kinderInfoModalField\"><div class=\"modalLabel\">요일</div><div id=\"kinderLessonDayToggleRow\" class=\"infoDayToggleRow\"></div><input id=\"kinderLessonDayInput\" type=\"hidden\"></div>'\n        + '<div id=\"kinderLessonTimeField\" class=\"kinderInfoModalField studentScheduleTimeField\"><div class=\"modalLabel\">시간</div><div id=\"kinderLessonTimeToggleRow\" class=\"infoTimeToggleRow\"></div><input type=\"hidden\" id=\"kinderLessonTimeToggleRowInput\"></div>'"
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'markup anchor mismatch: {count} for {old[:110]!r}')
    text = text.replace(old, new, 1)

for required_id in [
    'elementaryStudentLessonTimeToggleRow',
    'studentLessonTimeToggleRow',
    'elementaryLessonTimeToggleRow',
    'kinderLessonTimeToggleRow',
]:
    if text.count(required_id) < 1:
        raise SystemExit(f'missing canonical time row: {required_id}')
ui.write_text(text)

index = Path('index.html')
text = index.read_text()
start_marker = '<script id="olliStudentScheduleTimeAndDocImportPatch">\n(function(){\n'
start = text.find(start_marker)
if start < 0:
    raise SystemExit('legacy time/doc patch start not found')
body_start = start + len(start_marker)
keep = text.find('  window.openStudentBulkImportFilePicker = function(){', body_start)
if keep < 0:
    raise SystemExit('bulk import preservation anchor not found')
legacy = text[body_start:keep]
for required in [
    'const oldPatchMarkup = window.olliPatchStudentModalMarkup;',
    'const oldPrepareAdd = window.olliPrepareStudentAddExtra;',
    'const oldGetAdd = window.olliGetStudentAddExtra;',
    'const oldPrepareInfo = window.olliPrepareInfoExtra;',
    'const oldGetInfo = window.olliGetInfoExtra;',
    'addAllTimeRows()'
]:
    if required not in legacy:
        raise SystemExit(f'legacy time wrapper safeguard missing: {required}')
replacement_start = '<script id="olliStudentDocImportPatch">\n(function(){\n'
text = text[:start] + replacement_start + text[keep:]
index.write_text(text)
