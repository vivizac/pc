'use strict';

const {callSupabaseRpc}=require('../supabase-rpc.cjs');
const {readScheduleAvailability}=require('./availability-tools.cjs');
const {normalizeTimetableMode,timeLabel,weekdayLabel}=require('./schedule-tools.cjs');

function clean(value){return String(value==null?'':value).trim();}
function readError(message,statusCode=400,code='OLLI_AGENT_TIMETABLE_READ_ERROR'){
  const error=new Error(message); error.statusCode=statusCode; error.code=code; return error;
}
function parseDateKey(value){
  const key=clean(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y,m,d]=key.split('-').map(Number);
  const ts=Date.UTC(y,m-1,d);
  const x=new Date(ts);
  if(x.getUTCFullYear()!==y||x.getUTCMonth()+1!==m||x.getUTCDate()!==d) return null;
  return {key,timestamp:ts,year:y,month:m,day:d};
}
function addDaysKey(value,days){
  const p=parseDateKey(value); if(!p) return '';
  return new Date(p.timestamp+Number(days||0)*86400000).toISOString().slice(0,10);
}
function isoWeekday(value){
  const p=parseDateKey(value); if(!p) return 0;
  const d=new Date(p.timestamp).getUTCDay(); return d===0?7:d;
}
function mondayKey(value){
  const day=isoWeekday(value); return day?addDaysKey(value,-(day-1)):'';
}
function resolveDateSpec(spec,todayKey){
  const today=parseDateKey(todayKey); if(!today) return '';
  if(!spec||typeof spec!=='object') return '';
  const mode=clean(spec.mode);
  if(mode==='today') return today.key;
  if(mode==='tomorrow') return addDaysKey(today.key,1);
  if(mode==='month_day'){
    const month=Number(spec.month||0),day=Number(spec.day||0);
    if(month<1||month>12||day<1||day>31) return '';
    let y=today.year;
    let key=String(y).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    let parsed=parseDateKey(key);
    if(!parsed) return '';
    if(parsed.timestamp<today.timestamp){
      y+=1; key=String(y)+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      parsed=parseDateKey(key);
    }
    return parsed?parsed.key:'';
  }
  if(mode==='day_of_month'){
    const day=Number(spec.day||0); if(day<1||day>31) return '';
    let y=today.year,m=today.month;
    let key=String(y)+'-'+String(m).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    let parsed=parseDateKey(key);
    if(!parsed||parsed.timestamp<today.timestamp){
      m+=1;if(m>12){m=1;y+=1;}
      key=String(y)+'-'+String(m).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      parsed=parseDateKey(key);
    }
    return parsed?parsed.key:'';
  }
  const weekday=Number(spec.weekday||0);
  if(weekday<1||weekday>6) return '';
  const current=isoWeekday(today.key);
  if(mode==='upcoming_weekday') return addDaysKey(today.key,(weekday-current+7)%7);
  const monday=mondayKey(today.key);
  const offset=mode==='week_after_next_weekday'?14:(mode==='next_weekday'?7:0);
  return addDaysKey(monday,offset+weekday-1);
}
function normalizeDivision(value){
  const d=clean(value).toLowerCase();
  return ['elementary','kinder'].includes(d)?d:'';
}
function groupOf(row){
  return clean(row?.class_group || row?.target_class_group).toUpperCase()==='B'?'B':'A';
}
function rowDivision(row){
  return normalizeDivision(row?.division || row?.target_division || row?.guest_division);
}
function rowEffectiveOn(row,dateKey){
  const from=clean(row?.effective_from).slice(0,10);
  const to=clean(row?.effective_to).slice(0,10);
  return (!from||from<=dateKey)&&(!to||to>=dateKey);
}
function activeStatus(row){
  return !['cancelled','canceled','resolved'].includes(clean(row?.status).toLowerCase());
}
function rosterName(data,row){
  const direct=clean(row?.student_name || row?.studentName || row?.guest_name || row?.guestName);
  if(direct) return direct;
  const id=clean(row?.student_id);
  if(!id) return '';
  const e=(Array.isArray(data?.enrollments)?data.enrollments:[]).find(x=>clean(x?.student_id)===id&&clean(x?.student_name));
  return clean(e?.student_name);
}
function createLabelBook(){
  const byName=new Map(),byLabel=new Map();
  return {
    label(name){
      const n=clean(name); if(!n) return '';
      if(byName.has(n)) return byName.get(n);
      const label='명단'+String(byName.size+1);
      byName.set(n,label);byLabel.set(label,n);return label;
    },
    restore(text){
      let value=String(text||'');
      Array.from(byLabel.entries())
        .sort((a,b)=>b[0].length-a[0].length)
        .forEach(([label,name])=>{value=value.split(label).join(name);});
      return value;
    },
    size(){return byName.size;}
  };
}
function requestedTimeText(intent){
  const raw=clean(intent?.originalText);
  const m=raw.match(/(\d{1,2})\s*시(?:\s*(30)\s*분|\s*반)?/);
  if(!m) return '';
  return String(Number(m[1]))+'시'+(m[2]||/\s반/.test(m[0])?' 30분':'');
}
function requestedGroup(intent){
  const g=clean(intent?.classGroup).toUpperCase();
  return ['A','B'].includes(g)?g:'';
}
function normalizeReadIntent(intent,sourceText){
  if(!intent||typeof intent!=='object') throw readError('시간표 조회 종류를 확인하지 못했습니다.',400,'OLLI_AGENT_TIMETABLE_READ_INTENT_REQUIRED');
  const type=clean(intent.intent);
  if(!['find_available_slots','find_roster_entries','find_pickups','multi_read_query'].includes(type)){
    throw readError('지원하지 않는 시간표 조회입니다.',400,'OLLI_AGENT_TIMETABLE_READ_INTENT_UNSUPPORTED');
  }
  const original=clean(intent.originalText);
  if(original && original!==clean(sourceText)){
    throw readError('시간표 조회 원문과 조회 조건이 일치하지 않습니다.',409,'OLLI_AGENT_TIMETABLE_READ_INTENT_SOURCE_MISMATCH');
  }
  return intent;
}
function readReferenceDate(intent,todayKey){
  if(clean(intent?.scope)==='week'){
    return addDaysKey(todayKey,Number(intent?.weekOffset||0)*7);
  }
  return resolveDateSpec(intent?.dateSpec,todayKey)||todayKey;
}
async function readWeek(requestContext,dateKey,callRpc){
  const data=await callRpc('olli_schedule_week',{
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_week_start:mondayKey(dateKey),
  });
  if(!data?.ok) throw readError(data?.message||'시간표를 조회하지 못했습니다.',403,data?.code||'OLLI_AGENT_TIMETABLE_WEEK_READ_FAILED');
  return data;
}
function matchesCommon(item,intent){
  const d=normalizeDivision(intent?.division);
  if(d&&item.division!==d) return false;
  const g=requestedGroup(intent); if(g&&item.class_group!==g) return false;
  const weekday=Number(intent?.weekday||0); if(weekday&&item.weekday!==weekday) return false;
  const wanted=requestedTimeText(intent); if(wanted&&item.time_label!==wanted) return false;
  return true;
}
async function readRoster({requestContext,intent,todayKey,labelBook,callRpc}){
  const scope=['date','week','all'].includes(clean(intent?.scope))?clean(intent.scope):'date';
  const reference=readReferenceDate(intent,todayKey);
  const data=await readWeek(requestContext,reference,callRpc);
  const mode=normalizeTimetableMode(data?.timetable_mode);
  const kind=clean(intent?.rosterKind)||'class_roster';
  const weekStart=mondayKey(reference);
  const start=scope==='week'?weekStart:reference;
  const end=scope==='week'?addDaysKey(weekStart,5):reference;
  const items=[];
  const push=(row,meta={})=>{
    const division=meta.division||rowDivision(row);
    const weekday=Number(meta.weekday||row?.weekday||row?.target_weekday||0);
    const slot=Number(meta.time_slot||row?.time_slot||row?.target_time_slot||0);
    const item={
      student_label:labelBook.label(meta.name||rosterName(data,row)),
      date:clean(meta.date),
      weekday,
      weekday_label:weekdayLabel(weekday),
      division,
      time_label:timeLabel(division,weekday,slot,mode),
      class_group:meta.class_group||groupOf(row),
      entry_kind:meta.entry_kind||kind,
      is_guest:meta.is_guest===true || row?.is_guest===true || !!clean(row?.guest_name),
    };
    if(item.student_label&&matchesCommon(item,intent)) items.push(item);
  };
  const inRange=(date)=>scope==='all'||(date>=start&&date<=end);

  if(kind==='class_roster'){
    for(const row of (Array.isArray(data?.enrollments)?data.enrollments:[])){
      const wd=Number(row?.weekday||0);
      const date=scope==='week'?addDaysKey(weekStart,wd-1):reference;
      if(wd<1||wd>6||!inRange(date)||isoWeekday(date)!==wd||!rowEffectiveOn(row,date)||clean(row?.status).toLowerCase()!=='active') continue;
      push(row,{date,entry_kind:'regular'});
    }
    for(const row of (Array.isArray(data?.one_time_sessions)?data.one_time_sessions:[])){
      const date=clean(row?.session_date).slice(0,10);
      if(!inRange(date)||!activeStatus(row)) continue;
      push(row,{date,weekday:isoWeekday(date),entry_kind:clean(row?.session_type).toLowerCase()==='trial'?'trial':'makeup'});
    }
  }else if(kind==='absence'){
    for(const row of (Array.isArray(data?.attendance_overrides)?data.attendance_overrides:[])){
      const date=clean(row?.session_date).slice(0,10);
      if(!inRange(date)||clean(row?.register_status).toLowerCase()!=='absent') continue;
      const wd=isoWeekday(date);
      const division=rowDivision(row) || rowDivision((data.enrollments||[]).find(e=>clean(e?.student_id)===clean(row?.student_id)&&Number(e?.weekday)===wd));
      push(row,{date,weekday:wd,division,entry_kind:'absence'});
    }
  }else if(kind==='makeup'||kind==='trial'){
    for(const row of (Array.isArray(data?.one_time_sessions)?data.one_time_sessions:[])){
      const date=clean(row?.session_date).slice(0,10);
      const trial=clean(row?.session_type).toLowerCase()==='trial';
      if(!inRange(date)||!activeStatus(row)||(kind==='trial')!==trial) continue;
      push(row,{date,weekday:isoWeekday(date),entry_kind:kind});
    }
  }else if(kind==='waitlist'){
    for(const row of (Array.isArray(data?.waitlist)?data.waitlist:[])){
      if(!['waiting','offered'].includes(clean(row?.status).toLowerCase())) continue;
      const wd=Number(row?.target_weekday||0);
      if(scope==='date'&&wd!==isoWeekday(reference)) continue;
      push(row,{date:scope==='date'?reference:'',weekday:wd,entry_kind:'waitlist'});
    }
  }else if(kind==='move'){
    for(const row of (Array.isArray(data?.changes)?data.changes:[])){
      if(clean(row?.status).toLowerCase()!=='scheduled'||clean(row?.change_type).toLowerCase()!=='move') continue;
      const date=clean(row?.effective_date).slice(0,10);
      if(scope!=='all'&&!inRange(date)) continue;
      const target=(data.enrollments||[]).find(e=>clean(e?.id)===clean(row?.target_enrollment_id))||row;
      push(target,{name:rosterName(data,row),date,entry_kind:'move'});
    }
  }
  return {kind,scope,reference_date:reference,timetable_mode:mode,count:items.length,items:items.slice(0,100),truncated:items.length>100};
}
async function readPickupRoster({requestContext,intent,todayKey,labelBook,callRpc}){
  const date=resolveDateSpec(intent?.dateSpec,todayKey)||todayKey;
  const data=await readWeek(requestContext,date,callRpc);
  const mode=normalizeTimetableMode(data?.timetable_mode);
  const weekday=isoWeekday(date);
  const wanted=requestedTimeText(intent);
  const kind=clean(intent?.kind)||'all';
  const items=[];
  for(const row of (Array.isArray(data?.pickups)?data.pickups:[])){
    if(Number(row?.weekday||0)!==weekday||!rowEffectiveOn(row,date)) continue;
    const division='kinder';
    const label=timeLabel(division,weekday,Number(row?.class_time||0),mode);
    if(wanted&&label!==wanted) continue;
    const isDropoff=row?.is_dropoff===true;
    if(kind==='dropoff'&&!isDropoff) continue;
    if(kind==='pickup'&&isDropoff) continue;
    const name=clean(row?.student_name)||rosterName(data,row);
    const studentLabel=labelBook.label(name);
    if(!studentLabel) continue;
    items.push({
      student_label:studentLabel,
      date,weekday,weekday_label:weekdayLabel(weekday),
      class_time_label:label,
      pickup_kind:isDropoff?'dropoff':'arrival',
      location:clean(isDropoff?(row?.dropoff_label||row?.pickup_label):row?.pickup_label).slice(0,80),
      pickup_time:isDropoff?'':clean(row?.pickup_time).slice(0,5),
    });
  }
  return {date,kind,count:items.length,items:items.slice(0,100),truncated:items.length>100};
}
async function readAvailability({requestContext,intent,todayKey,callRpc}){
  let start,end;
  const scope=clean(intent?.scope);
  if(scope==='week'){
    start=mondayKey(addDaysKey(todayKey,Number(intent?.weekOffset||0)*7)); end=addDaysKey(start,5);
  }else if(scope==='recurring'){
    const wd=Number(intent?.weekday||0);
    start=wd?resolveDateSpec({mode:'upcoming_weekday',weekday:wd},todayKey):todayKey;
    end=wd?start:addDaysKey(todayKey,13);
  }else{
    start=resolveDateSpec(intent?.dateSpec,todayKey)||todayKey; end=start;
  }
  const divisions=normalizeDivision(intent?.division)?[normalizeDivision(intent.division)]:['elementary','kinder'];
  const purpose=['regular','makeup','trial','wait'].includes(clean(intent?.purpose))?clean(intent.purpose):'regular';
  const group=requestedGroup(intent)||'ALL';
  const results=[];
  for(const division of divisions){
    results.push(await readScheduleAvailability({
      requestContext,division,purpose,startDate:start,endDate:end,timeSlot:0,classGroup:group,
      sanitizePayload(value){return value;},callRpc,
    }));
  }
  return {scope:scope||'date',view_mode:clean(intent?.viewMode)||'availability',purpose,start_date:start,end_date:end,results};
}
async function readTimetableIntent({requestContext,intent,sourceText,todayKey,labelBook,callRpc=callSupabaseRpc}){
  const fixed=normalizeReadIntent(intent,sourceText);
  if(fixed.intent==='multi_read_query'){
    const queries=Array.isArray(fixed.queries)?fixed.queries:[];
    if(queries.length<2||queries.length>3) throw readError('동시 조회는 2~3개 항목만 지원합니다.',400,'OLLI_AGENT_TIMETABLE_MULTI_READ_COUNT_INVALID');
    const results=[];
    for(const q of queries){
      const nested=Object.assign({},q,{originalText:clean(q?.originalText)});
      if(nested.intent==='find_roster_entries') results.push(await readRoster({requestContext,intent:nested,todayKey,labelBook,callRpc}));
      else if(nested.intent==='find_pickups') results.push(await readPickupRoster({requestContext,intent:nested,todayKey,labelBook,callRpc}));
      else if(nested.intent==='find_available_slots') results.push(await readAvailability({requestContext,intent:nested,todayKey,callRpc}));
      else throw readError('동시 조회에 지원하지 않는 항목이 있습니다.',400,'OLLI_AGENT_TIMETABLE_MULTI_READ_UNSUPPORTED');
    }
    return {intent:'multi_read_query',results};
  }
  if(fixed.intent==='find_roster_entries') return {intent:fixed.intent,result:await readRoster({requestContext,intent:fixed,todayKey,labelBook,callRpc})};
  if(fixed.intent==='find_pickups') return {intent:fixed.intent,result:await readPickupRoster({requestContext,intent:fixed,todayKey,labelBook,callRpc})};
  return {intent:fixed.intent,result:await readAvailability({requestContext,intent:fixed,todayKey,callRpc})};
}
function createTimetableReadTool({tool,z,requestContext,intent,sourceText,todayKey,labelBook}){
  if(typeof tool!=='function'||!z) throw readError('Agents SDK Tool 런타임이 준비되지 않았습니다.',500,'OLLI_AGENT_TOOL_RUNTIME_MISSING');
  return tool({
    name:'read_timetable_query',
    description:'서버가 원문에 고정한 시간표 조회를 읽기 전용으로 실행합니다. 조회 종류나 학생 범위를 변경할 수 없습니다.',
    parameters:z.object({}),
    async execute(){
      const payload=await readTimetableIntent({requestContext,intent,sourceText,todayKey,labelBook});
      return JSON.stringify(payload);
    },
  });
}
module.exports={
  parseDateKey,addDaysKey,isoWeekday,mondayKey,resolveDateSpec,createLabelBook,
  normalizeReadIntent,readRoster,readPickupRoster,readAvailability,readTimetableIntent,createTimetableReadTool,
};
