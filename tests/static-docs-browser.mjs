#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Genuine Chromium offline docs navigation from a synthetic owned Native
// Candidate, not a real customer/host/Platform capture.
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import JSZip from 'jszip';
import {chromium} from '../.ci-tools/node_modules/playwright/index.mjs';
import {makeOwnedStaticDocsFixture} from './static-docs-fixture.mjs';
import {planStaticDocs,exportStaticDocs} from '../src/static-docs.mjs';

const root=mkdtempSync(join(tmpdir(),'launchwright-r45-browser-'));
const evidence='evidence/static-docs/browser';
mkdirSync(evidence,{recursive:true});
let f=null,browser=null;
const errors=[],externalRequests=[],failedRequests=[];
let checked=false;
try{
  f=await makeOwnedStaticDocsFixture({root});
  const plan=await planStaticDocs(f.app,f.input);
  const receipt=await exportStaticDocs(f.app,plan,f.output,f.approve(plan));
  const zfile=join(f.output,'launchwright-docs-'+plan.plan_sha256.slice(0,12)+'.zip');
  const zip=await JSZip.loadAsync((await import('node:fs')).readFileSync(zfile),{
    checkCRC32:true
  });
  const site=join(root,'site');
  mkdirSync(site,{mode:0o700});
  for(const filename of Object.keys(zip.files)){
    assert.match(filename,/^(index|start|api|review)\.html$|^manifest\.json$/u);
    writeFileSync(join(site,filename),await zip.file(filename).async('nodebuffer'),{mode:0o600});
  }
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  page.on('request',r=>{
    if(!['file:','data:'].includes(new URL(r.url()).protocol))
      externalRequests.push(r.url());
  });
  page.on('requestfailed',r=>failedRequests.push({
    url:r.url(),error:r.failure()?.errorText??'unknown'
  }));
  await page.goto(pathToFileURL(join(site,'index.html')).href);
  await page.getByRole('heading',{name:'Documentation overview'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Getting started'}).count(),2);
  await page.locator('nav').getByRole('link',{name:'Getting started'}).click();
  await page.getByRole('heading',{name:'Getting started',exact:true}).waitFor();
  assert.ok((await page.locator('article').innerText()).includes('npm run start'));
  assert.ok(await page.locator('pre code[data-language="bash"]').isVisible());
  await page.locator('nav').getByRole('link',{name:'API guide'}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'API guide',exact:true}).waitFor();
  assert.ok((await page.locator('article').innerText()).includes('"published":false'));
  assert.equal(await page.locator('nav a[aria-current="page"]').innerText(),'API guide');
  await page.getByRole('link',{name:'Getting started'}).first().click();
  await page.getByRole('heading',{name:'Getting started',exact:true}).waitFor();
  await page.locator('.skip').focus();
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash,'#main-content');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    const frame=await page.evaluate(()=>({
      viewport:innerWidth,actual:document.documentElement.scrollWidth,
      content:document.querySelector('main').getBoundingClientRect().width
    }));
    assert.ok(frame.actual<=frame.viewport+1,
      'Offline documentation causes horizontal overflow '+width+': '+JSON.stringify(frame));
    await page.screenshot({
      path:evidence+'/docs-'+width+'.png',
      fullPage:true
    });
  }
  await page.locator('nav').getByRole('link',{name:'Editorial and source review'}).click();
  await page.getByRole('heading',{name:'Editorial and source review',exact:true}).waitFor();
  assert.ok((await page.locator('article').innerText()).includes('TECHNICAL UNKNOWN'));
  await page.screenshot({
    path:evidence+'/docs-review.png',fullPage:true
  });
  assert.deepEqual(externalRequests,[]);
  assert.deepEqual(failedRequests,[]);
  assert.deepEqual(errors,[]);
  checked=true;
  writeFileSync(evidence+'/result.json',JSON.stringify({
    schema_version:'launchwright-r45-browser-evidence/1',
    synthetic_fixture:true,passed:checked,
    candidate_sha256:plan.candidate_sha256,
    build_identity:plan.release_build,
    source_pages:plan.pages.map(p=>p.slug),
    archive_sha256:receipt.archive_sha256,
    viewport_widths_checked:[320,390,768,1440],
    keyboard_navigation_accepted:true,
    internal_links_opened:true,
    examples_rendered_as_inert_text:true,
    external_requests:externalRequests,failed_requests:failedRequests,
    page_errors:errors,
    customer_capture_accepted:false,
    external_publication:false,platform_authority:false,
    human_visual_review_pending:true
  },null,2)+'\n');
  console.log('R45_OWNED_OFFLINE_CHROMIUM_SITE_PASS',plan.candidate_sha256);
}finally{
  try{await browser?.close();}finally{
    try{f?.app.close();}finally{rmSync(root,{
      recursive:true,force:true,maxRetries:5,retryDelay:50
    });}
  }
}
