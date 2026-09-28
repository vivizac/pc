function formatExistingFeedbackImportFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return '';
  if (size < 1024) return size + 'B';
  if (size < 1024 * 1024) return Math.round(size / 1024) + 'KB';
  return (size / 1024 / 1024).toFixed(1) + 'MB';
}

function openExistingFeedbackImportPicker() {
  const input = document.getElementById('existingFeedbackImportInput');
  if (input) input.click();
}

function isExistingFeedbackTextReadableFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(name);
}


function isExistingFeedbackDocxFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return /\.docx$/i.test(name) || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function readFileAsArrayBufferForExistingFeedback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

function decodeExistingFeedbackXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractExistingFeedbackTextFromDocxXml(xmlText) {
  const xml = String(xmlText || '');
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  const lines = paragraphs.map(paragraph => {
    const chunks = [];
    paragraph.replace(/<w:tab\s*\/?\s*>/g, '\t')
      .replace(/<w:br\s*\/?\s*>/g, '\n')
      .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, value) => {
        chunks.push(decodeExistingFeedbackXmlEntities(value));
        return '';
      });
    return chunks.join('').trim();
  }).filter(Boolean);

  if (lines.length) return lines.join('\n');

  return decodeExistingFeedbackXmlEntities(
    xml
      .replace(/<w:tab\s*\/?\s*>/g, '\t')
      .replace(/<w:br\s*\/?\s*>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

async function inflateExistingFeedbackZipEntry(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error('지원하지 않는 docx 압축 방식입니다.');
  if (typeof DecompressionStream !== 'function') {
    throw new Error('이 브라우저에서는 docx 압축 해제가 지원되지 않습니다. txt로 저장해 다시 업로드해 주세요.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function findExistingFeedbackZipEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 66000);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}


let existingFeedbackJSZipLoadPromise = null;
function loadExistingFeedbackJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (existingFeedbackJSZipLoadPromise) return existingFeedbackJSZipLoadPromise;
  existingFeedbackJSZipLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    script.async = true;
    script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip 로드에 실패했습니다.'));
    script.onerror = () => reject(new Error('JSZip 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
  return existingFeedbackJSZipLoadPromise;
}

async function extractDocxTextWithJSZipForExistingFeedback(file) {
  const JSZipLib = await loadExistingFeedbackJSZip();
  const buffer = await readFileAsArrayBufferForExistingFeedback(file);
  const zip = await JSZipLib.loadAsync(buffer);
  const xmlNames = Object.keys(zip.files || {}).filter(name => {
    return /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name);
  });
  const orderedNames = [
    'word/document.xml',
    ...xmlNames.filter(name => name !== 'word/document.xml').sort()
  ].filter((name, index, arr) => zip.files[name] && arr.indexOf(name) === index);
  if (!orderedNames.length) throw new Error('docx 안에서 본문 XML을 찾지 못했습니다.');
  const parts = [];
  for (const name of orderedNames) {
    const xml = await zip.files[name].async('text');
    const extracted = extractExistingFeedbackTextFromDocxXml(xml).trim();
    if (extracted) parts.push(extracted);
  }
  const text = parts.join('\n\n')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new Error('docx에서 텍스트를 찾지 못했습니다.');
  return text;
}

async function extractDocxTextForExistingFeedback(file) {
  try {
    return await extractDocxTextWithJSZipForExistingFeedback(file);
  } catch (jsZipErr) {
    console.warn('JSZip docx 추출 실패, 기본 추출로 재시도:', jsZipErr && (jsZipErr.message || jsZipErr));
  }
  const buffer = await readFileAsArrayBufferForExistingFeedback(file);
  const view = new DataView(buffer);
  const eocdOffset = findExistingFeedbackZipEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error('docx 파일 구조를 읽지 못했습니다. 파일이 손상되었거나 docx 형식이 아닙니다.');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  let offset = centralOffset;
  const decoder = new TextDecoder('utf-8');
  const preferredNames = new Set(['word/document.xml', 'word/header1.xml', 'word/footer1.xml']);
  const entries = [];

  for (let i = 0; i < entryCount && offset + 46 <= view.byteLength; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = new Uint8Array(buffer, offset + 46, nameLength);
    const name = decoder.decode(nameBytes);
    if (preferredNames.has(name)) {
      entries.push({ name, method, compressedSize, localHeaderOffset });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  const documentEntry = entries.find(entry => entry.name === 'word/document.xml') || entries[0];
  if (!documentEntry) throw new Error('docx 안에서 본문 XML을 찾지 못했습니다.');

  const localOffset = documentEntry.localHeaderOffset;
  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('docx 본문 위치를 읽지 못했습니다.');
  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const compressed = new Uint8Array(buffer, dataStart, documentEntry.compressedSize);
  const inflated = await inflateExistingFeedbackZipEntry(compressed, documentEntry.method);
  const xmlText = decoder.decode(inflated);
  const text = extractExistingFeedbackTextFromDocxXml(xmlText)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) throw new Error('docx에서 텍스트를 찾지 못했습니다.');
  return text;
}

function readFileAsTextForExistingFeedback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsText(file, 'utf-8');
  });
}

function readFileAsDataUrlForExistingFeedback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

async function handleExistingFeedbackImportChange(event) {
  const file = event?.target?.files && event.target.files[0] ? event.target.files[0] : null;
  if (!file) return;
  existingFeedbackImportState.fileName = file.name || '기존 피드백 파일';
  existingFeedbackImportState.fileSize = file.size || 0;
  existingFeedbackImportState.fileType = file.type || '';
  existingFeedbackImportState.fileText = '';
  existingFeedbackImportState.fileDataUrl = '';
  existingFeedbackImportState.rawReply = '';
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.statusMessage = '파일을 준비하고 있어요.';
  refreshSettingsAttendancePhotoImportDetail();
  try {
    if (isExistingFeedbackTextReadableFile(file)) {
      existingFeedbackImportState.fileText = await readFileAsTextForExistingFeedback(file);
      existingFeedbackImportState.statusMessage = '파일을 읽었습니다. 피드백 분석하기를 누르면 AI가 학생별 기록으로 정리합니다.';
    } else if (isExistingFeedbackDocxFile(file)) {
      try {
        existingFeedbackImportState.fileText = await extractDocxTextForExistingFeedback(file);
        existingFeedbackImportState.fileDataUrl = '';
        existingFeedbackImportState.statusMessage = 'docx에서 텍스트를 추출했습니다. 피드백 분석하기를 누르면 AI가 학생별 기록으로 정리합니다.';
      } catch (docxErr) {
        existingFeedbackImportState.fileText = '';
        existingFeedbackImportState.fileDataUrl = '';
        existingFeedbackImportState.statusMessage = '';
        existingFeedbackImportState.errorMessage = 'docx 본문 텍스트를 읽지 못했습니다. 파일을 다시 선택하거나, Google Docs에서 txt로 내려받아 업로드해 주세요. (' + String(docxErr && (docxErr.message || docxErr) || 'docx 텍스트 추출 실패') + ')';
      }
    } else {
      existingFeedbackImportState.fileDataUrl = await readFileAsDataUrlForExistingFeedback(file);
      existingFeedbackImportState.statusMessage = '문서 파일을 준비했습니다. 피드백 분석하기를 누르면 API로 문서를 보내 분석합니다.';
    }
  } catch (err) {
    existingFeedbackImportState.errorMessage = String(err && (err.message || err) || '파일을 읽지 못했어요.');
    existingFeedbackImportState.statusMessage = '';
  } finally {
    refreshSettingsAttendancePhotoImportDetail();
    if (event?.target) event.target.value = '';
  }
}

function clearExistingFeedbackImportFile() {
  existingFeedbackImportState.fileName = '';
  existingFeedbackImportState.fileSize = 0;
  existingFeedbackImportState.fileType = '';
  existingFeedbackImportState.fileText = '';
  existingFeedbackImportState.fileDataUrl = '';
  existingFeedbackImportState.rawReply = '';
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.statusMessage = '';
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.analyzing = false;
  existingFeedbackImportState.importRunning = false;
  refreshSettingsAttendancePhotoImportDetail();
}

function buildExistingFeedbackImportPromptText() {
  return '기존 피드백 파일을 학생별, 날짜별, 피드백별로 분리해 주세요.\n\n'
    + '반드시 JSON만 응답하세요. 설명 문장은 쓰지 마세요.\n\n'
    + '응답 형식:\n'
    + '{\n'
    + '  "feedbacks": [\n'
    + '    {\n'
    + '      "student_name": "학생 이름",\n'
    + '      "division": "elementary 또는 kinder. 알 수 없으면 빈 문자열",\n'
    + '      "date": "YYYY-MM-DD. 날짜가 없으면 빈 문자열",\n'
    + '      "date_label": "원문에 적힌 날짜/주차 표현",\n'
    + '      "feedback_type": "general",\n'
    + '      "content": "피드백 본문",\n'
    + '      "note": "확인이 필요한 내용"\n'
    + '    }\n'
    + '  ]\n'
    + '}\n\n'
    + '규칙:\n'
    + '- 학생 이름 단위로 묶인 기존 피드백을 각각 분리합니다.\n'
    + '- 날짜가 명확하면 YYYY-MM-DD로 변환합니다. 날짜가 불명확하면 date는 빈 문자열로 두고 date_label에 원문 표현을 남깁니다.\n'
    + '- 매주 작성된 일반 피드백은 feedback_type을 general로 둡니다.\n'
    + '- 학생 이름이 불확실하거나 날짜가 불확실하면 note에 확인 필요라고 적습니다.\n'
    + '- 피드백 본문은 원문 의미를 바꾸지 말고 그대로 유지합니다.\n'
    + '- 한 학생에게 여러 개의 피드백이 있으면 feedbacks 배열에 각각 따로 넣습니다.';
}

function normalizeExistingFeedbackDivision(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (/유치|kinder|kindergarten|5세|6세|7세/.test(raw)) return 'kinder';
  if (/초등|elementary|초\s*\d|\d\s*학년|학년/.test(raw)) return 'elementary';
  return '';
}

function normalizeExistingFeedbackDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (direct) {
    const year = Number(direct[1]);
    const month = Number(direct[2]);
    const day = Number(direct[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return raw;
}

function extractExistingFeedbackJsonText(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) text = fenced[1].trim();
  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
    return text.slice(firstObject, lastObject + 1);
  }
  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    return text.slice(firstArray, lastArray + 1);
  }
  return text;
}

function parseExistingFeedbackImportReply(raw) {
  const jsonText = extractExistingFeedbackJsonText(raw);
  if (!jsonText) return [];
  let parsed = null;
  try { parsed = JSON.parse(jsonText); } catch (err) {
    console.warn('기존 피드백 JSON 파싱 실패:', err);
    return [];
  }
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.feedbacks)) return parsed.feedbacks;
  if (Array.isArray(parsed.items)) return parsed.items;
  if (Array.isArray(parsed.results)) return parsed.results;
  return [];
}

