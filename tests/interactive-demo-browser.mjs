// SPDX-License-Identifier: AGPL-3.0-only
// R43 real Chromium opens a generated, script-free offline HTML package.
// Not an external browser/product capture; only owned synthetic fixtures.
import { chromium } from '../.ci-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const output=resolve('evidence/interactive-demo');
const report=JSON.parse(readFileSync(join(output,'result.json'),'utf8'));
assert.equal(report.owner_synthetic_fixture,true);
assert.equal(report.technical_state,'UNKNOWN');
assert.equal(report.canonical_customer_capture,false);
const zipBytes=readFileSync(join(output,report.bundle_filename));
assert.equal(createHash('sha256').update(zipBytes).digest('hex'),report.bundle_sha256);
const zip=await JSZip.loadAsync(zipBytes,{checkCRC32:true});
const includedHtml=await zip.file('index.html').async('string');
assert.equal(readFileSync(join(output,'index.html'),'utf8'),includedHtml);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[],httpRequests=[],missingImages=[],cspMessages=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{
  if(/^https?:/iu.test(r.url()))httpRequests.push(r.url());
});
page.on('requestfailed',r=>missingImages.push(r.url()+':'+r.failure()?.errorText));
page.on('console',msg=>{
  if(/Content Security Policy|Refused to execute/iu.test(msg.text()))
    cspMessages.push(msg.text());
});
let accepted=false;
try{
  await page.goto(pathToFileURL(join(output,'index.html')).href,{
    waitUntil:'load',timeout:15000
  });
  assert.equal(await page.title(),'Private product walkthrough');
  assert.equal(await page.locator('script').count(),0);
  assert.equal(await page.locator('iframe').count(),0);
  assert.equal(await page.locator('form').count(),0);
  assert.equal(await page.locator('nav.navigator label').count(),2);
  assert.equal(await page.locator('.frame:visible').count(),1);
  assert.equal(await page.locator('#step-1').isChecked(),true);
  assert.equal(await page.locator('#frame-1').isVisible(),true);
  assert.equal(await page.locator('#frame-2').isVisible(),false);
  assert.equal(await page.locator('#frame-1 img').evaluate(el=>
    el.complete&&el.naturalWidth===640&&el.naturalHeight===360),true);
  assert.ok((await page.locator('body').innerText()).includes('TECHNICAL UNKNOWN'));
  assert.ok(!(await page.locator('body').innerText()).includes('/home/sergio'));
  assert.ok(!(await page.locator('body').innerText()).includes('platform_job_id'));
  await page.screenshot({path:join(output,'offline-first-1440.png'),fullPage:true});
  await page.locator('label[for="step-2"]').click();
  assert.equal(await page.locator('#step-2').isChecked(),true);
  assert.equal(await page.locator('#frame-2').isVisible(),true);
  assert.equal(await page.locator('#frame-1').isVisible(),false);
  assert.equal(await page.locator('#frame-2 img').evaluate(el=>
    el.complete&&el.naturalWidth===640&&el.naturalHeight===360),true);
  await page.screenshot({path:join(output,'offline-second-1440.png'),fullPage:true});
  // Native radio group remains operable from keyboard with zero custom JS.
  await page.locator('#step-1').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#step-2').isChecked(),true);
  // An inserted inline script must be refused by the package's own CSP.
  await page.evaluate(()=>{
    const test=document.createElement('script');
    test.textContent='window.__r43UnsafeScriptExecuted=true';
    document.body.appendChild(test);
  });
  assert.equal(await page.evaluate(()=>Boolean(window.__r43UnsafeScriptExecuted)),false);
  assert.ok(cspMessages.some(s=>/script-src|Content Security Policy/iu.test(s)),
    'Browser must report blocking the attempted inline script');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.locator('label[for="step-1"]').click();
    const metrics=await page.evaluate(()=>({
      document:document.documentElement.scrollWidth,viewport:innerWidth,
      visible:[...document.querySelectorAll('.frame')].filter(el=>
        getComputedStyle(el).display!=='none').length
    }));
    assert.ok(metrics.document<=width+1,
      'Offline demo has horizontal overflow at '+width+': '+JSON.stringify(metrics));
    assert.equal(metrics.visible,1);
    await page.screenshot({path:join(output,'offline-'+width+'.png'),fullPage:true});
  }
  // No HTTP is needed for tab changes, even with networking explicitly off.
  await page.context().setOffline(true);
  await page.locator('label[for="step-2"]').click();
  assert.equal(await page.locator('#frame-2').isVisible(),true);
  assert.deepEqual(httpRequests,[]);
  assert.deepEqual(missingImages,[]);
  assert.deepEqual(errors,[]);
  accepted=true;
}finally{
  const ci={
    schema_version:'launchwright-r43-browser-acceptance/1',
    source_sha:process.env.GITHUB_SHA??null,
    owned_synthetic_only:true,
    offline_chromium_navigation_passed:accepted,
    keyboard_radio_navigation_passed:accepted,
    script_csp_enforced:accepted,
    browser_viewports:[320,390,768,1440],
    actual_png_dimensions:[640,360],
    http_requests:httpRequests,
    page_errors:errors,
    failed_requests:missingImages,
    csp_denials:cspMessages.length,
    real_customer_capture:false,
    canonical_driver_host_acceptance:false,
    pixel_privacy_independently_verified:false,
    platform_authority:false,
    external_publication:false
  };
  writeFileSync(join(output,'browser-report.json'),JSON.stringify(ci,null,2)+'\n');
  await browser.close();
}
assert.equal(accepted,true);
process.stdout.write('R43 REAL OFFLINE CHROMIUM NAVIGATION PASS\n');
