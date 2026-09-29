
document.addEventListener('DOMContentLoaded', function(){
  try {
    const current = getAllStudents();
    let changed = false;
    const next = current.map(function(student){
      const result = applyOlliStudentLifecycle(student, new Date());
      if (result.changed) changed = true;
      return result.student;
    });
    if (changed) setAllStudents(next);
  } catch (err) {
    console.warn('학생 연도 자동 갱신 초기화 보류:', err?.message || err);
  }
});
