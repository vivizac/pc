(function initOlliMuseClassVoice(global) {
  'use strict';
  if (global.OlliMuseClassVoice) return;

  var TARGET_SAMPLE_RATE=24000;
  var MAX_CAPTURE_MS=9 * 60 * 1000;
  var FINAL_WAIT_MS=9000;
  var state={
    starting:false,active:false,stopping:false,
    socket:null,stream:null,audioContext:null,source:null,processor:null,
    turns:new Map(),turnOrder:[],elapsedTimer:0,maxTimer:0,finalTimer:0,
    startedAt:0,wakeLock:null,lastTranscript:''
  };

  function button(){return document.getElementById('kcfTeacherSheetMuseBtn');}
  function notify(message){
    if(typeof global.showPushToast === 'function') global.showPushToast(String(message || ''));
    else if(message) console.warn('[OLLI Muse Voice]',message);
  }
  function academyId(){return String(localStorage.getItem('olli_current_academy_id') || '').trim();}
  function sessionToken(){return String(localStorage.getItem('olli_account_session_token_v1') || '').trim();}
  function socketUrl(){return (global.location.protocol === 'https:' ? 'wss:':'ws:') + '//' + global.location.host + '/api/muse-voice-realtime';}
  function setButtonState(){
    var btn=button(); if(!btn) return;
    btn.classList.toggle('connecting',state.starting || state.stopping);
    btn.classList.toggle('active',state.active || state.stopping);
    btn.setAttribute('aria-pressed',state.active ? 'true':'false');
    btn.setAttribute('aria-label',state.active || state.stopping ? 'Muse 수업기록 종료':'Muse 수업기록 시작');
    btn.textContent=state.active || state.stopping ? 'Muse ●':'Muse';
  }
  function ensureUi(){
    var status=document.getElementById('kcfMuseClassStatus');
    if(!status){
      status=document.createElement('div');
      status.id='kcfMuseClassStatus';
      status.className='kcfMuseClassStatus';
      status.hidden=true;
      status.innerHTML='<span class="kcfMuseClassStatusDot" aria-hidden="true"></span><span>Muse 수업기록</span><span id="kcfMuseClassStatusTimer" class="kcfMuseClassStatusTimer">00:00</span><button id="kcfMuseClassStatusStop" class="kcfMuseClassStatusStop" type="button">종료</button>';
      document.body.appendChild(status);
      document.getElementById('kcfMuseClassStatusStop')?.addEventListener('click',function(event){event.preventDefault();stop();});
    }
    var overlay=document.getElementById('kcfMuseResultOverlay');
    if(!overlay){
      overlay=document.createElement('div');
      overlay.id='kcfMuseResultOverlay';
      overlay.className='kcfMuseResultOverlay';
      overlay.hidden=true;
      overlay.innerHTML='<section class="kcfMuseResultSheet" role="dialog" aria-modal="true" aria-label="Muse 수업기록 결과"><div class="kcfMuseResultTitle">Muse 수업기록</div><div class="kcfMuseResultHelp">현재 실험 단계에서는 화자를 A·B·C로만 구분합니다. 실제 학생 이름 연결은 화자 분리 정확도를 확인한 뒤 추가합니다.</div><textarea id="kcfMuseResultText" class="kcfMuseResultText" readonly></textarea><div class="kcfMuseResultActions"><button id="kcfMuseResultClose" class="kcfMuseResultBtn secondary" type="button">닫기</button><button id="kcfMuseResultInsert" class="kcfMuseResultBtn primary" type="button">퀵노트에 넣기</button></div></section>';
      document.body.appendChild(overlay);
      document.getElementById('kcfMuseResultClose')?.addEventListener('click',hideResult);
      document.getElementById('kcfMuseResultInsert')?.addEventListener('click',insertResultIntoQuickNote);
      overlay.addEventListener('click',function(event){if(event.target === overlay) hideResult();});
    }
  }
  function elapsed(ms){
    var total=Math.max(0,Math.floor(Number(ms || 0)/1000));
    return String(Math.floor(total/60)).padStart(2,'0') + ':' + String(total%60).padStart(2,'0');
  }
  function updateStatus(){
    ensureUi();
    var status=document.getElementById('kcfMuseClassStatus');
    if(status) status.hidden=!(state.active || state.stopping);
    var timer=document.getElementById('kcfMuseClassStatusTimer');
    if(timer) timer.textContent=elapsed(state.startedAt ? Date.now()-state.startedAt:0);
    setButtonState();
  }
  function clearTimers(){
    if(state.elapsedTimer) clearInterval(state.elapsedTimer);
    if(state.maxTimer) clearTimeout(state.maxTimer);
    if(state.finalTimer) clearTimeout(state.finalTimer);
    state.elapsedTimer=state.maxTimer=state.finalTimer=0;
  }
  async function acquireWakeLock(){
    if(!navigator.wakeLock?.request || document.hidden) return;
    try{state.wakeLock=await navigator.wakeLock.request('screen');}catch(_){state.wakeLock=null;}
  }
  function releaseWakeLock(){
    var lock=state.wakeLock; state.wakeLock=null;
    if(!lock || lock.released || typeof lock.release !== 'function') return;
    try{lock.release().catch(function(){});}catch(_){}
  }
  function stopAudio(){
    if(state.processor){try{state.processor.disconnect();}catch(_){} state.processor.onaudioprocess=null;}
    if(state.source){try{state.source.disconnect();}catch(_){}}
    if(state.audioContext){try{state.audioContext.close();}catch(_){}}
    if(state.stream){try{state.stream.getTracks().forEach(function(track){track.stop();});}catch(_){}}
    state.processor=state.source=state.audioContext=state.stream=null;
  }
  function closeSocket(){var socket=state.socket;state.socket=null;if(socket){try{socket.close();}catch(_){}}}
  function resample(input,sourceRate){
    var rate=Number(sourceRate || TARGET_SAMPLE_RATE);
    if(!input?.length) return new Float32Array(0);
    if(rate === TARGET_SAMPLE_RATE) return new Float32Array(input);
    var ratio=rate/TARGET_SAMPLE_RATE;
    var output=new Float32Array(Math.max(1,Math.round(input.length/ratio)));
    for(var i=0;i<output.length;i+=1){
      var position=i*ratio,index=Math.floor(position),next=Math.min(input.length-1,index+1),fraction=position-index;
      var a=input[Math.min(input.length-1,index)] || 0,b=input[next] || a;
      output[i]=a+(b-a)*fraction;
    }
    return output;
  }
  function pcm16(input){
    var buffer=new ArrayBuffer(input.length*2),view=new DataView(buffer);
    for(var i=0;i<input.length;i+=1){
      var s=Math.max(-1,Math.min(1,Number(input[i] || 0)));
      view.setInt16(i*2,s<0 ? s*0x8000:s*0x7fff,true);
    }
    return buffer;
  }
  function startAudio(stream){
    var AudioContextCtor=global.AudioContext || global.webkitAudioContext;
    if(!AudioContextCtor) throw new Error('이 기기에서 오디오 처리를 시작할 수 없습니다.');
    state.stream=stream;
    var context=new AudioContextCtor(); state.audioContext=context;
    var source=context.createMediaStreamSource(stream); state.source=source;
    var processor=context.createScriptProcessor(4096,1,1); state.processor=processor;
    processor.onaudioprocess=function(event){
      if(!state.active || state.socket?.readyState !== WebSocket.OPEN) return;
      var mono=resample(event.inputBuffer.getChannelData(0),context.sampleRate);
      if(mono.length){try{state.socket.send(pcm16(mono));}catch(_){}}
      try{event.outputBuffer.getChannelData(0).fill(0);}catch(_){}
    };
    source.connect(processor);
    processor.connect(context.destination);
    if(context.state === 'suspended'){try{context.resume();}catch(_){}}
  }
  function turn(id){
    var key=String(id !== undefined && id !== null ? id:'turn-' + state.turnOrder.length);
    if(!state.turns.has(key)){state.turns.set(key,{speaker:'',text:'',partial:''});state.turnOrder.push(key);}
    return state.turns.get(key);
  }
  function handleMeta(event){
    if(!event || typeof event !== 'object') return;
    var item=turn(event.turnId !== undefined ? event.turnId:event.turn_id);
    if(event.type === 'speaker'){item.speaker=String(event.speaker || event.label || '').trim();return;}
    if(event.type === 'transcript'){item.partial=String(event.transcript || '');if(event.final === true)item.text=item.partial;return;}
    if(event.type === 'speechComplete') item.text=String(event.transcript || item.text || item.partial || '').trim();
  }
  function transcript(){
    return state.turnOrder.map(function(id){
      var item=state.turns.get(id); if(!item) return '';
      var text=String(item.text || item.partial || '').replace(/\s+/g,' ').trim(); if(!text) return '';
      var speaker=String(item.speaker || '').trim();
      return (speaker ? '[' + speaker + '] ':'') + text;
    }).filter(Boolean).join('\n').trim();
  }
  function showResult(){
    ensureUi();
    state.lastTranscript=transcript();
    var field=document.getElementById('kcfMuseResultText');if(field) field.value=state.lastTranscript;
    var overlay=document.getElementById('kcfMuseResultOverlay');if(overlay) overlay.hidden=false;
    if(!state.lastTranscript) notify('인식된 수업 음성이 없어요.');
  }
  function hideResult(){var overlay=document.getElementById('kcfMuseResultOverlay');if(overlay)overlay.hidden=true;}
  function insertResultIntoQuickNote(){
    var text=String(state.lastTranscript || '').trim();
    if(!text) return notify('퀵노트에 넣을 전사 내용이 없어요.');
    var target=document.getElementById('kcfTeacherSheetInput') || document.getElementById('kcfInput');if(!target)return;
    var base=String(target.value || '').trimEnd();
    target.value=base + (base ? '\n\n':'') + '[Muse 수업기록]\n' + text;
    target.dispatchEvent(new Event('input',{bubbles:true}));
    var baseInput=document.getElementById('kcfInput');
    if(baseInput && baseInput !== target){baseInput.value=target.value;baseInput.dispatchEvent(new Event('input',{bubbles:true}));}
    hideResult();
    notify('Muse 수업기록을 퀵노트에 넣었어요.');
  }
  function finish(show){
    var shouldShow=show !== false;
    clearTimers();stopAudio();releaseWakeLock();closeSocket();
    state.starting=state.active=state.stopping=false;state.startedAt=0;updateStatus();
    if(shouldShow)showResult();
  }
  function handleServer(message){
    if(!message || typeof message !== 'object') return;
    if(message.type === 'muse.ready'){
      if(!state.starting || !state.stream)return;
      try{startAudio(state.stream);}catch(error){notify(error?.message || 'Muse 오디오 처리를 시작하지 못했습니다.');finish(false);return;}
      state.starting=false;state.active=true;state.startedAt=Date.now();
      state.elapsedTimer=setInterval(updateStatus,1000);
      state.maxTimer=setTimeout(function(){if(state.active){notify('Muse 실험 녹음은 9분까지 기록합니다.');stop();}},MAX_CAPTURE_MS);
      updateStatus();notify('Muse 수업기록을 시작했어요.');return;
    }
    if(message.type === 'muse.meta'){handleMeta(message.event);return;}
    if(message.type === 'muse.error'){notify(message.message || 'Muse 전사 오류가 발생했습니다.');if(!state.stopping)finish(false);return;}
    if(message.type === 'muse.complete')finish(true);
  }
  async function start(){
    if(state.starting || state.active || state.stopping)return;
    if(!navigator.mediaDevices?.getUserMedia || !global.WebSocket)return notify('이 기기에서는 Muse 수업기록을 사용할 수 없습니다.');
    var token=sessionToken(),academy=academyId();
    if(!token || !academy)return notify('Muse 수업기록은 로그인된 학원에서 사용할 수 있어요.');
    state.turns=new Map();state.turnOrder=[];state.lastTranscript='';state.starting=true;setButtonState();ensureUi();
    try{
      await acquireWakeLock();
      var stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      state.stream=stream;
      var socket=new WebSocket(socketUrl());socket.binaryType='arraybuffer';state.socket=socket;
      socket.addEventListener('open',function(){if(state.starting)socket.send(JSON.stringify({type:'auth',sessionToken:token,academyId:academy}));});
      socket.addEventListener('message',function(event){if(typeof event.data !== 'string')return;let message=null;try{message=JSON.parse(event.data);}catch(_){}handleServer(message);});
      socket.addEventListener('close',function(event){
        if(state.stopping){if(!state.finalTimer)state.finalTimer=setTimeout(function(){finish(true);},120);return;}
        if(state.active || state.starting){notify(event?.code === 1000 ? 'Muse 수업기록을 종료했어요.':'Muse 연결이 종료됐어요.');finish(state.turnOrder.length>0);}
      });
      socket.addEventListener('error',function(){if(state.starting || state.active){notify('Muse 서버에 연결하지 못했습니다.');finish(false);}});
    }catch(error){
      console.warn('[OLLI Muse Voice] start failed:',error);
      notify(error?.name === 'NotAllowedError' ? '마이크 권한을 허용해 주세요.':(error?.message || 'Muse 수업기록을 시작하지 못했습니다.'));
      finish(false);
    }
  }
  function stop(){
    if(!state.active && !state.starting)return;
    if(state.starting && !state.active){finish(false);return;}
    state.active=false;state.stopping=true;clearTimers();stopAudio();releaseWakeLock();updateStatus();
    if(state.socket?.readyState === WebSocket.OPEN){
      try{state.socket.send(JSON.stringify({type:'endStream'}));}catch(_){}
      state.finalTimer=setTimeout(function(){finish(true);},FINAL_WAIT_MS);
    }else finish(true);
  }
  async function toggle(){if(state.active || state.starting){stop();return;}if(!state.stopping)await start();}

  global.addEventListener('pagehide',function(){if(state.active || state.starting || state.stopping)finish(false);});
  document.addEventListener('visibilitychange',function(){if(!document.hidden && state.active && !state.wakeLock)acquireWakeLock();});
  global.OlliMuseClassVoice=Object.freeze({start:start,stop:stop,toggle:toggle,isActive:function(){return state.active;},getTranscript:transcript});
})(window);
