// SPDX-License-Identifier: AGPL-3.0-only
// Real R61 Chromium E2E: anchored click + keyboard links within R55 masked
// pixels, with file:// source, offline mode and no JavaScript network access.
import { chromium } from '../.ci-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { PNG } from 'pngjs';

const folder=resolve(process.env.LAUNCHWRIGHT_HOTSPOT_EVIDENCE_DIR??'evidence/offline-hotspots');
const data=JSON.parse(readFileSync(join(folder,'result.json'),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(data.real_owned_synthetic_fixture,true);
assert.equal(data.r55_mask_pixels_verified,true);
assert.equal(data.native_media_output_count,1);
assert.equal(data.technical_state,'UNKNOWN');
assert.equal(data.canonical_driver_host_accepted,false);
assert.equal(data.platform_authority,false);
assert.equal(data.customer_source_captured,false);
const bundle=readFileSync(join(folder,data.hotspot_bundle_filename));
assert.equal(sha(bundle),data.hotspot_bundle_sha256);
const zip=await JSZip.loadAsync(bundle,{checkCRC32:true});
assert.deepEqual(Object.keys(zip.files).sort(),['README.txt','index.html','manifest.json']);
const html=await zip.file('index.html').async('nodebuffer');
const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
assert.equal(sha(html),manifest.html_sha256);
assert.equal(manifest.r59_bundle_sha256,data.original_r59_bundle_sha256);
assert.equal(manifest.navigation_mode,'css-target-links');
assert.equal(manifest.technical_state,'UNKNOWN');
assert.equal(manifest.native_media_output_created,false);
assert.equal(manifest.platform_authority,false);
assert.equal(manifest.links.length,2);
assert.equal(manifest.masked_source_chain.length,2);

const browser=await chromium.launch({headless:true,
  executablePath:process.env.LAUNCHWRIGHT_BROWSER_EXECUTABLE??undefined});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const requests=[],failed=[],errors=[],csp=[];
page.on('request',r=>{if(/^https?:/u.test(r.url()))requests.push(r.url());});
page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(/Content Security Policy|Refused to execute/iu.test(m.text()))csp.push(m.text());});
let approved=false;
try{
  await page.goto(pathToFileURL(join(folder,'index.html')).href,{
    waitUntil:'load',timeout:15000
  });
  assert.equal(await page.title(),'Private click-through walkthrough');
  assert.equal(await page.locator('script,iframe,form,video').count(),0);
  assert.equal(await page.locator('a.hotspot').count(),2);
  assert.equal(await page.locator('.step-link').count(),2);
  assert.equal(await page.locator('#scene-1').isVisible(),true);
  assert.equal(await page.locator('#scene-2').isVisible(),false);
  assert.ok((await page.locator('body').innerText()).includes('TECHNICAL UNKNOWN'));
  assert.ok((await page.locator('body').innerText()).includes('DRAFT'));
  for(let i=1;i<=2;i++){
    const image=page.locator('#scene-'+i+' .surface img');
    const decoded=await image.evaluate(el=>({
      src:el.getAttribute('src'),loaded:el.complete,
      w:el.naturalWidth,h:el.naturalHeight
    }));
    assert.equal(decoded.loaded,true);
    assert.equal(decoded.w,640);
    assert.equal(decoded.h,360);
    const pixels=PNG.sync.read(Buffer.from(decoded.src.split(',')[1],'base64'),
      {checkCRC:true});
    assert.equal(sha(pixels.data),manifest.masked_source_chain[i-1].masked_pixel_sha256);
  }
  // Confirm the hotspot is truly geometrically aligned to original source
  // pixel coordinates rather than scaled relative to a letterboxed parent.
  const geometry=await page.locator('#scene-1 .surface').evaluate(surface=>{
    const img=surface.querySelector('img').getBoundingClientRect();
    const box=surface.querySelector('.hotspot').getBoundingClientRect();
    return{
      x:Math.round((box.left-img.left)*640/img.width),
      y:Math.round((box.top-img.top)*360/img.height),
      width:Math.round(box.width*640/img.width),
      height:Math.round(box.height*360/img.height),
      imageWidth:img.width,imageHeight:img.height
    };
  });
  for(const key of ['x','y','width','height'])
    assert.ok(Math.abs(geometry[key]-manifest.links[0][key])<=2,
      'Hotspot screen coordinates drifted: '+JSON.stringify(geometry));
  await page.screenshot({path:join(folder,'hotspots-first-1440.png'),fullPage:true});
  await page.locator('#zone-1').click();
  assert.equal(new URL(page.url()).hash,'#scene-2');
  assert.equal(await page.locator('#scene-2').isVisible(),true);
  assert.equal(await page.locator('#scene-1').isVisible(),false);
  await page.screenshot({path:join(folder,'hotspots-second-1440.png'),fullPage:true});
  // A is a native anchor, keyboard Enter navigates without JavaScript.
  await page.locator('#zone-2').focus();
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash,'#scene-1');
  assert.equal(await page.locator('#scene-1').isVisible(),true);
  await page.locator('.step-link[href="#scene-2"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#scene-2').isVisible(),true);
  // Attempt a malicious active script; CSP must reject it.
  await page.evaluate(()=>{
    const injected=document.createElement('script');
    injected.textContent='window.__r61UnsafeScriptExecuted=true';
    document.body.appendChild(injected);
  });
  assert.equal(await page.evaluate(()=>Boolean(window.__r61UnsafeScriptExecuted)),false);
  assert.ok(csp.some(x=>/Content Security Policy|script-src/iu.test(x)));
  // Every target also has an accessible 44px navigation link, independent of
  // the geometry-scaled screenshot hotspot on narrow mobile devices.
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.locator('.step-link[href="#scene-1"]').click();
    const dimensions=await page.evaluate(()=>{
      const nav=document.querySelector('.step-link');
      const visible=[...document.querySelectorAll('.frame')].filter(el=>
        getComputedStyle(el).display!=='none');
      return{
        viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        navHeight:nav.getBoundingClientRect().height,
        visible:visible.length,
        srcWidth:visible[0]?.querySelector('img')?.naturalWidth??0
      };
    });
    assert.ok(dimensions.scrollWidth<=width+1,
      'Responsive masked demo overflow: '+JSON.stringify(dimensions));
    assert.equal(dimensions.visible,1);
    assert.equal(dimensions.srcWidth,640);
    assert.ok(dimensions.navHeight>=44,
      'Keyboard/touch fallback target is too small');
    await page.screenshot({path:join(folder,'hotspots-'+width+'.png'),fullPage:true});
  }
  await page.context().setOffline(true);
  await page.locator('#zone-1').click();
  assert.equal(await page.locator('#scene-2').isVisible(),true);
  await page.locator('#zone-2').click();
  assert.equal(await page.locator('#scene-1').isVisible(),true);
  assert.deepEqual(requests,[]);
  assert.deepEqual(failed,[]);
  assert.deepEqual(errors,[]);
  approved=true;
}finally{
  const report={
    schema_version:'launchwright-r61-offline-hotspot-browser/1',
    source_sha:process.env.GITHUB_SHA??null,
    accepted_real_chromium:approved,
    masked_screenshot_pixels_verified:approved,
    hotspot_click_navigation:approved,
    hotspot_keyboard_enter_navigation:approved,
    exact_source_pixel_geometry:approved,
    keyboard_tab_fallback:approved,
    script_csp_enforced:approved,
    responsive_widths:[320,390,768,1440],
    remote_http_requests:requests,
    failed_requests:failed,
    page_errors:errors,
    csp_denials:csp.length,
    customer_source_execution:false,
    mask_outside_pii_verified:false,
    canonical_driver_host_accepted:false,
    technical_state:'UNKNOWN',
    platform_authority:false,external_publication:false
  };
  writeFileSync(join(folder,'browser-report.json'),
    JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await browser.close();
}
assert.equal(approved,true);
process.stdout.write('R61 EXACT R55/R59 MASKED HOTSPOT OFFLINE CHROMIUM PASS\n');
