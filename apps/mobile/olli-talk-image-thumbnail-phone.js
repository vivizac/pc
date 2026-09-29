/* Team Chat phone thumbnail generator
 * Creates a small local preview before upload. No paid image transformation service.
 */
(function(global){
  'use strict';

  if(global.OlliTalkImageThumbnailPhone?.version)return;

  const MAX_EDGE=640;
  const MAX_BYTES=2*1024*1024;
  const WEBP_QUALITY=0.72;
  const JPEG_QUALITY=0.80;
  const IMAGE_EXTENSION_RE=/\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i;

  function isImageFile(file){
    if(!file)return false;
    const mime=String(file.type||'').toLowerCase();
    return mime.startsWith('image/')||IMAGE_EXTENSION_RE.test(String(file.name||''));
  }

  function canvasToBlob(canvas,type,quality){
    return new Promise(resolve=>{
      try{canvas.toBlob(blob=>resolve(blob||null),type,quality)}
      catch(_){resolve(null)}
    });
  }

  function loadHtmlImage(file){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);
      const image=new Image();
      image.decoding='async';
      let settled=false;
      const cleanup=()=>{try{URL.revokeObjectURL(url)}catch(_){}};
      const done=()=>{
        if(settled)return;
        const width=Math.max(0,Number(image.naturalWidth||image.width||0));
        const height=Math.max(0,Number(image.naturalHeight||image.height||0));
        if(!width||!height){
          settled=true;
          cleanup();
          reject(new Error('이미지 크기를 확인하지 못했습니다.'));
          return;
        }
        settled=true;
        resolve({source:image,width,height,cleanup});
      };
      image.onload=done;
      image.onerror=()=>{
        if(settled)return;
        settled=true;
        cleanup();
        reject(new Error('이미지를 읽지 못했습니다.'));
      };
      image.src=url;
      if(typeof image.decode==='function'){
        image.decode().then(done).catch(()=>{});
      }
    });
  }

  async function loadImageSource(file){
    if(typeof global.createImageBitmap==='function'){
      try{
        const bitmap=await global.createImageBitmap(file,{imageOrientation:'from-image'});
        const width=Math.max(0,Number(bitmap?.width||0));
        const height=Math.max(0,Number(bitmap?.height||0));
        if(width&&height){
          return {source:bitmap,width,height,cleanup:()=>{try{bitmap.close?.()}catch(_){}}};
        }
        try{bitmap?.close?.()}catch(_){}
      }catch(_){
        try{
          const bitmap=await global.createImageBitmap(file);
          const width=Math.max(0,Number(bitmap?.width||0));
          const height=Math.max(0,Number(bitmap?.height||0));
          if(width&&height){
            return {source:bitmap,width,height,cleanup:()=>{try{bitmap.close?.()}catch(_){}}};
          }
          try{bitmap?.close?.()}catch(_){}
        }catch(_){}
      }
    }
    return loadHtmlImage(file);
  }

  async function createThumbnail(file){
    if(!isImageFile(file))return null;

    let decoded=null;
    try{
      decoded=await loadImageSource(file);
      const sourceWidth=Math.max(1,Math.round(decoded.width));
      const sourceHeight=Math.max(1,Math.round(decoded.height));
      const scale=Math.min(1,MAX_EDGE/Math.max(sourceWidth,sourceHeight));
      const width=Math.max(1,Math.round(sourceWidth*scale));
      const height=Math.max(1,Math.round(sourceHeight*scale));

      const canvas=document.createElement('canvas');
      canvas.width=width;
      canvas.height=height;
      const context=canvas.getContext('2d');
      if(!context)return null;
      context.drawImage(decoded.source,0,0,width,height);

      let blob=await canvasToBlob(canvas,'image/webp',WEBP_QUALITY);
      let mimeType=String(blob?.type||'').toLowerCase();
      if(!blob||mimeType!=='image/webp'){
        const jpegCanvas=document.createElement('canvas');
        jpegCanvas.width=width;
        jpegCanvas.height=height;
        const jpegContext=jpegCanvas.getContext('2d',{alpha:false});
        if(!jpegContext)return null;
        jpegContext.fillStyle='#fff';
        jpegContext.fillRect(0,0,width,height);
        jpegContext.drawImage(decoded.source,0,0,width,height);
        blob=await canvasToBlob(jpegCanvas,'image/jpeg',JPEG_QUALITY);
        mimeType=String(blob?.type||'').toLowerCase();
      }

      if(!blob||blob.size<1||blob.size>MAX_BYTES)return null;
      if(mimeType!=='image/webp'&&mimeType!=='image/jpeg')return null;

      return {
        blob,
        mimeType,
        fileName:mimeType==='image/webp'?'thumbnail.webp':'thumbnail.jpg',
        bytes:blob.size,
        imageWidth:sourceWidth,
        imageHeight:sourceHeight,
        thumbnailWidth:width,
        thumbnailHeight:height
      };
    }catch(error){
      console.warn('Team Chat 썸네일 생성 실패:',error?.message||error);
      return null;
    }finally{
      try{decoded?.cleanup?.()}catch(_){}
    }
  }

  global.OlliTalkImageThumbnailPhone=Object.freeze({
    version:'1.0.0',
    MAX_EDGE,
    isImageFile,
    create:createThumbnail
  });
})(window);
