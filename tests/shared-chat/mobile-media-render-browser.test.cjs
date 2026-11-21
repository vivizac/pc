'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');
const stop="  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', init, { once:true });\n  } else {\n    init();\n  }";
assert.ok(source.includes(stop),'test hooks target the actual mobile renderer, never a duplicate implementation');
const harness=source.replace(stop,
  "  window.__renderSharedMediaTest=renderOlliTalkServerMessages;\n  window.__makeSharedBubbleTest=createOlliTalkMessageBubble;");

function file(id,fileName,mime){
  return {id:'shared:'+id,shared_message_id:id,is_shared:true,
    message_type:'file',sender_name:'루루',sender_member_id:'teacher',
    branch_name:'대천점',body:fileName,
    created_at:new Date(Date.UTC(2026,10,19,6,id)).toISOString(),
    attachment:{id:'attachment-'+id,is_shared:true,kind:'media',
      file_name:fileName,mime_type:mime,file_size:1000}};
}

test('production MIME classifier executes for both JPEG and QuickTime MOV without throwing',()=>{
  const start=source.indexOf('  function isOlliTalkVideoAttachment(attachment){');
  const end=source.indexOf('\n  function isOlliTalkImageAttachment(',start);
  assert.ok(start>=0&&end>start,'test the real production MIME classifier');
  const classifier=new Function(source.slice(start,end)+';return isOlliTalkVideoAttachment;')();
  assert.equal(classifier({mime_type:'image/jpeg',file_name:'IMG_4660.jpeg'}),false);
  assert.equal(classifier({mime_type:'video/quicktime',file_name:'IMG_4667.mov'}),true);
  assert.equal(classifier({mime_type:'application/octet-stream',file_name:'IMG_4662.mov'}),true);
  assert.equal(classifier({mime_type:'application/pdf',file_name:'notes.pdf'}),false);
});

test('iPhone-sized real renderer mounts photo/video previews, not raw IMG filenames', {timeout:120000},async()=>{
  const browser=await chromium.launch({headless:true,channel:'chromium'});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
    await page.setContent('<!doctype html><html><body><div id="olliTalkBetaScreen" style="display:flex"><div id="olliTalkBetaChatArea"></div></div></body></html>');
    await page.addScriptTag({content:`
      window.__mountedPreviews=[];
      window.OlliSharedTeamChat={
        mountUnifiedThumbnail:(attachment,target)=>{
          if(!target.isConnected)throw Error('thumbnail mount must occur after DOM insertion');
          window.__mountedPreviews.push({id:attachment.id,mime:attachment.mime_type});
          const image=document.createElement('img');
          image.className='olliUnifiedThumbnailImage';
          image.alt='';image.src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
          target.append(image);
          return true;
        }
      };
      window.OlliTeamTalkAvatars=undefined;
      window.OlliCommandRouter=undefined;
    `});
    await page.addScriptTag({content:harness});
    const result=await page.evaluate(records=>{
      const faults=[];console.warn=(...args)=>faults.push(args.map(x=>x?.message||String(x)).join(' | '));
      const messages=records.map(([id,name,mime])=>({
        id:'shared:'+id,shared_message_id:id,is_shared:true,
        message_type:'file',sender_name:'루루',sender_member_id:'teacher',
        branch_name:'대천점',body:name,
        created_at:new Date(Date.UTC(2026,10,19,6,id)).toISOString(),
        attachment:{id:'attachment-'+id,is_shared:true,kind:'media',
          file_name:name,mime_type:mime,file_size:1000}
      }));
      window.__renderSharedMediaTest({academy_id:'academy',current_member_id:'owner',messages},{scrollMode:'initial-latest'});
      const frames=[...document.querySelectorAll('.olliTalkBetaAttachmentImageFrame')];
      return {
        frames:frames.length,
        photos:frames.filter(f=>f.getAttribute('aria-label')==='원본 사진 보기').length,
        videos:frames.filter(f=>f.getAttribute('aria-label')==='원본 동영상 보기').length,
        mounted:window.__mountedPreviews.length,
        files:[...document.querySelectorAll('.olliTalkBetaBubble')].map(n=>n.textContent.trim()),
        images:document.querySelectorAll('.olliUnifiedThumbnailImage').length,
        faults
      };
    },[
      [23,'IMG_4660.jpeg','image/jpeg'],
      [24,'IMG_4667.mov','video/quicktime'],
      [25,'IMG_4660.jpeg','image/jpeg'],
      [28,'IMG_4662.mov','video/quicktime']
    ]);
    assert.equal(result.frames,4,JSON.stringify(result));
    assert.equal(result.photos,2);
    assert.equal(result.videos,2);
    assert.equal(result.mounted,4,'each preview starts only after its frame is attached');
    assert.equal(result.images,4);
    assert.equal(result.files.some(x=>/^IMG_466[027]\.(jpeg|mov)$/.test(x)),false,
      'no raw file-name text bubble may replace a media preview');
    await page.close();
  }finally{await browser.close();}
});

