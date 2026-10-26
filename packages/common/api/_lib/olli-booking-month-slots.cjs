'use strict';
// Calendar-month aggregation reuses the existing single-day booking RPCs.
// Keep the guardian API private and do not persist reservation data in browser storage.
const DAY_MS=86400000;
function dateIso(utc){return new Date(utc).toISOString().slice(0,10);}
function kstToday(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return o.year+'-'+o.month+'-'+o.day;
}
function monthDays(month,now=new Date()){
 if(typeof month!=='string'||!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(month))
  throw new Error('MONTH_INVALID');
 const today=kstToday(now);
 const horizon=dateIso(Date.parse(today+'T00:00:00Z')+120*DAY_MS);
 if(month<today.slice(0,7)||month>horizon.slice(0,7))
  throw new Error('MONTH_INVALID');
 const [year,n]=month.split('-').map(Number);
 const end=new Date(Date.UTC(year,n,0)).getUTCDate();
 return Array.from({length:end},(_,i)=>month+'-'+String(i+1).padStart(2,'0'))
  .filter(d=>d>=today&&d<=horizon);
}
function allowedDate(date,weeks,weekdays){
 const [year,month,day]=date.split('-').map(Number);
 const first=new Date(Date.UTC(year,month-1,1)).getUTCDay();
 const dayOfWeek=new Date(Date.UTC(year,month-1,day)).getUTCDay();
 const week=Math.floor((day-1+first)/7)+1;
 const iso=(dayOfWeek+6)%7+1;
 return weeks.includes(week)&&weekdays.includes(iso);
}
async function collectMonthSlots({month,weeks,weekdays,fetchDay,now=new Date()}){
 const days=monthDays(month,now);
 const weeksSafe=Array.isArray(weeks)?weeks.filter(v=>Number.isInteger(v)&&v>=1&&v<=6):[2,3];
 const weekdaysSafe=Array.isArray(weekdays)?weekdays.filter(v=>Number.isInteger(v)&&v>=1&&v<=7):[1,2,3,4,5];
 const slotsByDate=Object.create(null);
 for(const day of days)slotsByDate[day]=[];
 const enabled=days.filter(d=>allowedDate(d,weeksSafe,weekdaysSafe));
 // Limit concurrent database calls so a single browser cannot fan out 31 RPCs at once.
 for(let i=0;i<enabled.length;i+=4){
  const batch=enabled.slice(i,i+4);
  const results=await Promise.all(batch.map(d=>fetchDay(d)));
  for(let j=0;j<batch.length;j++){
   if(!Array.isArray(results[j]))throw new Error('MONTH_SLOTS_INVALID');
   slotsByDate[batch[j]]=results[j];
  }
 }
 return slotsByDate;
}
module.exports={collectMonthSlots,monthDays,allowedDate,kstToday};
