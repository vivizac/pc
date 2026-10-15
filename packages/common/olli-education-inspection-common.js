/* Olli Education Inspection: one owner-only source for PC and mobile. */
(function(global){
  'use strict';
  const state={tab:'ledger',month:localMonth(),data:null,loading:false,staged:null,source:null,map:{},message:''};
  const money=n=>Number(n||0).toLocaleString('ko-KR')+'원';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
  function localMonth(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
  function token(){return global.getOlliSettingsSessionToken?.()||localStorage.getItem('olli_account_session_token_v1')||'';}
  function academy(){return global.settingsGetAcademyId?.()||localStorage.getItem('olli_current_academy_id')||'';}
  function owner(){const r=global.getOlliCurrentRole?.()||localStorage.getItem('olli_current_member_role')||'';return r==='owner'||r==='super_admin';}
  function body(){return document.getElementById('settingsDetailBody');}
  async function rpc(name,params){if(typeof global.callOlliRpc!=='function')throw Error('올리 서버 연결을 확인해 주세요.');return global.callOlliRpc(name,params);}
  function params(){return {p_session_token:String(token()),p_academy_id:String(academy())};}
  function notify(text){state.message=String(text||'');const node=body()?.querySelector('[data-inspection-message]');if(node)node.textContent=state.message;}
  function isoDate(v){
    const x=String(v??'').trim();
    if(!x)return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(x))return x;
    if(/^\d{4,5}(?:\.\d+)?$/.test(x)){const n=Number(x);if(n>25000&&n<80000)return new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000).toISOString().slice(0,10);}
    let m=x.match(/^(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})/);
    if(!m)m=x.match(/^(\d{2})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})/);
    if(!m)m=x.match(/^(\d{1,2})월\s*(\d{1,2})일/);
    if(!m)return '';
    let y,mo,d;
    if(m.length===3){y=Number(state.month.slice(0,4));mo=Number(m[1]);d=Number(m[2]);}
    else{y=Number(m[1]);if(y<100)y+=2000;mo=Number(m[2]);d=Number(m[3]);}
    const date=new Date(Date.UTC(y,mo-1,d));
    return date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d
      ?y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0'):'';
  }
  function amountValue(raw){
    const s=String(raw??'').trim();
    if(!s)return NaN;
    const n=Number(s.replace(/[^\d.-]/g,''));
    if(!Number.isFinite(n)||n===0)return NaN;
    return (s.includes('(')&&s.includes(')')?-1:1)*n;
  }
  function tabHtml(){
    return '<div class="olliInspectTabs" role="tablist">'
      +[['ledger','현금출납부'],['receipts','교습비등 영수증 원부'],['students','수강생 대장']].map(([id,label])=>'<button type="button" role="tab" data-inspection-tab="'+id+'" aria-selected="'+(state.tab===id)+'" class="'+(state.tab===id?'active':'')+'">'+label+'</button>').join('')
      +'</div>';
  }
  function header(){
    const d=state.data||{};
    return '<div class="olliInspectTop"><div class="olliInspectMonth"><label for="olliInspectionMonth">조회 월</label><input id="olliInspectionMonth" type="month" value="'+esc(state.month)+'"></div>'
      +'<button type="button" data-inspection-export class="olliInspectGhost">CSV 내보내기</button></div>'
      +'<div class="olliInspectStats">'
      +'<div><span>수입</span><strong>'+money(d.income_amount)+'</strong></div>'
      +'<div><span>환불</span><strong>'+money(d.refund_amount)+'</strong></div>'
      +'<div><span>지출</span><strong>'+money(d.expense_amount)+'</strong></div>'
      +'<div><span>수입 - 지출</span><strong>'+money(d.balance_amount)+'</strong></div></div>'
      +'<div class="olliInspectWarning">실제 거래를 기록하는 점검용 원장입니다. 미수납 교육비 예상액이나 월간 지출 추정치는 자동 입력되지 않습니다.</div>'
      +'<div class="olliInspectWarning">기존 학원 운영지출의 월별 참고액 '+money(d.expense_reference_amount)
      +' · 금전출납부에는 결제일을 확인해 거래를 등록한 뒤 반영됩니다.'
      +(Number(d.expense_reference_missing||0)>0?' (아직 입력하지 않은 운영비 '+Number(d.expense_reference_missing)+'건)':'')+'</div>';
  }
  function groupedTransactions(){
    const groups=new Map();
    for(const t of state.data?.transactions||[]){
      const key=t.paid_on+'|'+t.entry_type;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(t);
    }
    return Array.from(groups.values()).sort((a,b)=>a[0].paid_on.localeCompare(b[0].paid_on));
  }
  function ledgerHtml(){
    const all=state.data?.transactions||[];
    const groups=groupedTransactions();
    return '<div class="olliInspectSectionIntro"><strong>현금출납부</strong><span>결제일별 수입·환불·지출을 묶어 표시하고 원본 거래는 개별 보관합니다.</span></div>'
      +'<div class="olliInspectActions">'
      +'<label class="olliInspectUpload">결제 파일 불러오기<input type="file" data-inspection-file accept=".csv,.txt,.tsv,.xlsx"></label>'
      +'<button type="button" data-inspection-manual>거래 직접 입력</button></div>'
      +'<div data-inspection-editor></div>'
      +(state.source?mappingHtml():'')
      +'<div class="olliInspectList"><div class="olliInspectTableHead"><span>결제일</span><span>적요</span><span>금액</span></div>'
      +(groups.length?groups.map(g=>{
        const t=g[0],count=g.length,total=g.reduce((n,x)=>n+Number(x.amount||0),0);
        const first=t.student_name||t.participant_name||'거래';
        const title=first+(count>1?' 외 '+(count-1)+'명':'');
        const type=t.entry_type==='refund'?'환불':t.entry_type==='expense'?'지출':'수입';
        const sign=t.entry_type==='income'?'':'-';
        return '<details class="olliInspectDay"><summary><span>'+esc(t.paid_on.slice(5).replace('-','.'))+'</span>'
          +'<span>'+esc(title)+' <small>'+type+' · '+count+'건</small></span><strong>'+sign+money(total)+'</strong></summary>'
          +'<div class="olliInspectDetails">'+g.map(item=>'<div><span>'+esc(item.student_name||item.participant_name)+'</span><small>'+esc(item.category||'기타')+' · '+esc(item.approval_no||item.source_name||'')+'</small><strong>'+money(item.amount)+'</strong></div>').join('')+'</div></details>';
      }).join(''):'<div class="olliInspectEmpty">해당 월에 확정된 거래 기록이 없습니다. 결제 파일을 등록하거나 직접 입력해 주세요.</div>')
      +'</div>'
      +(state.data?.truncated?'<p class="olliInspectWarning">조회 결과가 3,000건을 초과해 일부만 보입니다. CSV 내보내기도 표시된 범위만 포함합니다.</p>':'')
      +'<p class="olliInspectFootnote">거래를 임의로 삭제하거나 덮어쓰지 않습니다. 정정이 필요하면 반대 거래를 별도로 등록해 기록을 남겨 주세요.</p>';
  }
  function receiptsHtml(){
    const items=(state.data?.transactions||[]).filter(x=>x.entry_type!=='expense');
    return '<div class="olliInspectSectionIntro"><strong>교습비등 영수증 원부</strong><span>실제 수납 거래를 근거로 조회합니다. 신고 정보·교습기간 등 빠진 값은 확인 후 영수증을 발급해야 합니다.</span></div>'
      +(items.length?'<div class="olliInspectReceiptList">'+items.map(x=>{
        const ready=!!(x.student_name&&x.course_name&&x.course_period);
        return '<div class="olliInspectReceipt"><div><strong>'+esc(x.student_name||x.participant_name)+'</strong>'
          +'<span>'+esc(x.paid_on)+' · '+esc(x.category||'교습비')+' · '+esc(x.entry_type==='refund'?'환불':'수납')+'</span>'
          +'<small>교습과목 '+esc(x.course_name||'미입력')+' · 교습기간 '+esc(x.course_period||'미입력')+'</small></div>'
          +'<div class="olliInspectReceiptAside"><strong>'+money(x.amount)+'</strong><span class="'+(ready?'ready':'review')+'">'+(ready?'항목 확인':'정보 확인 필요')+'</span></div></div>';
      }).join('')+'</div>':'<div class="olliInspectEmpty">아직 이 달의 수납·환불 기록이 없습니다.</div>')
      +'<p class="olliInspectFootnote">여기에 표시되는 것은 영수증 원부용 거래 기록이며, 법정 양식의 영수증이 자동 발급되었다는 의미는 아닙니다.</p>';
  }
  function studentsHtml(){
    const ev=state.data?.student_events||[];
    const counts={register:ev.filter(x=>x.event_type==='register').length,withdraw:ev.filter(x=>x.event_type==='withdraw').length};
    return '<div class="olliInspectSectionIntro"><strong>수강생 대장</strong><span>학생 등록·퇴원 시 기록한 이력을 자동으로 불러옵니다.</span></div>'
      +'<div class="olliInspectStudentSummary">신규 등록 '+counts.register+'명 <span>·</span> 퇴원 '+counts.withdraw+'명</div>'
      +(ev.length?'<div class="olliInspectList"><div class="olliInspectStudentHead"><span>날짜</span><span>학생</span><span>구분</span></div>'
      +ev.map(x=>'<div class="olliInspectStudentRow"><span>'+esc(x.effective_on||'')+'</span>'
        +'<span>'+esc(x.student_name||'')+' <small>'+esc(x.division||'')+'</small></span>'
        +'<strong>'+esc(x.event_type==='register'?'등록':'퇴원')+'</strong></div>').join('')+'</div>'
      :'<div class="olliInspectEmpty">선택한 월의 등록·퇴원 변경 이력이 없습니다.</div>')
      +(Number(state.data?.legacy_withdrawals_without_date||0)>0
        ?'<div class="olliInspectWarning">과거 퇴원생 중 퇴원일이 기록되지 않은 학생 '+Number(state.data.legacy_withdrawals_without_date)+'명은 날짜를 추정해 자동 등록하지 않았습니다. 기존 학생 기록을 확인해 주세요.</div>':'')
      +'<p class="olliInspectFootnote">과거 기록은 기존 학생정보에 남아 있는 등록일·퇴원일을 기반으로 초기 구성합니다. 연락처·주소 등 법정 서식의 추가 항목은 별도 확인이 필요합니다.</p>';
  }
  function csvRecords(text){
    const first=text.replace(/^\uFEFF/,'');
    const sample=first.split(/\r?\n/).slice(0,4).join('\n');
    const delim=(['\t',',',';'].map(c=>({c,n:sample.split(c).length})).sort((a,b)=>b.n-a.n)[0]||{c:','}).c;
    const result=[];let row=[],cell='',quote=false;
    for(let i=0;i<first.length;i++){
      const c=first[i];
      if(c==='"'){if(quote&&first[i+1]==='"'){cell+='"';i++;}else quote=!quote;}
      else if(c===delim&&!quote){row.push(cell);cell='';}
      else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&first[i+1]==='\n')i++;row.push(cell);if(row.some(x=>String(x).trim()))result.push(row);row=[];cell='';}
      else cell+=c;
    }
    if(quote)throw Error('CSV 따옴표가 닫히지 않았습니다.');
    row.push(cell);if(row.some(x=>String(x).trim()))result.push(row);
    return result;
  }
  async function readRows(file){
    if(file.size>15*1024*1024)throw Error('파일은 15MB 이하만 불러올 수 있습니다.');
    if(/\.xlsx$/i.test(file.name)){
      if(!global.JSZip)throw Error('엑셀 읽기 도구를 찾지 못했습니다.');
      const zip=await global.JSZip.loadAsync(await file.arrayBuffer());
      const shared=zip.file('xl/sharedStrings.xml');
      const parser=new DOMParser();
      const strings=shared?Array.from(parser.parseFromString(await shared.async('text'),'application/xml').getElementsByTagName('si')).map(n=>n.textContent||''):[];
      const names=Object.keys(zip.files).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/sheet(\d+)/)[1])-Number(b.match(/sheet(\d+)/)[1]));
      if(!names.length)throw Error('엑셀에서 시트를 찾지 못했습니다.');
      const xml=parser.parseFromString(await zip.file(names[0]).async('text'),'application/xml');
      if(xml.getElementsByTagName('parsererror').length)throw Error('엑셀 데이터를 읽을 수 없습니다.');
      const rows=[];
      for(const r of Array.from(xml.getElementsByTagName('row')).slice(0,3001)){
        const a=[];
        for(const c of Array.from(r.getElementsByTagName('c'))){
          const label=String(c.getAttribute('r')||'').match(/^[A-Z]+/);
          if(!label)continue;
          let col=0;for(const ch of label[0])col=col*26+ch.charCodeAt(0)-64;
          const v=c.getElementsByTagName('v')[0]?.textContent||'';
          a[col-1]=c.getAttribute('t')==='s'?strings[Number(v)]||'':c.getAttribute('t')==='inlineStr'?(c.getElementsByTagName('is')[0]?.textContent||''):v;
        }
        if(a.some(v=>String(v||'').trim()))rows.push(a);
      }
      return rows;
    }
    if(!/\.(csv|txt|tsv)$/i.test(file.name))throw Error('CSV 또는 XLSX 파일만 지원합니다.');
    const raw=await file.arrayBuffer();
    let txt=new TextDecoder('utf-8').decode(raw);
    if((txt.match(/\uFFFD/g)||[]).length>1)txt=new TextDecoder('euc-kr').decode(raw);
    return csvRecords(txt).slice(0,3001);
  }
  function guess(headers,keys){
    const n=s=>String(s||'').replace(/[\s_\-()[\]]/g,'').toLowerCase();
    return headers.findIndex(h=>keys.some(k=>n(h).includes(n(k))));
  }
  function mappedFields(){
    const h=state.source?.headers||[];
    return [['date','결제일', ['승인일자','거래일자','결제일','일자','거래일','승인일','매출일','날짜']],
      ['name','결제자·학생 이름',['학생명','수강생','납부자','결제자','고객명','구매자','성명','이름']],
      ['payer','결제자 (선택)',['결제자명','납부자명','보호자명','카드소유자','결제자']],
      ['student','학생명 (선택)',['수강생명','학생이름','학생명','수강생']],
      ['amount','결제 금액',['승인금액','결제금액','거래금액','매출금액','납부금액','금액']],
      ['approval','승인번호',['승인번호','거래번호','거래ID','전표번호']],
      ['status','승인·취소 구분',['거래구분','거래상태','승인구분','취소여부','상태','구분']],
      ['course','교습과목',['교습과목','과목','강좌']],
      ['period','교습기간',['교습기간','수강기간','교육기간']]
    ].map(([key,label,hints])=>({key,label,index:state.map[key]??guess(h,hints)}));
  }
  function mappingHtml(){
    const src=state.source, fields=mappedFields();
    const opts=(i)=>'<option value="-1">열 선택 안 함</option>'+src.headers.map((h,n)=>'<option value="'+n+'" '+(n===i?'selected':'')+'>'+esc(h||'열 '+(n+1))+'</option>').join('');
    return '<section class="olliInspectMapping"><div class="olliInspectSectionIntro"><strong>업로드 확인 · '+esc(src.name)+'</strong><span>원본 파일은 서버로 보내지 않습니다. 추출한 거래만 확인 후 저장합니다.</span></div>'
      +'<div class="olliInspectMapGrid">'+fields.map(f=>'<label>'+f.label+'<select data-inspection-map="'+f.key+'">'+opts(f.index)+'</select></label>').join('')+'</div>'
      +'<div class="olliInspectMapToolbar"><button type="button" data-inspection-preview>내역 확인</button><button type="button" data-inspection-reset class="light">취소</button></div>'
      +(state.staged?previewHtml():'')+'</section>';
  }
  function findStudent(name){
    const clean=v=>String(v||'').replace(/\s/g,'');
    const matches=(state.data?.student_candidates||[]).filter(s=>clean(s.name)===clean(name));
    return matches.length===1?matches[0]:null;
  }
  function stagedFromSource(){
    const f=Object.fromEntries(mappedFields().map(x=>[x.key,x.index]));
    if(f.date<0||f.name<0||f.amount<0)throw Error('결제일·이름·금액 열을 모두 선택해 주세요.');
    const staged=[];let rejected=0;
    const seen=new Map();
    state.source.rows.forEach((r,i)=>{
      const date=isoDate(r[f.date]),name=String(r[f.name]||'').trim();
      const signed=amountValue(r[f.amount]),approval=f.approval>=0?String(r[f.approval]||'').trim():'';
      if(!date||!name||!Number.isFinite(signed)){rejected++;return;}
      const st=f.status>=0?String(r[f.status]||''):'';
      const entry_type=signed<0||/취소|환불|반품|refund/i.test(st)?'refund':'income';
      const payer=f.payer>=0?String(r[f.payer]||'').trim():name;
      const studentName=f.student>=0?String(r[f.student]||'').trim():name;
      const match=findStudent(studentName);
      const fingerprint=[date,name,Math.abs(signed),entry_type,approval].join('|');
      const occ=(seen.get(fingerprint)||0)+1;seen.set(fingerprint,occ);
      staged.push({
        paid_on:date,participant_name:studentName||name,payer_name:payer,student_id:match?.id||null,student_name:match?.name||(f.student>=0?studentName:null),
        amount:Math.round(Math.abs(signed)),entry_type,
        category:Math.abs(signed)===70000?'workbook':([110000,150000].includes(Math.abs(signed))?'tuition':'other'),
        approval_no:approval,
        course_name:f.course>=0?String(r[f.course]||'').trim():'',course_period:f.period>=0?String(r[f.period]||'').trim():'',
        source_name:state.source.name,
        dedupe_key:approval?('card:'+approval+':'+date+':'+Math.abs(signed)+':'+entry_type+':'+occ):('file:'+state.source.fingerprint+':'+i)
      });
    });
    if(staged.length>2000)throw Error('2,000건 이하의 파일만 미리 확인할 수 있습니다.');
    state.staged={rows:staged,rejected,page:0};
    if(!staged.length)throw Error('날짜·이름·금액을 확인할 수 있는 거래가 없습니다.');
  }
  function previewHtml(){
    const s=state.staged||{rows:[],rejected:0,page:0};
    const perPage=40, totalPages=Math.max(1,Math.ceil(s.rows.length/perPage));
    const page=Math.max(0,Math.min(totalPages-1,Number(s.page||0)));
    const start=page*perPage,items=s.rows.slice(start,start+perPage);
    const categories=[['tuition','교육비'],['workbook','워크북 교환비'],['materials','재료비'],['rent','월세'],['other','기타']];
    const opts=r=>categories.map(([v,n])=>'<option value="'+v+'"'+(r.category===v?' selected':'')+'>'+n+'</option>').join('');
    return '<div class="olliInspectPreview"><div class="olliInspectSectionIntro"><strong>저장 전 전체 내역 확인 · '+s.rows.length+'건</strong>'
      +'<span>제외 '+s.rejected+'건 · 모든 페이지를 확인한 다음 저장해 주세요.</span></div>'
      +'<div class="olliInspectPreviewTable">'+items.map((r,i)=>'<div class="olliInspectPreviewRow"><span>'+esc(r.paid_on)+'</span>'
      +'<span>'+esc(r.participant_name)+' <small>'+(r.student_id?'학생 연결':'학생 매칭 확인')+'</small></span>'
      +'<strong>'+money(r.amount)+'</strong>'
      +'<select data-inspection-kind="'+(start+i)+'"><option value="income"'+(r.entry_type==='income'?' selected':'')+'>수입</option><option value="refund"'+(r.entry_type==='refund'?' selected':'')+'>환불</option><option value="expense"'+(r.entry_type==='expense'?' selected':'')+'>지출</option></select>'
      +'<select data-inspection-category="'+(start+i)+'">'+opts(r)+'</select></div>').join('')+'</div>'
      +'<div class="olliInspectPreviewPager"><button type="button" data-inspection-preview-step="-1"'+(page===0?' disabled':'')+'>이전</button>'
      +'<span>'+(page+1)+' / '+totalPages+' 페이지</span><button type="button" data-inspection-preview-step="1"'+(page===totalPages-1?' disabled':'')+'>다음</button></div>'
      +'<div class="olliInspectMapToolbar"><button type="button" data-inspection-save>확인한 '+s.rows.length+'건 저장</button></div></div>';
  }
  function manualForm(){
    return '<div class="olliInspectManual"><div class="olliInspectSectionIntro"><strong>거래 직접 입력</strong><span>수납·환불·지출을 선택하고 저장하세요.</span></div>'
      +'<div class="olliInspectMapGrid"><label>결제일<input type="date" data-field="paid_on" value="'+(new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0'))+'"></label>'
      +'<label>구분<select data-field="entry_type"><option value="income">수입</option><option value="refund">환불</option><option value="expense">지출</option></select></label>'
      +'<label>학생·결제자·지출처<input data-field="participant_name" maxlength="100" placeholder="이름"></label>'
      +'<label>금액<input data-field="amount" type="number" min="1" step="1" placeholder="원"></label>'
      +'<label>항목<select data-field="category"><option value="tuition">교육비</option><option value="workbook">워크북 교환비</option><option value="materials">재료비</option><option value="rent">임차료</option><option value="other">기타</option></select></label>'
      +'<label>교습과목 (선택)<input data-field="course_name" placeholder="미술"></label>'
      +'<label>교습기간 (선택)<input data-field="course_period" placeholder="2026-10-01~2026-10-28"></label></div>'
      +'<div class="olliInspectMapToolbar"><button type="button" data-inspection-manual-save>서버에 저장</button><button type="button" data-inspection-manual-cancel class="light">취소</button></div></div>';
  }
  async function fingerprintOf(file){
    const bytes=await file.arrayBuffer();
    if(global.crypto?.subtle){
      const hash=await global.crypto.subtle.digest('SHA-256',bytes);
      return Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,30);
    }
    let h=2166136261;for(const v of new Uint8Array(bytes)){h=Math.imul(h^v,16777619);}
    return (h>>>0).toString(16)+'-'+bytes.byteLength;
  }
  async function handleFile(file){
    if(!file)return;
    notify('결제 파일을 분석하는 중입니다...');
    try{
      const raw=await readRows(file);
      if(raw.length<2)throw Error('열 이름과 거래 행이 포함된 파일을 선택해 주세요.');
      state.source={name:file.name,headers:raw[0].map(v=>String(v||'').trim()),rows:raw.slice(1),fingerprint:await fingerprintOf(file)};
      state.map={};state.staged=null;notify('');
      render();
    }catch(e){state.source=null;state.staged=null;render();notify(e.message||String(e));}
  }
  async function saveRows(rows){
    let saved=0,duplicates=0;
    for(let i=0;i<rows.length;i+=200){
      const res=await rpc('olli_inspection_import',{...params(),p_rows:rows.slice(i,i+200)});
      if(!res?.ok)throw Error(res?.message||'거래 저장에 실패했습니다.');
      saved+=Number(res.saved||0);duplicates+=Number(res.duplicates||0);
    }
    return {saved,duplicates};
  }
  async function saveStaged(button){
    if(!state.staged?.rows.length||!owner())return;
    button.disabled=true;
    try{
      const result=await saveRows(state.staged.rows);
      state.source=null;state.staged=null;
      await load();
      notify('저장 '+result.saved+'건 · 중복 제외 '+result.duplicates+'건');
    }catch(e){notify('저장 확인 필요: '+(e?.message||e)+' (다시 실행해도 기존 거래는 중복 저장되지 않습니다.)');}
    finally{button.disabled=false;}
  }
  async function saveManual(section,button){
    const v=k=>String(section.querySelector('[data-field="'+k+'"]')?.value||'').trim();
    const date=isoDate(v('paid_on')),name=v('participant_name'),amount=Number(v('amount'));
    if(!date||!name||!Number.isSafeInteger(amount)||amount<=0){notify('날짜·이름·양수 금액을 확인해 주세요.');return;}
    const match=findStudent(name);
    if(!section.dataset.requestKey)section.dataset.requestKey=global.crypto?.randomUUID?.()||'manual-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const item={paid_on:date,entry_type:v('entry_type'),category:v('category'),participant_name:name,
      payer_name:name,student_id:match?.id||null,student_name:match?.name||null,amount,
      course_name:v('course_name'),course_period:v('course_period'),source_name:'manual',dedupe_key:section.dataset.requestKey};
    button.disabled=true;
    try{
      const response=await saveRows([item]);await load();notify('거래 저장 '+response.saved+'건 · 중복 제외 '+response.duplicates+'건');
    }catch(e){notify('저장 실패: '+(e.message||e));}
    finally{button.disabled=false;}
  }
  function csvEscape(v){
    let t=String(v??'');
    if(/^[=+\-@]/.test(t))t="'"+t;
    return '"'+t.replace(/"/g,'""')+'"';
  }
  function downloadCsv(filename,columns,rows){
    const content='\uFEFF'+[columns,...rows].map(r=>r.map(csvEscape).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function exportData(){
    if(!state.data)return;
    const file='올리_교육청점검_'+state.tab+'_'+state.month+'.csv';
    if(state.tab==='students')return downloadCsv(file,
      ['날짜','학생명','구분','유치부/초등부','학생 ID'],
      (state.data.student_events||[]).map(x=>[x.effective_on,x.student_name,x.event_type==='register'?'등록':'퇴원',x.division,x.student_id]));
    const filtered=(state.data.transactions||[]).filter(x=>state.tab!=='receipts'||x.entry_type!=='expense');
    downloadCsv(file,['결제일','수입/지출/환불','항목','학생명','결제자/지출처','금액','승인번호','교습과목','교습기간','출처','메모'],
      filtered.map(x=>[x.paid_on,x.entry_type,x.category,x.student_name,x.participant_name,x.amount,x.approval_no,x.course_name,x.course_period,x.source_name,x.note]));
  }
  function bind(){
    const root=body();if(!root)return;
    root.querySelectorAll('[data-inspection-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.inspectionTab;state.message='';render();}));
    root.querySelector('#olliInspectionMonth')?.addEventListener('change',e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){state.month=e.target.value;state.source=null;state.staged=null;load();}});
    root.querySelector('[data-inspection-export]')?.addEventListener('click',exportData);
    root.querySelector('[data-inspection-file]')?.addEventListener('change',e=>handleFile(e.target.files?.[0]));
    root.querySelector('[data-inspection-manual]')?.addEventListener('click',()=>{const n=root.querySelector('[data-inspection-editor]');n.innerHTML=manualForm();n.querySelector('[data-inspection-manual-save]').addEventListener('click',e=>saveManual(n.querySelector('.olliInspectManual'),e.currentTarget));n.querySelector('[data-inspection-manual-cancel]').addEventListener('click',()=>n.innerHTML='');});
    root.querySelectorAll('[data-inspection-map]').forEach(s=>s.addEventListener('change',()=>{state.map[s.dataset.inspectionMap]=Number(s.value);state.staged=null;render();}));
    root.querySelector('[data-inspection-preview]')?.addEventListener('click',()=>{try{stagedFromSource();state.message='';render();}catch(e){notify(e.message||String(e));}});
    root.querySelector('[data-inspection-reset]')?.addEventListener('click',()=>{state.source=null;state.staged=null;render();});
    root.querySelectorAll('[data-inspection-kind]').forEach(s=>s.addEventListener('change',()=>{const row=state.staged?.rows[Number(s.dataset.inspectionKind)];if(row)row.entry_type=s.value;}));
    root.querySelectorAll('[data-inspection-category]').forEach(s=>s.addEventListener('change',()=>{const row=state.staged?.rows[Number(s.dataset.inspectionCategory)];if(row)row.category=s.value;}));
    root.querySelectorAll('[data-inspection-preview-step]').forEach(b=>b.addEventListener('click',()=>{if(state.staged){state.staged.page+=Number(b.dataset.inspectionPreviewStep||0);render();}}));
    root.querySelector('[data-inspection-save]')?.addEventListener('click',e=>saveStaged(e.currentTarget));
  }
  function render(){
    const root=body();if(!root)return;
    root.innerHTML='<div class="olliInspectPage">'+header()+tabHtml()
      +(state.tab==='students'?studentsHtml():state.tab==='receipts'?receiptsHtml():ledgerHtml())
      +'<div data-inspection-message class="olliInspectMessage" role="status">'+esc(state.message)+'</div></div>';
    bind();
  }
  async function load(){
    if(!owner())return;
    const root=body();if(!root||state.loading)return;
    state.loading=true;root.innerHTML='<div class="settingsLoadingText">점검자료를 불러오는 중입니다...</div>';
    const monthAtRequest=state.month;
    try{
      const response=await rpc('olli_inspection_overview',{...params(),p_month:state.month+'-01'});
      if(!response?.ok)throw Error(response?.message||'점검자료를 불러오지 못했습니다.');
      state.data=response;
      const detail=document.getElementById('settingsDetailScreen');
      if(detail?.style.display!=='flex'||document.getElementById('settingsDetailTitlePill')?.textContent!=='교육청 점검자료')return;
      render();
    }catch(e){
      if(document.getElementById('settingsDetailTitlePill')?.textContent==='교육청 점검자료')
        root.innerHTML='<div class="olliInspectEmpty">점검자료를 불러오지 못했습니다. '+esc(e.message||String(e))+'</div>';
    }
    finally{state.loading=false;if(monthAtRequest!==state.month&&document.getElementById('settingsDetailTitlePill')?.textContent==='교육청 점검자료')load();}
  }
  function open(){
    if(!owner()){global.alert('교육청 점검자료는 원장 계정에서만 열 수 있습니다.');return;}
    const detail=document.getElementById('settingsDetailScreen');
    const settings=document.getElementById('settingsPageScreen');
    if(!detail||!body())return;
    try{global.olliPcSettingsLayoutBeforeOpenDetail?.('educationInspection');}catch(_){}
    if(settings)settings.style.display='flex';
    const title=document.getElementById('settingsDetailTitlePill');
    if(title)title.textContent='교육청 점검자료';
    detail.style.display='flex';detail.style.position='fixed';detail.style.inset='0';
    detail.style.transform='translateX(0)';detail.style.opacity='1';detail.style.pointerEvents='auto';detail.style.zIndex='130100';
    try{global.olliPcSettingsLayoutAfterOpenDetail?.('educationInspection');}catch(_){}
    load();
  }
  global.openOlliEducationInspection=open;
  global.OlliEducationInspection={open,load};
})(window);
