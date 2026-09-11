from pathlib import Path

path = Path('pc-timetable.js')
text = path.read_text(encoding='utf-8')

marker = "global.addEventListener('olli:realtime-change',"
if marker not in text:
    anchor = """    document.addEventListener('visibilitychange', () => {\n      if (!document.hidden) checkLiveScheduleSync(true);\n    });\n  }\n"""
    replacement = """    document.addEventListener('visibilitychange', () => {\n      if (!document.hidden) checkLiveScheduleSync(true);\n    });\n    global.addEventListener('olli:realtime-change', (event) => {\n      const detail = event && event.detail ? event.detail : {};\n      if (clean(detail.domain).toLowerCase() !== 'schedule') return;\n      const academyId = currentSyncAcademyId();\n      if (!academyId) return;\n      if (clean(detail.academyId) && clean(detail.academyId) !== academyId) return;\n      checkLiveScheduleSync(true);\n    });\n  }\n"""
    if anchor not in text:
        raise SystemExit('PC timetable realtime anchor not found')
    text = text.replace(anchor, replacement, 1)

path.write_text(text, encoding='utf-8')
print('PC timetable realtime listener enabled.')
