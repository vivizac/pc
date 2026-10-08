'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const css=read('packages/common/olli-teacher-payroll-common.css');
const pcHtml=read('apps/pc/index.html');
const mobileHtml=read('apps/mobile/index.html');

test('PC and mobile payroll statement text is consistently 20% smaller',()=>{
  const start=css.indexOf('.olliPayrollStatementOverlay{');
  const end=css.indexOf('\n@media(max-width:560px){\n  .olliPayrollPage',start);
  assert.ok(start>=0 && end>start,'statement-only style range must be present');
  const statement=css.slice(start,end);

  const actual=[...statement.matchAll(/font-size:([\d.]+)px/g)].map(match=>Number(match[1]));
  const expected=[24,12,19.2,16.8,14.4,13.6,13.6,13.6,13.6,14.4,15.2,21.6,11.2,24];
  assert.deepEqual(actual,expected);

  const bodyRules=statement.match(/--olli-payroll-statement-body-font:calc\(13\.6px \* var\(--olli-text-scale,1\)\)/g)||[];
  assert.equal(bodyRules.length,2,'both desktop and mobile body font values must be scaled');
  assert.match(statement,/\.olliPayrollStatementSub\{[^}]*font-size:var\(--olli-payroll-statement-body-font\)/);
  assert.match(statement,/\.olliPayrollStatementDate\{[^}]*font-size:13\.6px/);
  assert.match(statement,/\.olliPayrollStatementPay strong\{[^}]*font-size:21\.6px/);

  for(const html of [pcHtml,mobileHtml]){
    assert.ok(html.includes('olli-teacher-payroll-common.css?v=20261008-statement-font80-1'));
  }
});