function getExistingFeedbackActiveStudents() {
  return getAllStudents().filter(student => getStudentStatus(student) === 'active');
}

function findExistingFeedbackMatchedStudent(candidate) {
  const name = String(candidate?.student_name || '').trim();
  if (!name) return null;
  const division = normalizeExistingFeedbackDivision(candidate?.division || '');
  let matches = getExistingFeedbackActiveStudents().filter(student => String(student.name || '').trim() === name);
  if (division) matches = matches.filter(student => normalizeAttendancePhotoDivision(student.type) === division);
  return matches.length === 1 ? matches[0] : null;
}

function getExistingFeedbackStudentOptionLabel(student) {
  const division = normalizeAttendancePhotoDivision(student?.type) === 'kinder' ? '유치부' : '초등부';
  const meta = normalizeAttendancePhotoDivision(student?.type) === 'kinder'
    ? [student?.kindergarten, student?.age ? String(student.age).replace(/세$/, '') + '세' : ''].filter(Boolean).join(' · ')
    : [student?.school, student?.grade ? String(student.grade).replace(/학년$/, '') + '학년' : '', student?.group ? String(student.group).replace(/^([1-6])$/, function(_, g) { return ['','A','B','C','D','E','F'][Number(g)] || g; }) : ''].filter(Boolean).join(' · ');
  return `${student?.name || '이름 없음'} · ${division}${meta ? ' · ' + meta : ''}`;
}

