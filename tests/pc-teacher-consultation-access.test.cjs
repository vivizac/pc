const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('delegated access is separate from teacher role and owner-only messaging',()=>{
 const settings=read('packages/common/olli-settings-members.js'),booking=read('packages/common/olli-booking-owner-ui.js'),survey=read('apps/pc/consultation-survey-core.js');
 assert.match(settings,/선생님 \+ 상담 기록/);assert.match(settings,/getSettingsRoleChoice\(loaded\) !== role/);assert.match(booking,/OlliPcConsultationRecordAccess/);assert.match(survey,/if\(!await refreshAccess\(\)\)/);
 const file=fs.readdirSync(path.join(root,'supabase/migrations')).find(n=>n.endsWith('_pc_teacher_consultation_record_access.sql'));assert.ok(file);
 const sql=read('supabase/migrations/'+file);assert.match(sql,/teacher_record_access/);assert.match(sql,/v_consultation then 'teacher' else/);assert.match(sql,/m\.academy_id=p_academy_id/);assert.match(sql,/m\.status='active'/);assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.olli_consultation_messages_manage/i);assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION olli_consultation_private\.require_owner/i);
});
