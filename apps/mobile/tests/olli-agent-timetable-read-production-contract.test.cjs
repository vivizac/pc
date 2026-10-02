const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(root,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const readTool=fs.readFileSync(path.join(root,'api/_lib/olli-agent/tools/timetable-read-tools.cjs'),'utf8');
const scheduleTool=fs.readFileSync(path.join(root,'api/_lib/olli-agent/tools/schedule-tools.cjs'),'utf8');
const attendanceTool=fs.readFileSync(path.join(root,'api/_lib/olli-agent/tools/attendance-tools.cjs'),'utf8');
const pickupTool=fs.readFileSync(path.join(root,'api/_lib/olli-agent/tools/pickup-tools.cjs'),'utf8');
const sharedRouter=require('../../../packages/common/olli-command-router-common.js');

const {
  createLabelBook,
  readRoster,
  readAvailability,
}=require('../api/_lib/olli-agent/tools/timetable-read-tools.cjs');

function requestContext(){
  return {
    sessionToken:'secret',
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
  };
}

test('production exposes source-bound timetable, student schedule, attendance, and pickup reads',()=>{
  for(const mode of ['timetable_read','schedule_read','attendance_read','pickup_read']){
    assert.match(endpoint,new RegExp("'"+mode+"'"));
  }
  assert.match(endpoint,/OLLI_AGENT_READ_SOURCE_MESSAGE_REQUIRED/);
  assert.match(endpoint,/runTimetableRead\(/);
  assert.match(endpoint,/runStudentScheduleRead\(/);
  assert.match(endpoint,/runAttendanceRead\(/);
  assert.match(endpoint,/runPickupRead\(/);
  assert.match(runtime,/validatePickupSourceMessage\(/);
});

test('timetable read operation is fixed by server input and tool has zero query parameters',()=>{
  assert.match(readTool,/normalizeReadIntent\(intent,sourceText\)/);
  assert.match(readTool,/find_available_slots/);
  assert.match(readTool,/find_roster_entries/);
  assert.match(readTool,/find_pickups/);
  assert.match(readTool,/multi_read_query/);
  const start=readTool.indexOf("name:'read_timetable_query'");
  const schema=readTool.slice(start,readTool.indexOf('async execute()',start));
  assert.match(schema,/parameters:z\.object\(\{\}\)/);
});

test('class roster is anonymized before model-facing result and restored only by label book',async()=>{
  const labelBook=createLabelBook();
  const result=await readRoster({
    requestContext:requestContext(),
    intent:{
      intent:'find_roster_entries',
      rosterKind:'class_roster',
      scope:'date',
      division:'elementary',
      dateSpec:{mode:'today'},
      originalText:'오늘 초등부 수업 학생 보여줘'
    },
    todayKey:'2026-10-02',
    labelBook,
    callRpc:async(name)=>{
      assert.equal(name,'olli_schedule_week');
      return {
        ok:true,
        timetable_mode:'hourly',
        enrollments:[{
          id:'e1',
          student_id:'s1',
          student_name:'실제학생',
          division:'elementary',
          weekday:5,
          time_slot:4,
          class_group:'A',
          status:'active',
          effective_from:'2026-01-01',
          effective_to:null,
        }],
        one_time_sessions:[],
      };
    }
  });
  assert.equal(result.count,1);
  assert.equal(result.items[0].student_label,'명단1');
  assert.doesNotMatch(JSON.stringify(result),/실제학생|s1|e1/);
  assert.equal(labelBook.restore('명단1 학생'),'실제학생 학생');
});

test('availability Agent result keeps visible labels but strips internal time_slot',async()=>{
  const result=await readAvailability({
    requestContext:requestContext(),
    intent:{
      intent:'find_available_slots',
      division:'elementary',
      purpose:'makeup',
      scope:'date',
      dateSpec:{mode:'today'},
      classGroup:'A',
      originalText:'오늘 초등부 보강 자리 알려줘'
    },
    todayKey:'2026-10-02',
    callRpc:async(name)=>{
      assert.equal(name,'olli_schedule_availability_slots');
      return {
        ok:true,
        timetable_mode:'half_hour',
        capacity:8,
        closed_dates:[],
        slots:[{
          date:'2026-10-02',weekday:5,time_slot:10,class_group:'A',grouped:false,
          capacity:8,regular_count:6,absent_count:0,effective_regular_count:6,
          makeup_count:0,trial_count:0,one_time_count:0,occupancy:6,remaining:2,
          waitlist_count:0,waitlist_open:true,class_full:false,available:true,
        }]
      };
    }
  });
  assert.equal(result.results[0].slots[0].time_label,'4시 30분');
  assert.equal(Object.hasOwn(result.results[0].slots[0],'time_slot'),false);
});

test('all student read tools strip internal slot identifiers before model serialization',()=>{
  assert.match(scheduleTool,/delete copy\.time_slot/);
  assert.match(attendanceTool,/delete copy\.time_slot/);
  assert.match(pickupTool,/delete copy\.class_time/);
  assert.match(readTool,/delete copy\.time_slot/);
});

test('runtime reparses the stored source with the shared router and restores labels only after model execution',()=>{
  assert.equal(typeof sharedRouter.parseQueryIntent,'function');
  assert.match(runtime,/function loadSharedCommandRouter/);
  const start=runtime.indexOf('async function runTimetableRead({');
  const end=runtime.indexOf('\n\nmodule.exports = {',start);
  const block=runtime.slice(start,end);
  assert.match(block,/router\.parseQueryIntent\(String\(sourceMessageText/);
  assert.match(block,/OLLI_AGENT_TIMETABLE_READ_INTENT_MISMATCH/);
  assert.match(block,/labelBook\.restore/);
  assert.match(block,/restorePreparedSubjectLabels/);
  assert.ok(block.indexOf('await run\(agent')<block.indexOf('labelBook.restore'));
});


test('regular class roster does not require a status field already filtered by Production RPC',async()=>{
  const labelBook=createLabelBook();
  const result=await readRoster({
    requestContext:requestContext(),
    intent:{
      intent:'find_roster_entries',
      rosterKind:'class_roster',
      scope:'date',
      division:'elementary',
      dateSpec:{mode:'today'},
      originalText:'오늘 초등부 수업 학생 보여줘'
    },
    todayKey:'2026-10-02',
    labelBook,
    callRpc:async(name)=>{
      assert.equal(name,'olli_schedule_week');
      return {
        ok:true,
        timetable_mode:'hourly',
        enrollments:[{
          id:'e1',student_id:'s1',student_name:'실제학생',division:'elementary',
          weekday:5,time_slot:4,class_group:'A',effective_from:'2026-01-01',effective_to:null
        }],
        one_time_sessions:[],
      };
    }
  });
  assert.equal(result.student_count,1);
  assert.equal(result.items[0].student_label,'명단1');
});

test('absence roster reads authoritative session overrides and never exposes ids',async()=>{
  const labelBook=createLabelBook();
  const calls=[];
  const result=await readRoster({
    requestContext:requestContext(),
    intent:{
      intent:'find_roster_entries',
      rosterKind:'absence',
      scope:'date',
      division:'elementary',
      dateSpec:{mode:'today'},
      originalText:'오늘 초등부 결석 학생 누구야'
    },
    todayKey:'2026-10-02',
    labelBook,
    callRpc:async(name)=>{
      calls.push(name);
      if(name==='olli_schedule_week'){
        return {
          ok:true,timetable_mode:'hourly',
          enrollments:[{
            id:'e1',student_id:'s1',student_name:'실제학생',division:'elementary',
            weekday:5,time_slot:4,class_group:'A',effective_from:'2026-01-01',effective_to:null
          }]
        };
      }
      if(name==='olli_schedule_attendance_session_overrides_range'){
        return {ok:true,overrides:[{
          id:'override-secret',student_id:'s1',session_date:'2026-10-02',
          time_slot:4,class_group:'A',register_session_kind:'regular',register_status:'absent'
        }]};
      }
      throw new Error('unexpected RPC: '+name);
    }
  });
  assert.deepEqual(calls,['olli_schedule_week','olli_schedule_attendance_session_overrides_range']);
  assert.equal(result.student_count,1);
  assert.doesNotMatch(JSON.stringify(result),/s1|e1|override-secret|실제학생/);
  assert.equal(labelBook.restore(result.items[0].student_label),'실제학생');
});

test('pickup roster merges Production dropoff flags before Agent egress',async()=>{
  const {readPickupRoster}=require('../api/_lib/olli-agent/tools/timetable-read-tools.cjs');
  const labelBook=createLabelBook();
  const result=await readPickupRoster({
    requestContext:requestContext(),
    intent:{
      intent:'find_pickups',
      dateSpec:{mode:'today'},
      kind:'dropoff',
      originalText:'오늘 하원 픽업 누구 있어'
    },
    todayKey:'2026-10-02',
    labelBook,
    callRpc:async(name)=>{
      if(name==='olli_schedule_week'){
        return {
          ok:true,timetable_mode:'hourly',
          pickups:[{
            id:'pickup-secret',student_id:'s1',student_name:'실제학생',
            weekday:5,class_time:4,pickup_label:'기존장소',pickup_time:null,
            effective_from:'2026-01-01',effective_to:null
          }]
        };
      }
      if(name==='olli_schedule_pickup_dropoff_flags'){
        return {ok:true,flags:[{id:'pickup-secret',is_dropoff:true,dropoff_label:'정문'}]};
      }
      throw new Error('unexpected RPC: '+name);
    }
  });
  assert.equal(result.student_count,1);
  assert.equal(result.items[0].pickup_kind,'dropoff');
  assert.equal(result.items[0].location,'정문');
  assert.doesNotMatch(JSON.stringify(result),/pickup-secret|s1|실제학생/);
});

test('move roster keeps visible source and target schedule without internal ids',async()=>{
  const labelBook=createLabelBook();
  const result=await readRoster({
    requestContext:requestContext(),
    intent:{
      intent:'find_roster_entries',
      rosterKind:'move',
      scope:'all',
      originalText:'현재 수업 이동 예약 학생 누구야'
    },
    todayKey:'2026-10-02',
    labelBook,
    callRpc:async(name)=>{
      assert.equal(name,'olli_schedule_week');
      return {
        ok:true,timetable_mode:'hourly',
        enrollments:[
          {id:'source-secret',student_id:'s1',student_name:'실제학생',division:'elementary',weekday:2,time_slot:4,class_group:'A',effective_from:'2026-01-01'},
          {id:'target-secret',student_id:'s1',student_name:'실제학생',division:'elementary',weekday:4,time_slot:5,class_group:'B',effective_from:'2026-10-08'},
        ],
        changes:[{
          id:'change-secret',student_id:'s1',student_name:'실제학생',division:'elementary',
          change_type:'move',source_enrollment_id:'source-secret',target_enrollment_id:'target-secret',
          effective_date:'2026-10-08',status:'scheduled'
        }]
      };
    }
  });
  assert.equal(result.student_count,1);
  assert.equal(result.items[0].source_weekday_label,'화요일');
  assert.equal(result.items[0].source_time_label,'4시');
  assert.equal(result.items[0].target_weekday_label,'목요일');
  assert.equal(result.items[0].target_time_label,'5시');
  assert.doesNotMatch(JSON.stringify(result),/source-secret|target-secret|change-secret|s1|실제학생/);
});
