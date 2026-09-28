
/* 2026-07-03 patch: 학생정보 일괄 수정 문서 형식 유연화 */
(function(){
  function sbNorm(value){ return String(value == null ? '' : value).trim(); }
  function sbCompactName(value){ return sbNorm(value).replace(/\s+/g, ''); }
  function sbEscapeRegExp(value){ return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function sbUniqueByOrder(list, orderList){
    var seen = Object.create(null);
    var values = (Array.isArray(list) ? list : [])
      .map(function(v){ return sbNorm(v); })
      .filter(Boolean)
      .filter(function(v){ if (seen[v]) return false; seen[v] = true; return true; });
    if (Array.isArray(orderList) && orderList.length) {
      var order = Object.create(null);
      orderList.forEach(function(v, i){ order[v] = i + 1; });
      values.sort(function(a,b){ return (order[a] || 999) - (order[b] || 999); });
    }
    return values;
  }
  function sbJoinDays(){
    var all = [];
    Array.prototype.slice.call(arguments).forEach(function(value){
      sbNorm(value).split(/[·,\/|\s]+/).forEach(function(v){ if (v) all.push(v); });
    });
    return sbUniqueByOrder(all, ['월','화','수','목','금','토','일']).join('·');
  }
  function sbJoinTimes(){
    var all = [];
    Array.prototype.slice.call(arguments).forEach(function(value){
      sbNorm(value).split(/[·,\/|\s]+/).forEach(function(v){
        var m = v.match(/([1-7])\s*시/);
        if (m) all.push(Number(m[1]) + '시');
      });
    });
    return sbUniqueByOrder(all, ['1시','2시','3시','4시','5시','6시','7시']).join('·');
  }
  function sbStripDateLikeText(text){
    return sbNorm(text)
      .replace(/(20\d{2}|19\d{2})\s*[.\-\/년]\s*\d{1,2}\s*[.\-\/월]\s*\d{1,2}\s*일?/g, ' ')
      .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')
      .replace(/\d{1,2}\s*월(?!요일)/g, ' ')
      .replace(/\d{1,2}\s*일/g, ' ');
  }
  function sbExtractDays(text){
    var src = sbStripDateLikeText(text)
      .replace(/월요일/g, ' 월 ')
      .replace(/화요일/g, ' 화 ')
      .replace(/수요일/g, ' 수 ')
      .replace(/목요일/g, ' 목 ')
      .replace(/금요일/g, ' 금 ')
      .replace(/토요일/g, ' 토 ')
      .replace(/일요일/g, ' 일 ')
      .replace(/요일/g, ' ')
      .replace(/[()\[\]{}]/g, ' ');
    var days = [];
    var re = /(^|[\s,\/|·:;\-~])([월화수목금토일]{1,7})(?=$|[\s,\/|·:;\-~])/g;
    var m;
    while ((m = re.exec(src)) !== null) {
      String(m[2] || '').split('').forEach(function(d){ if ('월화수목금토일'.indexOf(d) >= 0) days.push(d); });
    }
    return sbUniqueByOrder(days, ['월','화','수','목','금','토','일']).join('·');
  }
  function sbExtractTimes(text){
    var src = sbNorm(text);
    var times = [];
    var re = /(?:오후\s*)?([1-7])\s*(?:시|:00)(?!\d)/g;
    var m;
    while ((m = re.exec(src)) !== null) times.push(Number(m[1]) + '시');
    return sbUniqueByOrder(times, ['1시','2시','3시','4시','5시','6시','7시']).join('·');
  }
  function sbExtractSchedule(text){
    return { lesson_day: sbExtractDays(text), class_time: sbExtractTimes(text) };
  }
  function sbScheduleHasValue(s){ return !!(s && (sbNorm(s.lesson_day) || sbNorm(s.class_time))); }
  function sbMergeSchedule(a, b){
    return {
      lesson_day: sbJoinDays(a && a.lesson_day, b && b.lesson_day),
      class_time: sbJoinTimes(a && a.class_time, b && b.class_time)
    };
  }
  function sbIsHeaderOrGuideLine(line){
    var raw = sbNorm(line);
    var compact = raw.replace(/\s+/g, '');
    if (!compact) return true;
    if (/^(예시|샘플|입력예시|학생이름|이름|구분|학교|학년|반|그룹|요일|시간|담임|등록일|나이|유치원|원생명|학생명)$/.test(compact)) return true;
    if (/^(초등부|유치부)?학생(등원|수업)?(요일|시간|명단|리스트)?$/.test(compact)) return true;
    if (/^(초등부|유치부)(학생)?(등원|수업)?(시간|요일|명단|리스트)$/.test(compact)) return true;
    if (/후보|반영|선택|삭제|등록가능|수정후보|일괄수정/.test(compact)) return true;
    return false;
  }
  function sbGetActiveStudents(){
    try {
      return (typeof getAllStudents === 'function' ? getAllStudents() : [])
        .filter(function(s){ return !s || typeof getStudentStatus !== 'function' ? true : getStudentStatus(s) === 'active'; })
        .filter(function(s){ return sbNorm(s && s.name); })
        .sort(function(a,b){ return sbCompactName(b.name).length - sbCompactName(a.name).length; });
    } catch(e) { return []; }
  }
  function sbFindKnownStudentsInText(text){
    var src = sbCompactName(text);
    if (!src) return [];
    var result = [];
    var students = sbGetActiveStudents();
    students.forEach(function(student){
      var name = sbCompactName(student.name);
      if (!name) return;
      if (src.indexOf(name) >= 0) result.push(student);
    });
    var seen = Object.create(null);
    return result.filter(function(student){
      var key = String(student.id || '') || (sbCompactName(student.name) + '|' + (student.type || ''));
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }
  function sbExtractPotentialNames(text, schedule){
    var raw = sbNorm(text);
    if (!raw || sbIsHeaderOrGuideLine(raw)) return [];
    if (!sbScheduleHasValue(schedule)) return [];
    var clean = raw
      .replace(/(20\d{2}|19\d{2})\s*[.\-\/년]\s*\d{1,2}\s*[.\-\/월]\s*\d{1,2}\s*일?/g, ' ')
      .replace(/(?:오후\s*)?[1-7]\s*(?:시|:00)/g, ' ')
      .replace(/월요일|화요일|수요일|목요일|금요일|토요일|일요일|요일/g, ' ')
      .replace(/[월화수목금토일]{1,7}/g, ' ')
      .replace(/초등부|유치부|초등|유치|유아|학생|원생|이름|학교|학년|유치원|나이|담임|선생님|선생|그룹|반|시간|등원|수업|기준/g, ' ');
    var names = [];
    clean.split(/[\s,\/|·:;\-~]+/).forEach(function(token){
      var t = sbNorm(token).replace(/[^가-힣]/g, '');
      if (/^[가-힣]{2,5}$/.test(t) && !sbIsHeaderOrGuideLine(t)) names.push(t);
    });
    return sbUniqueByOrder(names, []);
  }
  function sbGroupDisplayFromStudent(student){
    var raw = sbNorm(student && (student.group || student.groupName || student.group_no || ''));
    if (/^[1-6]$/.test(raw)) return {1:'A',2:'B',3:'C',4:'D',5:'E',6:'F'}[raw] || '';
    return typeof normalizeAttendancePhotoGroup === 'function' ? normalizeAttendancePhotoGroup(raw) : raw;
  }
  function sbStudentEnrolledAt(student){
    if (!student) return '';
    if (student.enrolled_at) return sbNorm(student.enrolled_at);
    var y = sbNorm(student.year), m = sbNorm(student.month), d = sbNorm(student.day);
    if (y && m && d) return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    return '';
  }
  function sbCandidateFromKnownStudent(student, schedule, index, note){
    var division = typeof normalizeAttendancePhotoDivision === 'function' ? normalizeAttendancePhotoDivision(student && student.type) : (student && student.type) || 'elementary';
    var item = typeof normalizeAttendancePhotoImportCandidate === 'function'
      ? normalizeAttendancePhotoImportCandidate({
          id: 'bulk_known_' + (student.id || sbCompactName(student.name)) + '_' + index,
          selected: true,
          name: student.name || '',
          division: division,
          school: student.school || student.school_name || '',
          grade: student.grade || student.school_grade || '',
          className: student.className || student.class_no || student.class || '',
          kindergarten: student.kindergarten || student.kindergarten_name || '',
          age: student.age || '',
          lesson_day: schedule && schedule.lesson_day || '',
          class_time: schedule && schedule.class_time || '',
          group: sbGroupDisplayFromStudent(student),
          teacher: (typeof getStudentTeacherDisplay === 'function' ? getStudentTeacherDisplay(student) : (student.teacher || student.homeroom_teacher || '')).replace(/T$/i, ''),
          enrolled_at: sbStudentEnrolledAt(student),
          confidence: 1,
          note: note || '문서에서 기존 학생명을 찾아 수정 후보로 만들었습니다.'
        }, index)
      : {};
    item.existing_student_id = student.id || '';
    item.selected = true;
    item.note = note || item.note || '';
    return item;
  }
  function sbCandidateFromUnknownName(name, schedule, division, index, note){
    var item = typeof normalizeAttendancePhotoImportCandidate === 'function'
      ? normalizeAttendancePhotoImportCandidate({
          id: 'bulk_unknown_' + Date.now() + '_' + index + '_' + Math.random().toString(36).slice(2, 7),
          selected: true,
          name: name,
          division: division || (studentBulkImportState && studentBulkImportState.division) || 'elementary',
          lesson_day: schedule && schedule.lesson_day || '',
          class_time: schedule && schedule.class_time || '',
          confidence: 0.8,
          note: note || '앱에 같은 이름의 재원생이 없어 신규 후보로 표시했습니다.'
        }, index)
      : { name: name, lesson_day: schedule.lesson_day, class_time: schedule.class_time, division: division || 'elementary', selected: true };
    item.note = note || item.note || '';
    return item;
  }
  function sbCandidateKey(item){
    if (item && item.existing_student_id) return 'id:' + item.existing_student_id;
    return 'name:' + sbCompactName(item && item.name) + '|' + (typeof normalizeAttendancePhotoDivision === 'function' ? normalizeAttendancePhotoDivision(item && item.division) : (item && item.division || 'elementary'));
  }
  function sbAddCandidate(map, item){
    if (!item || !sbNorm(item.name)) return;
    var key = sbCandidateKey(item);
    var prev = map.get(key);
    if (!prev) { map.set(key, item); return; }
    prev.lesson_day = sbJoinDays(prev.lesson_day, item.lesson_day);
    prev.class_time = sbJoinTimes(prev.class_time, item.class_time);
    prev.note = sbUniqueByOrder([prev.note, item.note].filter(Boolean), []).join(' / ');
    ['school','grade','className','kindergarten','age','group','teacher','enrolled_at','year','month','day'].forEach(function(field){
      if (!sbNorm(prev[field]) && sbNorm(item[field])) prev[field] = item[field];
    });
    prev.selected = prev.selected !== false || item.selected !== false;
  }
  function sbLineCells(line){
    var raw = String(line || '');
    if (raw.indexOf('\t') >= 0) return raw.split('\t').map(function(v){ return sbNorm(v); });
    if (raw.indexOf('|') >= 0) return raw.split('|').map(function(v){ return sbNorm(v); });
    return [sbNorm(raw)];
  }
  function sbCellLooksLikeScheduleHeader(cell){
    var s = sbExtractSchedule(cell);
    return sbScheduleHasValue(s) && sbFindKnownStudentsInText(cell).length === 0 && sbExtractPotentialNames(cell, s).length === 0;
  }
  function sbLineLooksLikeContextOnly(line){
    var schedule = sbExtractSchedule(line);
    if (!sbScheduleHasValue(schedule)) return false;
    if (sbFindKnownStudentsInText(line).length) return false;
    if (sbExtractPotentialNames(line, schedule).length) return false;
    var stripped = sbNorm(line)
      .replace(/월요일|화요일|수요일|목요일|금요일|토요일|일요일/g, '')
      .replace(/[월화수목금토일]/g, '')
      .replace(/(?:오후\s*)?[1-7]\s*(?:시|:00)/g, '')
      .replace(/[\s,\/|·:;\-~()\[\]{}]/g, '');
    return !stripped || /^(초등부|유치부|초등|유치|시간표|등원|수업|시간|요일)$/.test(stripped);
  }
  function sbParseCellsAsTable(cells, columnContexts, rowIndex, map, fallbackContext){
    var joined = cells.join(' ');
    var rowSchedule = sbExtractSchedule(joined);
    var rowContext = sbMergeSchedule(fallbackContext || {}, rowSchedule || {});
    var rowKnown = sbFindKnownStudentsInText(joined);
    if (rowKnown.length) {
      var schedule = rowContext;
      if (!sbScheduleHasValue(schedule)) {
        cells.forEach(function(cell, i){ schedule = sbMergeSchedule(schedule, columnContexts && columnContexts[i]); });
      }
      rowKnown.forEach(function(student, n){ sbAddCandidate(map, sbCandidateFromKnownStudent(student, schedule, rowIndex + '_' + n)); });
    }
    cells.forEach(function(cell, i){
      var columnContext = columnContexts && columnContexts[i] ? columnContexts[i] : {};
      var cellSchedule = sbExtractSchedule(cell);
      var schedule = sbMergeSchedule(rowContext, sbMergeSchedule(columnContext, cellSchedule));
      var known = sbFindKnownStudentsInText(cell);
      known.forEach(function(student, n){ sbAddCandidate(map, sbCandidateFromKnownStudent(student, schedule, rowIndex + '_' + i + '_' + n)); });
      if (!known.length) {
        sbExtractPotentialNames(cell, schedule).forEach(function(name, n){
          sbAddCandidate(map, sbCandidateFromUnknownName(name, schedule, (studentBulkImportState && studentBulkImportState.division) || 'elementary', rowIndex + '_' + i + '_' + n));
        });
      }
    });
  }
  function sbParseBulkTextFlexible(rawText){
    var lines = String(rawText || '')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(function(line){ return line.replace(/[\u00a0\u200b]/g, ' ').trim(); })
      .filter(Boolean);
    var map = new Map();
    var currentContext = { lesson_day: '', class_time: '' };
    var columnContexts = null;
    lines.forEach(function(line, rowIndex){
      if (!line || /^#/.test(line)) return;
      var cells = sbLineCells(line).filter(function(cell){ return cell !== ''; });
      var joined = cells.join(' ');
      if (sbIsHeaderOrGuideLine(joined) && !cells.some(sbCellLooksLikeScheduleHeader)) return;
      var scheduleCells = cells.map(sbExtractSchedule);
      var scheduleHeaderCount = scheduleCells.filter(sbScheduleHasValue).length;
      var knownCount = sbFindKnownStudentsInText(joined).length;
      var potentialCount = sbExtractPotentialNames(joined, sbExtractSchedule(joined)).length;
      if (cells.length > 1 && scheduleHeaderCount >= 2 && knownCount === 0 && potentialCount === 0) {
        columnContexts = scheduleCells;
        return;
      }
      if (sbLineLooksLikeContextOnly(joined)) {
        currentContext = sbExtractSchedule(joined);
        return;
      }
      if (cells.length > 1 && columnContexts) {
        sbParseCellsAsTable(cells, columnContexts, rowIndex, map, currentContext);
        return;
      }
      var ownLineSchedule = sbExtractSchedule(joined);
      var lineSchedule = sbScheduleHasValue(ownLineSchedule) ? ownLineSchedule : currentContext;
      var known = sbFindKnownStudentsInText(joined);
      if (known.length) {
        known.forEach(function(student, n){ sbAddCandidate(map, sbCandidateFromKnownStudent(student, lineSchedule, rowIndex + '_' + n)); });
      } else {
        sbExtractPotentialNames(joined, lineSchedule).forEach(function(name, n){
          sbAddCandidate(map, sbCandidateFromUnknownName(name, lineSchedule, (studentBulkImportState && studentBulkImportState.division) || 'elementary', rowIndex + '_' + n));
        });
      }
    });
    return Array.from(map.values()).filter(function(item){ return sbNorm(item.name) && (sbNorm(item.lesson_day) || sbNorm(item.class_time)); });
  }
  async function sbExtractDocxTextPreservingTables(file){
    if (typeof loadExistingFeedbackJSZip !== 'function' || typeof readFileAsArrayBufferForExistingFeedback !== 'function') {
      if (typeof extractDocxTextForExistingFeedback === 'function') return await extractDocxTextForExistingFeedback(file);
      throw new Error('docx를 읽을 수 있는 함수가 없습니다.');
    }
    try {
      var JSZipLib = await loadExistingFeedbackJSZip();
      var buffer = await readFileAsArrayBufferForExistingFeedback(file);
      var zip = await JSZipLib.loadAsync(buffer);
      var doc = zip.files && zip.files['word/document.xml'];
      if (!doc) throw new Error('docx 본문 XML을 찾지 못했습니다.');
      var xml = await doc.async('text');
      var tableRows = [];
      var tableRegex = /<w:tbl[\s\S]*?<\/w:tbl>/g;
      xml.replace(tableRegex, function(tbl){
        tbl.replace(/<w:tr[\s\S]*?<\/w:tr>/g, function(tr){
          var cells = [];
          tr.replace(/<w:tc[\s\S]*?<\/w:tc>/g, function(tc){
            var text = typeof extractExistingFeedbackTextFromDocxXml === 'function'
              ? extractExistingFeedbackTextFromDocxXml(tc)
              : tc.replace(/<[^>]+>/g, ' ');
            text = sbNorm(text.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' '));
            cells.push(text);
            return '';
          });
          if (cells.some(Boolean)) tableRows.push(cells.join('\t'));
          return '';
        });
        return '';
      });
      var nonTableXml = xml.replace(tableRegex, '\n');
      var paragraphText = typeof extractExistingFeedbackTextFromDocxXml === 'function'
        ? extractExistingFeedbackTextFromDocxXml(nonTableXml)
        : nonTableXml.replace(/<[^>]+>/g, ' ');
      var combined = tableRows.concat(sbNorm(paragraphText) ? [sbNorm(paragraphText)] : []).join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (combined) return combined;
    } catch(err) {
      console.warn('학생정보 일괄 수정용 docx 표 추출 실패:', err && (err.message || err));
    }
    if (typeof extractDocxTextForExistingFeedback === 'function') return await extractDocxTextForExistingFeedback(file);
    throw new Error('docx 파일을 읽지 못했습니다.');
  }
  window.getStudentBulkImportPlaceholder = function(){
    return '문서 형식이 달라도 괜찮아요.\n학생 이름 주변의 요일과 시간을 읽어 수정 후보를 만듭니다.\n\n예시 형식은 꼭 맞출 필요 없습니다.\n월요일 4시: 김민준, 이서윤\n화 5시 박하윤\n김민준 월·수 4시';
  };
  window.renderSettingsStudentBulkImport = function(){
    return '<div class="settingsInfoCard studentBulkImportPanel">'
      + '<div class="settingsInfoHead">요일·시간 일괄 수정</div>'
      + '<div class="studentBulkImportGuide">정해진 양식이 아니어도 됩니다. 독스 표, 일반 문장, 복사한 시간표에서 기존 학생 이름을 먼저 찾고, 이름 주변의 요일·시간만 수정 후보로 만듭니다.</div>'
      + '<textarea id="studentBulkImportText" class="studentBulkImportTextarea" oninput="updateStudentBulkImportText(this.value)" placeholder="' + settingsEscapeAttr(window.getStudentBulkImportPlaceholder()) + '">' + settingsEscapeHtml(studentBulkImportState.rawText || '') + '</textarea>'
      + '<div class="studentBulkImportGuide">파일 업로드 후 이상하게 읽힌 항목은 자동 저장되지 않습니다. 아래 후보 목록에서 확인한 뒤 반영해 주세요.</div>'
      + '<div class="attendancePhotoActionGrid"><button class="settingsActionBtn" type="button" onclick="openStudentBulkImportFilePicker()">독스 파일 업로드</button><button class="settingsActionBtn primary" type="button" onclick="parseStudentBulkImportText()">수정 후보 만들기</button><button class="settingsActionBtn" type="button" onclick="clearStudentBulkImportText()">입력 지우기</button></div>'
      + '</div>'
      + renderStudentBulkImportResults();
  };
  window.parseStudentBulkImportText = function(){
    var text = String(studentBulkImportState.rawText || '');
    if (!text.trim()) {
      studentBulkImportState.candidates = [];
      studentBulkImportState.errorMessage = '문서를 업로드하거나 시간표 내용을 붙여 넣어 주세요.';
      refreshSettingsAttendancePhotoImportDetail();
      return;
    }
    var candidates = sbParseBulkTextFlexible(text);
    studentBulkImportState.candidates = candidates;
    studentBulkImportState.errorMessage = candidates.length ? '' : '학생 이름과 요일·시간을 찾지 못했어요. 문서에 학생 이름과 등원 요일/시간이 함께 있는지 확인해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
  };
  window.renderStudentBulkCandidateCard = function(candidate, index){
    var dup = typeof getAttendancePhotoDuplicateInfo === 'function' ? getAttendancePhotoDuplicateInfo(candidate) : { type: '', label: '' };
    var existing = dup && dup.type === 'dup';
    var badgeClass = existing ? ' dup' : (dup && dup.type ? ' ' + dup.type : '');
    var badgeLabel = existing ? '기존 학생 수정' : '신규 후보';
    var division = typeof normalizeAttendancePhotoDivision === 'function' ? normalizeAttendancePhotoDivision(candidate.division) : candidate.division;
    var isKinder = division === 'kinder';
    var metaFields = isKinder
      ? renderStudentBulkCandidateField(index, 'kindergarten', '유치원', candidate.kindergarten)
        + renderStudentBulkCandidateField(index, 'age', '나이', candidate.age)
      : renderStudentBulkCandidateField(index, 'school', '학교', candidate.school)
        + renderStudentBulkCandidateField(index, 'grade', '학년', candidate.grade)
        + renderStudentBulkCandidateField(index, 'className', '반', candidate.className)
        + renderStudentBulkCandidateField(index, 'group', '그룹', candidate.group);
    var noteHtml = candidate.note ? '<div class="studentBulkCandidateNote">' + settingsEscapeHtml(candidate.note) + '</div>' : '';
    return '<div class="studentBulkCandidateCard">'
      + '<div class="studentBulkCandidateTop">'
      + '<label class="studentBulkCandidateCheck"><input type="checkbox" ' + (candidate.selected ? 'checked' : '') + ' onchange="toggleStudentBulkCandidate(' + index + ',this.checked)">반영 선택</label>'
      + '<span class="studentBulkCandidateTopRight"><span class="attendancePhotoCandidateBadge' + badgeClass + '">' + settingsEscapeHtml(badgeLabel) + '</span><button class="studentBulkCandidateDeleteBtn danger" type="button" onclick="removeStudentBulkCandidate(' + index + ')">삭제</button></span>'
      + '</div>'
      + noteHtml
      + '<div class="studentBulkCandidateGrid">'
      + renderStudentBulkCandidateField(index, 'name', '이름', candidate.name)
      + renderStudentBulkCandidateField(index, 'division', '구분', candidate.division, { type: 'select' })
      + metaFields
      + renderStudentBulkCandidateField(index, 'lesson_day', '요일', candidate.lesson_day)
      + renderStudentBulkCandidateField(index, 'class_time', '시간', candidate.class_time)
      + renderStudentBulkCandidateField(index, 'teacher', '담임', candidate.teacher)
      + renderStudentBulkCandidateField(index, 'enrolled_at', '등록일', candidate.enrolled_at)
      + '</div>'
      + '</div>';
  };
  window.handleStudentBulkImportFileChange = async function(event){
    var file = event && event.target && event.target.files ? event.target.files[0] : null;
    if (!file) return;
    try {
      studentBulkImportState.errorMessage = '';
      studentBulkImportState.candidates = [];
      var text = '';
      if (typeof isExistingFeedbackDocxFile === 'function' && isExistingFeedbackDocxFile(file)) text = await sbExtractDocxTextPreservingTables(file);
      else if (typeof readFileAsTextForExistingFeedback === 'function') text = await readFileAsTextForExistingFeedback(file);
      else text = await file.text();
      if (!text || !String(text).trim()) throw new Error('파일에서 읽을 수 있는 텍스트가 없습니다.');
      if (typeof updateStudentBulkImportText === 'function') updateStudentBulkImportText(text);
      var textarea = document.getElementById('studentBulkImportText');
      if (textarea) textarea.value = text;
      window.parseStudentBulkImportText();
      if (typeof showPushToast === 'function') showPushToast('파일을 읽고 수정 후보를 만들었어요. 후보 목록을 확인해 주세요.');
    } catch(err) {
      studentBulkImportState.errorMessage = err && err.message ? err.message : String(err);
      if (typeof refreshSettingsAttendancePhotoImportDetail === 'function') refreshSettingsAttendancePhotoImportDetail();
      else alert('파일 읽기 실패\n' + (err && err.message ? err.message : err));
    } finally {
      if (event && event.target) event.target.value = '';
    }
  };
  try {
    getStudentBulkImportPlaceholder = window.getStudentBulkImportPlaceholder;
    renderSettingsStudentBulkImport = window.renderSettingsStudentBulkImport;
    parseStudentBulkImportText = window.parseStudentBulkImportText;
    renderStudentBulkCandidateCard = window.renderStudentBulkCandidateCard;
  } catch(e) {}
})();
