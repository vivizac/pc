(function(global){
'use strict';

const AVATAR_KEYS=Object.freeze(Array.from({length:15},(_,index)=>'avatar-'+String(index+1).padStart(2,'0')));

function normalizeKey(value){
  const key=String(value||'').trim().toLowerCase();
  return AVATAR_KEYS.includes(key)?key:'';
}

function hash(value){
  const text=String(value||'');
  let result=2166136261;
  for(let i=0;i<text.length;i+=1){
    result^=text.charCodeAt(i);
    result=Math.imul(result,16777619);
  }
  return result>>>0;
}

function fallbackKey(seed){
  return AVATAR_KEYS[hash(seed)%AVATAR_KEYS.length];
}

function src(value,seed){
  const key=normalizeKey(value)||fallbackKey(seed);
  return 'team-talk-avatars/'+key+'.webp';
}

global.OlliTeamTalkAvatars=Object.freeze({
  keys:AVATAR_KEYS,
  normalizeKey,
  fallbackKey,
  src
});
})(window);
