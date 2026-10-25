'use strict';

/** Shared UI/server policy for academy-local consultation booking. Authoritative
 * authorization and collision checks remain in PostgreSQL. */
const DEFAULT_BOOKING_SETTINGS=Object.freeze({
  weeks:Object.freeze([2,3]),
  weekdays:Object.freeze([1,2,3,4,5]),
  startTime:'11:00',
  endTime:'17:00',
  slotMinutes:30,
  timezone:'Asia/Seoul',
  allowParentReschedule:true,
  allowParentCancel:true
});
function calendarDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('INVALID_DATE');
  const day=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value)throw new Error('INVALID_DATE');
  return day;
}
function calendarWeekOfMonth(value){
  const date=calendarDate(value);
  const first=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));
  const firstMondayOffset=(first.getUTCDay()+6)%7;
  return Math.floor((date.getUTCDate()-1+firstMondayOffset)/7)+1;
}
function isoWeekday(value){return (calendarDate(value).getUTCDay()+6)%7+1;}
function toMinutes(value){
  if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new Error('INVALID_TIME');
  return Number(value.slice(0,2))*60+Number(value.slice(3,5));
}
function formatMinutes(m){return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
function listBaseSlots(date,settings=DEFAULT_BOOKING_SETTINGS){
  const week=calendarWeekOfMonth(date),weekday=isoWeekday(date);
  if(!settings.weeks.includes(week)||!settings.weekdays.includes(weekday))return [];
  if(settings.timezone!=='Asia/Seoul')throw new Error('UNSUPPORTED_TIMEZONE');
  const start=toMinutes(settings.startTime),end=toMinutes(settings.endTime);
  const interval=Number(settings.slotMinutes);
  if(![15,30,60].includes(interval)||start>=end)throw new Error('INVALID_SETTINGS');
  const out=[];
  for(let min=start;min+interval<=end;min+=interval)out.push(formatMinutes(min));
  return out;
}
module.exports={DEFAULT_BOOKING_SETTINGS,calendarWeekOfMonth,isoWeekday,listBaseSlots};
