#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Real Chromium on owned R64 review ZIP, not a customer product UI capture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import JSZip from 'jszip';
import {chromium} from '../.ci-tools/node_modules/playwright/index.mjs';

const root=resolve(process.argv[2]??'evidence/review-kit');
const report=JSON.parse(readFileSync(join(root,'result.json'),'utf8'));
assert.equal(report.synthetic_fixture,true);
assert.equal(report.external_publish,false);
const receipt=report.receipt;
const bytes=readFileSync(join(root,receipt.filename));
assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.zip_sha256);
const archive=await JSZip.loadAsync(bytes,{checkCRC32:true});
const temp=mkdtempSync(join(tmpdir(),'launchwright-r64-browser-'));
const output=join(root,'screenshots');mkdirSync(output,{recursive:true});
let browser,accepted=false;
try{
  for(const name of Object.keys(archive.files)){
    assert.ok(/^(?:index\.html|manifest\.json|docs\/[a-z0-9-]+\.(?:html|json)|deck\/release-deck\.(?:pptx|pdf))$/u.test(name),
      'Owned browser fixture has an unexpected archive name');
    const path=join(temp,name);
    mkdirSync(dirname(path),{recursive:true});
    writeFileSync(path,await archive.file(name).async('nodebuffer'));
  }
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/u.test(r.url()))requests.push(r.url());});
  const indexUrl=pathToFileURL(join(temp,'index.html')).href;
  await page.goto(indexUrl);
  assert.equal(await page.getByRole('heading',{name:'Release review kit'}).count(),1);
  assert.equal(await page.getByRole('link',{name:'Open documentation'}).count(),1);
  assert.equal(await page.getByRole('link',{name:'Open PowerPoint'}).count(),1);
  assert.equal(await page.getByRole('link',{name:'Open PDF'}).count(),1);
  assert.match(await page.locator('.warning').innerText(),/TECHNICAL UNKNOWN/u);
  const link=page.getByRole('link',{name:'Open documentation'});
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    const metrics=await page.evaluate(()=>({
      width:innerWidth,scroll:document.documentElement.scrollWidth,
      navigationHeight:document.querySelector('.card a')?.getBoundingClientRect().height??0
    }));
    assert.ok(metrics.scroll<=width+1,'Offline kit viewport overflow: '+JSON.stringify(metrics));
    assert.ok(metrics.navigationHeight>=44,'Offline card action has insufficient touch height');
    await page.screenshot({path:join(output,'review-kit-'+width+'.png'),fullPage:true});
  }
  await page.context().setOffline(true);
  await link.click();
  await page.locator('.mark').getByText('Launchwright · Private docs').waitFor({timeout:15000});
  assert.ok(page.url().endsWith('/docs/index.html'));
  const docsPage=await page.locator('body').innerText();
  assert.ok(!docsPage.includes('TECHNICAL PASS'));
  await page.screenshot({path:join(output,'review-docs-offline.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  assert.deepEqual(requests,[]);
  accepted=true;
  process.stdout.write(JSON.stringify({
    schema_version:'launchwright-r64-real-browser-acceptance/1',
    passed:accepted,source_plan_sha256:report.plan_sha256,
    viewport_widths:[320,390,768,1440],
    docs_navigation_offline:true,
    external_requests:requests.length,page_errors:errors.length,
    source_scripts_executed:false,customer_product_captured:false,
    platform_authority:false
  },null,2)+'\n');
}finally{
  try{await browser?.close();}finally{
    rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
}
