'use strict';
// Node 24 TestsStream reporter: preserve every result without dumping entire
// HTML/SQL files into assertion output. The Node runner still controls exit status.
module.exports=async function* reporter(events){
  for await(const {type,data} of events){
    if(type==='test:pass'||type==='test:fail'){
      const error=data.details?.error,cause=error?.cause||error;
      yield JSON.stringify({type,file:data.file,entryFile:data.entryFile,name:data.name,line:data.line,
        nesting:data.nesting,skip:data.skip||false,todo:data.todo||false,
        error:cause?{name:cause.name,code:cause.code,failureType:error?.failureType||cause.failureType,
          message:String(cause.message||cause).slice(0,1800),stack:String(cause.stack||'').split('\n').slice(0,6).join('\n')}:null})+'\n';
    }else if(type==='test:summary'){
      yield JSON.stringify({type,...data})+'\n';
    }else if(type==='test:stderr'){
      yield JSON.stringify({type,file:data.file,message:String(data.message).slice(0,3000)})+'\n';
    }
  }
};
