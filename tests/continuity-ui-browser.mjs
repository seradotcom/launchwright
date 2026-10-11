// SPDX-License-Identifier: AGPL-3.0-only
// R67: real Chromium host UI test on owned Native fixtures in GitHub Actions.
// Never launches a customer application or exercises publication accounts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../.ci-tools/node_modules/playwright/index.mjs';
import {LaunchwrightApplication} from '../src/application.mjs';
import {createAppServer} from '../src/server.mjs';
import {createR67Fixture} from './continuity-r67-fixture.mjs';
const root=mkdtempSync(join(tmpdir(),'launchwright-r67-browser-'));
const output=join(process.cwd(),'evidence','continuity-browser');
mkdirSync(output,{recursive:true});
const token='r67-real-browser-local-owner-only-token';
let browser,service,app;
const errors=[],screens=[];
let passed=false;
try{
  app=new LaunchwrightApplication(root,{initialize:true});
  const fixture=await createR67Fixture(app);
  service=createAppServer(app,{port:0,token});
  const origin=await service.listen();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:950},acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#continuity');
  await page.locator('#token').fill(token);
  await page.getByRole('button',{name:'Open workspace'}).click();
  await page.getByRole('heading',{name:'Release continuity'}).waitFor();
  await page.selectOption('#continuity-before-release',fixture.old.release.id);
  await page.selectOption('#continuity-before-candidate',fixture.before.id);
  await page.selectOption('#continuity-after-release',fixture.afterRelease.id);
  await page.selectOption('#continuity-after-candidate',fixture.after.id);
  await page.locator('#continuity-private-confirm').check();
  await page.locator('#continuity-incomplete-confirm').check();
  await page.locator('[data-action="continuity-plan"]').click();
  await page.getByText('Prepared plan — no export yet').waitFor();
  const shaText=await page.locator('.continuity-hash').allTextContents();
  const [planSha,beforeSha,afterSha]=shaText;
  assert.match(planSha,/^[a-f0-9]{64}$/);
  assert.equal(beforeSha,fixture.before.data.candidate_sha256);
  assert.equal(afterSha,fixture.after.data.candidate_sha256);
  await page.locator('[data-action="continuity-export"]').click();
  await page.locator('#f-confirm_plan_sha256').fill(planSha);
  await page.locator('#f-confirm_before_candidate_sha256').fill(beforeSha);
  await page.locator('#f-confirm_after_candidate_sha256').fill(afterSha);
  await page.locator('#f-acknowledge_private_export').check();
  await page.locator('#save-editor').click();
  const downloadLink=page.getByRole('link',{name:'Download private continuity ZIP'});
  await downloadLink.waitFor();
  const href=await downloadLink.getAttribute('href');
  assert.ok(href.endsWith('/'+planSha+'/bundle.zip'));
  const res=await page.request.get(origin+href);
  assert.equal(res.status(),200);
  const bytes=await res.body();
  const zipSha=createHash('sha256').update(bytes).digest('hex');
  assert.ok((await page.locator('.continuity-hash').allTextContents()).includes(zipSha));
  // Verify browser cannot convert a private export into a published/verified receipt.
  const pageText=await page.locator('#main').innerText();
  assert.ok(pageText.includes('UNKNOWN'));
  assert.ok(pageText.includes('External publication'));
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:950});
    await page.screenshot({path:join(output,'continuity-'+width+'.png'),fullPage:true});
    screens.push('continuity-'+width+'.png');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=1,'Unexpected browser continuity horizontal overflow '+width+': '+overflow);
    assert.equal(await downloadLink.count(),1);
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  writeFileSync(join(output,'source-receipt.json'),JSON.stringify({
    schema_version:'launchwright-r67-owned-browser/1',
    plan_sha256:planSha,zip_sha256:zipSha,
    candidate_before_sha256:beforeSha,candidate_after_sha256:afterSha,
    source_application_executed:false,platform_authority:false,
    customer_acceptance:false,external_publication:false,
    screenshot_widths:[1440,768,390,320],errors
  },null,2)+'\n');
  passed=true;
}finally{
  await browser?.close();
  await service?.close();
  app?.close();
  rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  if(!passed)process.exitCode=1;
}
