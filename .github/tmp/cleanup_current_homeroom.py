from pathlib import Path
import re


def read(path): return Path(path).read_text(encoding='utf-8')
def write(path, text): Path(path).write_text(text, encoding='utf-8')
def req(text, old, new, label, min_count=1):
    count = text.count(old)
    if count < min_count: raise RuntimeError(f'{label}: expected >= {min_count}, got {count}')
    return text.replace(old, new)

# 1) 학생 저장 스펙에서 legacy teacher columns 조회 제거
p='olli-storage-core.js'; s=read(p)
s=req(s, "'class_no', 'teacher', 'homeroom_teacher', 'status'", "'class_no', 'status'", 'storage select columns')
write(p,s)

# 2) 로컬 학생 모델에서 legacy teacher mirror 제거
p='olli-data-students.js'; s=read(p)
s,n=re.subn(r",\s*teacher:\s*'',\s*homeroom_teacher:\s*''", "", s)
if n<1: raise RuntimeError('data-students default teacher fields not found')
s,n=re.subn(r"\n\s*teacher:\s*item\?\.teacher \|\| item\?\.homeroom_teacher \|\| item\?\.teacher_name \|\| '',\n\s*homeroom_teacher:\s*item\?\.homeroom_teacher \|\| item\?\.teacher \|\| item\?\.teacher_name \|\| '',", "", s)
if n<1: raise RuntimeError('data-students normalized teacher fields not found')
write(p,s)

# 3) 학생 Supabase row/merge 경로에서 legacy teacher 제거
p='olli-data-student-operations.js'; s=read(p)
s,n=re.subn(r"\n\s*teacher:\s*row\.teacher \|\| row\.homeroom_teacher \|\| row\.teacher_name \|\| '',\n\s*homeroom_teacher:\s*row\.homeroom_teacher \|\| row\.teacher \|\| row\.teacher_name \|\| '',", "", s)
if n<1: raise RuntimeError('student-operations row teacher mapping not found')
s=s.replace("  'academy_name', 'academy_region', 'group_months', 'feedback_months',\n  'homeroom_teacher'\n", "  'academy_name', 'academy_region', 'group_months', 'feedback_months'\n")
s,n=re.subn(r"\n\s*teacher:\s*remote\.teacher \?\? local\.teacher \?\? remote\.homeroom_teacher \?\? local\.homeroom_teacher \?\? '',\n\s*homeroom_teacher:\s*remote\.homeroom_teacher \?\? local\.homeroom_teacher \?\? remote\.teacher \?\? local\.teacher \?\? '',", "", s)
if n<1: raise RuntimeError('student-operations merge teacher mapping not found')
old="function getStudentTeacherDisplay(student) {\n  return formatTeacherNameWithT(student?.teacher || student?.homeroom_teacher || student?.teacher_name || '');\n}"
new="function getStudentTeacherDisplay(student) {\n  return formatTeacherNameWithT(student?.__olli_timetable_teacher || '');\n}"
s=req(s,old,new,'current teacher display helper')
write(p,s)

# 4) 예전 학생정보 팝업 저장 경로에서도 수동 담임 필드 제거
p='olli-student-info-runtime.js'; s=read(p)
s,n=re.subn(r"\n\s*teacher:\s*Object\.prototype\.hasOwnProperty\.call\(extraInfo, 'teacher'\) \? extraInfo\.teacher : \(targetStudent\.teacher \|\| ''\),\n\s*homeroom_teacher:\s*Object\.prototype\.hasOwnProperty\.call\(extraInfo, 'homeroom_teacher'\) \? extraInfo\.homeroom_teacher : \(targetStudent\.homeroom_teacher \|\| ''\),?", "", s)
if n<2: raise RuntimeError(f'legacy student-info teacher save fields expected 2, got {n}')
write(p,s)

# 5) PC 학생정보 카드: current timetable teacher는 transient field 하나만 사용
p='pc-student-info-card-runtime.js'; s=read(p)
s=req(s,
"""    const authoritativeStudent = Object.assign({}, student, fields, {
      class_time: fields.lesson_time,
      teacher: timetableTeacher,
      homeroom_teacher: timetableTeacher,
      __olli_timetable_teacher: timetableTeacher,
      __olli_authoritative_enrollments: enrollments
    });""",
"""    const authoritativeStudent = Object.assign({}, student, fields, {
      class_time: fields.lesson_time,
      __olli_timetable_teacher: timetableTeacher,
      __olli_authoritative_enrollments: enrollments
    });""",
'pc transient current teacher')
s=s.replace("${clean(student.teacher || student.homeroom_teacher) ? '' : 'isEmpty'}", "${clean(student.__olli_timetable_teacher) ? '' : 'isEmpty'}")
s=s.replace("${esc(student.teacher || student.homeroom_teacher || '미지정')}", "${esc(student.__olli_timetable_teacher || '미지정')}")
s=s.replace("      delete profileBase.teacher;\n      delete profileBase.homeroom_teacher;\n", "")
write(p,s)

print('pc current homeroom cleanup complete')