test('a single malformed optional message action still preserves attachment cards', {timeout:120000},async()=>{
  const browser=await chromium.launch({headless:true,channel:'chromium'});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.setContent('<div id="olliTalkBetaScreen" style="display:flex"><div id="olliTalkBetaChatArea"></div></div>');
    await page.addScriptTag({content:`
      window.OlliSharedTeamChat={mountUnifiedThumbnail:(attachment,target)=>{
        const img=document.createElement('img');img.className='olliUnifiedThumbnailImage';target.append(img);return true;
      }};
      window.OlliTeacherPayroll={createTeamChatPayrollButton:()=>{throw Error('Optional widget failed')}};
    `});
    await page.addScriptTag({content:harness});
    const result=await page.evaluate(()=>{
      const faults=[];console.warn=(...args)=>faults.push(args.map(x=>x?.message||String(x)).join(' | '));
      const item={id:'shared:23',is_shared:true,message_type:'file',
        sender_name:'루루',sender_member_id:'teacher',branch_name:'대천점',
        created_at:'2026-11-19T06:00:00Z',body:'IMG_4660.jpeg',
        attachment:{id:'file-id',is_shared:true,kind:'media',file_name:'IMG_4660.jpeg',mime_type:'image/jpeg'}};
      window.__renderSharedMediaTest({academy_id:'academy',current_member_id:'owner',messages:[item]},{scrollMode:'initial-latest'});
      return {cards:document.querySelectorAll('.olliTalkBetaAttachmentImageFrame').length,
        images:document.querySelectorAll('.olliUnifiedThumbnailImage').length,
        plain:[...document.querySelectorAll('.olliTalkBetaBubble')].filter(el=>el.textContent==='IMG_4660.jpeg').length,faults};
    });
    assert.equal(result.cards,1,JSON.stringify(result));
    assert.equal(result.images,1,JSON.stringify(result));
    assert.equal(result.plain,0,JSON.stringify(result));
    await page.close();
  }finally{await browser.close();}
});

test('the production phone loads the new renderer and uses authorized media in memory only',()=>{
  assert.match(html,/olli-talk-beta\.js\?v=20261121-stable-reentry-v2/);
  assert.match(source,/frame\.__olliUnifiedAttachment=attachment/);
  assert.match(source,/hydrateOlliTalkUnifiedThumbnails\(chatArea\)/);
  assert.match(source,/const visibleAfterDeletion=currentView===nextChat/);
  assert.match(source,/if\(item\?\.attachment\?\.is_shared\)\{\s*try\{bubble=createOlliTalkUnifiedAttachmentBubble\(item\)/);
  assert.doesNotMatch(source,/localStorage\.setItem\([^\n]*__olliUnifiedAttachment/);
});
