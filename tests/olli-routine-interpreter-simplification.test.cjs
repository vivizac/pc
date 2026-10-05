'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const contextRoute=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
const common=fs.readFileSync(path.join(root,'packages/common/olli-command-router-common.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

assert.match(contextRoute,/Your job is translation, not data extraction/);
assert.match(contextRoute,/max_output_tokens:160/);
assert.doesNotMatch(contextRoute,/Structured command pilot:/);
assert.doesNotMatch(contextRoute,/batch_commands:\{/);
assert.match(contextRoute,/required:\['lane','intent','standalone_command','context_used'\]/);
assert.doesNotMatch(contextRoute,/reply:\{type:'string'\}/);

assert.match(common,/function interpretedIntentToStructuredCommand\(intent, text\)/);
assert.match(pc,/router\.interpretedIntentToStructuredCommand\(interpreterIntent,commandText\)/);
assert.match(mobile,/router\.interpretedIntentToStructuredCommand\(interpreterIntent,commandText\)/);
assert.match(common,/function parseCanonicalAddDraft\(text, intent\)/);

console.log('routine interpreter simplification regression: ok');
