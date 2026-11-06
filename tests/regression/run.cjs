'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'../..');
const SUITES={root:'.',pc:'apps/pc',mobile:'apps/mobile'};
function inside(base,target){const rel=path.relative(base,target);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
function git(args){const r=cp.spawnSync('git',args,{cwd:ROOT,encoding:'utf8',maxBuffer:30e6});if(r.status!==0)throw Error(r.stderr||String(r.error));return r.stdout;}
function collect(dir){return fs.readdirSync(path.join(dir,'tests'),{recursive:true})
  .filter(f=>f.endsWith('.test.cjs')&&!f.split(path.sep).includes('node_modules')).sort().map(f=>path.join('tests',f));}
function cleanEnv(env){const result={...env};for(const key of Object.keys(result))
  if(/^(?:SUPABASE|OPENAI|VERCEL|DATABASE_URL|PGPASSWORD|PGHOST|PGUSER|SOLAPI)|^OLLI_.*(?:TOKEN|SECRET|KEY|URL)$/i.test(key))delete result[key];
  delete result.NODE_TEST_CONTEXT;
  return result;
}
function analyze(output,status){
  const events=output.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const summary=events.findLast(e=>e.type==='test:summary'&&!e.file);
  return {completed:!!summary,success:status===0&&summary?.success===true,
    counts:summary?.counts||null,failures:events.filter(e=>e.type==='test:fail'),
    skipped:events.filter(e=>e.skip),diagnostics:events.filter(e=>e.type==='test:stderr')};
}
function copySnapshot(target,ref,normalize){
  if(ref){
    const archive=target+'.tar';git(['archive','--format=tar','--output='+archive,ref]);
    const tar=cp.spawnSync('tar',['-xf',archive,'-C',target],{encoding:'utf8'});if(tar.status!==0)throw Error(tar.stderr);
  }else for(const file of git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean)){
    if(file.split('/').includes('node_modules')||file.startsWith('supabase/.temp/'))continue;
    const source=path.resolve(ROOT,file),dest=path.resolve(target,file);
    if(!inside(ROOT,source)||!inside(target,dest))throw Error('Unsafe snapshot path: '+file);
    if(!fs.existsSync(source)||!fs.statSync(source).isFile())continue;
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);
  }
  if(normalize)for(const file of fs.readdirSync(target,{recursive:true})){
    const full=path.join(target,file);if(fs.statSync(full).isFile()&&/\.(?:c?js|mjs|ts|css|html|json|sql|md|ya?ml|txt)$/.test(file))
      fs.writeFileSync(full,fs.readFileSync(full,'utf8').replace(/\r\n/g,'\n'));
  }
  // Reuse installed, pinned packages without staging common files in the checkout.
  for(const dir of ['apps/pc','apps/mobile','tests/shared-chat','tests/tuition']){
    const installed=path.join(ROOT,dir,'node_modules'),dest=path.join(target,dir,'node_modules');
    if(fs.existsSync(installed)&&fs.existsSync(path.dirname(dest)))fs.cpSync(installed,dest,{recursive:true,dereference:true});
  }
}
function main(argv){
  let compare=null,normalize=false,out=null,suite='all';
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--compare')compare=argv[++i];
    else if(argv[i]==='--normalize-eol')normalize=true;
    else if(argv[i]==='--out')out=path.resolve(argv[++i]);
    else if(argv[i]==='--suite')suite=argv[++i];
    else throw Error('Unknown argument: '+argv[i]);
  }
  if(suite!=='all'&&!Object.hasOwn(SUITES,suite))throw Error('Unknown suite: '+suite);
  out=out||fs.mkdtempSync(path.join(os.tmpdir(),'olli-regression-'));
  if(inside(ROOT,out))throw Error('Evidence output must be outside the source checkout.');
  fs.mkdirSync(out,{recursive:true});
  const report={head:git(['rev-parse','HEAD']).trim(),compareRef:compare,normalizedEol:normalize,node:process.version,results:[]};
  const env=cleanEnv(process.env);
  env.NODE_PATH=[path.join(ROOT,'tests/shared-chat/node_modules'),path.join(ROOT,'tests/tuition/node_modules'),
    path.join(ROOT,'apps/mobile/node_modules'),path.join(ROOT,'apps/pc/node_modules'),env.NODE_PATH||''].join(path.delimiter);
  const reporter=pathToFileURL(path.join(ROOT,'tests/regression/reporter.cjs')).href;
  for(const [label,ref] of [...(compare?[['baseline',compare]]:[]),['current',null]]){
    const snapshot=path.join(out,label);fs.mkdirSync(snapshot);copySnapshot(snapshot,ref,normalize);
    for(const [name,relative] of Object.entries(SUITES)){
      if(suite!=='all'&&suite!==name)continue;
      const cwd=path.join(snapshot,relative);
      if(name!=='root'){
        const staged=cp.spawnSync(process.execPath,['scripts/stage-common.cjs'],{cwd,env,encoding:'utf8'});
        if(staged.status!==0)throw Error('Common staging failed: '+staged.stderr);
      }
      const tests=collect(cwd);
      const r=cp.spawnSync(process.execPath,['--test','--test-concurrency=4','--test-timeout=120000','--test-force-exit',
        '--test-reporter='+reporter,...tests],{cwd,env,encoding:'utf8',maxBuffer:20e6,timeout:600000});
      fs.writeFileSync(path.join(out,label+'-'+name+'.jsonl'),r.stdout||'');
      if(r.stderr)fs.writeFileSync(path.join(out,label+'-'+name+'-stderr.log'),r.stderr);
      const result={label,suite:name,files:tests.length,exit:r.status,error:r.error?.message,...analyze(r.stdout||'',r.status)};
      // Paths identify repository test files, independent of the temporary workspace.
      for(const e of [...result.failures,...result.diagnostics])for(const key of ['file','entryFile'])if(e[key])e[key]=path.relative(snapshot,e[key]).split(path.sep).join('/');
      report.results.push(result);fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({label,suite:name,files:tests.length,counts:result.counts,completed:result.completed,success:result.success}));
    }
  }
  console.log('Evidence: '+out);
  return report.results.every(r=>r.success)?0:1;
}
module.exports={inside,cleanEnv,analyze,collect};
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}}
