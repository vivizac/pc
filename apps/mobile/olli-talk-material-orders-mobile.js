(function initializeOlliMobileTeamTalkMaterialOrders(global){
  'use strict';

  if (global.OlliMobileTeamTalkMaterialOrders?.version) return;

  const VERSION='1.0.2';
  const SESSION_KEY='olli_account_session_token_v1';
  const CACHE_PREFIX='olli_team_material_requests_cache_v1:';
  const LAST_CACHE_CONTEXT_KEY='olli_team_chat_last_cache_context_v1';
  const state={
    root:null,
    items:[],
    summary:{requested:0,on_hold:0,ordered:0,arrived:0},
    expandedId:'',
    currentRole:'',
    canProcess:false,
    loading:false,
    creating:false,
    processing:false,
    sequence:0,
    filter:'all',
    search:'',
    realtimeWatcher:null,
    createRoot:null,
    localSnapshotAvailable:false
  };

  const clean=value=>String(value==null?'':value).trim();

  function localAccountId(){
    try{return clean(localStorage.getItem('olli_account_id_v1'))}catch(_){return ''}
  }

  function readLastCacheContext(){
    try{
      const raw=localStorage.getItem(LAST_CACHE_CONTEXT_KEY);
      const parsed=raw?JSON.parse(raw):null;
      const accountId=localAccountId();
      if(!parsed?.academy_id||!accountId||clean(parsed.account_id)!==accountId)return null;
      return parsed;
    }catch(_){return null}
  }

  function rememberLastCacheContext(academyId){
    const id=clean(academyId),accountId=localAccountId();
    if(!id||!accountId)return false;
    try{
      localStorage.setItem(LAST_CACHE_CONTEXT_KEY,JSON.stringify({
        academy_id:id,
        account_id:accountId,
        saved_at:new Date().toISOString()
      }));
      return true;
    }catch(_){return false}
  }

  function context(){
    let academyContext=null;
    try{academyContext=global.OlliStorageCore?.AcademyContext?.getCurrent?.()||null}catch(_){}
    let academyId='',memberId='',sessionToken='';
    try{
      academyId=clean(localStorage.getItem('olli_current_academy_id'));
      memberId=clean(localStorage.getItem('olli_current_member_id'));
      sessionToken=clean(localStorage.getItem(SESSION_KEY));
    }catch(_){}
    const resolvedAcademyId=clean(academyContext?.academyId||academyContext?.academy_id||academyId||readLastCacheContext()?.academy_id);
    return{
      academyId:resolvedAcademyId,
      memberId:clean(academyContext?.memberId||academyContext?.member_id||memberId),
      sessionToken
    };
  }

  function cacheKey(academyId){
    const id=clean(academyId);
    return id?(CACHE_PREFIX+id):'';
  }

  function readCache(current=context()){
    const key=cacheKey(current?.academyId);
    if(!key)return null;
    try{
      const raw=localStorage.getItem(key);
      const cached=raw?JSON.parse(raw):null;
      if(!cached||clean(cached.academy_id)!==clean(current?.academyId))return null;
      const accountId=localAccountId();
      if(accountId&&clean(cached.account_id)!==accountId)return null;
      return cached;
    }catch(_){return null}
  }

  function writeCache(current,payload){
    const key=cacheKey(current?.academyId);
    if(!key||!payload)return false;
    try{
      localStorage.setItem(key,JSON.stringify({
        academy_id:clean(current.academyId),
        account_id:localAccountId(),
        items:Array.isArray(payload.items)?payload.items:[],
        summary:payload.summary||{},
        current_role:clean(payload.current_role),
        can_process:payload.can_process===true,
        cached_at:new Date().toISOString()
      }));
      rememberLastCacheContext(current.academyId);
      return true;
    }catch(_){return false}
  }

  async function rpc(name,params){
    const call=typeof global.supabase==='function'
      ?global.supabase
      :(typeof supabase==='function'?supabase:null);
    if(!call)throw new Error('Supabase 연결이 준비되지 않았습니다.');
    return call('POST',`rpc/${name}`,params);
  }

  function create(tag,className,text){
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined&&text!==null)node.textContent=String(text);
    return node;
  }

  function rootQuery(selector){return state.root?.querySelector(selector)||null}

  function statusMeta(status){
    const map={
      requested:{label:'요청',className:'requested'},
      on_hold:{label:'보류',className:'hold'},
      ordered:{label:'주문',className:'ordered'},
      arrived:{label:'도착',className:'arrived'}
    };
    return map[clean(status)]||map.requested;
  }

  function formatDate(value){
    const text=clean(value);
    if(!text)return '미지정';
    const date=new Date(text+(text.length===10?'T00:00:00':''));
    if(!Number.isFinite(date.getTime()))return text;
    return `${date.getMonth()+1}월 ${date.getDate()}일`;
  }

  function formatDateTime(value){
    const date=new Date(value||0);
    if(!Number.isFinite(date.getTime()))return '';
    const y=date.getFullYear();
    const m=String(date.getMonth()+1).padStart(2,'0');
    const d=String(date.getDate()).padStart(2,'0');
    const hh=String(date.getHours()).padStart(2,'0');
    const mm=String(date.getMinutes()).padStart(2,'0');
    return `${y}.${m}.${d} ${hh}:${mm}`;
  }

  function clientMutationId(){
    if(global.crypto?.randomUUID)return global.crypto.randomUUID();
    return `material-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  }

  const OLLI_COFFEE_THUMBS=[
    '/assets/olli-coffee/coffee-1.webp',
    '/assets/olli-coffee/coffee-2.webp',
    '/assets/olli-coffee/coffee-3.webp',
    '/assets/olli-coffee/coffee-4.webp',
    '/assets/olli-coffee/coffee-5.webp',
    '/assets/olli-coffee/coffee-6.webp',
    '/assets/olli-coffee/coffee-7.webp'
  ];

  // Work Hub is rendered from local cache while its page can still be hidden.
  // Keep these tiny bundled thumbnails warm so remounts/tab switches do not
  // wait for lazy loading/async decode after the page becomes visible.
  const OLLI_COFFEE_THUMB_PRELOADS=OLLI_COFFEE_THUMBS.map(src=>{
    const image=new Image();
    image.decoding='async';
    image.src=src;
    image.decode?.().catch(()=>{});
    return image;
  });

  function coffeeThumbIndex(value){
    const text=String(value||'');
    let hash=2166136261;
    for(let i=0;i<text.length;i+=1){
      hash^=text.charCodeAt(i);
      hash=Math.imul(hash,16777619);
    }
    return Math.abs(hash>>>0)%OLLI_COFFEE_THUMBS.length;
  }

  function coffeeThumb(item){
    const seed=clean(item?.id)||[item?.created_at,item?.item_name].filter(Boolean).join('|');
    const wrap=create('span','olliMobileMatCoffeeThumb');
    const image=document.createElement('img');
    image.alt='';
    image.loading='eager';
    image.decoding='sync';
    image.src=OLLI_COFFEE_THUMBS[coffeeThumbIndex(seed)];
    wrap.appendChild(image);
    return wrap;
  }

  function createMaterialCreateModalHtml(titleId='olliMobileMatCreateTitle'){
    return `
        <div class="olliMobileMatModalBackdrop" data-material-modal hidden>
          <div class="olliMobileMatModal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
            <div class="olliMobileMatModalHead">
              <div>
                <div class="olliMobileMatModalTitle" id="${titleId}" data-material-modal-title>재료 요청 등록</div>
                <div class="olliMobileMatModalSub" data-material-modal-sub>필요한 재료와 필요한 날짜를 적어 주세요.</div>
              </div>
              <button class="olliMobileMatIconBtn" type="button" data-material-action="close-create" aria-label="닫기">×</button>
            </div>
            <form class="olliMobileMatForm" data-material-form data-request-kind="material">
              <label class="olliMobileMatField olliMobileMatFieldWide">
                <span data-material-item-label>재료명 <b>*</b></span>
                <input name="item_name" maxlength="120" required placeholder="예: 아크릴 물감 12색" data-material-item-input>
              </label>
              <label class="olliMobileMatField">
                <span>수량 <b>*</b></span>
                <input name="quantity_text" maxlength="60" required placeholder="예: 2세트">
              </label>
              <label class="olliMobileMatField">
                <span>필요일</span>
                <input name="needed_on" type="date">
              </label>
              <label class="olliMobileMatField olliMobileMatFieldWide">
                <span data-material-use-label>사용수업</span>
                <input name="use_context" maxlength="160" placeholder="예: 초등부 수요일 3시" data-material-use-input>
              </label>
              <label class="olliMobileMatField olliMobileMatFieldWide">
                <span>구매링크</span>
                <input name="purchase_url" type="url" maxlength="2000" placeholder="https://">
              </label>
              <label class="olliMobileMatField olliMobileMatFieldWide">
                <span>메모</span>
                <textarea name="memo" maxlength="1000" rows="4" placeholder="색상, 규격 등 주문할 때 참고할 내용을 적어 주세요."></textarea>
              </label>
              <div class="olliMobileMatFormActions">
                <button class="olliMobileMatSecondaryBtn" type="button" data-material-action="close-create">취소</button>
                <button class="olliMobileMatPrimaryBtn" type="submit" data-material-submit>요청 등록</button>
              </div>
            </form>
          </div>
        </div>`;
  }

  function configureCreateForm(root,variant='material'){
    const isCoffee=variant==='coffee';
    const form=root?.querySelector('[data-material-form]');
    if(!form)return false;
    form.dataset.requestKind=isCoffee?'coffee':'material';
    const title=root.querySelector('[data-material-modal-title]');
    const sub=root.querySelector('[data-material-modal-sub]');
    const itemLabel=root.querySelector('[data-material-item-label]');
    const itemInput=root.querySelector('[data-material-item-input]');
    const useLabel=root.querySelector('[data-material-use-label]');
    const useInput=root.querySelector('[data-material-use-input]');
    if(title)title.textContent=isCoffee?'커피주문':'재료 요청 등록';
    if(sub)sub.textContent=isCoffee?'필요한 커피와 필요한 날짜를 적어주세요.':'필요한 재료와 필요한 날짜를 적어 주세요.';
    if(itemLabel)itemLabel.innerHTML=`${isCoffee?'커피명':'재료명'} <b>*</b>`;
    if(itemInput)itemInput.placeholder='예: 아크릴 물감 12색';
    if(useLabel)useLabel.textContent=isCoffee?'픽업':'사용수업';
    if(useInput)useInput.placeholder='예: 초등부 수요일 3시';
    return true;
  }

  function shellHtml(){
    return `
      <section class="olliMobileMatRoot" aria-label="팀톡 재료주문">
        <div class="olliMobileMatSummary" aria-label="재료 주문 현황">
          <button class="olliMobileMatSummaryCard requested" type="button" data-material-filter="requested">
            <span class="olliMobileMatSummaryIcon coffee" aria-hidden="true"><svg viewBox="0 0 86 99"><path d="M18 8h50v10H18z"></path><path d="M12 18h62"></path><path d="M17 22h52l-6 67H23l-6-67Z"></path><circle cx="43" cy="50" r="9"></circle></svg></span>
            <span class="olliMobileMatSummaryLabel">요청</span>
            <strong data-material-count="requested">0</strong>
          </button>
          <button class="olliMobileMatSummaryCard ordered" type="button" data-material-filter="ordered">
            <span class="olliMobileMatSummaryIcon receipt" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3.5h10v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4V3.5Z"></path><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3.5"></path></svg></span>
            <span class="olliMobileMatSummaryLabel">주문</span>
            <strong data-material-count="ordered">0</strong>
          </button>
          <button class="olliMobileMatSummaryCard arrived" type="button" data-material-filter="arrived">
            <span class="olliMobileMatSummaryIcon delivery" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 7h6v5h-6zM9.5 12h4.2l1.7-4h2.2l2.2 4v3.2h-1.4"></path><path d="M13.7 15.2H8.4"></path><circle cx="6.2" cy="16.5" r="2"></circle><circle cx="17.2" cy="16.5" r="2"></circle></svg></span>
            <span class="olliMobileMatSummaryLabel">도착</span>
            <strong data-material-count="arrived">0</strong>
          </button>
        </div>
        <div class="olliMobileMatList" data-material-list></div>
        <button aria-label="요청 등록" class="olliMobileMatCreateBtn" type="button" data-material-action="open-create">
          <svg aria-hidden="true" viewBox="0 0 24 24"><line x1="12" x2="12" y1="5" y2="19"></line><line x1="5" x2="19" y1="12" y2="12"></line></svg>
        </button>
        <div class="olliMobileMatToast" data-material-toast hidden></div>
      </section>`;
  }

  function showToast(message,tone){
    const quickToast=state.createRoot?.querySelector('[data-material-toast]');
    const quickModal=state.createRoot?.querySelector('[data-material-modal]');
    const quickActive=!!(
      quickToast &&
      state.createRoot?.isConnected &&
      (quickModal?.hidden===false || !state.root?.isConnected)
    );
    const toast=quickActive?quickToast:rootQuery('[data-material-toast]');
    if(!toast)return;
    toast.textContent=clean(message);
    toast.className=`olliMobileMatToast ${tone==='error'?'error':'ok'}`;
    toast.hidden=!toast.textContent;
    if(toast.hidden)return;
    clearTimeout(showToast.timer);
    showToast.timer=setTimeout(()=>{if(toast.isConnected)toast.hidden=true},2800);
  }

  function requestCount(){
    return Math.max(0,Number(state.summary?.requested||0))+Math.max(0,Number(state.summary?.on_hold||0));
  }

  function renderSummary(){
    const values={
      requested:requestCount(),
      ordered:Math.max(0,Number(state.summary?.ordered||0)),
      arrived:Math.max(0,Number(state.summary?.arrived||0))
    };
    Object.entries(values).forEach(([key,value])=>{
      const node=rootQuery(`[data-material-count="${key}"]`);
      if(node)node.textContent=String(value);
    });
    state.root?.querySelectorAll('[data-material-filter]').forEach(button=>{
      button.classList.toggle('active',button.dataset.materialFilter===state.filter);
    });
  }

  function matchesFilter(item){
    const status=clean(item?.status);
    if(state.filter==='requested'&&!['requested','on_hold'].includes(status))return false;
    if(state.filter==='ordered'&&status!=='ordered')return false;
    if(state.filter==='arrived'&&status!=='arrived')return false;
    const q=state.search.toLowerCase();
    if(!q)return true;
    return[item?.item_name,item?.quantity_text,item?.requested_by_name,item?.use_context,item?.memo]
      .some(value=>clean(value).toLowerCase().includes(q));
  }

  function filteredItems(){return state.items.filter(matchesFilter)}

  function detailRow(label,valueNode){
    const row=create('div','olliMobileMatDetailRow');
    row.appendChild(create('dt','',label));
    const dd=create('dd');
    if(valueNode instanceof Node)dd.appendChild(valueNode);
    else dd.textContent=clean(valueNode)||'-';
    row.appendChild(dd);
    return row;
  }

  function actionButton(label,nextStatus,className,id){
    const button=document.createElement('button');
    button.type='button';
    button.className=className;
    button.dataset.materialSetStatus=nextStatus;
    button.dataset.materialId=id;
    button.textContent=label;
    button.disabled=state.processing;
    return button;
  }

  function deleteButton(id){
    const button=document.createElement('button');
    button.type='button';
    button.className='olliMobileMatDeleteBtn';
    button.dataset.materialDelete='1';
    button.dataset.materialId=id;
    button.textContent='삭제';
    button.disabled=state.processing;
    return button;
  }

  function createDetail(item){
    const wrap=create('div','olliMobileMatExpandedDetail');
    const dl=create('dl','olliMobileMatDetailGrid');
    dl.append(
      detailRow('품목명',item.item_name),
      detailRow('수량',item.quantity_text),
      detailRow('필요일',item.needed_on?formatDate(item.needed_on):'미지정'),
      detailRow('사용수업',item.use_context||'미지정'),
      detailRow('요청자',item.requested_by_name||'-')
    );
    if(item.purchase_url){
      const link=document.createElement('a');
      link.href=item.purchase_url;
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.className='olliMobileMatPurchaseLink';
      link.textContent='구매링크 열기 ↗';
      dl.appendChild(detailRow('구매링크',link));
    }else{
      dl.appendChild(detailRow('구매링크','없음'));
    }
    wrap.appendChild(dl);

    const memo=create('section','olliMobileMatMemo');
    memo.append(
      create('div','olliMobileMatMemoLabel','메모'),
      create('div','olliMobileMatMemoText',clean(item.memo)||'등록된 메모가 없습니다.')
    );
    wrap.appendChild(memo);

    if(item.status==='on_hold'&&clean(item.hold_reason)){
      const hold=create('section','olliMobileMatHoldReason');
      hold.append(create('strong','','보류 사유'),create('span','',item.hold_reason));
      wrap.appendChild(hold);
    }

    const audit=create('div','olliMobileMatAudit');
    const auditText=[clean(item.status_changed_by_name),formatDateTime(item.status_changed_at)].filter(Boolean).join(' · ');
    if(auditText)audit.textContent=auditText;
    wrap.appendChild(audit);

    const actions=create('div','olliMobileMatActions');
    const id=clean(item.id);
    if(!state.canProcess){
      actions.appendChild(create('div','olliMobileMatReadOnlyNote','주문 상태는 원장 또는 관리자가 변경합니다.'));
    }else if(item.status==='requested'){
      actions.append(
        deleteButton(id),
        actionButton('보류','on_hold','olliMobileMatSecondaryBtn',id),
        actionButton('주문완료','ordered','olliMobileMatDarkBtn',id)
      );
    }else if(item.status==='on_hold'){
      actions.append(
        deleteButton(id),
        actionButton('요청으로','requested','olliMobileMatSecondaryBtn',id),
        actionButton('주문완료','ordered','olliMobileMatDarkBtn',id)
      );
    }else if(item.status==='ordered'){
      actions.appendChild(actionButton('도착처리','arrived','olliMobileMatPrimaryBtn',id));
    }else{
      actions.appendChild(create('div','olliMobileMatDoneNote','도착 처리가 완료된 요청입니다.'));
    }
    wrap.appendChild(actions);
    return wrap;
  }

  function renderList(){
    const body=rootQuery('[data-material-list]');
    if(!body)return;
    const items=filteredItems();
    body.replaceChildren();

    if(state.loading&&!state.items.length){
      const empty=create('div','olliMobileMatEmpty');
      empty.append(create('strong','','재료 요청을 불러오는 중이에요.'),create('span','','잠시만 기다려 주세요.'));
      body.appendChild(empty);
      return;
    }

    if(!items.length){
      const empty=create('div','olliMobileMatEmpty');
      empty.append(
        create('strong','',state.search?'검색 결과가 없어요.':'등록된 요청이 없어요.'),
        create('span','',state.search?'다른 검색어를 입력해 보세요.':'필요한 재료가 생기면 요청등록을 눌러 주세요.')
      );
      body.appendChild(empty);
      return;
    }

    const fragment=document.createDocumentFragment();
    items.forEach((item,index)=>{
      const id=clean(item?.id);
      const expanded=id&&id===state.expandedId;
      const card=create('article','olliMobileMatItemCard'+(expanded?' expanded':''));
      card.dataset.materialCardId=id;

      const button=document.createElement('button');
      button.type='button';
      button.className='olliMobileMatItemMain';
      button.dataset.materialExpand=id;
      button.setAttribute('aria-expanded',expanded?'true':'false');

      const copy=create('span','olliMobileMatItemCopy');
      copy.appendChild(create('strong','olliMobileMatItemName',clean(item?.item_name)||'재료'));
      const meta=create('span','olliMobileMatItemMeta');
      [
        `수량 ${clean(item?.quantity_text)||'-'}`,
        `필요일 ${formatDate(item?.needed_on)}`,
        `요청자 ${clean(item?.requested_by_name)||'-'}`
      ].forEach(text=>meta.appendChild(create('span','',text)));
      copy.appendChild(meta);

      const status=statusMeta(item?.status);
      button.append(
        coffeeThumb(item),
        copy,
        create('span',`olliMobileMatStatusTag ${status.className}`,status.label)
      );
      card.appendChild(button);
      if(expanded)card.appendChild(createDetail(item));
      fragment.appendChild(card);
    });
    body.appendChild(fragment);
  }

  function materialPayloadSignature(payload){
    try{
      return JSON.stringify({
        items:Array.isArray(payload?.items)?payload.items:[],
        summary:{
          requested:Number(payload?.summary?.requested||0),
          on_hold:Number(payload?.summary?.on_hold||0),
          ordered:Number(payload?.summary?.ordered||0),
          arrived:Number(payload?.summary?.arrived||0)
        },
        current_role:clean(payload?.current_role),
        can_process:payload?.can_process===true
      });
    }catch(_){return ''}
  }

  function currentMaterialPayloadSignature(){
    return materialPayloadSignature({
      items:state.items,
      summary:state.summary,
      current_role:state.currentRole,
      can_process:state.canProcess
    });
  }

  function renderPayload(payload){
    state.items=Array.isArray(payload?.items)?payload.items:[];
    state.summary={
      requested:Number(payload?.summary?.requested||0),
      on_hold:Number(payload?.summary?.on_hold||0),
      ordered:Number(payload?.summary?.ordered||0),
      arrived:Number(payload?.summary?.arrived||0)
    };
    state.currentRole=clean(payload?.current_role);
    state.canProcess=payload?.can_process===true;
    if(state.expandedId&&!state.items.some(item=>clean(item?.id)===state.expandedId))state.expandedId='';
    renderSummary();
    renderList();
  }

  async function refresh(options={}){
    const sequence=++state.sequence;
    const current=context();
    if(!state.root?.isConnected)return true;
    if(!current.sessionToken||!current.academyId){
      const hasLocalSnapshot=state.localSnapshotAvailable===true;
      const retryCount=Number(options.contextRetry||0);
      if(retryCount<10){
        setTimeout(()=>{
          if(!state.root?.isConnected)return;
          refresh({...options,showLoading:false,contextRetry:retryCount+1}).catch(()=>{});
        },220);
      }
      if(!hasLocalSnapshot&&options.showLoading!==false){
        state.loading=true;
        renderList();
      }
      return hasLocalSnapshot;
    }
    if(options.showLoading!==false){state.loading=true;renderList()}
    try{
      const payload=await rpc('olli_team_material_requests_list',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_limit:300
      });
      if(sequence!==state.sequence)return true;
      if(!payload?.ok)throw new Error(payload?.message||'재료 요청을 불러오지 못했습니다.');
      const changed=materialPayloadSignature(payload)!==currentMaterialPayloadSignature();
      writeCache(current,payload);
      state.localSnapshotAvailable=true;
      if(changed)renderPayload(payload);
      return true;
    }catch(error){
      if(sequence!==state.sequence)return true;
      console.warn('팀톡 재료주문 조회 실패:',error?.message||error);
      showToast(error?.message||'재료 요청을 불러오지 못했습니다.','error');
      return false;
    }finally{
      if(sequence===state.sequence){
        const wasLoading=state.loading;
        state.loading=false;
        if(wasLoading)renderList();
      }
    }
  }

  function ensureCreateRoot(){
    if(state.createRoot?.isConnected)return state.createRoot;
    const host=create('div','olliMobileMatQuickHost');
    host.setAttribute('aria-hidden','true');
    host.innerHTML=`<div class="olliMobileMatToast" data-material-toast hidden></div>${createMaterialCreateModalHtml('olliMobileMatSharedCreateTitle')}`;
    host.addEventListener('click',event=>{
      const action=event.target.closest('[data-material-action]')?.dataset.materialAction;
      if(action==='close-create'){closeCreate();return}
      const modal=event.target.closest('[data-material-modal]');
      if(modal&&event.target===modal)closeCreate();
    });
    host.addEventListener('submit',event=>{
      if(event.target.matches('[data-material-form]'))submitCreate(event);
    });
    document.body.appendChild(host);
    state.createRoot=host;
    return host;
  }

  function openCreate(options={}){
    const root=ensureCreateRoot();
    const modal=root?.querySelector('[data-material-modal]');
    const form=root?.querySelector('[data-material-form]');
    if(!modal||!form)return false;
    configureCreateForm(root,options.variant==='coffee'?'coffee':'material');
    form.reset();
    modal.hidden=false;
    root.setAttribute?.('aria-hidden','false');
    requestAnimationFrame(()=>form.elements.item_name?.focus());
    return true;
  }

  function openQuickOrder(){
    return openCreate({variant:'coffee'});
  }

  function closeCreate(){
    const root=state.createRoot;
    const modal=root?.querySelector?.('[data-material-modal]');
    if(modal&&!modal.hidden){
      modal.hidden=true;
      root.setAttribute?.('aria-hidden','true');
    }
  }

  async function submitCreate(event){
    event.preventDefault();
    if(state.creating)return;
    const form=event.target instanceof HTMLFormElement?event.target:rootQuery('[data-material-form]');
    if(!form)return;
    const submit=form.querySelector('[data-material-submit]');
    const current=context();
    if(!current.sessionToken||!current.academyId){
      showToast('팀톡을 사용하려면 계정 로그인이 필요합니다.','error');
      return;
    }
    const isCoffee=form.dataset.requestKind==='coffee';
    const data=new FormData(form);
    const itemName=clean(data.get('item_name'));
    const quantityText=clean(data.get('quantity_text'));
    if(!itemName||!quantityText){
      showToast(isCoffee?'커피명과 수량을 입력해 주세요.':'재료명과 수량을 입력해 주세요.','error');
      return;
    }

    state.creating=true;
    if(submit){submit.disabled=true;submit.textContent='등록 중...'}
    try{
      const payload=await rpc('olli_team_material_request_create',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_item_name:itemName,
        p_quantity_text:quantityText,
        p_needed_on:clean(data.get('needed_on'))||null,
        p_use_context:clean(data.get('use_context'))||null,
        p_purchase_url:clean(data.get('purchase_url'))||null,
        p_memo:clean(data.get('memo'))||null,
        p_client_mutation_id:clientMutationId()
      });
      if(!payload?.ok)throw new Error(payload?.message||(isCoffee?'커피 요청을 등록하지 못했습니다.':'재료 요청을 등록하지 못했습니다.'));
      state.expandedId=clean(payload.request_id);
      state.filter='requested';
      closeCreate();
      if(state.root?.isConnected)await refresh({showLoading:false});
      showToast(isCoffee?'커피 요청을 등록했습니다.':'재료 요청을 등록했습니다.','ok');
    }catch(error){
      showToast(error?.message||(isCoffee?'커피 요청을 등록하지 못했습니다.':'재료 요청을 등록하지 못했습니다.'),'error');
    }finally{
      state.creating=false;
      if(submit){submit.disabled=false;submit.textContent='요청 등록'}
    }
  }

  async function setStatus(itemId,nextStatus){
    if(state.processing||!state.canProcess)return;
    const item=state.items.find(entry=>clean(entry?.id)===clean(itemId));
    if(!item)return;
    const current=context();
    if(!current.sessionToken||!current.academyId)return;

    state.processing=true;
    renderList();
    try{
      const payload=await rpc('olli_team_material_request_set_status',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_request_id:item.id,
        p_status:nextStatus,
        p_expected_revision:Number(item.revision||0),
        p_hold_reason:null
      });
      if(!payload?.ok)throw new Error(payload?.message||'주문 상태를 변경하지 못했습니다.');
      await refresh({showLoading:false});
      showToast(`${statusMeta(nextStatus).label} 상태로 변경했습니다.`,'ok');
    }catch(error){
      await refresh({showLoading:false});
      showToast(error?.message||'주문 상태를 변경하지 못했습니다.','error');
    }finally{
      state.processing=false;
      renderList();
    }
  }

  async function deleteRequest(itemId){
    if(state.processing||!state.canProcess)return;
    const item=state.items.find(entry=>clean(entry?.id)===clean(itemId));
    if(!item)return;
    if(!global.confirm(`${clean(item.item_name)||'이 요청'}을 삭제할까요?\n삭제한 요청은 주문 목록에서 사라집니다.`))return;

    const current=context();
    if(!current.sessionToken||!current.academyId)return;

    state.processing=true;
    renderList();
    try{
      const payload=await rpc('olli_team_material_request_delete',{
        p_session_token:current.sessionToken,
        p_academy_id:current.academyId,
        p_request_id:item.id,
        p_expected_revision:Number(item.revision||0)
      });
      if(!payload?.ok)throw new Error(payload?.message||'재료 요청을 삭제하지 못했습니다.');
      if(state.expandedId===clean(item.id))state.expandedId='';
      await refresh({showLoading:false});
      showToast('재료 요청을 삭제했습니다.','ok');
    }catch(error){
      await refresh({showLoading:false});
      showToast(error?.message||'재료 요청을 삭제하지 못했습니다.','error');
    }finally{
      state.processing=false;
      renderList();
    }
  }

  function setFilter(filter){
    if(!['all','requested','ordered','arrived'].includes(filter))filter='all';
    state.filter=filter;
    state.expandedId='';
    renderSummary();
    renderList();
  }

  function setSearch(value){
    state.search=clean(value);
    state.expandedId='';
    renderList();
  }

  function bindEvents(){
    if(!state.root||state.root.dataset.olliMobileMaterialBound)return;
    state.root.dataset.olliMobileMaterialBound='1';
    state.root.addEventListener('click',event=>{
      const action=event.target.closest('[data-material-action]')?.dataset.materialAction;
      if(action==='open-create'){openQuickOrder();return}
      if(action==='close-create'){closeCreate();return}

      const filter=event.target.closest('[data-material-filter]');
      if(filter){
        const next=clean(filter.dataset.materialFilter);
        setFilter(state.filter===next?'all':next);
        return;
      }

      const expand=event.target.closest('[data-material-expand]');
      if(expand){
        const id=clean(expand.dataset.materialExpand);
        state.expandedId=state.expandedId===id?'':id;
        renderList();
        return;
      }

      const deleteRequestButton=event.target.closest('[data-material-delete]');
      if(deleteRequestButton){deleteRequest(clean(deleteRequestButton.dataset.materialId));return}

      const statusButton=event.target.closest('[data-material-set-status]');
      if(statusButton){setStatus(clean(statusButton.dataset.materialId),clean(statusButton.dataset.materialSetStatus));return}

      const modal=event.target.closest('[data-material-modal]');
      if(modal&&event.target===modal)closeCreate();
    });
    state.root.addEventListener('input',event=>{
      if(event.target.matches('[data-material-search]'))setSearch(event.target.value);
    });
    state.root.addEventListener('submit',event=>{
      if(event.target.matches('[data-material-form]'))submitCreate(event);
    });
    state.root.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!rootQuery('[data-material-modal]')?.hidden)closeCreate();
    });
  }

  function bindRealtime(){
    if(state.realtimeWatcher||!global.OlliRealtime?.watchDomain)return;
    try{
      state.realtimeWatcher=global.OlliRealtime.watchDomain('chat',async()=>{
        if(!state.root?.isConnected)return true;
        return refresh({showLoading:false});
      });
      global.OlliRealtime.ensureConnected?.({reason:'mobile_team_material_orders_start'}).catch(()=>{});
    }catch(error){
      console.warn('팀톡 재료주문 Realtime 연결 실패:',error?.message||error);
    }
  }

  async function mount(target,options={}){
    const root=typeof target==='string'?document.querySelector(target):target;
    if(!(root instanceof Element))return false;
    state.root=root;
    state.items=[];
    state.summary={requested:0,on_hold:0,ordered:0,arrived:0};
    state.expandedId='';
    state.currentRole='';
    state.canProcess=false;
    state.localSnapshotAvailable=false;
    state.filter=['requested','ordered','arrived'].includes(clean(options.filter))?clean(options.filter):'all';
    state.root.innerHTML=shellHtml();
    bindEvents();

    const cached=readCache(context());
    const renderedLocal=!!cached;
    state.localSnapshotAvailable=renderedLocal;
    if(cached)renderPayload(cached);
    else{
      renderSummary();
      renderList();
    }

    if(options.localOnly===true)return true;

    bindRealtime();
    await refresh({showLoading:!renderedLocal});
    return true;
  }

  async function activate(){
    if(!state.root?.isConnected)return false;
    state.filter='all';
    state.expandedId='';
    renderSummary();
    renderList();
    bindRealtime();
    await refresh({showLoading:false});
    return true;
  }

  function destroy(){
    state.realtimeWatcher?.dispose?.();
    state.realtimeWatcher=null;
    if(state.root?.isConnected)state.root.replaceChildren();
    state.root=null;
    state.items=[];
    state.summary={requested:0,on_hold:0,ordered:0,arrived:0};
    state.expandedId='';
    state.currentRole='';
    state.canProcess=false;
    state.localSnapshotAvailable=false;
  }

  global.OlliMobileTeamTalkMaterialOrders=Object.freeze({
    version:VERSION,
    mount,
    activate,
    refresh,
    openCreate,
    openQuickOrder,
    closeCreate,
    destroy
  });
})(window);
