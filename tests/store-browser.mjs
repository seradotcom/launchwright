#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R44 actual Playwright Chromium inspection of the two PRIVATE store previews.
// Screens are synthetic owned fixture images, not captured mobile devices.
import { chromium } from '../.ci-tools/node_modules/playwright/index.mjs';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const root=resolve(process.argv[2]??'evidence/store-assets');
const report=JSON.parse(readFileSync(join(root,'owned-smoke.json'),'utf8'));
assert.equal(report.schema_version,'launchwright-owned-store-fixture/1');
assert.equal(report.results.length,2);
const browser=await chromium.launch({headless:true});
const screenshots=[],errors=[],network=[];
const mediaWidths=[320,390,768,1440];
try{
  for(const entry of report.results){
    const directory=join(root,entry.output_folder);
    const zipName='launchwright-store-'+entry.plan_sha256.slice(0,12)+'.zip';
    const archive=await JSZip.loadAsync(readFileSync(join(directory,zipName)),
      {checkCRC32:true});
    const preview=await archive.file('preview.html').async('string');
    const pagePath=join(directory,'preview-local.html');
    writeFileSync(pagePath,preview,{mode:0o600});
    const manifest=JSON.parse(await archive.file('manifest.json').async('string'));
    assert.equal(manifest.store_policy_complete,false);
    assert.equal(manifest.store_account_accepted,false);
    assert.equal(manifest.source_pixel_authenticity,'operator-declaration-only');
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    page.on('pageerror',e=>errors.push(entry.platform+': '+e.message));
    page.on('request',request=>{
      if(/^https?:/iu.test(request.url()))network.push(request.url());
    });
    await page.goto(pathToFileURL(pagePath).href,{waitUntil:'load'});
    assert.equal(await page.title(),'Private store listing review');
    assert.equal(await page.locator('h1').innerText(),'Owned Synthetic Product');
    assert.ok((await page.locator('.pill').innerText()).includes('NOT PUBLISHED'));
    const images=page.locator('figure img');
    const expected=entry.screenshot_count+
      (entry.platform==='google-play-phone-portrait'?2:0);
    assert.equal(await images.count(),expected);
    assert.equal(await page.locator('script').count(),0);
    assert.equal(await page.locator('iframe').count(),0);
    assert.equal(await page.locator('a[href]').count(),0);
    for(const width of mediaWidths){
      await page.setViewportSize({width,height:900});
      const diagnostic=await page.evaluate(()=>({
        viewport:innerWidth,document:document.documentElement.scrollWidth,
        images:[...document.images].map(i=>({
          loaded:i.complete&&i.naturalWidth>0&&i.naturalHeight>0,
          actualWidth:i.naturalWidth,actualHeight:i.naturalHeight
        }))
      }));
      assert.ok(diagnostic.document<=width+1,
        'R44 offline store preview overflow at '+width+': '+JSON.stringify(diagnostic));
      assert.ok(diagnostic.images.every(i=>i.loaded),
        'R44 offline store preview images not loaded: '+JSON.stringify(diagnostic));
      const output='preview-'+entry.output_folder+'-'+width+'.png';
      await page.screenshot({path:join(root,output),fullPage:true});
      screenshots.push(output);
    }
    await page.close();
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(network,[]);
  const result={
    schema_version:'launchwright-r44-browser/1',
    real_chromium_test_passed:true,
    platforms_tested:report.results.map(x=>x.platform),
    viewport_widths:mediaWidths,
    page_errors:errors,network_requests:network,
    screenshot_files:screenshots,
    actual_mobile_device_tested:false,
    store_api_upload_performed:false,
    pixel_privacy_independently_verified:false,
    technical_state:'UNKNOWN',platform_authority:false
  };
  writeFileSync(join(root,'browser-result.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{await browser.close();}