function normalizeExistingFeedbackCandidate(item = {}, index = 0) {
  const studentName = String(item.student_name || item.name || item.student || '').trim();
  const division = normalizeExistingFeedbackDivision(item.division || item.type || item.student_type || item.category || '');
  const candidate = {
    id: item.id || `existing_feedback_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    selected: item.selected !== false,
    student_id: String(item.student_id || '').trim(),
    student_name: studentName,
    division,
    date: normalizeExistingFeedbackDate(item.date || item.feedback_date || item.created_at || ''),
    date_label: String(item.date_label || item.week_label || item.original_date || '').trim(),
    feedback_type: String(item.feedback_type || item.type_label || 'general').trim() || 'general',
    content: String(item.content || item.feedback || item.text || item.body || '').trim(),
    note: String(item.note || item.memo || item.warning || '').trim()
  };
  if (!candidate.student_id) {
    const matched = findExistingFeedbackMatchedStudent(candidate);
    if (matched?.id) {
      candidate.student_id = matched.id;
      candidate.division = normalizeAttendancePhotoDivision(matched.type);
      candidate.student_name = matched.name || candidate.student_name;
    }
  }
  return candidate;
}

function normalizeExistingFeedbackCandidates(list) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => normalizeExistingFeedbackCandidate(item, index))
    .filter(item => item.student_name || item.content);
}

const EXISTING_FEEDBACK_IMPORT_CHUNK_CHAR_LIMIT = 6500;

function splitExistingFeedbackImportText(text, limit = EXISTING_FEEDBACK_IMPORT_CHUNK_CHAR_LIMIT) {
  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return [];
  if (source.length <= limit) return [source];

  const chunks = [];
  let cursor = 0;
  while (cursor < source.length) {
    let end = Math.min(source.length, cursor + limit);
    if (end < source.length) {
      const paragraphBreak = source.lastIndexOf('\n\n', end);
      const lineBreak = source.lastIndexOf('\n', end);
      const breakPoint = paragraphBreak > cursor + Math.floor(limit * 0.45)
        ? paragraphBreak
        : (lineBreak > cursor + Math.floor(limit * 0.45) ? lineBreak : end);
      end = breakPoint;
    }
    const chunk = source.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    cursor = end;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  }
  return chunks;
}


function normalizeExistingFeedbackStudentNameMatchText(value) {
  return String(value || '')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[\[\]\(\){}<>〈〉《》『』「」“”\"'‘’·•\-_:：|]/g, '')
    .trim();
}

function cleanExistingFeedbackPotentialHeadingLine(value) {
  return String(value || '')
    .replace(/^\s*[\-–—*•·●○◎◇◆□■▶▷▸▹①-⑳0-9.\)\]]+\s*/, '')
    .replace(/\s*(학생|원생|어린이|아동|유치부|초등부|피드백|기록|상담)\s*[:：\-–—]?\s*$/g, '')
    .replace(/^\s*(학생|원생|이름)\s*[:：]\s*/g, '')
    .trim();
}

function getExistingFeedbackStudentNameEntries() {
  const map = new Map();
  getExistingFeedbackActiveStudents().forEach(student => {
    const name = String(student?.name || '').trim();
    if (!name) return;
    const normalized = normalizeExistingFeedbackStudentNameMatchText(name);
    if (!normalized) return;
    if (!map.has(normalized)) map.set(normalized, []);
    map.get(normalized).push(student);
  });
  return Array.from(map.entries()).map(([normalized, students]) => ({
    normalized,
    name: String(students[0]?.name || '').trim(),
    students,
    student: students.length === 1 ? students[0] : null
  })).sort((a, b) => b.normalized.length - a.normalized.length);
}

function findExistingFeedbackStudentHeading(line, entries) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  if (raw.length > 36) return null;
  const cleaned = cleanExistingFeedbackPotentialHeadingLine(raw);
  if (!cleaned || cleaned.length > 24) return null;
  const normalized = normalizeExistingFeedbackStudentNameMatchText(cleaned);
  if (!normalized) return null;
  return entries.find(entry => entry.normalized === normalized) || null;
}

function splitExistingFeedbackImportTextByStudent(text) {
  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return [];
  const entries = getExistingFeedbackStudentNameEntries();
  if (!entries.length) return [];
  const lines = source.split('\n');
  const sections = [];
  let current = null;
  let introLines = [];
  lines.forEach((line) => {
    const heading = findExistingFeedbackStudentHeading(line, entries);
    if (heading) {
      if (current && current.lines.join('\n').trim()) sections.push(current);
      current = {
        id: 'student_section_' + sections.length + '_' + Math.random().toString(36).slice(2, 7),
        student_name: heading.name,
        student_id: heading.student?.id || '',
        division: heading.student ? normalizeAttendancePhotoDivision(heading.student.type) : '',
        duplicateName: heading.students.length > 1,
        headingLine: String(line || '').trim(),
        lines: []
      };
      return;
    }
    if (current) current.lines.push(line);
    else introLines.push(line);
  });
  if (current && current.lines.join('\n').trim()) sections.push(current);
  const cleaned = sections.map(section => {
    const content = section.lines.join('\n').replace(/^\s+|\s+$/g, '').replace(/\n{4,}/g, '\n\n\n');
    return { ...section, content, length: content.length };
  }).filter(section => section.content.trim().length >= 12);
  const intro = introLines.join('\n').trim();
  if (intro && cleaned.length) {
    cleaned[0].content = intro + '\n\n' + cleaned[0].content;
    cleaned[0].length = cleaned[0].content.length;
  }
  return cleaned;
}

function buildExistingFeedbackStudentSectionText(section, index = 0, total = 0) {
  const name = String(section?.student_name || '').trim();
  const divisionLabel = section?.division === 'kinder' ? '유치부' : (section?.division === 'elementary' ? '초등부' : '미확인');
  return '[학생별 원문 구간' + (total ? ' ' + index + '/' + total : '') + ']\n'
    + '학생명: ' + name + '\n'
    + '구분: ' + divisionLabel + '\n'
    + (section?.student_id ? '앱 학생ID: ' + section.student_id + '\n' : '')
    + (section?.duplicateName ? '동명이인 가능: 있음. 앱 저장 전 학생 연결을 반드시 확인해야 합니다.\n' : '')
    + '\n[원문]\n'
    + String(section?.content || '').trim();
}

function buildExistingFeedbackStudentAnalysisUnits(fullText) {
  const sections = splitExistingFeedbackImportTextByStudent(fullText);
  if (sections.length < 2) return [];
  const units = [];
  let currentSections = [];
  let currentLength = 0;
  const total = sections.length;
  const limit = EXISTING_FEEDBACK_IMPORT_CHUNK_CHAR_LIMIT;
  sections.forEach((section, index) => {
    const sectionText = buildExistingFeedbackStudentSectionText(section, index + 1, total);
    if (sectionText.length > limit) {
      if (currentSections.length) {
        units.push({
          type: 'student_batch',
          sections: currentSections,
          text: currentSections.map(item => item.text).join('\n\n---\n\n'),
          studentNames: currentSections.map(item => item.section.student_name).filter(Boolean)
        });
        currentSections = [];
        currentLength = 0;
      }
      const splitChunks = splitExistingFeedbackImportText(section.content, Math.max(3600, Math.floor(limit * 0.72)));
      splitChunks.forEach((chunk, chunkIndex) => {
        units.push({
          type: 'student_split',
          sections: [section],
          text: buildExistingFeedbackStudentSectionText({ ...section, content: chunk }, chunkIndex + 1, splitChunks.length),
          studentNames: [section.student_name].filter(Boolean),
          studentName: section.student_name,
          studentId: section.student_id || '',
          chunkPart: chunkIndex + 1,
          chunkPartTotal: splitChunks.length
        });
      });
      return;
    }
    const nextLength = currentLength + (currentSections.length ? 8 : 0) + sectionText.length;
    if (currentSections.length && nextLength > limit) {
      units.push({
        type: 'student_batch',
        sections: currentSections,
        text: currentSections.map(item => item.text).join('\n\n---\n\n'),
        studentNames: currentSections.map(item => item.section.student_name).filter(Boolean)
      });
      currentSections = [];
      currentLength = 0;
    }
    currentSections.push({ section, text: sectionText });
    currentLength += (currentLength ? 8 : 0) + sectionText.length;
  });
  if (currentSections.length) {
    units.push({
      type: 'student_batch',
      sections: currentSections,
      text: currentSections.map(item => item.text).join('\n\n---\n\n'),
      studentNames: currentSections.map(item => item.section.student_name).filter(Boolean)
    });
  }
  return units;
}

function buildExistingFeedbackFallbackAnalysisUnits(fullText) {
  return splitExistingFeedbackImportText(fullText).map((chunk, index, arr) => ({
    type: 'text_chunk',
    text: chunk,
    studentNames: [],
    chunkPart: index + 1,
    chunkPartTotal: arr.length
  }));
}

function getExistingFeedbackImportAnalysisUnits(fullText) {
  const source = String(fullText || '').trim();
  if (!source) return [];
  const studentUnits = buildExistingFeedbackStudentAnalysisUnits(source);
  if (studentUnits.length) return studentUnits;
  return buildExistingFeedbackFallbackAnalysisUnits(source);
}

async function analyzeExistingFeedbackImportUnit(unit, index, total) {
  const chunkInfo = {
    index,
    total,
    type: unit?.type || 'text_chunk',
    studentNames: Array.isArray(unit?.studentNames) ? unit.studentNames : [],
    studentName: unit?.studentName || '',
    studentId: unit?.studentId || '',
    chunkPart: unit?.chunkPart || 0,
    chunkPartTotal: unit?.chunkPartTotal || 0
  };
  const result = await requestExistingFeedbackImportPayloads(buildExistingFeedbackImportPayloads(unit?.text || '', chunkInfo));
  const parsed = parseExistingFeedbackImportReply(result.reply);
  return { reply: result.reply, candidates: normalizeExistingFeedbackCandidates(parsed) };
}

async function analyzeExistingFeedbackImportUnitWithFallback(unit, index, total) {
  try {
    return await analyzeExistingFeedbackImportUnit(unit, index, total);
  } catch (err) {
    if (Number(err?.status) !== 413) throw err;
    const text = String(unit?.text || '').trim();
    const subChunks = splitExistingFeedbackImportText(text, 3600);
    if (subChunks.length <= 1) throw err;
    const replies = [];
    const candidates = [];
    for (let i = 0; i < subChunks.length; i++) {
      existingFeedbackImportState.statusMessage = '한 학생 구간이 길어서 더 작게 나누어 분석하고 있어요. ' + (i + 1) + '/' + subChunks.length;
      refreshSettingsAttendancePhotoImportDetail();
      const subUnit = { ...unit, text: subChunks[i], type: (unit?.type || 'student_batch') + '_small', chunkPart: i + 1, chunkPartTotal: subChunks.length };
      const subResult = await analyzeExistingFeedbackImportUnit(subUnit, i + 1, subChunks.length);
      replies.push('[SUB CHUNK ' + (i + 1) + '/' + subChunks.length + ']\n' + subResult.reply);
      candidates.push(...subResult.candidates);
    }
    return { reply: replies.join('\n\n---\n\n'), candidates };
  }
}

function buildExistingFeedbackImportPayloads(textOverride = null, chunkInfo = null) {
  const prompt = buildExistingFeedbackImportPromptText();
  const fileName = existingFeedbackImportState.fileName || '';
  const fileType = existingFeedbackImportState.fileType || '';
  const hasTextOverride = textOverride !== null && textOverride !== undefined;
  const fileText = String(hasTextOverride ? textOverride : existingFeedbackImportState.fileText || '').trim();
  const fileDataUrl = hasTextOverride ? '' : String(existingFeedbackImportState.fileDataUrl || '').trim();
  const studentNames = Array.isArray(chunkInfo?.studentNames) ? chunkInfo.studentNames.filter(Boolean) : [];
  const studentHint = studentNames.length
    ? '\n\n[학생 구간 안내]\n이 요청에는 다음 학생 구간이 포함되어 있습니다: ' + studentNames.join(', ') + '\n각 피드백의 student_name은 해당 학생 이름으로 작성하세요. 다른 학생의 기록을 섞지 마세요.'
    : (chunkInfo?.studentName ? '\n\n[학생 구간 안내]\n이 요청은 ' + chunkInfo.studentName + ' 학생의 긴 구간 중 일부입니다. student_name은 반드시 ' + chunkInfo.studentName + '으로 작성하세요.' : '');
  const chunkGuide = chunkInfo && chunkInfo.total > 1
    ? '\n\n[분할 분석 안내]\n이 문서는 용량 제한 때문에 여러 조각으로 나누어 분석합니다. 현재 조각은 ' + chunkInfo.index + '/' + chunkInfo.total + '입니다. 이 조각 안에서 확인 가능한 피드백만 JSON으로 반환하세요. 같은 피드백을 반복해서 만들지 마세요.' + studentHint
    : studentHint;
  const textContent = fileText
    ? prompt + chunkGuide + '\n\n[파일명]\n' + fileName + '\n\n[기존 피드백 원문' + (chunkInfo && chunkInfo.total > 1 ? ' ' + chunkInfo.index + '/' + chunkInfo.total : '') + ']\n' + fileText
    : prompt + '\n\n[파일명]\n' + fileName + '\n\n[문서 파일 안내]\n첨부된 fileDataUrl 또는 files 배열의 문서 내용을 읽고 기존 피드백을 학생별·날짜별로 분리해 주세요.';
  const basePayload = {
    feature: 'existingFeedbackImport',
    fileName,
    fileType,
    fileSize: existingFeedbackImportState.fileSize || 0,
    chunkIndex: chunkInfo ? chunkInfo.index : null,
    chunkTotal: chunkInfo ? chunkInfo.total : null,
    messages: [{ role: 'user', content: textContent }]
  };
  if (fileDataUrl) {
    basePayload.fileDataUrl = fileDataUrl;
    basePayload.file = { name: fileName, type: fileType, dataUrl: fileDataUrl };
    basePayload.files = [{ name: fileName, type: fileType, dataUrl: fileDataUrl }];
  }
  return [
    { ...basePayload, promptType: 'existing_feedback_import' },
    { ...basePayload, promptType: 'summary' }
  ];
}

async function requestExistingFeedbackImportPayloads(payloads) {
  let result = null;
  let lastError = null;
  for (const payload of payloads) {
    try {
      result = await postExistingFeedbackImportPayload(payload);
      break;
    } catch (err) {
      lastError = err;
      if (err.status && err.status !== 400 && err.status !== 415) break;
    }
  }
  if (!result) throw lastError || new Error('기존 피드백 분석 요청에 실패했어요.');
  return result;
}

function getExistingFeedbackCandidateDedupeKey(candidate) {
  const name = String(candidate?.student_name || '').replace(/\s+/g, '');
  const date = String(candidate?.date || candidate?.date_label || '').replace(/\s+/g, '');
  const content = String(candidate?.content || '').replace(/\s+/g, '').slice(0, 120);
  return [name, date, content].join('|');
}

function dedupeExistingFeedbackCandidates(candidates) {
  const seen = new Set();
  const result = [];
  (Array.isArray(candidates) ? candidates : []).forEach(candidate => {
    const key = getExistingFeedbackCandidateDedupeKey(candidate);
    if (!key.replace(/\|/g, '')) return;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(candidate);
  });
  return result;
}

async function postExistingFeedbackImportPayload(payload) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { reply: raw, raw }; }
  if (!res.ok) {
    const error = new Error((data && (data.message || data.error || data.details)) || getApiErrorMessage?.(res.status, data) || ('분석 요청 실패 (' + res.status + ')'));
    error.status = res.status;
    error.data = data;
    throw error;
  }
  const reply = String(data?.reply || data?.content || data?.raw || raw || '').trim();
  return { data, raw, reply };
}

async function requestExistingFeedbackImportAnalysis() {
  if (existingFeedbackImportState.analyzing) return;
  if (!existingFeedbackImportState.fileName) {
    if (typeof showPushToast === 'function') showPushToast('먼저 기존 피드백 파일을 선택해 주세요.');
    else alert('먼저 기존 피드백 파일을 선택해 주세요.');
    return;
  }
  if (!String(existingFeedbackImportState.fileText || '').trim() && !String(existingFeedbackImportState.fileDataUrl || '').trim()) {
    existingFeedbackImportState.errorMessage = '분석할 파일 내용이 없습니다. 파일을 다시 선택해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  if (isExistingFeedbackDocxFile({ name: existingFeedbackImportState.fileName, type: existingFeedbackImportState.fileType }) && !String(existingFeedbackImportState.fileText || '').trim()) {
    existingFeedbackImportState.errorMessage = 'docx 본문 텍스트를 아직 읽지 못했습니다. 파일을 다시 선택하거나, Google Docs에서 txt로 내려받아 업로드해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  existingFeedbackImportState.analyzing = true;
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.rawReply = '';
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.statusMessage = '원생 이름 기준으로 문서를 나눈 뒤 AI가 학생별·날짜별로 정리하고 있어요.';
  refreshSettingsAttendancePhotoImportDetail();
  try {
    const fullText = String(existingFeedbackImportState.fileText || '').trim();
    if (fullText) {
      const units = getExistingFeedbackImportAnalysisUnits(fullText);
      const allCandidates = [];
      const rawReplies = [];
      const studentSectionCount = splitExistingFeedbackImportTextByStudent(fullText).length;
      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const names = Array.isArray(unit.studentNames) && unit.studentNames.length ? ` (${unit.studentNames.join(', ')})` : '';
        existingFeedbackImportState.statusMessage = studentSectionCount >= 2
          ? `학생별로 나누어 분석하고 있어요. ${i + 1}/${units.length}번째${names}`
          : `파일이 커서 나누어 분석하고 있어요. ${i + 1}/${units.length}번째`;
        refreshSettingsAttendancePhotoImportDetail();
        const result = await analyzeExistingFeedbackImportUnitWithFallback(unit, i + 1, units.length);
        rawReplies.push(`[UNIT ${i + 1}/${units.length}${names}]\n` + result.reply);
        allCandidates.push(...result.candidates);
      }
      existingFeedbackImportState.rawReply = rawReplies.join('\n\n---\n\n');
      existingFeedbackImportState.candidates = dedupeExistingFeedbackCandidates(allCandidates);
    } else {
      const result = await requestExistingFeedbackImportPayloads(buildExistingFeedbackImportPayloads());
      existingFeedbackImportState.rawReply = result.reply;
      const parsed = parseExistingFeedbackImportReply(result.reply);
      existingFeedbackImportState.candidates = normalizeExistingFeedbackCandidates(parsed);
    }
    existingFeedbackImportState.statusMessage = existingFeedbackImportState.candidates.length
      ? `분석 결과 ${existingFeedbackImportState.candidates.length}개의 피드백 후보를 찾았습니다. 검수 후 저장해 주세요.`
      : '분석 결과를 받았지만 피드백 후보를 찾지 못했습니다. 원문 형식이나 서버 응답을 확인해 주세요.';
  } catch (err) {
    const status = Number(err && err.status);
    existingFeedbackImportState.errorMessage = status === 413
      ? '요청 용량이 너무 큽니다. 앱에서 파일을 더 작게 나누어 보내도록 수정했지만, 이 메시지가 계속 나오면 원본을 학생별 또는 월별로 나누어 업로드해 주세요.'
      : String(err && (err.message || err) || '기존 피드백 분석에 실패했어요.');
    existingFeedbackImportState.statusMessage = '';
  } finally {
    existingFeedbackImportState.analyzing = false;
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function renderExistingFeedbackCandidateStudentSelect(candidate, index) {
  const students = getExistingFeedbackActiveStudents().slice().sort((a, b) => {
    const sameNameA = String(a.name || '').trim() === String(candidate.student_name || '').trim() ? 0 : 1;
    const sameNameB = String(b.name || '').trim() === String(candidate.student_name || '').trim() ? 0 : 1;
    if (sameNameA !== sameNameB) return sameNameA - sameNameB;
    const divA = normalizeAttendancePhotoDivision(a.type) === normalizeExistingFeedbackDivision(candidate.division) ? 0 : 1;
    const divB = normalizeAttendancePhotoDivision(b.type) === normalizeExistingFeedbackDivision(candidate.division) ? 0 : 1;
    if (divA !== divB) return divA - divB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
  const options = ['<option value="">학생 선택 필요</option>'].concat(students.map(student => {
    const selected = String(candidate.student_id || '') === String(student.id || '') ? ' selected' : '';
    return '<option value="' + settingsEscapeAttr(student.id || '') + '"' + selected + '>' + settingsEscapeHtml(getExistingFeedbackStudentOptionLabel(student)) + '</option>';
  })).join('');
  return '<div class="studentBulkCandidateField full"><div class="studentBulkCandidateLabel">앱 원생 연결</div>'
    + '<select class="existingFeedbackCandidateStudentSelect" onchange="updateExistingFeedbackCandidateField(' + index + ',\'student_id\',this.value)">' + options + '</select></div>';
}

function renderExistingFeedbackCandidateField(index, field, label, value, options = {}) {
  const safeValue = settingsEscapeAttr(value || '');
  const full = options.full ? ' full' : '';
  if (options.type === 'select') {
    const selectedElementary = normalizeExistingFeedbackDivision(value) === 'elementary' ? ' selected' : '';
    const selectedKinder = normalizeExistingFeedbackDivision(value) === 'kinder' ? ' selected' : '';
    const selectedUnknown = normalizeExistingFeedbackDivision(value) ? '' : ' selected';
    return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
      + '<select class="studentBulkCandidateSelect" onchange="updateExistingFeedbackCandidateField(' + index + ',\'' + field + '\',this.value)">'
      + '<option value=""' + selectedUnknown + '>미확인</option>'
      + '<option value="elementary"' + selectedElementary + '>초등부</option>'
      + '<option value="kinder"' + selectedKinder + '>유치부</option>'
      + '</select></div>';
  }
  if (options.type === 'textarea') {
    return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
      + '<textarea class="existingFeedbackCandidateTextArea" oninput="updateExistingFeedbackCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">' + settingsEscapeHtml(value || '') + '</textarea></div>';
  }
  return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
    + '<input class="studentBulkCandidateInput" value="' + safeValue + '" oninput="updateExistingFeedbackCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">'
    + '</div>';
}

function getExistingFeedbackCandidateStatus(candidate) {
  if (!String(candidate?.student_name || '').trim()) return { type: 'warn', label: '이름 확인' };
  if (!String(candidate?.student_id || '').trim()) return { type: 'warn', label: '학생 연결 필요' };
  if (!String(candidate?.date || '').trim()) return { type: 'warn', label: '날짜 확인' };
  if (!String(candidate?.content || '').trim()) return { type: 'warn', label: '내용 없음' };
  return { type: '', label: '저장 가능' };
}

function renderExistingFeedbackCandidateCard(candidate, index) {
  const status = getExistingFeedbackCandidateStatus(candidate);
  const badgeClass = status.type ? ' ' + status.type : '';
  return '<div class="studentBulkCandidateCard">'
    + '<div class="studentBulkCandidateTop">'
    + '<label class="studentBulkCandidateCheck"><input type="checkbox" ' + (candidate.selected ? 'checked' : '') + ' onchange="toggleExistingFeedbackCandidate(' + index + ',this.checked)">저장 선택</label>'
    + '<span class="studentBulkCandidateTopRight"><span class="attendancePhotoCandidateBadge' + badgeClass + '">' + settingsEscapeHtml(status.label) + '</span><button class="studentBulkCandidateDeleteBtn danger" type="button" onclick="removeExistingFeedbackCandidate(' + index + ')">삭제</button></span>'
    + '</div>'
    + '<div class="studentBulkCandidateGrid">'
    + renderExistingFeedbackCandidateStudentSelect(candidate, index)
    + renderExistingFeedbackCandidateField(index, 'student_name', '학생명', candidate.student_name)
    + renderExistingFeedbackCandidateField(index, 'division', '구분', candidate.division, { type: 'select' })
    + renderExistingFeedbackCandidateField(index, 'date', '날짜', candidate.date, { placeholder: 'YYYY-MM-DD' })
    + renderExistingFeedbackCandidateField(index, 'date_label', '원문 날짜', candidate.date_label)
    + renderExistingFeedbackCandidateField(index, 'content', '피드백 내용', candidate.content, { type: 'textarea', full: true })
    + renderExistingFeedbackCandidateField(index, 'note', '확인 메모', candidate.note, { full: true })
    + '</div>'
    + '</div>';
}

function renderExistingFeedbackImportResults() {
  const list = existingFeedbackImportState.candidates || [];
  if (!list.length) return '';
  const selectedCount = list.filter(item => item.selected && String(item.content || '').trim()).length;
  return '<div class="settingsInfoCard"><div class="settingsInfoHead">피드백 후보 확인</div>'
    + '<div class="attendancePhotoResultSummary"><span class="attendancePhotoResultCount">후보 ' + list.length + '개 · 저장 선택 ' + selectedCount + '개</span><span class="studentBulkCandidateTopRight"><button class="settingsActionBtn" type="button" onclick="setAllExistingFeedbackCandidatesChecked(true)">전체 선택</button><button class="settingsActionBtn" type="button" onclick="removeSelectedExistingFeedbackCandidates()">선택 삭제</button><button class="settingsActionBtn" type="button" onclick="clearExistingFeedbackCandidates()">전체 삭제</button></span></div>'
    + '<div class="studentBulkCandidateList">' + list.map(renderExistingFeedbackCandidateCard).join('') + '</div>'
    + '<div class="attendancePhotoActionGrid single"><button class="settingsActionBtn primary" type="button" onclick="importExistingFeedbackCandidates()">선택한 피드백 앱에 저장</button></div>'
    + '</div>';
}

function updateExistingFeedbackCandidateField(index, field, value) {
  const item = existingFeedbackImportState.candidates[index];
  if (!item) return;
  if (field === 'division') item[field] = normalizeExistingFeedbackDivision(value);
  else if (field === 'date') item[field] = normalizeExistingFeedbackDate(value);
  else item[field] = String(value || '').trim();
  if (field === 'student_id') {
    const student = getAllStudents().find(s => String(s.id || '') === String(value || '')) || null;
    if (student) {
      item.student_name = student.name || item.student_name;
      item.division = normalizeAttendancePhotoDivision(student.type);
    }
  } else if (field === 'student_name' || field === 'division') {
    if (!item.student_id) {
      const matched = findExistingFeedbackMatchedStudent(item);
      if (matched?.id) item.student_id = matched.id;
    }
  }
  refreshSettingsAttendancePhotoImportDetail();
}

function toggleExistingFeedbackCandidate(index, checked) {
  const item = existingFeedbackImportState.candidates[index];
  if (!item) return;
  item.selected = !!checked;
}

function setAllExistingFeedbackCandidatesChecked(checked) {
  existingFeedbackImportState.candidates.forEach(item => { item.selected = !!checked; });
  refreshSettingsAttendancePhotoImportDetail();
}

function removeExistingFeedbackCandidate(index) {
  if (!Array.isArray(existingFeedbackImportState.candidates)) return;
  const safeIndex = Number(index);
  if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= existingFeedbackImportState.candidates.length) return;
  existingFeedbackImportState.candidates.splice(safeIndex, 1);
  refreshSettingsAttendancePhotoImportDetail();
}

function removeSelectedExistingFeedbackCandidates() {
  const before = Array.isArray(existingFeedbackImportState.candidates) ? existingFeedbackImportState.candidates.length : 0;
  if (!before) return;
  const next = existingFeedbackImportState.candidates.filter(item => !item.selected);
  if (next.length === before) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 피드백 후보를 선택해 주세요.');
    else alert('삭제할 피드백 후보를 선택해 주세요.');
    return;
  }
  existingFeedbackImportState.candidates = next;
  refreshSettingsAttendancePhotoImportDetail();
}

function clearExistingFeedbackCandidates() {
  if (!Array.isArray(existingFeedbackImportState.candidates) || !existingFeedbackImportState.candidates.length) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 피드백 후보가 없습니다.');
    else alert('삭제할 피드백 후보가 없습니다.');
    return;
  }
  const ok = confirm('피드백 후보를 모두 삭제할까요?');
  if (!ok) return;
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.errorMessage = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function getExistingFeedbackCandidateSaveDate(candidate) {
  const raw = String(candidate?.date || '').trim();
  if (!raw) return '';
  return normalizeExistingFeedbackDate(raw);
}

function getExistingFeedbackCandidateSaveYear(candidate) {
  const date = getExistingFeedbackCandidateSaveDate(candidate);
  const match = String(date || '').match(/(20\d{2})/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

async function importExistingFeedbackCandidates() {
  if (existingFeedbackImportState.importRunning) return;
  const selected = existingFeedbackImportState.candidates.filter(item => item.selected);
  if (!selected.length) {
    if (typeof showPushToast === 'function') showPushToast('저장할 피드백을 선택해 주세요.');
    else alert('저장할 피드백을 선택해 주세요.');
    return;
  }
  const invalid = selected.filter(item => {
    const status = getExistingFeedbackCandidateStatus(item);
    return status.label !== '저장 가능';
  });
  if (invalid.length) {
    existingFeedbackImportState.errorMessage = '학생 연결, 날짜, 피드백 내용이 빠진 후보가 있습니다. 검수 후 다시 저장해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  existingFeedbackImportState.importRunning = true;
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.statusMessage = '기존 피드백을 앱에 저장하고 있어요.';
  refreshSettingsAttendancePhotoImportDetail();
  const savedIds = new Set();
  const errors = [];
  try {
    for (const candidate of selected) {
      try {
        const student = getAllStudents().find(item => String(item.id || '') === String(candidate.student_id || ''));
        if (!student) throw new Error(`${candidate.student_name || '학생'} 원생 연결을 찾지 못했습니다.`);
        const content = String(candidate.content || '').trim();
        const date = getExistingFeedbackCandidateSaveDate(candidate);
        const payload = addOlliAcademyToPayload({
          student_id: student.id,
          student_name: student.name || candidate.student_name,
          content,
          feedback_type: 'general',
          year: getExistingFeedbackCandidateSaveYear(candidate),
          date
        }, '기존 피드백 가져오기');
        await saveFeedbackRowVerified('feedbacks', payload, '기존 피드백 가져오기');
        savedIds.add(candidate.id);
      } catch (err) {
        errors.push((candidate.student_name || '이름 없음') + ': ' + String(err && (err.message || err) || '저장 실패'));
      }
    }
    existingFeedbackImportState.candidates = existingFeedbackImportState.candidates.filter(item => !savedIds.has(item.id));
    try { await loadStudentsFromSupabase(); } catch(e) {}
    try {
      const searchValue = document.getElementById('searchName')?.value?.trim() || '';
      if (typeof loadRecords === 'function') await loadRecords(searchValue);
    } catch(e) {}
    
    existingFeedbackImportState.statusMessage = savedIds.size
      ? `${savedIds.size}개의 기존 피드백을 앱에 저장했습니다.`
      : '';
    existingFeedbackImportState.errorMessage = errors.length ? errors.slice(0, 5).join('\n') + (errors.length > 5 ? '\n...' : '') : '';
    if (savedIds.size && typeof showPushToast === 'function') showPushToast(`${savedIds.size}개의 피드백을 저장했어요.`);
  } finally {
    existingFeedbackImportState.importRunning = false;
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function renderSettingsExistingFeedbackImport() {
  const hasFile = !!existingFeedbackImportState.fileName;
  const fileSize = formatExistingFeedbackImportFileSize(existingFeedbackImportState.fileSize);
  const title = hasFile ? existingFeedbackImportState.fileName : '기존 피드백 파일 업로드';
  const extractedTextLength = String(existingFeedbackImportState.fileText || '').trim().length;
  const desc = hasFile
    ? ((fileSize ? fileSize + ' · ' : '') + (extractedTextLength ? ('본문 ' + extractedTextLength.toLocaleString('ko-KR') + '자 추출됨') : '기존 피드백 파일입니다.'))
    : '학생별로 정리해둔 기존 피드백 문서나 텍스트 파일을 올릴 수 있어요.';
  const status = existingFeedbackImportState.statusMessage
    ? '<div class="attendancePhotoStatusBox">' + settingsEscapeHtml(existingFeedbackImportState.statusMessage) + '</div>'
    : '';
  const error = existingFeedbackImportState.errorMessage
    ? '<div class="attendancePhotoStatusBox error">' + settingsEscapeHtml(existingFeedbackImportState.errorMessage) + '</div>'
    : '';
  const preview = existingFeedbackImportState.rawReply && !(existingFeedbackImportState.candidates || []).length
    ? '<div class="existingFeedbackPreviewBox">' + settingsEscapeHtml(existingFeedbackImportState.rawReply.slice(0, 1800)) + (existingFeedbackImportState.rawReply.length > 1800 ? '\n...' : '') + '</div>'
    : '';
  const analyzeLabel = existingFeedbackImportState.analyzing ? '분석 중...' : '피드백 분석하기';
  const clearLabel = existingFeedbackImportState.candidates && existingFeedbackImportState.candidates.length ? '파일/후보 지우기' : '파일 지우기';
  return '<div class="settingsInfoCard"><div class="settingsInfoHead">기존 피드백 가져오기</div></div>'
    + '<div class="existingFeedbackImportBox" onclick="openExistingFeedbackImportPicker()" role="button">'
    + '<div class="existingFeedbackImportIcon"><svg viewBox="0 0 24 24"><path d="M7 3.8h7.2L19 8.6V20a1.7 1.7 0 0 1-1.7 1.7H7A1.7 1.7 0 0 1 5.3 20V5.5A1.7 1.7 0 0 1 7 3.8z"></path><path d="M14 4v5h5"></path><path d="M8.6 13h6.8"></path><path d="M8.6 16.5h4.5"></path></svg></div>'
    + '<div class="existingFeedbackImportTitle">' + settingsEscapeHtml(title) + '</div>'
    + '<div class="existingFeedbackImportDesc">' + settingsEscapeHtml(desc) + '</div>'
    + '</div>'
    + '<div class="attendancePhotoActionGrid"><button class="settingsActionBtn primary" type="button" onclick="requestExistingFeedbackImportAnalysis()"' + (existingFeedbackImportState.analyzing ? ' disabled' : '') + '>' + analyzeLabel + '</button><button class="settingsActionBtn" type="button" onclick="clearExistingFeedbackImportFile()">' + clearLabel + '</button></div>'
    + status + error + preview + renderExistingFeedbackImportResults();
}

