// SPDX-License-Identifier: AGPL-3.0-only
// R54 owned offline real Chromium review of two-release private dossier.
// Customer execution, canonical Graph and Platform Publish remain unproved.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '../.ci-tools/node_modules/playwright/index.mjs';

const root='evidence/continuity';
const result=JSON.parse(readFileSync(join(root,'result.json'),'utf8'));
assert.equal(result.schema_version,'launchwright-r54-owned-continuity-smoke/1');
assert.equal(result.real_customer_acceptance,false);
assert.equal(result.external_publication,false);
assert.equal(result.platform_authority,false);
const browser=await chromium.launch({
  headless:true,
  ...(process.env.LAUNCHWRIGHT_TEST_CHROMIUM_PATH?
    {executablePath:process.env.LAUNCHWRIGHT_TEST_CHROMIUM_PATH}:{})
});
let passed=false;
const errors=[],requests=[],screens=[];
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>requests.push(r.url()));
try{
  await page.goto(pathToFileURL(join(process.cwd(),root,'preview.html')).href);
  await page.getByRole('heading',{name:'Release continuity'}).waitFor();
  assert.equal(await page.locator('table tbody tr').count(),3);
  assert.equal(await page.locator('.metrics .metric').count(),4);
  assert.equal(await page.getByText('1.0 Synthetic',{exact:true}).count(),1);
  assert.equal(await page.getByText('1.1 Synthetic',{exact:true}).count(),1);
  for(const state of ['ADDED','REMOVED','CHANGED'])
    assert.equal(await page.locator('tbody .status.'+state.toLowerCase()).count(),1);
  assert.equal(await page.locator('tbody .status.unchanged').count(),0);
  assert.ok((await page.locator('tbody').innerText()).includes('Editorial copy unchanged'));
  const fullText=await page.locator('main').innerText();
  for(const phrase of [
    'Registered workspace inventory only',
    'No automatic copy reuse',
    'No canonical Platform Publish',
    'DRAFT / NOT PUBLISHED'
  ])assert.ok(fullText.includes(phrase),phrase);
  assert.equal(await page.locator('script').count(),0);
  assert.equal(await page.locator('iframe').count(),0);
  const policy=await page.locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  assert.ok(policy.includes("script-src 'none'"));
  assert.ok(policy.includes("connect-src 'none'"));
  const file=join(root,'continuity-1440.png');
  await page.screenshot({path:file,fullPage:true});
  screens.push(file);
  for(const width of [768,390,320]){
    await page.setViewportSize({width,height:950});
    const measurement=await page.evaluate(()=>({
      viewport:innerWidth,document:document.documentElement.scrollWidth,
      offenders:[...document.querySelectorAll('body *')].filter(el=>
        el.getBoundingClientRect().right>innerWidth+1).slice(0,5).map(el=>({
          tag:el.tagName,elementClass:el.className,
          right:Math.ceil(el.getBoundingClientRect().right)
        }))
    }));
    assert.ok(measurement.document<=width+1,
      'Offline continuity page overflows width '+width+': '+JSON.stringify(measurement));
    assert.equal(await page.locator('table tbody tr').count(),3);
    const name=join(root,'continuity-'+width+'.png');
    await page.screenshot({path:name,fullPage:true});
    screens.push(name);
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.ok(requests.every(x=>x.startsWith('file://')),
    'Offline artifact must not fetch or connect to HTTP(S) resources');
  passed=true;
}finally{
  const report={
    schema_version:'launchwright-r54-chromium-acceptance/1',
    passed,screens,errors,network_requests:requests,
    private_operator_fixture:true,technical_truth:'UNKNOWN',
    external_customer_acceptance:false,
    platform_publish_authority:false,
    canonical_graph_authority:false
  };
  writeFileSync(join(root,'browser-result.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
if(!passed)process.exitCode=1;
