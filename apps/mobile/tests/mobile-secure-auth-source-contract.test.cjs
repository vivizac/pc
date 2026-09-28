const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const vercel=fs.readFileSync(path.join(__dirname,'..','vercel.json'),'utf8');

test('mobile preview uses secured PC auth academy and teacher membership files',()=>{
  assert.match(vercel,/pc\/main\/olli-auth-academy-access\.js/);
  assert.match(vercel,/pc\/main\/olli-auth-teacher-membership\.js/);
  assert.doesNotMatch(vercel,/pc\/main\/olli-auth-academy-access\.js/);
  assert.doesNotMatch(vercel,/pc\/main\/olli-auth-teacher-membership\.js/);
});
