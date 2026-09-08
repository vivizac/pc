from pathlib import Path

p = Path('pc-student-info-card-runtime.js')
s = p.read_text(encoding='utf-8')

old = """    const rows = Array.isArray(student && student.__olli_authoritative_enrollments)
      ? student.__olli_authoritative_enrollments
      : pairsFromLessonFields(student && student.lesson_day, student && (student.lesson_time || student.class_time));"""
new = """    const rows = Array.isArray(student && student.__olli_authoritative_enrollments)
      ? student.__olli_authoritative_enrollments
      : [];"""
if old not in s:
    raise RuntimeError('PC existing-student schedule fallback block not found')
s = s.replace(old, new, 1)

old = """      const pairs = typeof global.olliGetInfoSchedulePairs === 'function'
        ? global.olliGetInfoSchedulePairs(division)
        : pairsFromLessonFields(extra.lesson_day, extra.lesson_time || extra.class_time);"""
new = """      if (typeof global.olliGetInfoSchedulePairs !== 'function') {
        throw new Error('학생 시간표 편집기가 준비되지 않았습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
      }
      const pairs = global.olliGetInfoSchedulePairs(division);"""
if old not in s:
    raise RuntimeError('PC save schedule fallback block not found')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('PC student schedule source cleanup complete')
