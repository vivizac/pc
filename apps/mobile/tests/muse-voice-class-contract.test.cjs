const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const teacher=read('kcf-teacher-sheet.js');
const index=read('index.html');
const client=read('muse-voice-class.js');
const relay=read('api/muse-voice-realtime.js');
const pkg=JSON.parse(read('package.json'));
const vercel=JSON.parse(read('vercel.json'));

assert.match(teacher,/kcfTeacherSheetMuseBtn/);
assert.match(teacher,/OlliMuseClassVoice\.toggle/);
assert.match(index,/muse-voice-class\.js/);
assert.match(client,/MAX_CAPTURE_MS=9 \* 60 \* 1000/);
assert.match(client,/\[Muse 수업기록\]/);
assert.match(relay,/muse-voice-transcribe-1\.0/);
assert.match(relay,/mode:'DIARIZATION'/);
assert.match(relay,/olli_get_my_academies/);
assert.match(relay,/META_MODEL_API_KEY/);
assert.equal(pkg.dependencies.ws,'8.22.0');
assert.equal(vercel.functions['api/muse-voice-realtime.js'].maxDuration,800);
assert.equal(vercel.git.deploymentEnabled,false);
console.log('Muse Voice Class POC contract: OK');
