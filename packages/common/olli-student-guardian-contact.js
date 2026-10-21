(function(global) {
  'use strict';
  const states = new WeakMap();
  function ctx() { return {academyId:localStorage.getItem('olli_current_academy_id') || '',sessionToken:localStorage.getItem('olli_account_session_token_v1') || ''}; }
  function same(value) { const current=ctx();return current.academyId===value.academyId && current.sessionToken===value.sessionToken; }
  function allowed() { const role=typeof global.getOlliCurrentRole==='function'?global.getOlliCurrentRole():localStorage.getItem('olli_current_member_role');return ['owner','super_admin'].includes(role); }
  async function request(state,action,data={}) {
    if(!same(state.context))throw new Error('학원 또는 로그인 계정이 바뀌었습니다. 학생정보를 다시 열어 주세요.');
    const result=await global.callOlliRpc('olli_consultation_messages_manage',{p_session_token:state.context.sessionToken,p_academy_id:state.context.academyId,p_action:action,p_data:data});
    if(!same(state.context))throw new Error('학원 또는 로그인 계정이 바뀌었습니다.');
    if(result?.ok!==true)throw new Error(result?.message || '보호자 연락처를 저장하지 못했습니다.');
    return result;
  }
  function values(host) { return {phone:host.querySelector('[data-guardian-phone]').value.replace(/[^0-9]/g,''),enabled:host.querySelector('[data-guardian-enabled]').checked,confirmed:host.querySelector('[data-guardian-confirmed]').checked}; }
  function mount(root,student=null,options={}) {
    if(!root || !allowed())return;
    const id=String(student?.id || '');
    const previous=states.get(root);
    if(previous && previous.studentId===id && same(previous.context) && previous.host.isConnected && !options.reset)return;
    previous?.host.remove();
    const host=document.createElement('section');host.className='olliStudentGuardianContact';
    host.innerHTML='<label>보호자 연락처<input type="tel" inputmode="tel" autocomplete="off" maxlength="15" aria-label="보호자 연락처" placeholder="010-0000-0000" data-guardian-phone></label><div class="osgc-options"><label><input type="checkbox" data-guardian-enabled checked>상담 안내 대상</label><label><input type="checkbox" data-guardian-confirmed>보호자 번호 확인</label></div><small data-guardian-status role="status">학생정보의 저장 버튼으로 함께 저장됩니다.</small>';
    const actions=root.querySelector('.pcStudentInfoActions,.modalActions');
    if(actions)actions.before(host);else root.appendChild(host);
    const state={context:ctx(),studentId:id,host,loaded:!id,baseline:{phone:'',enabled:true,confirmed:false},registered:null};states.set(root,state);
    host.querySelector('[data-guardian-phone]').addEventListener('input',()=>{host.querySelector('[data-guardian-confirmed]').checked=false;});
    if(!id)return;
    host.querySelectorAll('input').forEach(input=>{input.disabled=true;});
    host.querySelector('[data-guardian-status]').textContent='저장된 보호자 연락처를 확인하고 있습니다.';
    request(state,'load').then(result=>{
      if(states.get(root)!==state || !host.isConnected)return;
      const contact=result.students.find(item=>String(item.id)===id);
      // No match must never be interpreted as an empty, writable existing contact.
      if(!contact)throw new Error('현재 재원생의 연락처를 확인하지 못했습니다.');
      state.baseline={phone:String(contact.phone || ''),enabled:contact.enabled!==false,confirmed:!!contact.confirmed};
      host.querySelector('[data-guardian-phone]').value=state.baseline.phone;
      host.querySelector('[data-guardian-enabled]').checked=state.baseline.enabled;
      host.querySelector('[data-guardian-confirmed]').checked=state.baseline.confirmed;
      state.loaded=true;host.querySelectorAll('input').forEach(input=>{input.disabled=false;});
      host.querySelector('[data-guardian-status]').textContent='학생정보의 저장 버튼으로 함께 저장됩니다.';
    }).catch(()=>{
      if(states.get(root)===state && host.isConnected)host.querySelector('[data-guardian-status]').textContent='연락처를 불러오지 못했습니다. 기존 번호를 보존합니다. 다시 열어 주세요.';
    });
  }
  function capture(root) {
    const state=states.get(root);if(!state || !state.loaded)return null;
    if(!same(state.context))throw new Error('학원 또는 로그인 계정이 바뀌었습니다.');
    const data=values(state.host);
    if(JSON.stringify(data)===JSON.stringify(state.baseline))return null;
    if(!data.phone && !state.baseline.phone)return null;
    if(!/^01[016789]\d{7,8}$/.test(data.phone))throw new Error('보호자 휴대전화 번호를 확인해 주세요. 안내를 중단하려면 상담 안내 대상 체크를 해제해 주세요.');
    return {state,data};
  }
  function registered(root) { const state=states.get(root);return state && same(state.context)?state.registered:null; }
  function markRegistered(root,student) { const state=states.get(root);if(state && same(state.context))state.registered=student; }
  async function save(root,student,captured) {
    if(!captured)return;
    const state=states.get(root);
    if(state!==captured.state || !state.host.isConnected || !same(state.context))throw new Error('학생정보가 변경되었습니다. 연락처는 저장하지 않았습니다.');
    if(!student?.id || student.__pending_sync)throw new Error('학생정보 서버 저장을 확인한 뒤 보호자 연락처를 다시 저장해 주세요.');
    try {
      const result=await request(state,'contact',{student_id:student.id,...captured.data});
      const verified=result.students.find(item=>String(item.id)===String(student.id));
      if(!verified || verified.phone!==captured.data.phone || verified.enabled!==captured.data.enabled || verified.confirmed!==captured.data.confirmed)throw new Error('연락처 저장 결과가 일치하지 않습니다.');
      state.baseline={...captured.data};
      state.host.querySelector('[data-guardian-status]').textContent='보호자 연락처를 저장했습니다.';
    } catch(error) { throw new Error('학생정보는 저장되었지만 보호자 연락처 저장을 완료하지 못했습니다. 입력한 번호는 화면에 남아 있습니다. 다시 저장해 주세요.\n'+error.message); }
  }
  global.OlliGuardianContact=Object.freeze({mount,capture,save,registered,markRegistered});
})(window);
