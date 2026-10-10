// SPDX-License-Identifier: AGPL-3.0-only
// R59 genuine Chromium opens the exact owned synthetic R55/Native offline
// bundle, verifies CSP, links, keyboard navigation and all viewport widths.
import{chromium}from'../.ci-tools/node_modules/playwright/index.mjs';
import assert from'node:assert/strict';
import{readFileSync,writeFileSync}from'node:fs';
import{join,resolve}from'node:path';
import{pathToFileURL}from'node:url';
import{createHash}from'node:crypto';
import JSZip from'jszip';
import{PNG}from'pngjs';

const dir=resolve('evidence/masked-demo');
const report=JSON.parse(readFileSync(join(dir,'result.json'),'utf8'));
assert.equal(report.owned_synthetic_only,true);
assert.equal(report.independent_pixel_privacy_review,false);
assert.equal(report.external_publication,false);
assert.equal(report.technical_state,'UNKNOWN');
const bytes=readFileSync(join(dir,report.bundle_filename));
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(bytes),report.bundle_sha256);
const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
const html=await zip.file('index.html').async('nodebuffer');
assert.ok(html.equals(readFileSync(join(dir,'index.html'))));
const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
assert.equal(manifest.r59_plan_sha256,report.output_artifact.plan_sha256);
assert.equal(manifest.r55_mask_chain.length,2);
assert.equal(manifest.technical_state,'UNKNOWN');
assert.equal(manifest.source_scripts_executed,false);
assert.equal(manifest.platform_authority,false);
assert.equal(manifest.pixels_outside_masks_independently_private,false);
assert.equal(manifest.html_sha256,hash(html));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const requests=[],errors=[],networkFailures=[],csp=[];
page.on('request',r=>{if(/^https?:/iu.test(r.url()))requests.push(r.url());});
page.on('requestfailed',r=>networkFailures.push(r.url()+':'+r.failure()?.errorText));
page.on('pageerror',e=>errors.push(e.message));
page.on('console',msg=>{if(/Content Security Policy|Refused to execute/iu.test(msg.text()))csp.push(msg.text());});
let accepted=false;
try{
  await page.goto(pathToFileURL(join(dir,'index.html')).href,{
    waitUntil:'load',timeout:15000
  });
  assert.equal(await page.title(),'Private product walkthrough');
  assert.equal(await page.locator('script,iframe,form').count(),0);
  assert.equal(await page.locator('nav.navigator label').count(),2);
  assert.equal(await page.locator('#step-1').isChecked(),true);
  assert.equal(await page.locator('#frame-1').isVisible(),true);
  assert.equal(await page.locator('#frame-2').isVisible(),false);
  assert.ok((await page.locator('body').innerText()).includes('TECHNICAL UNKNOWN'));
  assert.ok((await page.locator('body').innerText()).includes('DRAFT'));
  assert.ok(!(await page.locator('body').innerText()).includes('/home/sergio'));
  const imgTags=page.locator('.frame img');
  assert.equal(await imgTags.count(),2);
  for(let i=0;i<2;i++){
    const actual=await imgTags.nth(i).evaluate(el=>{
      const src=el.getAttribute('src')??'';
      return{src,complete:el.complete,wide:el.naturalWidth,high:el.naturalHeight};
    });
    assert.equal(actual.complete,true);
    assert.equal(actual.wide,640);assert.equal(actual.high,360);
    assert.ok(actual.src.startsWith('data:image/png;base64,'));
    const png=PNG.sync.read(Buffer.from(actual.src.split(',')[1],'base64'),
      {checkCRC:true});
    assert.equal(hash(png.data),manifest.r55_mask_chain[i].masked_pixel_sha256);
  }
  await page.screenshot({path:join(dir,'masked-first-1440.png'),fullPage:true});
  await page.locator('label[for="step-2"]').click();
  assert.equal(await page.locator('#step-2').isChecked(),true);
  assert.equal(await page.locator('#frame-2').isVisible(),true);
  await page.screenshot({path:join(dir,'masked-second-1440.png'),fullPage:true});
  await page.locator('#step-1').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#step-2').isChecked(),true);
  await page.evaluate(()=>{
    const el=document.createElement('script');
    el.textContent='window.__unsafeR59ScriptWasExecuted=true';
    document.body.appendChild(el);
  });
  assert.equal(await page.evaluate(()=>Boolean(window.__unsafeR59ScriptWasExecuted)),false);
  assert.ok(csp.some(x=>/script-src|Content Security Policy/iu.test(x)));
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.locator('label[for="step-1"]').click();
    const state=await page.evaluate(()=>({
      width:innerWidth,documentWidth:document.documentElement.scrollWidth,
      visible:[...document.querySelectorAll('.frame')].filter(el=>
        getComputedStyle(el).display!=='none').length
    }));
    assert.ok(state.documentWidth<=width+1,
      'Offline masked demo horizontal viewport overflow: '+JSON.stringify(state));
    assert.equal(state.visible,1);
    await page.screenshot({path:join(dir,'masked-'+width+'.png'),fullPage:true});
  }
  await page.context().setOffline(true);
  await page.locator('label[for="step-2"]').click();
  assert.equal(await page.locator('#frame-2').isVisible(),true);
  assert.deepEqual(requests,[]);
  assert.deepEqual(networkFailures,[]);
  assert.deepEqual(errors,[]);
  accepted=true;
}finally{
  const evidence={
    schema_version:'launchwright-r59-browser-acceptance/1',
    source_sha:process.env.GITHUB_SHA??null,
    owned_synthetic_only:true,
    offline_masked_navigation_passed:accepted,
    image_pixels_match_r55:accepted,
    keyboard_radio_navigation_passed:accepted,
    script_csp_enforced:accepted,
    screen_widths:[320,390,768,1440],
    number_of_masked_native_images:2,
    http_requests:requests,
    failed_requests:networkFailures,page_errors:errors,
    csp_denials:csp.length,
    real_customer_capture:false,
    all_personal_data_removed:false,
    technical_state:'UNKNOWN',
    canonical_driver_host_acceptance:false,
    platform_authority:false,
    external_publication:false
  };
  writeFileSync(join(dir,'browser-report.json'),JSON.stringify(evidence,null,2)+'\n');
  await browser.close();
}
assert.equal(accepted,true);
process.stdout.write('R59 SOURCE-PINNED MASKED CHROMIUM OFFLINE NAVIGATION PASS\n');
