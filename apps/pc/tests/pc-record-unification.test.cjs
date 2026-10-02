const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pc=path.resolve(__dirname,'..');
const common=path.resolve(pc,'..','..','packages','common');
const read=(file)=>fs.readFileSync(file,'utf8');
const editor=read(path.join(pc,'pc-record-editor.js'));
const attendance=read(path.join(pc,'pc-attendance.js'));
const index=read(path.join(pc,'index.html'));
const history=read(path.join(common,'observation-memo-version-history-common.js'));
const voice=read(path.join(pc,'pc-note-voice.js'));
const classMode=read(path.join(pc,'pc-kcf-class-mode.js'));

assert.match(editor,/mode==='quick'\?KINDER_HTML:ELEMENTARY_HTML/);
assert.match(editor,/\['elementary','kinder'\]\.includes\(session\.type\)/);
assert.match(editor,/memoEditorVoiceBtn/);
assert.match(editor,/olliMemoVersionHistoryBtn/);
assert.match(editor,/kcfTeacherBtn/);
assert.match(editor,/kcfVoiceBtn/);
assert.doesNotMatch(editor,/kcfStudentManageBtn/);
assert.doesNotMatch(editor,/kcfCardToolBtn kcfInboxBtn/);

assert.match(attendance,/PC_VIEW_PREFS_PREFIX = 'olli_pc_personality_records_view_v1'/);
assert.match(attendance,/const savedViewPrefs = readPcPersonalityViewPrefs\(\);/);
assert.match(attendance,/app\.state\.attendanceDivision = savedViewPrefs\.division/);
assert.match(attendance,/state\.sortMode = savedViewPrefs\.sortMode/);
assert.match(attendance,/writePcPersonalityViewPrefs\(\{ division: nextDivision, sortMode: state\.sortMode \}\)/);
assert.match(attendance,/writePcPersonalityViewPrefs\(\{ division: core\(\)\.state\.attendanceDivision, sortMode: state\.sortMode \}\)/);
assert.doesNotMatch(attendance,/state\.sortMode = PC_SORT_MODES\.DAY;\s*renderEmptyDetail\(\);\s*app\.state\.attendanceDivision = 'all'/);
assert.match(attendance,/pcSetPersonalityRecordMode/);
assert.match(attendance,/피드백 보관함/);
assert.match(attendance,/pcAttendanceArchiveMonthBtn/);
assert.match(attendance,/renderUnifiedRecordCards\(student, monthFeedbacks, monthSummaries\)/);

assert.match(history,/\['elementary', 'kinder'\]\.includes\(global\.currentMemoType\)/);
assert.match(history,/global\.currentMemoType === 'kinder' \? 'kinder' : 'elementary'/);

assert.match(index,/pc-note-voice\.js/);
assert.match(index,/pc-kcf-class-mode\.js/);
assert.match(voice,/input_audio_buffer\.commit/);
assert.doesNotMatch(voice,/transcription\.delta[\s\S]{0,500}target\.value/);
assert.match(classMode,/OlliTimetableService/);
assert.match(classMode,/completeSuccessfulSubmit/);

console.log('PC 관찰노트·퀵노트 통합 정적 검증 통과');

assert.match(index,/pc-attendance\.js\?v=20261002-personality-view-prefs-1/);
