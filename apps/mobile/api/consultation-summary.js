// One shared summary generator: mobile Vercel hosts it, PC forwards to this endpoint.
// Security: session-validated RPC before data access; service key never leaves server;
// generation is owned by an atomic academy/student/rule/due-month lease in Postgres.
const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const CHAT_API_URL = 'https://vivizac-feedback.vercel.app/api/chat';
const VALID_RULES = new Set(['after_1','after_3','every_6','every_12']);
function serverKey() { return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''; }
function fail(status, message, code = 'ERROR') { const e = new Error(message);e.httpStatus=status;e.code=code;throw e; }
function monthKey(date) { return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0'); }
function addMonth(date,n) {return new Date(date.getFullYear(),date.getMonth()+n,1);}
function parseMonth(s) {
  if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(String(s||''))) return null;
  return new Date(Number(s.slice(0,4)),Number(s.slice(5,7))-1,1);
}
function dateFromFeedback(row) {
  const raw=String(row.date||row.lesson_date||row.created_at||'').trim();
  let m=raw.match(/^(\d{4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})/);
  if(m) {const d=new Date(+m[1],+m[2]-1,+m[3]); return d.getFullYear()==+m[1] && d.getMonth()==+m[2]-1 && d.getDate()==+m[3]?d:null;}
  const d=new Date(raw);return Number.isNaN(d.getTime())?null:d;
}
function verifyDue(student, rule, due) {
  const enrolled=new Date(String(student.enrolled_at||'')+'T00:00:00');
  if(Number.isNaN(enrolled.getTime())) fail(400,'학생 등록일이 없습니다.','ENROLLMENT_MISSING');
  const registeredMonth = new Date(enrolled.getFullYear(),enrolled.getMonth(),1);
  const difference=(due.getFullYear()-registeredMonth.getFullYear())*12+due.getMonth()-registeredMonth.getMonth();
  const months=rule==='after_1'?1:rule==='after_3'?3:rule==='every_6'?6:12;
  if(difference<months || (rule==='every_12'?difference%12!==0:difference!==months))
    fail(400,'등록일과 상담회차가 일치하지 않습니다.','DUE_MISMATCH');
  if(due>new Date(new Date().getFullYear(),new Date().getMonth(),1))
    fail(400,'아직 상담 대상 월이 아닙니다.','FUTURE_DUE');
  return months;
}
async function callRpc(name, body, key) {
  const response=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
    method:'POST',headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+key},
    body:JSON.stringify(body)
  });
  const raw=await response.text();
  let result;try{result=JSON.parse(raw)}catch{result={message:raw.slice(0,300)}}
  if(!response.ok) fail(response.status,result.message||'Supabase 요청 실패','RPC_HTTP_ERROR');
  if(!result?.ok) fail(result?.code==='SESSION_INVALID'?401:403,result?.message||result?.code||'서버 권한 확인 실패',result?.code);
  return result;
}
async function getRows(table, params,key) {
  const url=new URL(SUPABASE_URL+'/rest/v1/'+table);
  for(const [field,value]of Object.entries(params))url.searchParams.set(field,value);
  const response=await fetch(url,{headers:{apikey:key,Authorization:'Bearer '+key}});
  const result=await response.json();
  if(!response.ok || !Array.isArray(result))fail(response.status||500,result?.message||'기록 조회 실패');
  return result;
}
function relevantRows(feedbacks,failures,division,rule,due,months) {
  const start=addMonth(due,-months);
  const through=addMonth(due,1); // the due month may contain the final prior-month feedback
  let rows=[...feedbacks.map(x=>({...x,source_table:'feedbacks'})),...failures.map(x=>({...x,source_table:'fail_feedbacks'}))];
  rows=rows.map(row=>({...row,_date:dateFromFeedback(row)}))
    .filter(row=>row._date && row._date>=start && row._date<through && String(row.content||'').trim())
    .sort((a,b)=>a._date-b._date);
  const general=rows.filter(row=>row.source_table==='feedbacks');
  const growth=general.filter(row=>!row.feedback_type || String(row.feedback_type).toLowerCase()==='growth');
  if(division==='elementary' && months===1) return {status:general.length?'ready':'insufficient',mode:'elementary_one_month_records',rows:general,reason:'일반 피드백이 없습니다.'};
  if(division==='kinder' && months===1 && general.length<4) return {status:'insufficient',rows:general,reason:'유치부 1개월 상담은 수업 피드백 최소 4개가 필요합니다.'};
  if(division==='elementary') {
    if(growth.length<2) return {status:'insufficient',rows:growth,reason:'초등부 종합 상담에는 성장 피드백 최소 2개가 필요합니다.'};
    if(rule==='every_12'){
      const finalMonth=addMonth(due,-1);
      if(!growth.some(row=>row._date>=finalMonth&&row._date<through))
        return {status:'insufficient',rows:growth,reason:monthKey(finalMonth)+'분 마지막 성장 피드백이 아직 없습니다.'};
    }
    return {status:'ready',rows:growth};
  }
  if(!rows.length)return{status:'insufficient',rows,reason:'해당 상담 기간에 저장된 피드백이 없습니다.'};
  return {status:'ready',rows};
}
function userPrompt(student,months,rows,dueMonth){
  const division=student.division==='kinder'?'유치부':'초등부';
  const records=rows.map((r,i)=>{
    const d=r._date;
    const date=d?d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0'):'미확인';
    const kind=r.source_table==='fail_feedbacks'?'실패·재도전 성장기록':'성장·수업 피드백';
    return (i+1)+'. ['+date+' / '+kind+']\n'+String(r.content||'');
  }).join('\n\n');
  return '[학생 정보]\n- 이름: '+student.name+'\n- 구분: '+division+'\n- 등록일: '+student.enrolled_at+
    '\n- 상담 회차: '+months+'개월 / '+dueMonth+'\n\n[최근 '+months+'개월 저장 피드백]\n'+records;
}
async function generate(student,months,rows,dueMonth){
  const body={promptType:student.division==='kinder'&&months===1?'kinder_one_month':'summary',
    studentId:student.id,studentName:student.name,studentDivision:student.division,
    messages:[{role:'user',content:userPrompt(student,months,rows,dueMonth)}]};
  const res=await fetch(CHAT_API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json();
  if(!res.ok || !String(data.reply||'').trim())fail(502,data.error||'AI 종합 피드백 생성 실패','AI_GENERATION_FAILED');
  return String(data.reply).trim();
}
async function main(body) {
  const academyId=String(body.academyId||'').trim(), sessionToken=String(body.sessionToken||'').trim();
  const studentId=String(body.studentId||'').trim(), taskKey=String(body.taskKey||'').trim();
  const parts=taskKey.split('|'),rule=parts[1],dueMonth=parts[2];
  if(!academyId||!sessionToken||!studentId||parts.length!==3||parts[0]!=='id:'+studentId
    ||!VALID_RULES.has(rule)||!parseMonth(dueMonth))fail(400,'상담 회차 또는 로그인 정보를 확인해 주세요.','INVALID_TASK');
  const key=serverKey();if(!key)fail(503,'서버 Supabase 키 설정이 없습니다.','SERVER_KEY_MISSING');
  const params={p_session_token:sessionToken,p_academy_id:academyId,p_student_id:studentId,
    p_rule_key:rule,p_due_month:dueMonth};
  const status=await callRpc('olli_consultation_summary_job_access',{...params,p_action:'read'},key);
  if(status.status==='ready'&&status.feedback_id){
    const rows=await getRows('summary_feedbacks',{id:'eq.'+status.feedback_id,academy_id:'eq.'+academyId,select:'id,content'},key);
    if(rows[0])return {ok:true,status:'ready',content:rows[0].content,feedbackId:rows[0].id};
  }
  if(status.status==='generating')return{ok:true,status:'generating'};
  const students=await getRows('students',{id:'eq.'+studentId,academy_id:'eq.'+academyId,select:'id,name,division,enrolled_at,status,is_deleted'},key);
  const student=students[0];if(!student||student.status!=='active'||student.is_deleted)fail(404,'재원 학생을 찾을 수 없습니다.');
  const due=parseMonth(dueMonth);
  const months=verifyDue(student,rule,due);
  const base={academy_id:'eq.'+academyId,student_id:'eq.'+studentId,is_deleted:'is.false',
    select:'id,date,lesson_date,created_at,feedback_type,content',limit:'300'};
  // Both feedback tables may have different date columns; query only shared fields.
  const feedbacks=await getRows('feedbacks',Object.assign({},base,{select:'id,date,lesson_date,created_at,feedback_type,content'}),key);
  let failures=[];
  if(student.division==='kinder' && months>1){
    failures=await getRows('fail_feedbacks',Object.assign({},base,{select:'id,date,created_at,feedback_type,content'}),key);
  }
  const material=relevantRows(feedbacks,failures,student.division,rule,due,months);
  if(material.status!=='ready')return{ok:true,status:'insufficient',reason:material.reason};
  if(material.mode==='elementary_one_month_records')return{ok:true,status:'ready',mode:'elementary_one_month_records',
    content:material.rows.map(r=>String(r.content||'')).join('\n\n')};
  const claim=await callRpc('olli_consultation_summary_job_access',{...params,p_action:'claim'},key);
  if(claim.status==='ready') {
    const rows=await getRows('summary_feedbacks',{id:'eq.'+claim.feedback_id,academy_id:'eq.'+academyId,select:'id,content'},key);
    return{ok:true,status:'ready',content:rows[0]?.content||'',feedbackId:claim.feedback_id};
  }
  if(claim.status!=='claimed')return{ok:true,status:'generating'};
  try {
    const text=await generate(student,months,material.rows,dueMonth);
    const done=await callRpc('olli_consultation_summary_job_access',{
      ...params,p_action:'finish',p_claim_token:claim.claim_token,p_content:text
    },key);
    return{ok:true,status:'ready',content:text,feedbackId:done.feedback_id};
  } catch(error) {
    try {await callRpc('olli_consultation_summary_job_access',{
      ...params,p_action:'fail',p_claim_token:claim.claim_token,p_error:String(error.message||error).slice(0,400)
    },key);}catch(_) {}
    throw error;
  }
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try { const result=await main(req.body||{});return res.status(200).json(result); }
  catch(error){return res.status(error.httpStatus||500).json({ok:false,error:error.code||'ERROR',message:error.message||'Server error'});}
}
export const __test = {monthKey,addMonth,parseMonth,verifyDue,dateFromFeedback,relevantRows,userPrompt};
