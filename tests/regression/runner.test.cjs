const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {analyze,cleanEnv,inside}=require('./run.cjs');
test('regression result cannot pass without a completed aggregate summary',()=>{
  assert.equal(analyze('',0).success,false);
  const summary=JSON.stringify({type:'test:summary',success:true,counts:{tests:1,passed:1,failed:0}});
  assert.equal(analyze(summary,1).success,false);assert.equal(analyze(summary,0).success,true);
});
test('regression children do not inherit hosted application credentials',()=>{
  const env=cleanEnv({PATH:'path',PLAYWRIGHT_BROWSERS_PATH:'local',NODE_PATH:'deps',SUPABASE_SECRET_KEY:'secret',
    OPENAI_API_KEY:'secret',OLLI_ACCOUNT_SESSION_TOKEN:'secret',DATABASE_URL:'secret'});
  assert.deepEqual(Object.keys(env).sort(),['NODE_PATH','PATH','PLAYWRIGHT_BROWSERS_PATH']);
});
test('snapshot containment distinguishes a sibling with the same prefix',()=>{
  const root=path.resolve('fixture');assert.equal(inside(root,path.join(root,'a')),true);
  assert.equal(inside(root,path.resolve('fixture-other/a')),false);assert.equal(inside(root,path.resolve('../a')),false);
});
test('structured reporter keeps passing, failing, skipped and bootstrap results and failing exit',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'olli-reporter-test-'));
  const fixture=path.join(dir,'sample.test.cjs');
  fs.writeFileSync(fixture,"const {test}=require('node:test');test('pass',()=>{});test('fail',()=>{throw Error('deliberate failure')});test.skip('skip',()=>{});");
  const reporter=pathToFileURL(path.join(__dirname,'reporter.cjs')).href;
  const r=cp.spawnSync(process.execPath,['--test','--test-reporter='+reporter,fixture],{encoding:'utf8',env:cleanEnv(process.env)});
  const result=analyze(r.stdout,r.status);assert.equal(r.status,1,r.stderr+'\n'+r.stdout);assert.equal(result.completed,true);
  assert.equal(result.counts.failed,1);assert.equal(result.counts.passed,1);assert.equal(result.counts.skipped,1);
  assert.equal(result.failures[0].error.message,'deliberate failure');
  fs.writeFileSync(fixture,"throw new SyntaxError('deliberate bootstrap failure');");
  const bootstrap=cp.spawnSync(process.execPath,['--test','--test-reporter='+reporter,fixture],{encoding:'utf8',env:cleanEnv(process.env)});
  const failed=analyze(bootstrap.stdout,bootstrap.status);assert.equal(failed.success,false);
  assert.equal(failed.failures.length,1);assert.ok(failed.diagnostics.some(x=>x.message.includes('deliberate bootstrap failure')));
});
