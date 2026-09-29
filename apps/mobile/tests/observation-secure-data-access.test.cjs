const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname,'..');
const storage = fs.readFileSync(path.join(root,'olli-storage-core.js'),'utf8');
const vercel = fs.readFileSync(path.join(root,'vercel.json'),'utf8');

function featureBlock(feature){
  const start=storage.indexOf(`feature: '${feature}'`);
  assert.notEqual(start,-1,`${feature} missing`);
  const b0=storage.lastIndexOf('FeatureRegistry.register({',start);
  const b1=storage.indexOf('\n  });',start);
  return storage.slice(b0,b1+6);
}

test('mobile photo metadata and note archive use account-session RPC transport',()=>{
  const expected={
    feedback_photo:'olli_feedback_photo_data_access',
    feedback_photo_student_link:'olli_feedback_photo_data_access',
    student_note_archive:'olli_note_archive_data_access'
  };
  Object.entries(expected).forEach(([feature,rpc])=>{
    const block=featureBlock(feature);
    assert.match(block,/transport: 'session_rpc'/);
    assert.match(block,new RegExp(`rpc: '${rpc}'`));
  });
});

test('mobile preview consumes secured observation memo storage common from PC work branch',()=>{
  assert.match(vercel,/pc\/main\/observation-memo-storage-common\.js/);
});
